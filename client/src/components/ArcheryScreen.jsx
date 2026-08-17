import { useEffect, useRef, useState } from 'react';
import archery, {
  ARROWS_PER_ATHLETE,
  aimAt,
  powerAt,
} from '@shared/events/archery.js';
import { serverNow } from '../net/interpolation.js';
import { t, lang } from '../i18n.js';
import Flag from './Flag.jsx';

// Standard target colours, outermost first. Ring k (score k) spans radii
// (10-k)/10 .. (11-k)/10, so drawing largest-first layers them correctly.
const RINGS = [
  { score: 1, fill: '#f4f4f5' },
  { score: 2, fill: '#f4f4f5' },
  { score: 3, fill: '#27272a' },
  { score: 4, fill: '#27272a' },
  { score: 5, fill: '#38bdf8' },
  { score: 6, fill: '#38bdf8' },
  { score: 7, fill: '#ef4444' },
  { score: 8, fill: '#ef4444' },
  { score: 9, fill: '#facc15' },
  { score: 10, fill: '#facc15' },
];

const SPREAD = 0.9; // must match the sim's aim-to-target-radii factor
const POWER_IDEAL = 0.72;

/**
 * Archery.
 *
 * Two taps per arrow: the first locks the angle off a marker sweeping across
 * the target, the second locks power off a gauge sweeping up and down.
 *
 * Both sweeps are pure functions of `stageAt` (a SERVER timestamp carried in
 * the snapshot) and the server-corrected clock — so the marker drawn here is
 * the marker the server will score. The value the player saw is what gets sent;
 * the server bounds it rather than re-sampling, or every player would pay their
 * ping on every shot.
 *
 * The 60fps work writes straight to DOM nodes. React re-renders only when a
 * shot actually lands, which is at most three times per player.
 */
export default function ArcheryScreen({ room, me, netRef, sendInput, event }) {
  const markerRef = useRef(null);
  const gaugeRef = useRef(null);
  const stageRef = useRef(null);
  const clockRef = useRef(null);
  const rafRef = useRef(0);
  const sigRef = useRef('');

  const [snap, setSnap] = useState(null);
  const myId = me?.id;
  const mine = snap?.a?.[myId] ?? null;
  const windIndex = Math.min(mine?.sh?.length ?? 0, ARROWS_PER_ATHLETE - 1);
  const wind = snap?.w?.[windIndex] ?? { x: 0, y: 0 };

  // --- input --------------------------------------------------------------
  useEffect(() => {
    const shoot = () => {
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      const a = latest?.a?.[myId];
      if (!a || a.st === 'done') return;
      const now = serverNow(net);
      if (now < latest.s) return; // still counting down

      // Send the value the player actually saw, computed from the same pure
      // function the server will check it against.
      const athlete = { stageAt: a.sa };
      const v = a.st === 'aim' ? aimAt(athlete, now) : powerAt(athlete, now);
      sendInput({ t: a.st, v: Math.round(v * 1000) / 1000 });
    };

    const onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        shoot();
      }
    };
    const onPointerDown = (e) => {
      if (e.target.closest('[data-no-shoot]')) return;
      e.preventDefault();
      shoot();
    };

    window.addEventListener('keydown', onKey);
    const root = document.querySelector('[data-archery-root]');
    root?.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      root?.removeEventListener('pointerdown', onPointerDown);
    };
  }, [myId, netRef, sendInput]);

  // --- game state, on a timer (NOT on rAF) --------------------------------
  // Scores, arrows, wind and the clock are not animation: they must keep
  // arriving when the tab is backgrounded, and a hidden tab stops rAF dead
  // while an interval merely slows down. Driving all of this from the frame
  // loop froze the whole scoreboard at zero the moment the tab lost focus.
  useEffect(() => {
    const sync = () => {
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      if (!latest) return;
      const now = serverNow(net);

      const sig = Object.values(latest.a ?? {})
        .map((p) => `${p.sh.length}:${p.st}:${p.sc}`)
        .join('|');
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setSnap(latest);
      }

      if (clockRef.current) {
        const toGun = latest.s - now;
        clockRef.current.textContent =
          toGun > 0 ? String(Math.ceil(toGun / 1000)) : `${Math.max(0, Math.ceil((latest.e - now) / 1000))}s`;
        clockRef.current.dataset.state = toGun > 0 ? 'countdown' : 'running';
      }

      const a = latest.a?.[myId];
      if (a && stageRef.current) {
        stageRef.current.textContent =
          now < latest.s ? t.getReady : a.st === 'aim' ? t.archeryAim : a.st === 'power' ? t.archeryPower : t.archeryDone;
      }
    };

    sync();
    const id = setInterval(sync, 150);
    return () => clearInterval(id);
  }, [myId, netRef]);

  // --- the two sweeps, on rAF ---------------------------------------------
  // Purely visual: if the tab is hidden these stop, and nothing is lost —
  // the player cannot aim at a marker they cannot see.
  useEffect(() => {
    const frame = () => {
      rafRef.current = requestAnimationFrame(frame);
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      if (!latest) return;

      const now = serverNow(net);
      const a = latest.a?.[myId];
      if (!a) return;
      const live = a.st !== 'done' && now >= latest.s;

      if (markerRef.current) {
        // While aiming the marker sweeps; once locked it holds at the chosen
        // angle so the player can see what they committed to.
        const aim = live && a.st === 'aim' ? aimAt({ stageAt: a.sa }, now) : a.am;
        markerRef.current.style.transform = `translateX(${(aim * SPREAD * 50).toFixed(2)}%)`;
        markerRef.current.dataset.locked = a.st === 'power' ? '1' : '0';
      }

      if (gaugeRef.current) {
        const power = live && a.st === 'power' ? powerAt({ stageAt: a.sa }, now) : 0;
        gaugeRef.current.style.height = `${(power * 100).toFixed(1)}%`;
        gaugeRef.current.dataset.active = live && a.st === 'power' ? '1' : '0';
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [myId, netRef]);

  const shotsLeft = ARROWS_PER_ATHLETE - (mine?.sh?.length ?? 0);

  return (
    <div
      data-archery-root
      className="flex min-h-full touch-none select-none flex-col px-5 py-6"
    >
      <header className="flex items-baseline justify-between">
        <p className="label mb-0">{event?.name?.[lang] ?? event?.name?.en}</p>
        <p ref={clockRef} data-state="countdown" className="font-mono text-lg font-bold tabular-nums">
          –
        </p>
      </header>

      <div className="mt-4 flex items-start gap-3">
        {/* Target + aim marker */}
        <div className="relative flex-1">
          <svg viewBox="-1.15 -1.15 2.3 2.3" className="w-full">
            {RINGS.map((ring) => (
              <circle
                key={ring.score}
                cx="0"
                cy="0"
                r={(11 - ring.score) / 10}
                fill={ring.fill}
                stroke="rgba(0,0,0,0.25)"
                strokeWidth="0.006"
              />
            ))}
            <circle cx="0" cy="0" r="0.03" fill="#27272a" />

            {/* Landed arrows — mine only; the rest is on the scoreboard. */}
            {(mine?.sh ?? []).map(([dx, dy], i) => (
              <g key={i}>
                <circle cx={dx} cy={dy} r="0.075" fill="#0a0a0a" opacity="0.5" />
                <circle cx={dx} cy={dy} r="0.05" fill="#fff" stroke="#0a0a0a" strokeWidth="0.02" />
              </g>
            ))}
          </svg>

          {/* The aim marker rides above the target, not inside the SVG, so it
              can be moved with a transform instead of a React re-render. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0">
            <div
              ref={markerRef}
              className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-white/70
                         data-[locked='1']:bg-emerald-400 data-[locked='1']:w-1"
            />
          </div>
        </div>

        {/* Power gauge */}
        <div className="flex w-10 shrink-0 flex-col items-center">
          <div className="relative h-44 w-6 overflow-hidden rounded-full border border-neutral-700 bg-neutral-900">
            <div
              ref={gaugeRef}
              style={{ height: '0%' }}
              className="absolute bottom-0 w-full bg-neutral-600 transition-none
                         data-[active='1']:bg-gradient-to-t data-[active='1']:from-emerald-500 data-[active='1']:to-amber-400"
            />
            {/* The flat-flight power, marked. Players find it in two arrows
                anyway; hiding it just makes the first end feel arbitrary. */}
            <div
              className="absolute inset-x-0 h-0.5 bg-white/50"
              style={{ bottom: `${POWER_IDEAL * 100}%` }}
            />
          </div>
          <span className="mt-1 text-[10px] text-neutral-500">{t.power}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Wind wind={wind} />
        <p className="text-sm">
          <span className="font-mono text-xl font-bold">{mine?.sc ?? 0}</span>
          <span className="ml-1 text-xs text-neutral-500">{t.points}</span>
        </p>
        <p className="text-xs text-neutral-400">{t.arrowsLeft(shotsLeft)}</p>
      </div>

      <p ref={stageRef} className="mt-4 text-center text-sm font-semibold text-neutral-200">
        –
      </p>
      <p className="mt-1 text-center text-xs text-neutral-500">{t.archeryHint}</p>

      <Scoreboard room={room} snap={snap} meId={myId} />
    </div>
  );
}

/** Direction and strength, drawn — a number alone does not read at a glance. */
function Wind({ wind }) {
  const magnitude = Math.hypot(wind.x, wind.y);
  const angle = (Math.atan2(wind.y, wind.x) * 180) / Math.PI;

  return (
    <div className="flex items-center gap-2" title={t.wind}>
      <svg viewBox="-1 -1 2 2" className="h-7 w-7">
        <circle cx="0" cy="0" r="0.95" fill="none" stroke="#3f3f46" strokeWidth="0.08" />
        <g transform={`rotate(${angle})`}>
          <path
            d="M-0.6,0 L0.35,0 M0.15,-0.22 L0.4,0 L0.15,0.22"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="0.16"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
      <div className="leading-tight">
        <p className="text-[10px] uppercase tracking-wider text-neutral-500">{t.wind}</p>
        <p className="font-mono text-xs">{magnitude.toFixed(2)}</p>
      </div>
    </div>
  );
}

function Scoreboard({ room, snap, meId }) {
  const rows = room.players
    .map((p) => ({ player: p, a: snap?.a?.[p.id] }))
    .sort((x, y) => (y.a?.sc ?? 0) - (x.a?.sc ?? 0));

  return (
    <ul data-no-shoot className="mt-auto space-y-1 pt-5">
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
            {Array.from({ length: ARROWS_PER_ATHLETE }, (_, i) => (
              <span
                key={i}
                className={[
                  'grid h-5 w-5 place-items-center rounded text-[10px] font-semibold',
                  a?.sh?.[i] ? 'bg-neutral-700 text-neutral-100' : 'bg-neutral-800/60 text-neutral-600',
                ].join(' ')}
              >
                {a?.sh?.[i] ? a.sh[i][2] : '·'}
              </span>
            ))}
          </span>
          <span className="w-7 text-right font-mono font-semibold">{a?.sc ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}
