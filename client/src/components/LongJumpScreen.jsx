import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import longJump, {
  ATTEMPTS,
  IDEAL_ANGLE_DEG,
  KIND,
  PERFECT_M,
  RUNWAY_M,
  angleAt,
  flightPoint,
} from '@shared/events/long_jump.js';
import { babylon } from '../avatar3d/portraits.js';
import { createLongJumpArena } from '../arena3d/longJumpArena.js';
import { BUFFER_MS, sampleAt, serverNow } from '../net/interpolation.js';
import { t, lang } from '../i18n.js';
import Flag from './Flag.jsx';
import FootPad from './FootPad.jsx';
import LongJumpLanes, { BOARD_PCT, pctFor } from './LongJumpLanes.jsx';

// Same reconciliation the sprint uses: a small error eased away invisibly, a
// large one snapped, because holding a wrong position to look smooth is worse
// than one correction.
const RECONCILE_RATE = 3.5; // per second
const SNAP_DISTANCE = 4; // metres

// Inside this many metres of the board the readout stops being information and
// starts being a warning.
const CLOSE_M = 5;

/**
 * Long Jump.
 *
 * RUN (alternate thumbs down the runway) → TAKEOFF (press and HOLD to plant the
 * foot, ideally right on the board) → ANGLE (release as the dial passes 45°) →
 * the flight, drawn from the shared clock. Three attempts, best counts. Nothing
 * is a foul: stepping over the line costs metres, not the attempt.
 *
 * Nothing in the animation loop touches React state: at 60fps that would
 * re-render the tree sixty times a second. The loop writes transforms and text
 * straight to DOM nodes it holds refs to, and hands each athlete's
 * {x, v, st, f} to the 3D arena — which owns every mesh in the venue and not
 * one rule.
 *
 * Three positions exist for the local athlete and they are deliberately kept
 * apart: the SERVER's (authoritative, 20 Hz, arrives late), the PREDICTED one
 * (the same pure sim run locally on your own taps, so a tap moves you this
 * frame) and the DRAWN one. Prediction is not a nicety here — the board is
 * timed by eye, and an athlete drawn a tenth of a second in the past is an
 * athlete whose foot lands somewhere the player never chose.
 */
export default function LongJumpScreen({ room, me, netRef, sendInput, event }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const arenaRef = useRef(null);
  const stripRef = useRef(null); // flat fallback only
  const laneRefs = useRef(new Map()); // flat fallback only

  const clockRef = useRef(null);
  const readoutRef = useRef(null);
  const readoutLabelRef = useRef(null);
  const badgeRef = useRef(null);
  const speedRef = useRef(null);
  const stageRef = useRef(null);
  const dialRef = useRef(null);
  const needleRef = useRef(null);
  const dialTextRef = useRef(null);
  const padRefs = useRef([]);
  // When each thumb last went and whether it was the same one twice, so the
  // pads can flash the answer back.
  const strideFxRef = useRef([{ at: 0, wrong: false }, { at: 0, wrong: false }]);

  const predRef = useRef(null);
  const predStageRef = useRef('run');
  const rafRef = useRef(0);
  // What is on screen this frame, reused rather than rebuilt: this object is
  // touched sixty times a second.
  const drawnRef = useRef({});
  const sigRef = useRef('');

  const [snap, setSnap] = useState(null);
  // WebGL is not a given: locked-down WebViews and browsers with hardware
  // acceleration switched off both land on the flat strip, and so does anyone
  // whose engine throws on the way up.
  const [arenaOk, setArenaOk] = useState(() => Boolean(babylon()));

  const myId = me?.id;
  const players = room.players;
  const mine = snap?.a?.[myId] ?? null;
  const attemptsUsed = mine?.j?.length ?? 0;

  useLayoutEffect(() => {
    // Shaped exactly like one athlete in the shared sim, so the shared module
    // can be run over it verbatim rather than reimplemented here.
    predRef.current = {
      startsAt: null, // adopted from the first snapshot (server clock)
      endsAt: null,
      athletes: {
        [myId]: {
          lane: room.lanes?.[myId] ?? 1,
          stage: 'run', x: 0, v: 0, foot: -1, lastStepAt: 0,
          holdAt: 0, takeoffX: 0, flightUntil: 0, flight: null,
          jumps: [], best: 0, lastTapAt: 0,
        },
      },
    };
  }, [myId, room.lanes]);

  // --- the arena ----------------------------------------------------------
  // Built once for the whole event: the roster and the lane draw are locked
  // from the first attempt, so rebuilding the venue because a snapshot arrived
  // would be a stutter and a leak.
  const laneDraw = room.lanes;
  useEffect(() => {
    const B = babylon();
    const canvas = canvasRef.current;
    if (!B || !canvas) return undefined;

    let arena = null;
    let dead = false;

    // Never build against a 0x0 canvas: the buffer it produces stays 0x0 for
    // the life of the engine, and an embedded host reveals its iframe AFTER
    // load. Wait for a real size, then boot.
    const boot = () => {
      if (dead || arena || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
      try {
        arena = createLongJumpArena(B, canvas, { players, lanes: laneDraw, myId });
        arenaRef.current = arena;
      } catch {
        arena = null;
        setArenaOk(false); // the flat strip takes over
      }
    };

    const observer = new ResizeObserver(() => {
      boot();
      arena?.resize();
    });
    observer.observe(canvas);
    boot();

    return () => {
      dead = true;
      observer.disconnect();
      arenaRef.current = null;
      arena?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  // --- input --------------------------------------------------------------
  //
  // Two thumb pads run the athlete in; anywhere else on the screen is the
  // take-off. "Press and hold the screen" is the instruction the event is
  // taught with, so the screen — not a 90px button — is what answers to it: at
  // the speed the board arrives, hunting for a target is the difference between
  // a jump and a stumble.
  useEffect(() => {
    const stageOf = () => {
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      const a = latest?.a?.[myId];
      if (!a || a.st === 'done') return null;
      if (serverNow(net) < latest.s) return null; // still counting down
      return a;
    };

    /**
     * One stride. Applied to the prediction immediately AND sent up; the server
     * re-validates and re-runs the identical function as the authority.
     */
    const stride = (foot) => {
      const pred = predRef.current;
      const local = pred?.athletes[myId];
      if (!local || stageOf()?.st !== 'run') return;

      // Read the last foot BEFORE applying, or the sim has already overwritten
      // it and every step looks like a clean one. No local filtering beyond
      // that: the shared module decides what a step is worth, and a second rule
      // here would be a second implementation that drifts.
      const wrong = local.foot === foot;
      longJump.applyInput(pred, myId, { f: foot }, serverNow(netRef.current));
      sendInput({ f: foot });

      const fx = strideFxRef.current[foot];
      fx.at = performance.now();
      fx.wrong = wrong;
    };

    const press = () => {
      if (stageOf()?.st !== 'run') return;
      sendInput({ t: 'jump' });
    };

    const release = () => {
      const a = stageOf();
      if (a?.st !== 'takeoff') return;
      // Send the angle the player actually SAW, read off the same pure dial the
      // server will check it against — sampling only on the server would charge
      // every player their ping.
      const v = angleAt({ holdAt: a.ha }, serverNow(netRef.current));
      sendInput({ t: 'release', v: Math.round(v * 10) / 10 });
    };

    // Spacebar alternates on its own so a keyboard is playable at all; the side
    // keys give the real two-footed cadence on a desktop.
    const nextFoot = () => (predRef.current?.athletes[myId]?.foot === 1 ? 0 : 1);

    const onKeyDown = (e) => {
      if (e.repeat) return; // a held key is not a cadence
      if (e.code === 'Space') { e.preventDefault(); stride(nextFoot()); return; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); stride(0); return; }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); stride(1); return; }
      if (e.code === 'Enter' || e.code === 'ArrowUp') { e.preventDefault(); press(); }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Enter' || e.code === 'ArrowUp') { e.preventDefault(); release(); }
    };

    // `pointerdown`, not `click`: a click is only delivered on release, so a
    // fourteen-a-second cadence would arrive as fourteen late steps. Each
    // finger raises its own pointerdown, so a thumb resting on one pad never
    // blocks the other.
    const onPointerDown = (e) => {
      const pad = e.target.closest('[data-foot]');
      e.preventDefault();
      if (pad) stride(Number(pad.dataset.foot));
      else press();
    };

    const zone = rootRef.current;
    zone?.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // On the window, not the element: a finger that slides off before lifting
    // must still release the jump, or the athlete hangs on the board until the
    // sim's own timeout picks an angle for them.
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    return () => {
      zone?.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [myId, netRef, sendInput]);

  // --- scoreboard and clock, on a timer -----------------------------------
  // Deliberately not on rAF: a hidden tab stops rAF dead, and a scoreboard
  // frozen at zero looks like a crash.
  useEffect(() => {
    const sync = () => {
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      if (!latest) return;
      const now = serverNow(net);

      const sig = Object.values(latest.a ?? {})
        .map((p) => `${p.j.length}:${p.st}:${p.bt}`)
        .join('|');
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setSnap(latest);
      }

      if (clockRef.current) {
        const toGun = latest.s - now;
        clockRef.current.textContent = toGun > 0
          ? String(Math.ceil(toGun / 1000))
          : `${Math.max(0, Math.ceil((latest.e - now) / 1000))}s`;
      }

      const a = latest.a?.[myId];
      if (a && stageRef.current) {
        stageRef.current.textContent = now < latest.s
          ? t.getReady
          : a.st === 'run'
            ? t.ljRun
            : a.st === 'takeoff'
              ? t.ljAngle
              : a.st === 'flight'
                ? t.ljFlight
                : t.ljDone;
      }
    };

    sync();
    const id = setInterval(sync, 150);
    return () => clearInterval(id);
  }, [myId, netRef]);

  // --- render loop --------------------------------------------------------
  useEffect(() => {
    let last = performance.now();

    const frame = (now) => {
      rafRef.current = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const net = netRef.current;
      const pred = predRef.current;
      if (!pred || net.buffer.length === 0) return;

      const sNow = serverNow(net);
      // Remote athletes are drawn slightly in the past, so there is always a
      // frame on both sides of the moment being drawn.
      const authoritative = sampleAt(net, net.lastServerT - BUFFER_MS, ['x', 'v']);
      const latest = net.buffer[net.buffer.length - 1].s;
      if (pred.startsAt == null && latest.s) {
        pred.startsAt = latest.s;
        pred.endsAt = latest.e;
      }
      const started = sNow >= latest.s;

      // --- the local athlete ------------------------------------------------
      const local = pred.athletes[myId];
      const server = latest.a?.[myId];
      if (local && server) {
        if (server.st === 'run') {
          // A fresh attempt puts the athlete 38 metres back down the runway.
          // Adopt that wholesale rather than easing across the infield.
          if (predStageRef.current !== 'run' || Math.abs(server.x - local.x) > SNAP_DISTANCE) {
            local.x = server.x;
            local.v = server.v;
            local.lastStepAt = 0;
            local.foot = -1;
          } else {
            longJump.step(pred, dt, sNow);
            // `step` can also spend the attempt on its own, by running into the
            // sand. That call is the server's; made here it would teleport the
            // athlete back to the top of the runway a whole round trip early.
            if (local.stage !== 'run') {
              local.stage = 'run';
              local.x = server.x;
              local.v = server.v;
            } else {
              local.x += (server.x - local.x) * Math.min(1, RECONCILE_RATE * dt);
            }
          }
        } else {
          // Held on the board, or in the air: the server owns both, and there
          // is nothing for a prediction to add.
          local.x = server.x;
          local.v = server.v;
        }
        predStageRef.current = server.st;
      }

      // --- what everyone is doing this frame --------------------------------
      const drawn = drawnRef.current;
      for (const player of players) {
        const isMe = player.id === myId;
        const source = isMe ? latest.a?.[player.id] : authoritative?.a?.[player.id];
        if (!source) continue;
        const slot = drawn[player.id] ?? (drawn[player.id] = { x: 0, v: 0, st: 'run', f: null });
        slot.x = isMe && source.st === 'run' ? local.x : source.x;
        slot.v = source.v ?? 0;
        slot.st = source.st;
        slot.f = source.f ?? null;
      }

      const arena = arenaRef.current;
      if (arena) arena.render(dt, { athletes: drawn, started, myId, serverNow: sNow });
      else drawFlat(drawn, players, laneRefs.current, stripRef.current, sNow);

      // --- the HUD ----------------------------------------------------------
      const meNow = drawn[myId];
      const toBoard = meNow ? RUNWAY_M - meNow.x : RUNWAY_M;

      if (speedRef.current) {
        speedRef.current.style.width = `${Math.min(100, ((meNow?.v ?? 0) / 10.5) * 100).toFixed(1)}%`;
      }

      const node = readoutRef.current;
      const label = readoutLabelRef.current;
      const badge = badgeRef.current;
      if (node) {
        if (!started) {
          node.textContent = '';
          node.dataset.tone = 'plain';
          if (label) label.textContent = '';
          if (badge) badge.textContent = '';
        } else if (meNow?.st === 'flight' && meNow.f) {
          // The flight carries its own result, so the measurement needs neither
          // a timer nor a piece of state: it is on screen exactly as long as
          // the jump it belongs to.
          const [, , , distance, , kind] = meNow.f;
          node.textContent = `${distance.toFixed(2)}м`;
          node.dataset.tone = kind === KIND.PERFECT ? 'good' : kind === KIND.OVERSTEP ? 'warn' : 'plain';
          if (label) label.textContent = t.ljMeasured;
          if (badge) {
            badge.textContent = kind === KIND.PERFECT
              ? t.ljPerfect
              : kind === KIND.OVERSTEP
                ? t.ljOverstep
                : '';
            badge.dataset.tone = kind === KIND.PERFECT ? 'good' : 'warn';
          }
        } else if (meNow?.st === 'done') {
          node.textContent = `${(server?.bt ?? 0).toFixed(2)}м`;
          node.dataset.tone = 'plain';
          if (label) label.textContent = t.ljBest;
          if (badge) badge.textContent = '';
        } else {
          // Metres to the board — the only number that matters on the way in,
          // and the one the event is timed against. It goes NEGATIVE past the
          // line rather than clamping at zero: over the board is a price, not a
          // wall, and a player has to be able to see what they are paying.
          node.textContent = toBoard >= 0 ? `${toBoard.toFixed(1)}м` : `+${(-toBoard).toFixed(1)}м`;
          node.dataset.tone = toBoard < 0
            ? 'warn'
            : toBoard <= PERFECT_M ? 'good' : toBoard < CLOSE_M ? 'close' : 'plain';
          if (label) label.textContent = t.ljToBoard;
          if (badge) badge.textContent = '';
        }
      }

      // --- the angle dial ---------------------------------------------------
      const dial = dialRef.current;
      if (dial) {
        const live = meNow?.st === 'takeoff' && server;
        if (live) {
          const angle = angleAt({ holdAt: server.ha }, sNow);
          if (needleRef.current) {
            needleRef.current.setAttribute('transform', `rotate(${-angle.toFixed(1)} 14 106)`);
          }
          if (dialTextRef.current) dialTextRef.current.textContent = `${Math.round(angle)}°`;
          dial.dataset.good = Math.abs(angle - IDEAL_ANGLE_DEG) < 6 ? '1' : '0';

          // Beside the athlete in 3D, over the board on the flat strip: either
          // way it is next to the thing it describes, rather than parked in a
          // corner of the HUD where reading it costs a glance away from the
          // board.
          const at = arena?.headScreenPos(myId) ?? flatDialPos(stripRef.current);
          if (at) {
            dial.style.opacity = '1';
            dial.style.transform = `translate3d(${at.x}px, ${at.y}px, 0) translate(-112%, -58%)`;
          } else {
            dial.style.opacity = '0';
          }
        } else {
          dial.style.opacity = '0';
        }
      }

      // --- the pads answer back --------------------------------------------
      const canRun = meNow?.st === 'run' && started;
      const lastFoot = local?.foot ?? -1;
      for (let foot = 0; foot < 2; foot += 1) {
        const pad = padRefs.current[foot];
        if (!pad) continue;
        const fx = strideFxRef.current[foot];
        const hit = Math.max(0, 1 - (now - fx.at) / 190);
        // Before the first step either thumb opens; after that it is strictly
        // the one that did not just go.
        pad.dataset.next = canRun && (lastFoot === -1 || lastFoot !== foot) ? '1' : '0';
        pad.dataset.hit = hit > 0 ? (fx.wrong ? 'wrong' : 'clean') : 'no';
        pad.style.transform = `scale(${1 - hit * 0.07})`;
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [myId, netRef, players]);

  return (
    <div
      ref={rootRef}
      data-lj-root
      className="relative flex min-h-full touch-none select-none flex-col overflow-hidden"
    >
      {arenaOk ? (
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full outline-none" aria-hidden="true" />
      ) : null}

      <header className="relative flex items-baseline justify-between px-5 pt-5">
        <p className="label mb-0 text-white/70 [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">
          {event?.name?.[lang] ?? event?.name?.en}
        </p>
        <p
          ref={clockRef}
          className="font-mono text-lg font-bold tabular-nums [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]"
        >
          –
        </p>
      </header>

      <div className="relative mt-1 text-center">
        <p
          ref={readoutRef}
          data-tone="plain"
          className="font-mono text-4xl font-bold tabular-nums [text-shadow:0_2px_8px_rgba(0,0,0,0.9)]
                     data-[tone=plain]:text-white data-[tone=close]:text-amber-300
                     data-[tone=good]:text-emerald-400 data-[tone=warn]:text-red-400"
        />
        <p ref={readoutLabelRef} className="text-[11px] uppercase tracking-wider text-white/60" />
        <p
          ref={badgeRef}
          data-tone="good"
          className="mt-0.5 text-sm font-bold tracking-wide
                     data-[tone=good]:text-emerald-400 data-[tone=warn]:text-amber-400"
        />
      </div>

      {arenaOk ? (
        <div className="flex-1" />
      ) : (
        // NOT `relative`: the dial is placed against the root, and a positioned
        // wrapper here would silently become the strip's offsetParent and take
        // the dial's anchor with it.
        <div className="px-5">
          <LongJumpLanes players={players} myId={myId} stripRef={stripRef} laneRefs={laneRefs} />
        </div>
      )}

      {/* Speed and the attempt count on one line: two numbers that only mean
          anything next to each other — a fast run-up is worth nothing on your
          last attempt if you cannot put the foot down. */}
      <div className="relative mt-2 flex items-center gap-3 px-5">
        <span className="text-[10px] uppercase tracking-wider text-white/60">{t.speed}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/50">
          <div ref={speedRef} style={{ width: '0%' }} className="h-full rounded-full bg-sky-400" />
        </div>
        <span className="text-xs text-white/70">
          {t.ljAttempt(Math.min(attemptsUsed + 1, ATTEMPTS), ATTEMPTS)}
        </span>
      </div>

      <p
        ref={stageRef}
        className="relative mt-2 text-center text-sm font-semibold text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]"
      >
        –
      </p>

      {/* The pads, hard into the bottom corners — where the thumbs already are
          when a phone is held in two hands. Everything between them, and every
          other pixel on the screen, is the take-off. */}
      <div className="relative mt-2 flex items-end justify-between px-4 pb-5">
        <FootPad foot={0} label={t.leftFoot} nodeRef={(n) => { padRefs.current[0] = n; }} />
        <div className="pointer-events-none mb-4 flex-1 px-2 text-center">
          <p className="text-xs font-bold tracking-wide text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]">
            {t.ljHoldBtn}
          </p>
          <p className="mt-1 text-[11px] leading-tight text-white/70 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]">
            {t.ljHint}
          </p>
        </div>
        <FootPad foot={1} label={t.rightFoot} nodeRef={(n) => { padRefs.current[1] = n; }} />
      </div>

      <AngleDial nodeRef={dialRef} needleRef={needleRef} textRef={dialTextRef} />

      <Scoreboard room={room} snap={snap} meId={myId} />
    </div>
  );
}

/**
 * The angle indicator.
 *
 * A quarter dial that sweeps 0°→90° and back for as long as the take-off is
 * held, with the 45° band it is aimed at drawn ON it rather than described in a
 * hint underneath. The needle is written by the render loop; React never
 * re-renders this.
 */
function AngleDial({ nodeRef, needleRef, textRef }) {
  return (
    <div
      ref={nodeRef}
      data-good="0"
      style={{ opacity: 0 }}
      className="group pointer-events-none absolute left-0 top-0 h-32 w-32 transition-opacity
                 duration-150 will-change-transform"
    >
      <svg viewBox="0 0 128 128" className="h-full w-full overflow-visible">
        {/* the sweep, and the band worth hitting */}
        <path d="M14 106 A 78 78 0 0 1 92 28" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="14" strokeLinecap="round" />
        <path d="M14 106 A 78 78 0 0 1 92 28" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
        <path d="M50.9 41.3 A 78 78 0 0 1 63.9 33.9" fill="none" stroke="#34d399" strokeWidth="12" />
        <text x="86" y="26" fill="#34d399" fontSize="15" fontWeight="700" textAnchor="middle">45°</text>

        <g ref={needleRef} transform="rotate(0 14 106)">
          <line x1="14" y1="106" x2="86" y2="106" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" />
          {/* an arrowhead, so it reads as a direction rather than a clock hand */}
          <path d="M84 98 L100 106 L84 114 Z" fill="#ffffff" />
        </g>
        <circle cx="14" cy="106" r="7" fill="#0f1420" stroke="#ffffff" strokeWidth="3" />
      </svg>

      <span
        ref={textRef}
        className="absolute bottom-0 right-0 rounded bg-black/70 px-1.5 py-0.5 font-mono text-sm font-bold
                   tabular-nums text-white group-data-[good='1']:bg-emerald-500
                   group-data-[good='1']:text-neutral-950"
      />
    </div>
  );
}

/**
 * The flat strip's athletes, when there is no WebGL to draw them properly.
 * Kept here rather than in the strip component because it is the same per-frame
 * write the arena does — a component re-rendering ten rows sixty times a second
 * would cost more than the 3D scene it is standing in for.
 */
function drawFlat(drawn, players, laneNodes, strip, sNow) {
  if (!strip) return;
  for (const player of players) {
    const node = laneNodes.get(player.id);
    const at = drawn[player.id];
    if (!node || !at) continue;
    let { x } = at;
    let y = 0;
    if (at.st === 'flight' && at.f) {
      const point = flightPoint(at.f, sNow);
      x = point.x;
      y = point.y;
    }
    node.style.left = `${pctFor(x).toFixed(2)}%`;
    node.style.bottom = `${(14 + y * 6).toFixed(1)}px`; // ~6px to the metre
    node.dataset.stage = at.st;
  }
}

/** Where the dial sits with no arena to hang it off: over the board. */
function flatDialPos(strip) {
  if (!strip) return null;
  return {
    x: strip.offsetLeft + (strip.offsetWidth * BOARD_PCT) / 100,
    y: strip.offsetTop + strip.offsetHeight * 0.4,
  };
}

function Scoreboard({ room, snap, meId }) {
  const rows = room.players
    .map((p) => ({ player: p, a: snap?.a?.[p.id] }))
    .sort((x, y) => (y.a?.bt ?? 0) - (x.a?.bt ?? 0));

  return (
    <ul className="relative mt-auto space-y-1 px-5 pb-5">
      {rows.map(({ player, a }) => (
        <li
          key={player.id}
          className={[
            'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm backdrop-blur-sm',
            player.id === meId ? 'bg-white/20' : 'bg-black/45',
          ].join(' ')}
        >
          <Flag code={player.country} className="h-3 w-4.5" />
          <span className="min-w-0 flex-1 truncate">{player.name}</span>
          <span className="flex gap-1">
            {Array.from({ length: ATTEMPTS }, (_, i) => {
              const jump = a?.j?.[i];
              const kind = jump?.[2];
              return (
                <span
                  key={i}
                  className={[
                    'grid h-5 w-9 place-items-center rounded text-[10px] font-semibold tabular-nums',
                    !jump
                      ? 'bg-black/40 text-neutral-500'
                      : kind === KIND.NO_JUMP
                        ? 'bg-neutral-700/60 text-neutral-400'
                        : kind === KIND.PERFECT
                          ? 'bg-emerald-500/25 text-emerald-300'
                          : kind === KIND.OVERSTEP
                            ? 'bg-amber-500/25 text-amber-200'
                            : 'bg-neutral-700 text-neutral-100',
                  ].join(' ')}
                >
                  {!jump ? '·' : kind === KIND.NO_JUMP ? '–' : jump[0].toFixed(2)}
                </span>
              );
            })}
          </span>
          <span className="w-12 text-right font-mono font-semibold tabular-nums">
            {(a?.bt ?? 0).toFixed(2)}
          </span>
        </li>
      ))}
    </ul>
  );
}
