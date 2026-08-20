import { useEffect, useRef, useState } from 'react';
import {
  AIM_REACH,
  ARROWS_PER_ATHLETE,
  crosshairAt,
  swayAt,
} from '@shared/events/archery.js';
import { serverNow } from '../net/interpolation.js';
import { t } from '../i18n.js';
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

// How long the target is shown plainly before the scope comes up. Half a second
// is enough to read what you are shooting at; any longer and the player is
// waiting on an animation.
const SCOPE_AT_MS = 500;

// The target box spans this many radii across (see the SVG viewBox), which is
// the only number that converts a position in radii into a position on screen.
const BOX_RADII = 2.3;

/**
 * Target Shooting.
 *
 * The target is shown plainly for half a second, then the scope comes up and
 * the barrel starts to drift. One finger anywhere on the glass drags the
 * crosshair against that drift; lifting it fires from wherever the crosshair
 * had got to. Three shots.
 *
 * TWO forces, deliberately different in kind. The DRIFT is drawn — a moving
 * thing you chase, and the reason a shot has a right moment as well as a right
 * place. The WIND is not — a fixed number in the HUD, added only once the shot
 * is away, so the crosshair is where you are POINTING and never a promise.
 * Both come out of the shared sim, and the crosshair is positioned by the same
 * `crosshairAt` the server scores with, so the picture cannot disagree with the
 * result.
 *
 * The 60fps work writes straight to DOM nodes. React re-renders only when a
 * shot lands, which is at most three times per player.
 */
export default function ArcheryScreen({ room, me, netRef, sendInput }) {
  const rootRef = useRef(null);
  const boxRef = useRef(null);
  const crossRef = useRef(null);
  const clockRef = useRef(null);
  const rafRef = useRef(0);
  const sigRef = useRef('');

  // The live drag, held OUTSIDE React: pointermove writes it and the crosshair
  // reads it every frame. Through state it would re-render the target, the
  // scope and the scoreboard a hundred times a second.
  const aimRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef(null); // { id, x, y } while a finger is down

  const [snap, setSnap] = useState(null);
  const [scoped, setScoped] = useState(false);

  const myId = me?.id;
  const mine = snap?.a?.[myId] ?? null;
  const fired = mine?.sh?.length ?? 0;
  const windIndex = Math.min(fired, ARROWS_PER_ATHLETE - 1);
  const wind = snap?.w?.[windIndex] ?? { x: 0, y: 0 };

  // --- the scope ----------------------------------------------------------
  // One state flip; the transition itself is CSS, so nothing about it costs a
  // frame of the render loop.
  useEffect(() => {
    const id = setTimeout(() => setScoped(true), SCOPE_AT_MS);
    return () => clearTimeout(id);
  }, []);

  // --- input --------------------------------------------------------------
  //
  // Hold to aim, release to fire, one finger, anywhere. There is nothing else
  // on the glass to hit: no stick, no trigger button. A press that goes down
  // and straight back up is a shot from wherever the drift had the crosshair,
  // which is what a nervous player deserves and still puts something on the
  // scoreboard.
  useEffect(() => {
    const canFire = () => {
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      const a = latest?.a?.[myId];
      if (!a || a.d) return false;
      return serverNow(net) >= latest.s; // not while the countdown runs
    };

    /** Drag in pixels → aim in stick units, against the target's own radius. */
    const aimFrom = (dx, dy) => {
      const radiusPx = (boxRef.current?.clientWidth ?? 300) / BOX_RADII;
      const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
      return {
        x: clamp1(dx / radiusPx / AIM_REACH),
        y: clamp1(-dy / radiusPx / AIM_REACH), // screen y is inverted against aim
      };
    };

    const onDown = (e) => {
      if (!canFire()) return;
      e.preventDefault();
      dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      aimRef.current = { x: 0, y: 0 };
    };

    const onMove = (e) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      aimRef.current = aimFrom(e.clientX - drag.x, e.clientY - drag.y);
    };

    const onUp = (e) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.id) return;
      dragRef.current = null;
      if (!canFire()) return;
      // Fired from the aim as it stands THIS instant. The drift is not sent:
      // the server recomputes it from the same seed and its own clock.
      const { x, y } = aimRef.current;
      sendInput({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
      aimRef.current = { x: 0, y: 0 };
    };

    const root = rootRef.current;
    root?.addEventListener('pointerdown', onDown);
    // On the window, not the element: a finger that slides off the edge before
    // lifting still has to fire, or the shot is simply swallowed.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      root?.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [myId, netRef, sendInput]);

  // --- scoreboard and clock, on a timer -----------------------------------
  // Deliberately not on rAF: a hidden tab stops rAF dead, and a clock frozen
  // mid-round reads as a crash.
  useEffect(() => {
    const sync = () => {
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      if (!latest) return;
      const now = serverNow(net);

      const sig = Object.values(latest.a ?? {}).map((p) => `${p.sc}:${p.sh.length}`).join('|');
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

  // --- the crosshair, on rAF ----------------------------------------------
  useEffect(() => {
    const frame = () => {
      rafRef.current = requestAnimationFrame(frame);
      const node = crossRef.current;
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      if (!node || !latest) return;

      // Drift and drag, from the shared module, on the SERVER clock — the same
      // two numbers the server adds up when the shot arrives.
      const sway = swayAt(latest.k ?? 0, serverNow(net));
      const { dx, dy } = crosshairAt(aimRef.current, sway);
      const pct = (v) => (v / BOX_RADII) * 100;
      node.style.transform =
        `translate(calc(-50% + ${pct(dx).toFixed(2)}%), calc(-50% + ${pct(-dy).toFixed(2)}%))`;
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [netRef]);

  const shotsLeft = ARROWS_PER_ATHLETE - fired;

  return (
    <div
      ref={rootRef}
      data-archery-root
      data-scoped={scoped ? '1' : '0'}
      className="group/scope relative flex min-h-full touch-none select-none flex-col overflow-hidden
                 bg-neutral-950"
    >
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {/* The target, and the crosshair riding over it. Both live in the same
            box so a position in radii converts to a position on screen the same
            way for each, whatever the scope is doing to the zoom. */}
        <div
          ref={boxRef}
          className="relative w-full max-w-[22rem] transition-transform duration-[900ms] ease-out
                     group-data-[scoped='1']/scope:scale-[1.45]"
        >
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

            {/* Where my own shots landed. The rest is on the scoreboard. */}
            {(mine?.sh ?? []).map(([dx, dy], i) => (
              <g key={i}>
                <circle cx={dx} cy={-dy} r="0.075" fill="#0a0a0a" opacity="0.5" />
                <circle cx={dx} cy={-dy} r="0.05" fill="#fff" stroke="#0a0a0a" strokeWidth="0.02" />
              </g>
            ))}
          </svg>

          <div className="pointer-events-none absolute inset-0">
            <Crosshair nodeRef={crossRef} />
          </div>
        </div>

        {/* The scope tube. Painted over everything, fading in after the plain
            look at the target, and never in the way of a finger. */}
        <ScopeTube />

        {/* The HUD, on the glass the way a scope's own markings would be: time,
            shots left, and the wind that is about to bend the shot. */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-[9%] flex justify-center gap-10">
            <Readout label={t.timer}>
              <span ref={clockRef} className="font-mono text-lg font-bold tabular-nums">–</span>
            </Readout>
            <Readout label={t.remaining}>
              <span className="font-mono text-lg font-bold tabular-nums">{t.shots(shotsLeft)}</span>
            </Readout>
          </div>

          <div className="absolute inset-x-0 bottom-[12%] flex justify-center">
            <WindReadout wind={wind} />
          </div>
        </div>
      </div>

      <Scoreboard room={room} snap={snap} meId={myId} />
    </div>
  );
}

/**
 * The crosshair. Moves with the drag AND the drift, because to a player those
 * are the same thing: where the sight is actually pointing right now.
 */
function Crosshair({ nodeRef }) {
  return (
    <div
      ref={nodeRef}
      style={{ transform: 'translate(-50%, -50%)' }}
      className="absolute left-1/2 top-1/2 h-16 w-16 will-change-transform"
    >
      <svg viewBox="0 0 64 64" className="h-full w-full overflow-visible">
        <g stroke="#f8fafc" strokeWidth="1.6" strokeLinecap="round" opacity="0.95">
          <line x1="32" y1="4" x2="32" y2="24" />
          <line x1="32" y1="40" x2="32" y2="60" />
          <line x1="4" y1="32" x2="24" y2="32" />
          <line x1="40" y1="32" x2="60" y2="32" />
        </g>
        <circle cx="32" cy="32" r="1.6" fill="#f8fafc" />
        <circle cx="32" cy="32" r="13" fill="none" stroke="rgba(248,250,252,0.35)" strokeWidth="1" />
      </svg>
    </div>
  );
}

/**
 * The scope, as one round hole and a lot of darkness.
 *
 * The vignette is a box-shadow with an enormous spread rather than four masking
 * panels: one element, no seams, and it covers whatever aspect ratio the screen
 * turns out to be.
 */
function ScopeTube() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[900ms]
                 ease-out group-data-[scoped='1']/scope:opacity-100"
    >
      <div
        className="absolute left-1/2 top-1/2 aspect-square w-[135%] max-w-[135vh] -translate-x-1/2
                   -translate-y-1/2 rounded-full border-[3px] border-neutral-700/80
                   shadow-[0_0_0_9999px_rgba(3,5,10,0.94),inset_0_0_70px_35px_rgba(0,0,0,0.85)]"
      >
        {/* Etched marks on the glass: enough to read as an optic, faint enough
            never to be mistaken for the crosshair. */}
        <svg viewBox="0 0 200 200" className="h-full w-full opacity-40">
          <g stroke="#e5e7eb" strokeWidth="0.7" strokeLinecap="round">
            <line x1="100" y1="2" x2="100" y2="18" />
            <line x1="100" y1="182" x2="100" y2="198" />
            <line x1="2" y1="100" x2="18" y2="100" />
            <line x1="182" y1="100" x2="198" y2="100" />
            {[-30, -20, -10, 10, 20, 30].map((d) => (
              <line key={d} x1={100 + d} y1="196" x2={100 + d} y2={Math.abs(d) === 20 ? 189 : 192} />
            ))}
          </g>
          <circle cx="100" cy="100" r="97" fill="none" stroke="#e5e7eb" strokeWidth="0.5" opacity="0.5" />
        </svg>
      </div>
    </div>
  );
}

/** One labelled number on the glass. */
function Readout({ label, children }) {
  return (
    <div className="text-center [text-shadow:0_1px_4px_rgba(0,0,0,0.95)]">
      <p className="text-[9px] uppercase tracking-[0.2em] text-white/60">{label}</p>
      <div className="text-white">{children}</div>
    </div>
  );
}

/**
 * The wind: a number, and the side it blows from.
 *
 * Drawn as well as written, because the shot has to lean into it by an amount,
 * and an arrow whose length can be seen is read faster mid-shot than two
 * decimal places.
 */
function WindReadout({ wind }) {
  const magnitude = Math.hypot(wind.x, wind.y);
  const angle = (Math.atan2(-wind.y, wind.x) * 180) / Math.PI;

  return (
    <div className="flex items-center gap-2 [text-shadow:0_1px_4px_rgba(0,0,0,0.95)]">
      <svg viewBox="-1 -1 2 2" className="h-6 w-6">
        <g transform={`rotate(${angle})`}>
          <path
            d="M-0.7,0 L0.4,0 M0.18,-0.26 L0.46,0 L0.18,0.26"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="0.18"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
      <p className="font-mono text-sm font-semibold text-white">
        {t.wind}: {magnitude.toFixed(2)} ({wind.x < 0 ? t.windLeft : t.windRight})
      </p>
    </div>
  );
}

function Scoreboard({ room, snap, meId }) {
  const rows = room.players
    .map((p) => ({ player: p, a: snap?.a?.[p.id] }))
    .sort((x, y) => (y.a?.sc ?? 0) - (x.a?.sc ?? 0));

  return (
    <ul className="relative space-y-1 px-5 pb-5 pt-3">
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
            {Array.from({ length: ARROWS_PER_ATHLETE }, (_, i) => (
              <span
                key={i}
                className={[
                  'grid h-5 w-5 place-items-center rounded text-[10px] font-semibold',
                  a?.sh?.[i] ? 'bg-neutral-700 text-neutral-100' : 'bg-black/40 text-neutral-600',
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
