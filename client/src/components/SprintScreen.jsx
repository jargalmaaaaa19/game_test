import { useEffect, useLayoutEffect, useRef } from 'react';
import sprint, { COUNTDOWN_MS, RACE_DISTANCE } from '@shared/events/sprint_100m.js';
import { getCountry } from '@shared/countries.js';
import { BUFFER_MS, sampleAt, serverNow } from '../net/interpolation.js';
import { t } from '../i18n.js';
import AvatarPortrait from './AvatarPortrait.jsx';
import Flag from './Flag.jsx';

// How hard a position error is pulled back toward the server each frame, and
// the gap past which we stop easing and just snap. Small errors are smoothed
// away invisibly; a large one means we are wrong about the world, and holding a
// wrong position to look smooth is worse than a single correction.
const RECONCILE_RATE = 3.5; // per second
const SNAP_DISTANCE = 5; // metres

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
 * DOM nodes it holds refs to.
 */
export default function SprintScreen({ room, me, netRef, sendInput, event }) {
  const trackRef = useRef(null);
  const laneRefs = useRef(new Map());
  const hudRef = useRef(null);
  const footRef = useRef(null);

  // Local prediction state, shaped exactly like one athlete in the shared sim
  // so the shared module can be run over it verbatim.
  const predRef = useRef(null);
  const rafRef = useRef(0);

  const myId = me?.id;
  const players = room.players;

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

  // --- input --------------------------------------------------------------
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
      const now = serverNow(netRef.current);
      sprint.applyInput(pred, myId, { f: foot }, now);
      sendInput({ f: foot });

      if (footRef.current) footRef.current.dataset.foot = String(mine.foot);
    };

    // Spacebar alternates on its own, so a single-key masher is playable;
    // left/right keys and the two tap zones give the real two-footed cadence.
    const nextFoot = () => (predRef.current?.athletes[myId]?.foot === 1 ? 0 : 1);

    const onKeyDown = (e) => {
      if (e.repeat) return; // a held key is not a cadence
      if (e.code === 'Space') { e.preventDefault(); stride(nextFoot()); return; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); stride(0); return; }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); stride(1); }
    };

    const zone = trackRef.current?.closest('[data-sprint-root]');
    const onPointerDown = (e) => {
      const side = e.target.closest('[data-foot]');
      if (!side) return;
      e.preventDefault();
      stride(Number(side.dataset.foot));
    };

    window.addEventListener('keydown', onKeyDown);
    zone?.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      zone?.removeEventListener('pointerdown', onPointerDown);
    };
  }, [myId, netRef, sendInput]);

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

      const trackWidth = trackRef.current?.clientWidth ?? 0;
      const travel = Math.max(trackWidth - 40, 0);

      for (const player of players) {
        const node = laneRefs.current.get(player.id);
        if (!node) continue;
        const isMe = player.id === myId;
        const source = isMe ? mine : authoritative?.a?.[player.id];
        if (!source) continue;
        const x = Math.max(0, Math.min(source.x, RACE_DISTANCE));
        node.style.transform = `translate3d(${(x / RACE_DISTANCE) * travel}px, 0, 0)`;
        node.dataset.done = source.d || source.done ? '1' : '0';
      }

      if (hudRef.current) {
        const startsAt = pred.startsAt ?? sNow + COUNTDOWN_MS;
        const toGun = startsAt - sNow;
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
  }, [myId, netRef, players]);

  return (
    <div data-sprint-root className="flex min-h-full touch-none select-none flex-col">
      <header className="px-5 pt-6 text-center">
        <p className="label mb-1">{event?.name?.mn ?? event?.name?.en}</p>
        <p
          ref={hudRef}
          data-state="countdown"
          className="font-mono text-4xl font-bold tabular-nums
                     data-[state=countdown]:text-white
                     data-[state=false]:text-amber-400 data-[state=false]:text-2xl
                     data-[state=done]:text-emerald-400"
        >
          {Math.ceil(COUNTDOWN_MS / 1000)}
        </p>
      </header>

      <div ref={trackRef} className="relative mx-5 my-4 flex-1 overflow-hidden">
        {/* finish line */}
        <div className="absolute inset-y-0 right-0 w-1 bg-white/70" />
        <div className="absolute -top-1 right-2 text-[10px] font-semibold text-neutral-500">
          {RACE_DISTANCE}м
        </div>

        <div className="flex h-full flex-col justify-center gap-1.5">
          {players.map((player) => {
            const country = getCountry(player.country);
            const isMe = player.id === myId;
            return (
              <div
                key={player.id}
                className={[
                  'relative h-11 rounded-lg border',
                  isMe ? 'border-white/40 bg-white/5' : 'border-neutral-900 bg-neutral-900/40',
                ].join(' ')}
              >
                <Flag code={player.country} className="absolute left-1 top-1/2 h-2.5 w-3.5 -translate-y-1/2" />
                <div
                  ref={(node) => {
                    if (node) laneRefs.current.set(player.id, node);
                    else laneRefs.current.delete(player.id);
                  }}
                  className="absolute left-1 top-1/2 -translate-y-1/2 will-change-transform
                             data-[done='1']:drop-shadow-[0_0_6px_rgba(52,211,153,0.9)]"
                >
                  <AvatarPortrait
                    skin={player.skin} build={player.build}
                    outfit={player.outfit}
                    hair={player.hair}
                    className="h-9 w-9"
                    title={player.name}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two tap zones — big, thumb-reachable, and never overlapping the track. */}
      <div ref={footRef} data-foot="-1" className="grid grid-cols-2 gap-2 p-4 pb-8">
        <TapZone foot={0} label={t.leftFoot} />
        <TapZone foot={1} label={t.rightFoot} />
        <p className="col-span-2 text-center text-xs text-neutral-500">{t.sprintHint}</p>
      </div>
    </div>
  );
}

function TapZone({ foot, label }) {
  return (
    <button
      type="button"
      data-foot={foot}
      className="h-24 rounded-2xl border border-neutral-800 bg-neutral-900 text-lg font-bold
                 text-neutral-200 transition active:scale-95 active:border-white active:bg-neutral-800"
    >
      {label}
    </button>
  );
}
