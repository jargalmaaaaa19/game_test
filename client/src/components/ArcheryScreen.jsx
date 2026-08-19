import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AIM_REACH,
  ARROWS_PER_ATHLETE,
} from '@shared/events/archery.js';
import { serverNow } from '../net/interpolation.js';
import { t, lang } from '../i18n.js';
import Flag from './Flag.jsx';
import AimStick from './AimStick.jsx';

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


/**
 * Archery.
 *
 * A floating stick moves a reticle over the target and a separate button
 * looses the arrow — two thumbs, or one if you set the aim and then reach for
 * the button, because the stick holds its position when released.
 *
 * The reticle is where you are POINTING. The wind is added to it when the
 * arrow goes, so the gold is only the right place to point in dead calm; the
 * rest of the time the shot is deciding how far into the wind to lean. That is
 * the whole event, and it is why the wind is drawn as large as the score.
 *
 * The 60fps work writes straight to DOM nodes. React re-renders only when a
 * shot actually lands, which is at most three times per player.
 */
export default function ArcheryScreen({ room, me, netRef, sendInput, event }) {
  const reticleRef = useRef(null);
  const stageRef = useRef(null);
  const clockRef = useRef(null);
  const rafRef = useRef(0);
  const sigRef = useRef('');

  // The live aim, held OUTSIDE React: the stick writes it on every pointermove
  // and the reticle reads it every frame. Through state it would re-render the
  // target, the scoreboard and three arrows at a hundred times a second.
  const aimRef = useRef({ x: 0, y: 0 });

  const [snap, setSnap] = useState(null);
  const myId = me?.id;
  const mine = snap?.a?.[myId] ?? null;
  const windIndex = Math.min(mine?.sh?.length ?? 0, ARROWS_PER_ATHLETE - 1);
  const wind = snap?.w?.[windIndex] ?? { x: 0, y: 0 };
  const spent = Boolean(mine?.d);

  const onAim = useCallback((aim) => { aimRef.current = aim; }, []);

  // --- input --------------------------------------------------------------
  // Aim on the stick, loose on the button. Nothing else on the screen fires:
  // the old two-tap scheme listened on the whole root, which cannot coexist
  // with a stick you drag across that same surface.
  const loose = useCallback(() => {
    const net = netRef.current;
    const latest = net.buffer[net.buffer.length - 1]?.s;
    const a = latest?.a?.[myId];
    if (!a || a.d) return;
    if (serverNow(net) < latest.s) return; // still counting down

    const { x, y } = aimRef.current;
    sendInput({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  }, [myId, netRef, sendInput]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        loose();
        return;
      }
      // Desktop aiming, in coarse steps — this is a phone control being made
      // usable with a keyboard, not a second input scheme to balance.
      const step = 0.12;
      const { x, y } = aimRef.current;
      const nudge = (dx, dy) => {
        e.preventDefault();
        aimRef.current = {
          x: Math.max(-1, Math.min(1, x + dx)),
          y: Math.max(-1, Math.min(1, y + dy)),
        };
      };
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') nudge(-step, 0);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') nudge(step, 0);
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') nudge(0, step);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') nudge(0, -step);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loose]);

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
        .map((p) => `${p.sh.length}:${p.d}:${p.sc}`)
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
          now < latest.s ? t.getReady : a.d ? t.archeryDone : t.archeryAim;
      }
    };

    sync();
    const id = setInterval(sync, 150);
    return () => clearInterval(id);
  }, [myId, netRef]);

  // --- the reticle, on rAF -------------------------------------------------
  // Purely visual: if the tab is hidden this stops and nothing is lost, since
  // the aim itself lives in a ref and the shot is only taken on the button.
  useEffect(() => {
    const frame = () => {
      rafRef.current = requestAnimationFrame(frame);
      const node = reticleRef.current;
      if (!node) return;
      const { x, y } = aimRef.current;
      // The target SVG spans -1.15..1.15 radii across its box, so a radius is
      // 1/2.3 of the width. Screen y is inverted against the aim's.
      const pct = (v) => ((v * AIM_REACH) / 2.3) * 100;
      node.style.transform = `translate(calc(-50% + ${pct(x).toFixed(2)}%), calc(-50% + ${pct(-y).toFixed(2)}%))`;
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

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

      <div className="mt-3 flex items-start gap-3">
        {/* Target + reticle */}
        <div className="relative mx-auto w-full max-w-[19rem]">
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

          {/* The reticle rides above the target rather than inside the SVG, so
              a thumb-drag moves it with a transform instead of re-rendering
              the whole target on every pointermove. It is where you are
              POINTING, not a promise of where the arrow goes — the wind is
              added after you loose, which is the entire event. */}
          <div className="pointer-events-none absolute inset-0">
            <div
              ref={reticleRef}
              style={{ transform: 'translate(-50%, -50%)' }}
              className="absolute left-1/2 top-1/2 h-9 w-9 rounded-full border-2 border-white
                         shadow-[0_0_0_2px_rgba(0,0,0,0.45)]"
            >
              <div className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-white" />
              <div className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 bg-white" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Wind wind={wind} />
        <p className="text-sm">
          <span className="font-mono text-xl font-bold">{mine?.sc ?? 0}</span>
          <span className="ml-1 text-xs text-neutral-500">{t.points}</span>
        </p>
        <p className="text-xs text-neutral-400">{t.arrowsLeft(shotsLeft)}</p>
      </div>

      <p ref={stageRef} className="mt-3 text-center text-sm font-semibold text-neutral-200">
        –
      </p>
      <p className="mt-1 text-center text-xs text-neutral-500">{t.archeryHint}</p>

      <Scoreboard room={room} snap={snap} meId={myId} />

      {/* Controls. The pad is the whole strip, so the stick lands under
          whichever thumb reaches for it; the loose button is carved out of it
          and sits in the corner, far enough from the stick that neither is hit
          by accident. */}
      <div className="relative mt-4 h-40 shrink-0">
        <AimStick onAim={onAim} disabled={spent} />
        <button
          type="button"
          data-loose
          onPointerDown={(e) => { e.preventDefault(); loose(); }}
          disabled={spent}
          className="absolute bottom-2 right-2 grid h-24 w-24 place-items-center rounded-full border-2
                     border-amber-300/70 bg-amber-400/25 text-sm font-bold tracking-widest text-amber-100
                     transition active:scale-95 active:bg-amber-400/50
                     disabled:border-neutral-700 disabled:bg-neutral-900 disabled:text-neutral-600"
        >
          {t.archeryLoose}
        </button>
      </div>
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
