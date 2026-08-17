import { useEffect, useRef, useState } from 'react';
import longJump, {
  ATTEMPTS,
  IDEAL_ANGLE_DEG,
  MAX_ANGLE_DEG,
  RUNWAY_M,
  angleAt,
} from '@shared/events/long_jump.js';
import { serverNow } from '../net/interpolation.js';
import { t, lang } from '../i18n.js';
import Flag from './Flag.jsx';

// How much runway is on screen behind the board. Showing all 38m would put the
// athlete in the last 3% of the strip for most of the run-up.
const VISIBLE_M = 14;
const PIT_M = 10;

/**
 * Long Jump.
 *
 * RUN (tap to build speed) → TAKEOFF (press and HOLD on or just before the red
 * board) → ANGLE (release near 45°). Three attempts, best counts. Crossing the
 * board, or running through it without committing, is a foul worth zero.
 *
 * Following the lesson archery taught: the angle dial rides
 * `requestAnimationFrame` because it is animation, while distances, fouls,
 * attempts and the clock run on an interval — a hidden tab stops rAF dead, and
 * a scoreboard frozen at zero looks like a crash.
 */
export default function LongJumpScreen({ room, me, netRef, sendInput, event }) {
  const athleteRef = useRef(null);
  const dialRef = useRef(null);
  const speedRef = useRef(null);
  const clockRef = useRef(null);
  const stageRef = useRef(null);
  const rafRef = useRef(0);
  const sigRef = useRef('');

  const [snap, setSnap] = useState(null);
  const myId = me?.id;
  const mine = snap?.a?.[myId] ?? null;
  const attemptsLeft = ATTEMPTS - (mine?.j?.length ?? 0);

  // --- input --------------------------------------------------------------
  useEffect(() => {
    const stageOf = () => {
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      const a = latest?.a?.[myId];
      if (!a || a.st === 'done') return null;
      if (serverNow(net) < latest.s) return null; // still counting down
      return a;
    };

    const run = () => {
      if (stageOf()?.st === 'run') sendInput({ t: 'run' });
    };

    const press = () => {
      if (stageOf()?.st === 'run') sendInput({ t: 'jump' });
    };

    const release = () => {
      const a = stageOf();
      if (a?.st !== 'takeoff') return;
      // Send the angle the player actually saw, from the same pure dial the
      // server will check it against.
      const v = angleAt({ holdAt: a.ha }, serverNow(netRef.current));
      sendInput({ t: 'release', v: Math.round(v * 10) / 10 });
    };

    const onKeyDown = (e) => {
      if (e.repeat) return;
      if (e.code === 'Space') { e.preventDefault(); run(); return; }
      if (e.code === 'Enter' || e.code === 'ArrowUp') { e.preventDefault(); press(); }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Enter' || e.code === 'ArrowUp') { e.preventDefault(); release(); }
    };

    const onDown = (e) => {
      const zone = e.target.closest('[data-zone]');
      if (!zone) return;
      e.preventDefault();
      if (zone.dataset.zone === 'run') run();
      else press();
    };
    const onUp = (e) => {
      const zone = e.target.closest('[data-zone="jump"]');
      if (!zone) return;
      e.preventDefault();
      release();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const root = document.querySelector('[data-lj-root]');
    root?.addEventListener('pointerdown', onDown);
    // On window, not the button: a finger that slides off the button before
    // lifting must still release the jump, or the athlete hangs mid-air.
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      root?.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [myId, netRef, sendInput]);

  // --- game state, on a timer ---------------------------------------------
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
        clockRef.current.textContent =
          toGun > 0 ? String(Math.ceil(toGun / 1000)) : `${Math.max(0, Math.ceil((latest.e - now) / 1000))}s`;
      }

      const a = latest.a?.[myId];
      if (a && stageRef.current) {
        stageRef.current.textContent =
          now < latest.s
            ? t.getReady
            : a.st === 'run'
              ? t.ljRun
              : a.st === 'takeoff'
                ? t.ljAngle
                : t.ljDone;
      }
    };

    sync();
    const id = setInterval(sync, 150);
    return () => clearInterval(id);
  }, [myId, netRef]);

  // --- run-up + dial, on rAF ----------------------------------------------
  useEffect(() => {
    const frame = () => {
      rafRef.current = requestAnimationFrame(frame);
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      const a = latest?.a?.[myId];
      if (!a) return;
      const now = serverNow(net);

      if (athleteRef.current) {
        // The board sits at 70% of the strip; the athlete walks in from the
        // left over the last VISIBLE_M metres of runway.
        const fromBoard = RUNWAY_M - a.x;
        const pct = 70 - Math.min(1, fromBoard / VISIBLE_M) * 70;
        athleteRef.current.style.left = `${pct.toFixed(2)}%`;
        athleteRef.current.dataset.stage = a.st;
      }

      if (speedRef.current) {
        speedRef.current.style.width = `${Math.min(100, (a.v / 10.5) * 100).toFixed(1)}%`;
      }

      if (dialRef.current) {
        const live = a.st === 'takeoff';
        const angle = live ? angleAt({ holdAt: a.ha }, now) : 0;
        dialRef.current.style.transform = `rotate(${-angle.toFixed(1)}deg)`;
        dialRef.current.dataset.active = live ? '1' : '0';
        dialRef.current.dataset.good = live && Math.abs(angle - IDEAL_ANGLE_DEG) < 7 ? '1' : '0';
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [myId, netRef]);

  return (
    <div data-lj-root className="flex min-h-full touch-none select-none flex-col px-5 py-6">
      <header className="flex items-baseline justify-between">
        <p className="label mb-0">{event?.name?.[lang] ?? event?.name?.en}</p>
        <p ref={clockRef} className="font-mono text-lg font-bold tabular-nums">–</p>
      </header>

      {/* Runway, board and pit, in side view */}
      <div className="relative mt-5 h-28 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/70">
        <div className="absolute inset-x-0 bottom-0 h-9 bg-neutral-800" />
        {/* the pit */}
        <div className="absolute bottom-0 right-0 h-9 w-[30%] bg-amber-200/20" />
        {/* the board — the red line */}
        <div className="absolute bottom-0 left-[70%] h-9 w-1.5 -translate-x-1/2 bg-red-500" />
        <div className="absolute bottom-10 left-[70%] -translate-x-1/2 text-[9px] font-semibold text-red-400">
          0м
        </div>
        {[2, 4, 6, 8].map((m) => (
          <div
            key={m}
            className="absolute bottom-0 h-9 border-l border-amber-200/25"
            style={{ left: `${70 + (m / PIT_M) * 30}%` }}
          >
            <span className="absolute -top-4 -translate-x-1/2 text-[9px] text-neutral-500">{m}</span>
          </div>
        ))}

        <div
          ref={athleteRef}
          style={{ left: '0%' }}
          className="absolute bottom-9 h-8 w-3 -translate-x-1/2 rounded-t-sm bg-white
                     data-[stage='takeoff']:bg-emerald-400"
        />

        {/* Angle dial, anchored at the board */}
        <div className="pointer-events-none absolute bottom-9 left-[70%] h-20 w-20 -translate-x-1/2">
          <div
            ref={dialRef}
            data-active="0"
            style={{ transform: 'rotate(0deg)' }}
            className="absolute bottom-0 left-0 h-0.5 w-16 origin-left rounded bg-white/25
                       data-[active='1']:h-1 data-[active='1']:bg-amber-400
                       data-[good='1']:bg-emerald-400"
          />
          {/* the 45° mark players are aiming for */}
          <div className="absolute bottom-0 left-0 h-0.5 w-14 origin-left rotate-[-45deg] rounded border-t border-dashed border-white/30" />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">{t.speed}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
          <div ref={speedRef} style={{ width: '0%' }} className="h-full rounded-full bg-sky-400" />
        </div>
        <span className="text-xs text-neutral-400">{t.attemptsLeft(attemptsLeft)}</span>
      </div>

      <p ref={stageRef} className="mt-4 text-center text-sm font-semibold text-neutral-200">–</p>
      <p className="mt-1 text-center text-xs text-neutral-500">{t.ljHint}</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button data-zone="run" type="button" className="btn-secondary h-20 text-lg">
          {t.ljRunBtn}
        </button>
        <button data-zone="jump" type="button" className="btn-primary h-20 text-lg">
          {t.ljJumpBtn}
        </button>
      </div>

      <Scoreboard room={room} snap={snap} meId={myId} />
    </div>
  );
}

function Scoreboard({ room, snap, meId }) {
  const rows = room.players
    .map((p) => ({ player: p, a: snap?.a?.[p.id] }))
    .sort((x, y) => (y.a?.bt ?? 0) - (x.a?.bt ?? 0));

  return (
    <ul className="mt-auto space-y-1 pt-5">
      {rows.map(({ player, a }) => (
        <li
          key={player.id}
          className={[
            'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm',
            player.id === meId ? 'bg-white/10' : 'bg-neutral-900/60',
          ].join(' ')}
        >
          <Flag code={player.country} className="h-3 w-4.5" />
          <span className="min-w-0 flex-1 truncate">{player.name}</span>
          <span className="flex gap-1">
            {Array.from({ length: ATTEMPTS }, (_, i) => {
              const jump = a?.j?.[i];
              return (
                <span
                  key={i}
                  className={[
                    'grid h-5 w-9 place-items-center rounded text-[10px] font-semibold tabular-nums',
                    !jump
                      ? 'bg-neutral-800/60 text-neutral-600'
                      : jump[2]
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-neutral-700 text-neutral-100',
                  ].join(' ')}
                >
                  {!jump ? '·' : jump[2] ? t.foul : jump[0].toFixed(2)}
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
