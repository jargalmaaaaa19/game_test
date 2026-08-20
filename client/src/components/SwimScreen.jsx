import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BEAT_MS,
  DISTANCE_M,
  TOTAL_BEATS,
  HIT_WINDOW_MS,
  beatTime,
  sideOf,
} from '@shared/events/freestyle_swim.js';
import { babylon } from '../avatar3d/portraits.js';
import { createSwimArena } from '../arena3d/swimArena.js';
import { BUFFER_MS, sampleAt, serverNow } from '../net/interpolation.js';
import { t, lang } from '../i18n.js';
import Flag from './Flag.jsx';
import SwimLanes from './SwimLanes.jsx';

// How long a cue takes to cross the lane. Set in MILLISECONDS rather than as a
// multiple of the beat, because the two things it controls pull apart: this is
// the scroll SPEED, while speed x BEAT_MS is the GAP between cues. Tying it to
// the beat meant the arrows could not be brought closer together without also
// slowing them down.
const LOOKAHEAD_MS = 1_400;

// Enough to cover the lookahead plus the ones still flowing out past the zone.
const CUES_DRAWN = Math.ceil(LOOKAHEAD_MS / BEAT_MS) + 3;

// How long a struck or spent cue keeps travelling before it is recycled. Cues
// flow THROUGH the hit zone and off the end; they used to stop dead on it and
// pile up, which read as the lane jamming.
const FLOW_PAST_MS = 420;

// Where the hit line sits across the cue lane, as a percentage of its width.
// Cues enter at 100% and are struck here.
const HIT_AT = 18;

// The cue tiles carry an arrow, not a word: "БАРУУН" does not fit in a tile a
// thumb's width across, and at speed a direction is read faster than a label
// anyway. The buttons underneath keep the words, colour-matched to the tiles.
const ARROW = { left: '←', right: '→' };

// Placings change a handful of times in a fifty; sorting the field at 60fps to
// learn nothing is pure garbage. Marker POSITIONS still move every frame.
const RANK_INTERVAL_MS = 150;

const MEDAL_TONE = ['#ffd23f', '#dbe4ee', '#e8834a'];

/**
 * 50m Freestyle.
 *
 * Cues slide toward a hit line on the beat; press the matching side as one
 * arrives. Both the cue positions and the judgement come from the same pure
 * module the server runs, off `startsAt` — a SERVER timestamp — so the beat
 * drawn here is the beat scored there.
 *
 * Cue motion and the pool are animation and live on rAF. Distance, combo,
 * times and the standings live on an interval, because a hidden tab stops rAF
 * dead and a frozen scoreboard reads as a crash. (Archery taught this one.)
 */
export default function SwimScreen({ room, me, netRef, sendInput, event }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const arenaRef = useRef(null);
  const laneRefs = useRef(new Map()); // flat fallback only
  const cueRefs = useRef([]);
  const judgeRef = useRef(null);
  const clockRef = useRef(null);
  const placeRef = useRef(null);
  const markerRefs = useRef([]);
  const distRefs = useRef([]);
  const rafRef = useRef(0);
  const sigRef = useRef('');

  const drawnRef = useRef({});
  const rankRef = useRef([]);
  const nextRankAt = useRef(0);

  const [snap, setSnap] = useState(null);
  const [arenaOk, setArenaOk] = useState(() => Boolean(babylon()));
  const [leaders, setLeaders] = useState([]);

  const myId = me?.id;
  const mine = snap?.a?.[myId] ?? null;
  const players = room.players;
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  // --- the arena ----------------------------------------------------------
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
        arena = createSwimArena(B, canvas, { players, lanes: laneDraw, myId });
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
    const root = rootRef.current;
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

  /**
   * Placings from what is being DRAWN, not from the last packet: the badge
   * over a swimmer's head has to agree with the swimmer under it. Same rule as
   * the sim's own `placements`.
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

  // --- pool, cue lane and badges, on rAF ----------------------------------
  useEffect(() => {
    let last = performance.now();

    const frame = (now) => {
      rafRef.current = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const net = netRef.current;
      const latest = net.buffer[net.buffer.length - 1]?.s;
      if (!latest) return;
      const sNow = serverNow(net);
      const a = latest.a?.[myId];
      const started = sNow >= latest.s;

      // Positions are interpolated a fixed slice into the past so the swimmers
      // glide at 60fps off a 20 Hz feed; the BEAT is read from the newest
      // packet instead, because a cue drawn 100ms late is a cue judged wrong.
      const smooth = sampleAt(net, net.lastServerT - BUFFER_MS, ['x', 'v']);
      const drawn = drawnRef.current;

      for (const player of players) {
        const p = smooth?.a?.[player.id] ?? latest.a?.[player.id];
        if (!p) continue;
        const slot = drawn[player.id]
          ?? (drawn[player.id] = { x: 0, v: 0, done: false, time: null });
        slot.x = Math.max(0, Math.min(p.x, DISTANCE_M));
        slot.done = Boolean(p.d);
        slot.v = slot.done ? 0 : Math.max(0, p.v ?? 0);
        slot.time = p.t ?? null;

        const node = laneRefs.current.get(player.id);
        if (node) {
          node.style.left = `${((slot.x / DISTANCE_M) * 100).toFixed(2)}%`;
          node.dataset.done = slot.done ? '1' : '0';
        }
      }

      const arena = arenaRef.current;
      if (arena) {
        arena.render(dt, { athletes: drawn, started, myId });

        if (now >= nextRankAt.current) {
          nextRankAt.current = now + RANK_INTERVAL_MS;
          const top = rankOrder(drawn);
          if (top.join('|') !== rankRef.current.join('|')) {
            rankRef.current = top;
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
          const dist = distRefs.current[i];
          if (dist) dist.textContent = `${(drawn[id]?.x ?? 0).toFixed(0)}м`;
        }

        // Only the top three wear a badge, so the local player needs their own
        // line — being seventh is the thing they most want to know.
        if (placeRef.current && drawn[myId]) {
          placeRef.current.textContent =
            `${t.place(placeAmong(drawn, myId))} · ${drawn[myId].x.toFixed(0)}м`;
        }
      }

      if (!a) return;

      // The server's beat pointer is up to one tick + one latency stale, so a
      // cue it has already expired can still be sitting on the hit line here —
      // and the player presses for a beat that is gone. Take whichever is
      // further along: the pointer, or the first cue the clock says is alive.
      const firstAlive = Math.max(
        0,
        Math.ceil((sNow - beatTime(latest.s, 0) - HIT_WINDOW_MS) / BEAT_MS),
      );
      const base = Math.max(a.b, firstAlive);

      // Cues slide right-to-left onto the hit line.
      //
      // Positioned by `left`, as a percentage OF THE LANE. It used to be a
      // percentage translateX — which is a percentage of the CUE, forty pixels
      // — so every cue in the lookahead landed within forty pixels of the hit
      // line, printed on top of one another. Writing `transform` also wiped
      // the centring the class had set, dropping each cue half its own height
      // out of the lane and into the row underneath it.
      for (let k = 0; k < CUES_DRAWN; k += 1) {
        const node = cueRefs.current[k];
        if (!node) continue;
        const index = base + k;
        if (index >= TOTAL_BEATS) {
          node.style.opacity = '0';
          continue;
        }
        const until = beatTime(latest.s, index) - sNow;
        if (until > LOOKAHEAD_MS || until < -FLOW_PAST_MS) {
          node.style.opacity = '0';
          continue;
        }

        // NOT clamped at the hit zone. Letting `until` go negative is what
        // carries a cue on through the zone and out of the lane; clamping it
        // parked every spent cue on the line in a heap.
        //
        // And one steady colour per side, all the way across — no muted-to-lit
        // switch as it arrives. The switch was a colour change on a 75ms
        // transition happening every 380ms, which is a strobe, and with the
        // cues this close together several of them were doing it at once.
        const side = sideOf(latest.sides, index);
        node.style.opacity = '1';
        node.style.left =
          `${(HIT_AT + (until / LOOKAHEAD_MS) * (100 - HIT_AT)).toFixed(2)}%`;
        node.dataset.cue = side === 0 ? 'left' : 'right';
        node.textContent = side === 0 ? ARROW.left : ARROW.right;
      }

      // The judgement flash fades on its own so a miss does not linger.
      if (judgeRef.current) {
        const age = sNow - (a.ja ?? 0);
        const show = a.j && age < 650;
        judgeRef.current.textContent = show ? t.swimJudge[a.j] ?? '' : '';
        judgeRef.current.dataset.grade = show ? a.j : 'none';
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [myId, netRef, players, rankOrder]);

  return (
    <div
      ref={rootRef}
      data-swim-root
      className={[
        'relative flex min-h-full touch-none select-none flex-col',
        arenaOk ? 'overflow-hidden' : 'px-5 py-6',
      ].join(' ')}
    >
      {arenaOk ? (
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full outline-none" aria-hidden="true" />
      ) : null}

      {/* Rank badges. Three slots, one per medal position — a badge belongs to
          the PLACE, not to a swimmer, so a lead change moves it. */}
      {arenaOk ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <RankMarker
              key={i}
              rank={i + 1}
              player={byId.get(leaders[i])}
              nodeRef={(node) => { markerRefs.current[i] = node; }}
              distRef={(node) => { distRefs.current[i] = node; }}
            />
          ))}
        </div>
      ) : null}

      <header
        className={[
          'relative flex items-start justify-between',
          arenaOk ? 'px-4 pt-4' : '',
        ].join(' ')}
      >
        <p
          className={[
            'label mb-0',
            arenaOk ? 'text-white/75 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]' : '',
          ].join(' ')}
        >
          {event?.name?.[lang] ?? event?.name?.en}
        </p>
        {/* The clock reads as an instrument, not a caption — a black box in the
            corner, the way every pool in the world shows it. */}
        <p
          ref={clockRef}
          className={[
            'font-mono text-lg font-bold tabular-nums',
            arenaOk ? 'rounded-lg border border-white/15 bg-black/70 px-3 py-1 text-white' : '',
          ].join(' ')}
        >
          –
        </p>
      </header>

      {arenaOk ? <div className="flex-1" /> : (
        <SwimLanes players={players} myId={myId} snap={snap} laneRefs={laneRefs} />
      )}

      <div className={arenaOk ? 'relative px-4 pb-7' : 'pb-2'}>
        {/* The cue lane. One job: which side is coming, and when.
            The judgement flashes INSIDE it, over the hit line, because that is
            where the player is already looking — as its own item in a row it
            was a third thing competing for a strip only wide enough for two. */}
        <div
          className={[
            'relative h-24 overflow-hidden rounded-2xl border',
            arenaOk ? 'border-white/15 bg-black/55' : 'mt-5 border-neutral-800 bg-neutral-900/70',
          ].join(' ')}
        >
          {/* The hit zone is the only thing that marks WHERE to press, and it
              never changes — the cues stream through it. Making the cue light
              up instead put the signal on a moving object that changes several
              times a second. */}
          <div
            className="absolute inset-y-2 w-16 -translate-x-1/2 rounded-xl border-2 border-white/40 bg-white/10"
            style={{ left: `${HIT_AT}%` }}
          />
          {Array.from({ length: CUES_DRAWN }, (_, k) => (
            <div
              key={k}
              ref={(node) => { cueRefs.current[k] = node; }}
              style={{ opacity: 0, left: '100%' }}
              className="absolute top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center
                         rounded-xl text-lg font-bold leading-none will-change-[left]
                         data-[cue=left]:bg-yellow-400 data-[cue=left]:text-neutral-950
                         data-[cue=right]:bg-blue-400 data-[cue=right]:text-neutral-950"
            />
          ))}
          <p
            ref={judgeRef}
            data-grade="none"
            className="pointer-events-none absolute inset-x-0 top-1.5 text-center text-xs font-bold
                       [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]
                       data-[grade=perfect]:text-emerald-300
                       data-[grade=good]:text-sky-300
                       data-[grade=ok]:text-neutral-300
                       data-[grade=miss]:text-red-400
                       data-[grade=wrong]:text-red-400
                       data-[grade=splash]:text-amber-400"
          />
        </div>

        {/* One status line, two items, each pinned to its own edge. Three
            competing items in a 390px row is how the place, the judgement and
            the combo ended up printed through one another. */}
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <span
            ref={placeRef}
            className={[
              'min-w-0 truncate text-xs font-semibold tabular-nums',
              arenaOk ? 'text-white/85 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]' : 'text-neutral-400',
            ].join(' ')}
          />
          <span
            className={[
              'shrink-0 text-xs tabular-nums',
              arenaOk ? 'text-white/70 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]' : 'text-neutral-400',
            ].join(' ')}
          >
            {t.swimCombo(mine?.c ?? 0)}
          </span>
        </div>

        {/* Colour-matched to the cues above them, so which side is a glance
            rather than a word to read mid-stroke. */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <StrokeButton side={0} label={t.swimL} glass={arenaOk} />
          <StrokeButton side={1} label={t.swimR} glass={arenaOk} />
        </div>
      </div>
    </div>
  );
}

/** Where `id` sits in the full field, 1-based. */
function placeAmong(drawn, id) {
  let place = 1;
  const me = drawn[id];
  for (const [other, a] of Object.entries(drawn)) {
    if (other === id) continue;
    const ahead = a.done !== me.done
      ? a.done
      : a.done && me.done
        ? (a.time ?? 0) < (me.time ?? 0)
        : a.x > me.x;
    if (ahead) place += 1;
  }
  return place;
}

/** One medal position's badge, floating over whoever currently holds it. */
function RankMarker({ rank, player, nodeRef, distRef }) {
  const tone = MEDAL_TONE[rank - 1];
  return (
    <div ref={nodeRef} className="absolute left-0 top-0 flex flex-col items-center opacity-0 will-change-transform">
      <div className="flex items-center gap-1 rounded-full border border-white/15 bg-black/60 px-2 py-0.5">
        {player ? <Flag code={player.country} className="h-2.5 w-3.5 shrink-0" /> : null}
        <span className="text-[11px] font-bold leading-none" style={{ color: tone }}>
          {t.placeShort(rank)}
        </span>
        <span ref={distRef} className="font-mono text-[11px] font-semibold leading-none tabular-nums text-white" />
      </div>
      <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true">
        <path d="M0 0h16L8 10Z" fill={tone} />
      </svg>
    </div>
  );
}

function StrokeButton({ side, label, glass }) {
  // Same hues as the cue tiles above them, so a button and the arrows it
  // answers are read as one thing.
  const tint = side === 0
    ? 'border-yellow-300/70 bg-yellow-400/20 text-yellow-100 active:bg-yellow-400/45'
    : 'border-blue-300/70 bg-blue-400/20 text-blue-100 active:bg-blue-400/45';
  return (
    <button
      type="button"
      data-side={side}
      className={[
        'flex h-20 items-center justify-center gap-2 rounded-2xl border-2',
        'text-base font-bold tracking-wide transition active:scale-95',
        glass ? tint : 'border-neutral-800 bg-neutral-900 text-neutral-100 active:bg-neutral-800',
      ].join(' ')}
    >
      <span aria-hidden="true" className="text-xl leading-none">
        {side === 0 ? ARROW.left : ARROW.right}
      </span>
      {label}
    </button>
  );
}
