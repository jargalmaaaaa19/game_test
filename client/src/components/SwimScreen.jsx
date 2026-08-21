import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DISTANCE_M, DRIFT_MS, driftAt, sideOf } from '@shared/events/freestyle_swim.js';
import { babylon } from '../avatar3d/portraits.js';
import { createSwimArena } from '../arena3d/swimArena.js';
import { BUFFER_MS, sampleAt, serverNow } from '../net/interpolation.js';
import { t, lang } from '../i18n.js';
import Flag from './Flag.jsx';
import SwimLanes from './SwimLanes.jsx';

// How far apart the arrows sit ON SCREEN, in pixels, and how wide a tile is.
// The gap is what is held constant — not the stretch of water on screen — so
// the ribbon looks the same on a phone and on a desktop.
//
// It used to be the other way round: a fixed FIVE METRES spread across whatever
// width the lane happened to be. On a 390px phone that put the tiles 40px apart
// and touching; on a 1200px monitor it put them 122px apart, which is the
// "arrows are very far away" the lane was reported for. A wide screen should
// show more of the row, not the same row stretched.
//
// The gap has to be bigger than the tile, and by a clear margin. At 52 to a
// 44px tile there were eight pixels of air between one arrow and the next, so
// the row read as a solid bar of colour and the one standing on the line was
// lost in the crowd behind it. At 82 each arrow is an object with space around
// it, and the arrow being answered is plainly the arrow ON the line.
const CUE_GAP_PX = 82;
const CUE_TILE_PX = 44;

// ...but never so wide that the lane stops warning the player. A phone has
// about 290px to the right of the line, which at the full gap is three and a
// half arrows — under a second of reading at racing pace. Below this width the
// gap gives way instead, because a row you cannot read ahead of is worse than a
// row drawn tight. Wide lanes are unaffected: they show MORE arrows at the full
// spacing rather than the same arrows stretched further apart.
const MIN_LOOKAHEAD_ARROWS = 4.5;

// Enough tiles for the widest lane anyone will open this on. Any that fall off
// either end are simply hidden, so over-provisioning costs a few invisible divs
// and nothing else.
const CUES_DRAWN = 22;

// Where the line sits across the lane, as a percentage of its width. This is
// the end of the road: an arrow that reaches it unanswered is gone and charged.
// Far enough left that the stream behind it is readable, far enough off the
// edge that the tile crossing it is not clipped.
const HIT_AT = 16;

// How long the row takes to close the gap an answered arrow left behind.
//
// Pure decoration: the arrow was destroyed the instant the thumb went down, and
// the sim has already brought the next one on. Without it the row teleports on
// every press, which at five presses a second reads as a stutter rather than as
// a stream; with it the whole thing flows and the presses are felt as surges.
const CLOSE_MS = 90;

// The two guards on the local row running ahead of the server's.
//
// A press moves the row here immediately and reaches the server a trip later,
// so being AHEAD is the normal state — by about rate x round trip, well under
// one arrow for anyone playing on a real connection. What is not normal is
// STAYING ahead: a press the server never applied (dropped, or over the input
// rate limit) leaves the row permanently offset, and from then on every press
// answers one arrow while the player is looking at another. Every side then
// reads as the wrong side and the swimmer stalls for reasons nothing on screen
// explains. Hammering at two hundred presses a second produced exactly that —
// the limiter ate most of them and the row ran hundreds of arrows out.
//
// So: never predict more than MAX_LEAD arrows past the server, and if the
// server's own count stops moving while we are ahead of it, give up the
// prediction and take theirs. The second is keyed on the SERVER's progress
// rather than on this device's presses, which is what the old guard got wrong —
// it reset itself on every press, so a player pressing steadily could never
// trip it however far out the row had drifted.
const MAX_LEAD = 4;
const SERVER_STALL_MS = 450;

// The cue tiles carry an arrow, not a word: "БАРУУН" does not fit in a tile a
// thumb's width across, and at speed a direction is read faster than a label
// anyway. The buttons underneath keep the words, colour-matched to the tiles.
const ARROW = { left: '←', right: '→' };

// Placings change a handful of times in a fifty; sorting the field at 60fps to
// learn nothing is pure garbage. Marker POSITIONS still move every frame.
const RANK_INTERVAL_MS = 150;

const MEDAL_TONE = ['#ffd23f', '#dbe4ee', '#e8834a'];

/**
 * 50m Backstroke.
 *
 * A stream of arrows crossing a line. Answer the leading one — press, and it is
 * destroyed wherever it had got to — and the rest close up. Press faster and
 * more of them go down per second, which is the swimmer's speed; press too
 * slowly and the leading one reaches the line on its own, costs speed, and the
 * stream carries on without pausing to be answered.
 *
 * The row is drawn on THIS DEVICE'S clock, from the leading arrow's deadline
 * plus the presses made since the last packet. Two reasons, and they pull the
 * same way: a press has to move the row on the thumb rather than a round trip
 * later, and the stream has to flow between packets rather than stepping
 * twenty times a second. Distance, combo, times and the standings sit on an
 * interval instead, because a hidden tab stops rAF dead and a frozen
 * scoreboard reads as a crash. (Archery taught that one.)
 */
export default function SwimScreen({ room, me, netRef, sendInput, event }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const arenaRef = useRef(null);
  const laneRefs = useRef(new Map()); // flat fallback only
  const cueRefs = useRef([]);
  const laneRef = useRef(null);
  const lineRef = useRef(null);
  const markRef = useRef(null);
  const stallRef = useRef(null);
  const judgeRef = useRef(null);
  const clockRef = useRef(null);
  const placeRef = useRef(null);
  const markerRefs = useRef([]);
  const distRefs = useRef([]);
  const rafRef = useRef(0);
  const sigRef = useRef('');

  // The row as this device believes it to be: the newest packet, plus the
  // strokes the player has made since that the server has not answered yet.
  const predRef = useRef(null);
  const flashRef = useRef(-1e9);

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
      const sNow = serverNow(net);
      if (sNow < latest.s) return;

      // Destroy the arrow NOW. The sim does exactly this when the packet lands
      // — spend the leading arrow, whatever the clock says — so there is
      // nothing to wait for and nothing that can come back refused. Waiting for
      // the echo would put a whole round trip between the thumb and the arrow
      // going, and at five presses a second that is most of a press.
      //
      // Right side or wrong, the arrow is spent either way: the sim consumes it
      // too, and a row that only moved on correct presses would be telling the
      // player they had got away with a fumble.
      const pred = predRef.current;
      if (!pred) {
        sendInput({ s: side, b: a.b });
        return;
      }
      // The arrow this press is aimed at goes with it, so a press that gets
      // lost cannot leave the two counts quietly answering different arrows.
      sendInput({ s: side, b: pred.beat });
      // Never predict further out than the server can plausibly be behind. The
      // press still goes; only the picture stops running away from it.
      if (pred.beat - a.b >= MAX_LEAD) return;
      // The gap the destroyed arrow leaves is however far it still had to go;
      // the row closes it over CLOSE_MS instead of teleporting.
      pred.close += 1 - driftAt(pred.dueAt, sNow);
      pred.beat += 1;
      pred.dueAt = sNow + DRIFT_MS;
      flashRef.current = sNow;
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
        .map((p) => `${p.d}:${p.t}:${p.b}:${p.c}:${p.m}:${Math.round(p.x)}`)
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
              ? t.secs((a.t / 1000).toFixed(2))
              : t.secs(((now - latest.s) / 1000).toFixed(1));
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
      // glide at 60fps off a 20 Hz feed; the ROW is drawn from the newest
      // packet instead, because an arrow drawn 100ms late is an arrow judged
      // wrong.
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

      // How far down the row this device believes it has got. The packet is the
      // truth but it is a round trip old, so: adopt it whenever it has moved
      // PAST us, and otherwise hold a prediction that is merely waiting to be
      // confirmed. A stroke that never landed at all — dropped, or past the
      // rate limit — is released by the staleness guard rather than left as a
      // row stuck a beat ahead for the rest of the race.
      let pred = predRef.current;
      if (!pred) {
        pred = predRef.current = {
          beat: a.b, dueAt: a.da, close: 0, serverBeat: a.b, serverMovedAt: sNow,
        };
      }
      // When the server's count last changed — the clock the stall guard runs
      // on. It moves on every press it applies AND on every arrow that crosses
      // the line, so in any live race it is never still for long.
      if (a.b !== pred.serverBeat) {
        pred.serverBeat = a.b;
        pred.serverMovedAt = sNow;
      }
      const ahead = pred.beat - a.b;
      if (a.b > pred.beat || (ahead > 0
        && (ahead > MAX_LEAD || sNow - pred.serverMovedAt > SERVER_STALL_MS))) {
        pred.beat = a.b;
        pred.dueAt = a.da;
        pred.close = 0;
      } else if (a.b === pred.beat) {
        // Agreed on the count: ease the deadline towards the server's rather
        // than snapping, so a packet that disagrees by a few milliseconds does
        // not jog the whole stream sideways every tick.
        pred.dueAt += (a.da - pred.dueAt) * 0.2;
      }
      // Where the stream has got to, in slots. The leading arrow is one slot
      // out when it comes on and 0 when it reaches the line — where it STOPS,
      // because `driftAt` saturates there — and everything behind it is that
      // plus its place in the queue, so the whole lane is one number and a
      // multiply. `close` is the gap left by arrows destroyed early, shrinking
      // to nothing over CLOSE_MS.
      const drift = driftAt(pred.dueAt, sNow);
      const stalled = sNow >= pred.dueAt;
      pred.close *= Math.exp(-(dt * 1000) / CLOSE_MS);
      if (pred.close < 0.002) pred.close = 0;
      const lead = 1 - drift + pred.close;

      // Read every frame rather than cached: the lane is a flex child, and a
      // rotation or a keyboard opening resizes it without remounting anything.
      const laneW = laneRef.current?.clientWidth ?? 360;
      const lineX = (laneW * HIT_AT) / 100;
      const gap = Math.min(CUE_GAP_PX, (laneW - lineX) / MIN_LOOKAHEAD_ARROWS);

      for (let k = 0; k < CUES_DRAWN; k += 1) {
        const node = cueRefs.current[k];
        if (!node) continue;
        const x = lineX + (k + lead) * gap;
        if (x < -CUE_TILE_PX || x > laneW + CUE_TILE_PX) {
          node.style.opacity = '0';
          continue;
        }
        const side = sideOf(latest.sides, pred.beat + k);
        // The queue fades back from the front. The arrow being answered is the
        // only one a player has to read, and depth is a cheaper way to say so
        // than another badge would be.
        node.style.opacity = k === 0 ? '1' : Math.max(0.34, 0.92 - k * 0.13).toFixed(2);
        node.style.left = `${x.toFixed(1)}px`;
        node.dataset.cue = side === 0 ? 'left' : 'right';
        // THE indicator: which arrow this press will answer. It is always the
        // front one — nothing has to arrive first — so it is marked the whole
        // way in rather than only once it reaches somewhere.
        node.dataset.live = k === 0 ? '1' : '0';
        // ...and once it is standing on the line with the swimmer stopped
        // behind it, it breathes until it is dealt with.
        node.dataset.waiting = k === 0 && stalled ? '1' : '0';
        node.textContent = side === 0 ? ARROW.left : ARROW.right;
      }

      // The pointer under the leading arrow, riding along with it. A ring on a
      // tile is easy to lose in a moving row; something aimed at it from
      // outside the row is not.
      if (markRef.current) {
        const x = lineX + lead * gap;
        markRef.current.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0) translateX(-50%)`;
        markRef.current.dataset.waiting = stalled ? '1' : '0';
      }

      // The line answers every press. The row moving is the real feedback, but
      // at four presses a second a player needs the hit to register somewhere
      // they are already looking, without reading anything — and when an arrow
      // is standing on it, the line itself goes amber to say what stopped.
      if (lineRef.current) {
        const pulse = Math.max(0, 1 - (sNow - flashRef.current) / 220);
        lineRef.current.style.transform = `translateX(-50%) scaleX(${(1 + pulse * 2.4).toFixed(2)})`;
        // Nearly solid at rest. It used to sit at half opacity between presses,
        // from when it was a marker that lit up on a hit — as a WALL that reads
        // as something you can barely see holding an arrow back.
        lineRef.current.style.opacity = (0.88 + 0.12 * pulse).toFixed(2);
        lineRef.current.dataset.waiting = stalled ? '1' : '0';
      }

      // The swimmer is stopped, and the lane says so where the player is
      // already looking rather than only in the standings.
      if (stallRef.current) stallRef.current.dataset.on = stalled ? '1' : '0';

      // The judgement flash fades on its own so it does not linger.
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
        {/* The lane. One job: which arrow is next, and how much room is left
            before it reaches the line and everything stops.
            The judgement flashes INSIDE it, over the line, because that is
            where the player is already looking — as its own item in a row it
            was a third thing competing for a strip only wide enough for two. */}
        <div
          ref={laneRef}
          className={[
            'relative h-24 overflow-hidden rounded-[20px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
            arenaOk
              ? 'border-white/15 bg-gradient-to-b from-slate-900/80 via-black/70 to-slate-900/80'
              : 'mt-5 border-neutral-800 bg-neutral-900/70',
          ].join(' ')}
        >
          {/* Water already swum. Answered arrows leave this way, and shading it
              keeps the eye on the queue rather than on the empty lane behind. */}
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent"
            style={{ width: `${HIT_AT + 4}%` }}
          />

          {/* THE LINE — a wall now, not a gate. An arrow that reaches it stops
              there and the swimmer stops with it, so the line is drawn as
              something solid enough to stop a thing: a bright bar with a lip at
              each end, going amber the moment something is standing against
              it. */}
          <div
            ref={lineRef}
            data-waiting="0"
            className="absolute inset-y-0 w-[4px] will-change-transform
                       bg-gradient-to-b from-white/70 via-white to-white/70
                       shadow-[0_0_16px_rgba(255,255,255,0.85)]
                       data-[waiting=1]:from-amber-200/70 data-[waiting=1]:via-amber-300
                       data-[waiting=1]:to-amber-200/70
                       data-[waiting=1]:shadow-[0_0_22px_rgba(252,211,77,0.95)]"
            style={{ left: `${HIT_AT}%`, transform: 'translateX(-50%)' }}
          />

          {/* The arrows. Plain nodes the render loop writes `left` on sixty
              times a second — they are animation, and a keyed React list that
              re-rendered the lane on every frame would cost more than the pool
              it sits under. NO css transition on the position: it is already
              the truth every frame, and easing it would put the tile somewhere
              the sim disagrees with. The RING and the scale do transition,
              because those say "this is the one" rather than "this is where". */}
          {Array.from({ length: CUES_DRAWN }, (_, k) => (
            <div
              key={k}
              ref={(node) => { cueRefs.current[k] = node; }}
              data-live="0"
              data-waiting="0"
              style={{ opacity: 0, left: '100%' }}
              className="absolute top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center
                         rounded-2xl text-2xl font-black leading-none will-change-[left]
                         shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-0 ring-white/0
                         transition-[box-shadow,ring-width,ring-color] duration-150
                         data-[cue=left]:bg-gradient-to-b data-[cue=left]:from-amber-300 data-[cue=left]:to-yellow-500
                         data-[cue=left]:text-amber-950
                         data-[cue=right]:bg-gradient-to-b data-[cue=right]:from-sky-300 data-[cue=right]:to-blue-500
                         data-[cue=right]:text-sky-950
                         data-[live=1]:scale-[1.06] data-[live=1]:ring-[3px] data-[live=1]:ring-white
                         data-[live=1]:shadow-[0_0_18px_rgba(255,255,255,0.45),0_3px_10px_rgba(0,0,0,0.5)]
                         data-[waiting=1]:animate-waiting data-[waiting=1]:ring-amber-300"
            />
          ))}

          {/* The pointer that rides under whichever arrow the next press
              answers. The ring on the tile says it too, but a ring inside a
              moving row of coloured tiles is easy to lose; an arrowhead coming
              at it from the floor of the lane is not. */}
          <div
            ref={markRef}
            data-waiting="0"
            className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 will-change-transform
                       border-x-[7px] border-b-[9px] border-x-transparent border-b-white
                       data-[waiting=1]:border-b-amber-300"
          />

          <p
            ref={judgeRef}
            data-grade="none"
            className="pointer-events-none absolute inset-x-0 top-1.5 text-center text-xs font-bold
                       [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]
                       data-[grade=perfect]:text-emerald-300
                       data-[grade=good]:text-sky-300
                       data-[grade=ok]:text-neutral-300
                       data-[grade=wrong]:text-red-400"
          />

          {/* Why the swimmer stopped, said where the player is already looking.
              The 3D pool can show a swimmer coming to a halt but never WHY, and
              a rule this blunt has to name itself the first time it bites. */}
          <p
            ref={stallRef}
            data-on="0"
            className="pointer-events-none absolute right-2 top-1.5 rounded-full bg-amber-300 px-2 py-0.5
                       text-[10px] font-black uppercase tracking-wider text-amber-950
                       opacity-0 transition-opacity duration-150 data-[on=1]:opacity-100"
          >
            {t.swimStopped}
          </p>
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
          {/* Two mistakes in a row and the water is taking real speed back. The
              combo can wait — what the player needs at that moment is to know
              WHY the swimmer is sinking down the field. */}
          {(mine?.m ?? 0) >= 2 ? (
            <span className="shrink-0 text-xs font-bold tabular-nums text-amber-300 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]">
              {t.swimSlowing}
            </span>
          ) : (
            <span
              className={[
                'shrink-0 text-xs tabular-nums',
                arenaOk ? 'text-white/70 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]' : 'text-neutral-400',
              ].join(' ')}
            >
              {t.swimCombo(mine?.c ?? 0)}
            </span>
          )}
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
    ? `border-amber-200/80 bg-gradient-to-b from-amber-400/70 to-amber-600/70 text-amber-50
       shadow-[0_6px_18px_rgba(245,158,11,0.35)] active:from-amber-300/90 active:to-amber-500/90`
    : `border-sky-200/80 bg-gradient-to-b from-sky-400/70 to-blue-600/70 text-sky-50
       shadow-[0_6px_18px_rgba(56,189,248,0.35)] active:from-sky-300/90 active:to-blue-500/90`;
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
