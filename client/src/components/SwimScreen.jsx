import { useEffect, useRef, useState } from 'react';
import {
  BEAT_MS,
  DISTANCE_M,
  TOTAL_BEATS,
  WINDOW,
  beatTime,
  sideOf,
} from '@shared/events/freestyle_swim.js';
import { serverNow } from '../net/interpolation.js';
import { t, lang } from '../i18n.js';
import Flag from './Flag.jsx';

// How far ahead the cue lane shows. Two and a bit beats is enough to read the
// next stroke without turning the screen into sheet music.
const LOOKAHEAD_MS = BEAT_MS * 2.6;
const CUES_DRAWN = 5;

/**
 * 50m Freestyle.
 *
 * Cues slide toward a hit line on the beat; press the matching side as one
 * arrives. Both the cue positions and the judgement come from the same pure
 * module the server runs, off `startsAt` — a SERVER timestamp — so the beat
 * drawn here is the beat scored there.
 *
 * Cue motion is animation and lives on rAF. Distance, combo, times and the
 * scoreboard live on an interval, because a hidden tab stops rAF dead and a
 * frozen scoreboard reads as a crash. (Archery taught this one.)
 */
export default function SwimScreen({ room, me, netRef, sendInput, event }) {
  const laneRefs = useRef(new Map());
  const cueRefs = useRef([]);
  const judgeRef = useRef(null);
  const clockRef = useRef(null);
  const rafRef = useRef(0);
  const sigRef = useRef('');

  const [snap, setSnap] = useState(null);
  const myId = me?.id;
  const mine = snap?.a?.[myId] ?? null;
  const players = room.players;

  // --- input --------------------------------------------------------------
  useEffect(() => {
    const stroke = (side) => {
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      const a = latest?.a?.[myId];
      if (!a || a.d) return;
      if (serverNow(net) < latest.s) return;
      sendInput({ s: side });
    };

    const onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); stroke(0); return; }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); stroke(1); }
    };
    const onDown = (e) => {
      const zone = e.target.closest('[data-side]');
      if (!zone) return;
      e.preventDefault();
      stroke(Number(zone.dataset.side));
    };

    window.addEventListener('keydown', onKey);
    const root = document.querySelector('[data-swim-root]');
    root?.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      root?.removeEventListener('pointerdown', onDown);
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
        .map((p) => `${p.d}:${p.t}:${p.c}:${Math.round(p.x)}`)
        .join('|');
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setSnap(latest);
      }

      if (clockRef.current) {
        const toGun = latest.s - now;
        const a = latest.a?.[myId];
        clockRef.current.textContent =
          toGun > 0
            ? String(Math.ceil(toGun / 1000))
            : a?.d
              ? `${(a.t / 1000).toFixed(2)}s`
              : `${((now - latest.s) / 1000).toFixed(1)}s`;
      }
    };

    sync();
    const id = setInterval(sync, 150);
    return () => clearInterval(id);
  }, [myId, netRef]);

  // --- cue lane + swimmers, on rAF ----------------------------------------
  useEffect(() => {
    const frame = () => {
      rafRef.current = requestAnimationFrame(frame);
      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      if (!latest) return;
      const now = serverNow(net);
      const a = latest.a?.[myId];

      // Every swimmer's position, straight to the DOM.
      for (const player of players) {
        const node = laneRefs.current.get(player.id);
        const p = latest.a?.[player.id];
        if (!node || !p) continue;
        node.style.left = `${Math.min(100, (p.x / DISTANCE_M) * 100).toFixed(2)}%`;
        node.dataset.done = p.d ? '1' : '0';
      }

      if (!a) return;

      // The server's beat pointer is up to one tick + one latency stale, so a
      // cue it has already expired can still be sitting on the hit line here —
      // and the player presses for a beat that is gone. Take whichever is
      // further along: the pointer, or the first cue the clock says is still
      // alive.
      const firstAlive = Math.max(
        0,
        Math.ceil((now - beatTime(latest.s, 0) - WINDOW.ok) / BEAT_MS),
      );
      const base = Math.max(a.b, firstAlive);

      // Cues slide right-to-left toward the hit line at 0%.
      for (let k = 0; k < CUES_DRAWN; k += 1) {
        const node = cueRefs.current[k];
        if (!node) continue;
        const index = base + k;
        if (index >= TOTAL_BEATS) {
          node.style.opacity = '0';
          continue;
        }
        const until = beatTime(latest.s, index) - now;
        if (until > LOOKAHEAD_MS || until < -WINDOW.ok * 1.5) {
          node.style.opacity = '0';
          continue;
        }
        node.style.opacity = '1';
        node.style.transform = `translateX(${((until / LOOKAHEAD_MS) * 100).toFixed(2)}%)`;
        node.dataset.side = String(sideOf(latest.sides, index));
        node.dataset.next = k === 0 ? '1' : '0';
        node.textContent = sideOf(latest.sides, index) === 0 ? t.swimL : t.swimR;
      }

      // The judgement flash fades on its own so a miss does not linger.
      if (judgeRef.current) {
        const age = now - (a.ja ?? 0);
        const show = a.j && age < 650;
        judgeRef.current.textContent = show ? t.swimJudge[a.j] ?? '' : '';
        judgeRef.current.dataset.grade = show ? a.j : 'none';
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [myId, netRef, players]);

  return (
    <div data-swim-root className="flex min-h-full touch-none select-none flex-col px-5 py-6">
      <header className="flex items-baseline justify-between">
        <p className="label mb-0">{event?.name?.[lang] ?? event?.name?.en}</p>
        <p ref={clockRef} className="font-mono text-lg font-bold tabular-nums">–</p>
      </header>

      {/* The pool, seen from above */}
      <div className="relative mt-4 overflow-hidden rounded-xl border border-sky-900/60 bg-sky-950/50 p-1.5">
        <div className="absolute inset-y-0 right-1.5 w-1 bg-white/70" />
        <div className="flex flex-col gap-1">
          {players.map((player) => (
            <div
              key={player.id}
              className={[
                'relative h-7 rounded border',
                player.id === myId ? 'border-white/40 bg-sky-900/40' : 'border-sky-900/40 bg-sky-900/20',
              ].join(' ')}
            >
              <Flag code={player.country} className="absolute left-1 top-1/2 h-2.5 w-3.5 -translate-y-1/2" />
              <div
                ref={(node) => {
                  if (node) laneRefs.current.set(player.id, node);
                  else laneRefs.current.delete(player.id);
                }}
                style={{ left: '0%' }}
                className="absolute top-1/2 h-3 w-5 -translate-y-1/2 rounded-full bg-sky-300 will-change-[left]
                           data-[done='1']:bg-emerald-400"
              />
            </div>
          ))}
        </div>
      </div>

      {/* The cue lane: markers slide left onto the hit line */}
      <div className="relative mt-5 h-16 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/70">
        <div className="absolute inset-y-0 left-[14%] w-0.5 -translate-x-1/2 bg-white/60" />
        <div className="absolute inset-y-0 left-[14%] w-16 -translate-x-1/2 rounded bg-white/5" />
        <div className="absolute inset-y-0 left-[14%] right-0">
          {Array.from({ length: CUES_DRAWN }, (_, k) => (
            <div
              key={k}
              ref={(node) => { cueRefs.current[k] = node; }}
              style={{ opacity: 0, transform: 'translateX(100%)' }}
              className="absolute top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg
                         text-sm font-bold will-change-transform
                         data-[side='0']:bg-amber-400/25 data-[side='0']:text-amber-200
                         data-[side='1']:bg-violet-400/25 data-[side='1']:text-violet-200
                         data-[next='1']:ring-2 data-[next='1']:ring-white/70"
            />
          ))}
        </div>
      </div>

      <p
        ref={judgeRef}
        data-grade="none"
        className="mt-3 h-6 text-center text-sm font-bold
                   data-[grade=perfect]:text-emerald-400
                   data-[grade=good]:text-sky-300
                   data-[grade=ok]:text-neutral-300
                   data-[grade=miss]:text-red-400
                   data-[grade=wrong]:text-red-400
                   data-[grade=splash]:text-amber-400"
      />

      <div className="flex items-center justify-between text-xs text-neutral-400">
        <span>{t.swimDistance((mine?.x ?? 0).toFixed(1), DISTANCE_M)}</span>
        <span>{t.swimCombo(mine?.c ?? 0)}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button data-side="0" type="button" className="btn-secondary h-24 text-lg">
          {t.swimL}
        </button>
        <button data-side="1" type="button" className="btn-secondary h-24 text-lg">
          {t.swimR}
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-neutral-500">{t.swimHint}</p>

      <Scoreboard room={room} snap={snap} meId={myId} />
    </div>
  );
}

function Scoreboard({ room, snap, meId }) {
  const rows = room.players
    .map((p) => ({ player: p, a: snap?.a?.[p.id] }))
    .sort((x, y) => {
      const ax = x.a ?? {};
      const by = y.a ?? {};
      if (Boolean(ax.d) !== Boolean(by.d)) return ax.d ? -1 : 1;
      if (ax.d && by.d) return (ax.t ?? 0) - (by.t ?? 0);
      return (by.x ?? 0) - (ax.x ?? 0);
    });

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
          <span className="font-mono text-xs tabular-nums text-neutral-400">
            {a?.d ? `${(a.t / 1000).toFixed(2)}s` : `${(a?.x ?? 0).toFixed(1)}м`}
          </span>
        </li>
      ))}
    </ul>
  );
}
