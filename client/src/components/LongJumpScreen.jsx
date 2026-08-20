import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import longJump, {
  ATTEMPTS,
  GAUGE_M,
  KIND,
  PERFECT_M,
  RUNWAY_M,
  flightPoint,
  zoneAt,
} from '@shared/events/long_jump.js';
import { babylon } from '../avatar3d/portraits.js';
import { createLongJumpArena } from '../arena3d/longJumpArena.js';
import { BUFFER_MS, sampleAt, serverNow } from '../net/interpolation.js';
import { t } from '../i18n.js';
import Flag from './Flag.jsx';
import FootPad from './FootPad.jsx';
import LongJumpLanes, { pctFor } from './LongJumpLanes.jsx';

// Same reconciliation the sprint uses: a small error eased away invisibly, a
// large one snapped, because holding a wrong position to look smooth is worse
// than one correction.
const RECONCILE_RATE = 3.5; // per second
const SNAP_DISTANCE = 4; // metres

// How much runway past the line the gauge shows. Red has to be a band you can
// see yourself entering, not a state you are only told about afterwards.
const RED_TAIL_M = 1.2;
const GAUGE_SPAN_M = GAUGE_M + RED_TAIL_M;

// The three bands, as percentages of the gauge. Derived from the sim's own
// metres so the picture cannot drift from the rule it is drawing.
const BAND = {
  good: ((GAUGE_M - PERFECT_M) / GAUGE_SPAN_M) * 100,
  perfect: (PERFECT_M / GAUGE_SPAN_M) * 100,
  foul: (RED_TAIL_M / GAUGE_SPAN_M) * 100,
};

/**
 * Long Jump.
 *
 * RUN (alternate thumbs down the runway) → JUMP (one press, as the white line
 * arrives) → the flight, drawn from the shared clock. Three attempts, best
 * counts.
 *
 * There is nothing to aim: every jump leaves at 45°, and the only question the
 * player answers is WHEN. Green is the last half-metre into the line and pays
 * the full speed you built; orange is the approach and pays three quarters of
 * it; over the line is a failed attempt. The gauge under the button is that
 * rule drawn to scale — no text explains it, because a bar that goes green
 * where you should press does not need explaining.
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
 * frame) and the DRAWN one. Prediction is not a nicety here — the line is
 * timed by eye, and an athlete drawn a tenth of a second in the past is an
 * athlete whose foot lands somewhere the player never chose.
 */
export default function LongJumpScreen({ room, me, netRef, sendInput }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const arenaRef = useRef(null);
  const stripRef = useRef(null); // flat fallback only
  const laneRefs = useRef(new Map()); // flat fallback only

  const clockRef = useRef(null);
  const scoreRef = useRef(null);
  const speedRef = useRef(null);
  const gaugeRef = useRef(null);
  const markerRef = useRef(null);
  const jumpRef = useRef(null);
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
  const attemptsUsed = snap?.a?.[myId]?.j?.length ?? 0;

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
          flightUntil: 0, flight: null, jumps: [], best: 0, lastTapAt: 0,
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
  // Two thumb pads run the athlete in; one button jumps. That is the whole
  // control scheme, and it is why nothing on this screen has to be explained.
  useEffect(() => {
    const liveAthlete = () => {
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      const a = latest?.a?.[myId];
      if (!a || a.st !== 'run') return null;
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
      if (!local || !liveAthlete()) return;

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

    const jump = () => {
      if (!liveAthlete()) return;
      sendInput({ t: 'jump' });
    };

    // Spacebar alternates on its own so a keyboard is playable at all; the side
    // keys give the real two-footed cadence on a desktop.
    const nextFoot = () => (predRef.current?.athletes[myId]?.foot === 1 ? 0 : 1);

    const onKeyDown = (e) => {
      if (e.repeat) return; // a held key is not a cadence
      if (e.code === 'Space') { e.preventDefault(); stride(nextFoot()); return; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); stride(0); return; }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); stride(1); return; }
      if (e.code === 'Enter' || e.code === 'ArrowUp') { e.preventDefault(); jump(); }
    };

    // `pointerdown`, not `click`: a click is only delivered on release, so a
    // fourteen-a-second cadence would arrive as fourteen late steps, and a jump
    // would be timed off the wrong end of the press. Each finger raises its own
    // pointerdown, so a thumb resting on one pad never blocks the other.
    const onPointerDown = (e) => {
      const pad = e.target.closest('[data-foot]');
      if (pad) {
        e.preventDefault();
        stride(Number(pad.dataset.foot));
        return;
      }
      if (e.target.closest('[data-jump]')) {
        e.preventDefault();
        jump();
      }
    };

    const zone = rootRef.current;
    zone?.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      zone?.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
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
          : t.secs(Math.max(0, Math.ceil((latest.e - now) / 1000)));
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
            // `step` can also end the attempt on its own, by running past the
            // line. That call is the server's; made here it would take the
            // attempt away a whole round trip early.
            if (local.stage !== 'run') {
              local.stage = 'run';
              local.x = server.x;
              local.v = server.v;
            } else {
              local.x += (server.x - local.x) * Math.min(1, RECONCILE_RATE * dt);
            }
          }
        } else {
          // In the air, or done: the server owns both, and there is nothing for
          // a prediction to add.
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

      if (speedRef.current) {
        speedRef.current.style.width = `${Math.min(100, ((meNow?.v ?? 0) / 10.5) * 100).toFixed(1)}%`;
      }

      // The score, and only the score: the jump being drawn while it is being
      // drawn, the best so far the rest of the time. The flight carries its own
      // result, so this needs neither a timer nor a piece of state.
      if (scoreRef.current) {
        const node = scoreRef.current;
        if (meNow?.st === 'flight' && meNow.f) {
          const [, , , distance, kind] = meNow.f;
          node.textContent = kind === KIND.FOUL ? t.ljFoul : `${distance.toFixed(2)}м`;
          node.dataset.tone = kind === KIND.FOUL ? 'foul' : kind === KIND.PERFECT ? 'perfect' : 'good';
        } else {
          node.textContent = `${(server?.bt ?? 0).toFixed(2)}м`;
          node.dataset.tone = 'plain';
        }
      }

      // --- the timing gauge -------------------------------------------------
      // One number decides everything on this screen: how far the athlete is
      // from the line. The marker rides it, the button wears its colour.
      const gap = meNow ? RUNWAY_M - meNow.x : RUNWAY_M;
      const zone = meNow && started && meNow.st === 'run' ? zoneAt(meNow.x) : 'early';

      if (markerRef.current) {
        const at = ((GAUGE_M - gap) / GAUGE_SPAN_M) * 100;
        markerRef.current.style.left = `${Math.max(0, Math.min(100, at)).toFixed(2)}%`;
      }
      if (gaugeRef.current) gaugeRef.current.dataset.live = zone === 'early' ? '0' : '1';
      if (jumpRef.current) jumpRef.current.dataset.zone = zone;

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

      {/* The whole HUD: attempt, clock, score, speed. Nothing else — the
          controls teach themselves. */}
      <header className="relative flex items-center justify-between px-5 pt-5">
        <p className="font-mono text-sm font-bold tabular-nums text-white/80 [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">
          {Math.min(attemptsUsed + 1, ATTEMPTS)}/{ATTEMPTS}
        </p>
        <p
          ref={clockRef}
          className="font-mono text-sm font-bold tabular-nums text-white/80 [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]"
        />
      </header>

      <p
        ref={scoreRef}
        data-tone="plain"
        className="relative mt-1 text-center font-mono text-4xl font-bold tabular-nums
                   [text-shadow:0_2px_8px_rgba(0,0,0,0.9)]
                   data-[tone=plain]:text-white data-[tone=good]:text-amber-300
                   data-[tone=perfect]:text-emerald-400 data-[tone=foul]:text-red-400"
      />

      <div className="relative mx-5 mt-3 h-1.5 overflow-hidden rounded-full bg-black/50">
        <div ref={speedRef} style={{ width: '0%' }} className="h-full rounded-full bg-sky-400" />
      </div>

      {arenaOk ? (
        <div className="flex-1" />
      ) : (
        <div className="px-5">
          <LongJumpLanes players={players} myId={myId} stripRef={stripRef} laneRefs={laneRefs} />
        </div>
      )}

      {/* Pads in the corners where the thumbs already are, the jump between
          them with its gauge directly above it — the bar and the button are one
          control, and putting the bar anywhere else would split the glance. */}
      <div className="relative mt-2 flex items-end justify-between gap-3 px-4 pb-6">
        <FootPad foot={0} label={t.leftFoot} nodeRef={(n) => { padRefs.current[0] = n; }} />

        <div className="flex flex-1 flex-col items-center gap-2">
          <TimingGauge gaugeRef={gaugeRef} markerRef={markerRef} />
          <button
            ref={jumpRef}
            type="button"
            data-jump
            data-zone="early"
            aria-label={t.ljJumpBtn}
            className="grid h-20 w-20 shrink-0 select-none place-items-center rounded-full border-2
                       text-sm font-bold tracking-widest transition-colors duration-75
                       data-[zone=early]:border-white/25 data-[zone=early]:bg-black/50
                       data-[zone=early]:text-white/40
                       data-[zone=good]:border-amber-300 data-[zone=good]:bg-amber-400/80
                       data-[zone=good]:text-neutral-950
                       data-[zone=perfect]:border-emerald-200 data-[zone=perfect]:bg-emerald-400
                       data-[zone=perfect]:text-neutral-950 data-[zone=perfect]:ring-4
                       data-[zone=perfect]:ring-emerald-300/50
                       data-[zone=foul]:border-red-300 data-[zone=foul]:bg-red-500/85
                       data-[zone=foul]:text-white"
          >
            {t.ljJumpBtn}
          </button>
        </div>

        <FootPad foot={1} label={t.rightFoot} nodeRef={(n) => { padRefs.current[1] = n; }} />
      </div>

      <Scoreboard room={room} snap={snap} meId={myId} />
    </div>
  );
}

/**
 * The timing gauge.
 *
 * The last few metres of runway drawn to scale: orange approach, a green band
 * for the last half-metre into the line, red past it. The marker is the
 * athlete. It is dimmed until the button goes live, so "not yet" is a state you
 * can see rather than a press that silently does nothing.
 */
function TimingGauge({ gaugeRef, markerRef }) {
  return (
    <div
      ref={gaugeRef}
      data-live="0"
      className="relative h-3 w-full max-w-[13rem] overflow-hidden rounded-full border border-white/20
                 bg-black/60 opacity-40 transition-opacity duration-150 data-[live='1']:opacity-100"
    >
      <div className="absolute inset-0 flex">
        <div style={{ width: `${BAND.good}%` }} className="h-full bg-amber-400/80" />
        <div style={{ width: `${BAND.perfect}%` }} className="h-full bg-emerald-400" />
        <div style={{ width: `${BAND.foul}%` }} className="h-full bg-red-500/85" />
      </div>
      <div
        ref={markerRef}
        style={{ left: '0%' }}
        className="absolute inset-y-0 w-1 -translate-x-1/2 rounded-full bg-white shadow
                   shadow-black/60 will-change-[left]"
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
              const kind = jump?.[1];
              return (
                <span
                  key={i}
                  className={[
                    'grid h-5 w-9 place-items-center rounded text-[10px] font-semibold tabular-nums',
                    !jump
                      ? 'bg-black/40 text-neutral-500'
                      : kind === KIND.FOUL
                        ? 'bg-red-500/25 text-red-300'
                        : kind === KIND.PERFECT
                          ? 'bg-emerald-500/25 text-emerald-300'
                          : 'bg-amber-500/25 text-amber-200',
                  ].join(' ')}
                >
                  {!jump ? '·' : kind === KIND.FOUL ? '✕' : jump[0].toFixed(2)}
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
