import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import sprint, { COUNTDOWN_MS, RACE_DISTANCE } from '@shared/events/sprint_100m.js';
import { babylon } from '../avatar3d/portraits.js';
import { createSprintArena } from '../arena3d/sprintArena.js';
import { BUFFER_MS, sampleAt, serverNow } from '../net/interpolation.js';
import { t } from '../i18n.js';
import Flag from './Flag.jsx';
import FootPad from './FootPad.jsx';
import SprintLanes from './SprintLanes.jsx';

// How hard a position error is pulled back toward the server each frame, and
// the gap past which we stop easing and just snap. Small errors are smoothed
// away invisibly; a large one means we are wrong about the world, and holding a
// wrong position to look smooth is worse than a single correction.
const RECONCILE_RATE = 3.5; // per second
const SNAP_DISTANCE = 5; // metres

// Ranks are recomputed on a slow tick, not every frame: the order changes a
// handful of times in ten seconds, and sorting the field at 60fps to learn
// nothing is pure garbage. Marker POSITIONS still move every frame.
const RANK_INTERVAL_MS = 120;

const MEDAL_TONE = ['#ffd23f', '#dbe4ee', '#e8834a'];

/**
 * The 100m Dash.
 *
 * Three positions exist for the local runner and they are deliberately kept
 * apart: the SERVER's (authoritative, 20 Hz, arrives late), the PREDICTED one
 * (the same pure sim run locally on your own taps, so a tap moves you this
 * frame), and the DRAWN one (predicted, eased toward the server). Remote
 * runners have no prediction at all — they are interpolated ~100ms in the past.
 *
 * Nothing in the animation loop touches React state: at 60fps that would
 * re-render the tree 60 times a second. The loop writes transforms straight to
 * DOM nodes it holds refs to, and hands each athlete's {x, v, done} to the 3D
 * arena — which owns every mesh in the stadium and not one rule.
 */
export default function SprintScreen({ room, me, netRef, sendInput, event }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const arenaRef = useRef(null);
  const trackRef = useRef(null); // flat fallback only
  const laneRefs = useRef(new Map()); // flat fallback only
  const hudRef = useRef(null);
  const markerRefs = useRef([]);
  const speedRefs = useRef([]);
  const padRefs = useRef([]);
  // When each foot last landed and whether it was the same one twice, so the
  // pads can flash the answer back.
  const strideFxRef = useRef([{ at: 0, wrong: false }, { at: 0, wrong: false }]);

  // Local prediction state, shaped exactly like one athlete in the shared sim
  // so the shared module can be run over it verbatim.
  const predRef = useRef(null);
  const rafRef = useRef(0);

  // What is on screen this frame, reused rather than rebuilt: this object is
  // touched sixty times a second.
  const drawnRef = useRef({});
  const rankRef = useRef([]);
  const nextRankAt = useRef(0);

  const myId = me?.id;
  const players = room.players;

  // WebGL is not a given: locked-down WebViews and browsers with hardware
  // acceleration switched off both land on the flat lanes, and so does anyone
  // whose engine throws on the way up.
  const [arenaOk, setArenaOk] = useState(() => Boolean(babylon()));
  const [leaders, setLeaders] = useState([]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  useLayoutEffect(() => {
    predRef.current = {
      startsAt: null, // adopted from the first snapshot (server clock)
      endsAt: null,
      athletes: {
        [myId]: {
          lane: room.lanes?.[myId] ?? 1,
          x: 0, v: 0, foot: -1, steps: 0, lastStepAt: 0, lastGap: 0,
          blockedUntil: 0, falseStart: false, done: false, time: null,
        },
      },
    };
  }, [myId, room.lanes]);

  // --- the arena ----------------------------------------------------------
  // Built once for the whole event. The roster and the lane draw are locked
  // from the gun, so there is nothing here to react to — rebuilding the
  // stadium because a snapshot arrived would be a stutter and a leak.
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
        arena = createSprintArena(B, canvas, { players, lanes: laneDraw, myId });
        arenaRef.current = arena;
      } catch {
        arena = null;
        setArenaOk(false); // the flat lanes take over
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
  // Two thumb pads, one in each bottom corner: tap them in alternation and you
  // accelerate, tap the same one twice and you slow down. The slowing is not
  // enforced here — the shared sim pays a same-foot step less than a quarter of
  // a stride's impulse, which is well under what drag takes back at speed, so a
  // one-thumbed masher decelerates on his own. One rule, in one place, that the
  // server runs too.
  //
  // What this file owes the player is knowing WHICH thumb is next, which is
  // what the ring on the pads is for.
  useEffect(() => {
    /**
     * One footstep. Applied to the prediction immediately AND sent up; the
     * server re-validates and re-runs the identical function as the authority.
     */
    const stride = (foot) => {
      const pred = predRef.current;
      const mine = pred?.athletes[myId];
      if (!mine || mine.done) return;

      // No local filtering: the shared module already decides what a step is
      // worth (including breaking the stride when it comes too early). A second
      // rule here would be a second implementation, and the prediction would
      // drift away from the server the moment the two disagreed.
      // Read the last foot BEFORE applying, or the sim has already overwritten
      // it and every step looks like a clean one.
      const wrong = mine.foot === foot;

      const now = serverNow(netRef.current);
      sprint.applyInput(pred, myId, { f: foot }, now);
      sendInput({ f: foot });

      const fx = strideFxRef.current[foot];
      fx.at = performance.now();
      fx.wrong = wrong;
    };

    // Spacebar alternates on its own, so a keyboard is playable at all; the
    // side keys give the real two-footed cadence on a desktop.
    const nextFoot = () => (predRef.current?.athletes[myId]?.foot === 1 ? 0 : 1);

    const onKeyDown = (e) => {
      if (e.repeat) return; // a held key is not a cadence
      if (e.code === 'Space') { e.preventDefault(); stride(nextFoot()); return; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); stride(0); return; }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); stride(1); }
    };

    const zone = rootRef.current;

    // `pointerdown`, not `click`: a click is only delivered on release, so a
    // fourteen-a-second cadence would arrive as fourteen late steps. Each
    // finger raises its own pointerdown, so a thumb resting on one pad never
    // blocks the other.
    const onPointerDown = (e) => {
      const pad = e.target.closest('[data-foot]');
      if (!pad) return;
      e.preventDefault();
      stride(Number(pad.dataset.foot));
    };

    zone?.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      zone?.removeEventListener('pointerdown', onPointerDown);
    };
  }, [myId, netRef, sendInput]);

  /**
   * Finishing order from what is being DRAWN, not from the last packet: the
   * badge over a runner's head has to agree with the runner under it. Same
   * rule as the sim's own `placements` — finishers by time, everyone else by
   * distance — so it can never disagree with the results screen either.
   */
  const rankOrder = useCallback((drawn) => {
    const ids = Object.keys(drawn);
    ids.sort((a, b) => {
      const x = drawn[a];
      const y = drawn[b];
      if (x.done !== y.done) return x.done ? -1 : 1;
      if (x.done && y.done && x.time !== y.time) return (x.time ?? 0) - (y.time ?? 0);
      return y.x - x.x;
    });
    return ids.slice(0, 3);
  }, []);

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
      // Draw the world slightly in the past so there is always a frame on both
      // sides of the moment being drawn.
      const authoritative = sampleAt(net, net.lastServerT - BUFFER_MS, ['x', 'v']);
      const latest = net.buffer[net.buffer.length - 1].s;

      if (pred.startsAt == null && latest.s) {
        pred.startsAt = latest.s;
        pred.endsAt = latest.e;
      }

      // Advance the local prediction, then ease it toward the server.
      const mine = pred.athletes[myId];
      const server = latest.a?.[myId];
      if (mine && server) {
        sprint.step(pred, dt, sNow);
        if (server.d) {
          mine.done = true;
          mine.x = RACE_DISTANCE;
          mine.time = server.t;
        }
        const error = server.x - mine.x;
        if (Math.abs(error) > SNAP_DISTANCE) mine.x = server.x;
        else mine.x += error * Math.min(1, RECONCILE_RATE * dt);
      }

      const startsAt = pred.startsAt ?? sNow + COUNTDOWN_MS;
      const toGun = startsAt - sNow;
      const started = toGun <= 0;

      const drawn = drawnRef.current;
      const arena = arenaRef.current;
      const trackWidth = trackRef.current?.clientWidth ?? 0;
      const travel = Math.max(trackWidth - 40, 0);

      for (const player of players) {
        const isMe = player.id === myId;
        const source = isMe ? mine : authoritative?.a?.[player.id];
        if (!source) continue;
        const x = Math.max(0, Math.min(source.x, RACE_DISTANCE));
        const done = Boolean(source.d || source.done);

        const slot = drawn[player.id] ?? (drawn[player.id] = { x: 0, v: 0, done: false, time: null });
        slot.x = x;
        slot.v = done ? 0 : Math.max(0, source.v ?? 0);
        slot.done = done;
        slot.time = source.t ?? source.time ?? null;

        const node = laneRefs.current.get(player.id);
        if (node) {
          node.style.transform = `translate3d(${(x / RACE_DISTANCE) * travel}px, 0, 0)`;
          node.dataset.done = done ? '1' : '0';
        }
      }

      if (arena) {
        arena.render(dt, { athletes: drawn, started, myId });

        if (now >= nextRankAt.current) {
          nextRankAt.current = now + RANK_INTERVAL_MS;
          const top = rankOrder(drawn);
          if (top.join('|') !== rankRef.current.join('|')) {
            rankRef.current = top;
            // The only state this loop sets, and only when the order really
            // changed: the badge has to re-render to swap flag and name.
            setLeaders(top);
          }
        }

        for (let i = 0; i < 3; i += 1) {
          const node = markerRefs.current[i];
          if (!node) continue;
          const id = rankRef.current[i];
          const at = started && id ? arena.headScreenPos(id) : null;
          if (!at) {
            node.style.opacity = '0';
            continue;
          }
          node.style.opacity = '1';
          node.style.transform = `translate3d(${at.x}px, ${at.y}px, 0) translate(-50%, -100%)`;
          const speed = speedRefs.current[i];
          if (speed) speed.textContent = `${(drawn[id]?.v ?? 0).toFixed(1)} ${t.mps}`;
        }
      }

      // The pads answer back: which thumb is owed the next step, and whether
      // the last one landed clean. Driven from the loop that is already
      // running rather than a timer per tap — at fourteen taps a second,
      // timers would be the most expensive thing on the screen.
      const lastFoot = mine?.foot ?? -1;
      for (let foot = 0; foot < 2; foot += 1) {
        const pad = padRefs.current[foot];
        if (!pad) continue;
        const fx = strideFxRef.current[foot];
        const hit = Math.max(0, 1 - (now - fx.at) / 190);
        // Before the first step either thumb opens; after that it is strictly
        // the one that did not just go.
        pad.dataset.next = lastFoot === -1 || lastFoot !== foot ? '1' : '0';
        pad.dataset.hit = hit > 0 ? (fx.wrong ? 'wrong' : 'clean') : 'no';
        pad.style.transform = `scale(${1 - hit * 0.07})`;
      }

      if (hudRef.current) {
        if (toGun > 0) {
          hudRef.current.textContent = String(Math.ceil(toGun / 1000));
          hudRef.current.dataset.state = 'countdown';
        } else if (mine?.done) {
          hudRef.current.textContent = `${(mine.time / 1000).toFixed(2)}s`;
          hudRef.current.dataset.state = 'done';
        } else if (mine?.falseStart && toGun > -1200) {
          hudRef.current.textContent = t.falseStart;
          hudRef.current.dataset.state = 'false';
        } else {
          hudRef.current.textContent = `${((mine?.x ?? 0)).toFixed(0)}м`;
          hudRef.current.dataset.state = 'running';
        }
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [myId, netRef, players, rankOrder]);

  return (
    <div
      ref={rootRef}
      data-sprint-root
      className="relative flex min-h-full touch-none select-none flex-col overflow-hidden"
    >
      {arenaOk ? (
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full outline-none" aria-hidden="true" />
      ) : null}

      {/* Rank badges. Three slots, one per medal position — a badge belongs to
          the PLACE, not to a player, so a lead change moves it rather than
          growing a fourth one. */}
      {arenaOk ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <RankMarker
              key={i}
              rank={i + 1}
              player={byId.get(leaders[i])}
              nodeRef={(node) => { markerRefs.current[i] = node; }}
              speedRef={(node) => { speedRefs.current[i] = node; }}
            />
          ))}
        </div>
      ) : null}

      <header className="relative px-5 pt-6 text-center">
        <p className="label mb-1 text-white/70 [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">
          {event?.name?.mn ?? event?.name?.en}
        </p>
        <p
          ref={hudRef}
          data-state="countdown"
          className="font-mono text-4xl font-bold tabular-nums [text-shadow:0_2px_8px_rgba(0,0,0,0.9)]
                     data-[state=countdown]:text-white
                     data-[state=false]:text-amber-400 data-[state=false]:text-2xl
                     data-[state=done]:text-emerald-400"
        >
          {Math.ceil(COUNTDOWN_MS / 1000)}
        </p>
      </header>

      {arenaOk ? (
        <div className="flex-1" />
      ) : (
        <SprintLanes players={players} myId={myId} trackRef={trackRef} laneRefs={laneRefs} />
      )}

      {/* Thumb pads, hard into the bottom corners — where the thumbs already
          are when a phone is held in two hands, and as far from the runners as
          the screen allows. */}
      <div className="relative px-4 pb-8 pt-2">
        {/* The hint gets the full width, ABOVE the pads. Wedged between them it
            had about a hundred pixels to hold a whole sentence, so it stacked
            into a narrow column in the gap and read as a third control rather
            than as a caption for the two. */}
        <p
          className={[
            'pointer-events-none mb-3 text-center text-xs leading-snug',
            arenaOk ? 'text-white/80 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]' : 'text-neutral-500',
          ].join(' ')}
        >
          {t.sprintHint}
        </p>
        <div className="flex items-end justify-between">
          <FootPad foot={0} label={t.leftFoot} nodeRef={(n) => { padRefs.current[0] = n; }} />
          <FootPad foot={1} label={t.rightFoot} nodeRef={(n) => { padRefs.current[1] = n; }} />
        </div>
      </div>
    </div>
  );
}

/** One medal position's badge, floating over whoever currently holds it. */
function RankMarker({ rank, player, nodeRef, speedRef }) {
  const tone = MEDAL_TONE[rank - 1];
  return (
    <div ref={nodeRef} className="absolute left-0 top-0 flex flex-col items-center opacity-0 will-change-transform">
      <div className="flex items-center gap-1 rounded-full border border-white/15 bg-black/60 px-2 py-0.5">
        {player ? <Flag code={player.country} className="h-2.5 w-3.5 shrink-0" /> : null}
        <span className="text-[11px] font-bold leading-none" style={{ color: tone }}>
          {t.placeShort(rank)}
        </span>
        <span ref={speedRef} className="font-mono text-[11px] font-semibold leading-none tabular-nums text-white" />
      </div>
      {/* The pointer that ties the badge to the head under it. */}
      <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true">
        <path d="M0 0h16L8 10Z" fill={tone} />
      </svg>
    </div>
  );
}

