import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import hammerThrow, {
  ATTEMPTS,
  KIND,
  MAX_SPIN,
  MIN_SPIN,
  SECTOR_HALF_DEG,
  flightPoint,
  headingAt,
  isFoul,
  isGreen,
  spinAt,
  wrapAngle,
} from '@shared/events/hammer_throw.js';
import { BUFFER_MS, sampleAt, serverNow } from '../net/interpolation.js';
import { t } from '../i18n.js';
import Flag from './Flag.jsx';
import SpinPad from './SpinPad.jsx';

const RAD = Math.PI / 180;
// The furthest mark the field draws out to. Past the world record, so the arcs
// never run out from under a throw.
const FIELD_M = 92;
// Heading error eased away rather than snapped: the arrow is the one thing the
// player is reading, and a reticle that jumps is a reticle that gets misread.
const RECONCILE_RATE = 6; // per second

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** The kinds that get a word rather than a number on the board. */
const FOUL_TEXT = {
  [KIND.OUT_OF_SECTOR]: () => t.htOutOfSector,
  [KIND.LEFT_CIRCLE]: () => t.htFoul,
  [KIND.NO_THROW]: () => t.htNoThrow,
};

/**
 * Hammer Throw.
 *
 * WIND (draw circles inside the ring — every revolution winds her faster) →
 * RELEASE (let go as the arrow sweeps through the green arc) → the flight and
 * the officials walking out to the mark, both drawn from the shared clock.
 * Three attempts, best counts. Leaving the ring is a foul, and it is the only
 * thing holding the spin back.
 *
 * Nothing in the animation loop touches React state: at 60fps that would
 * re-render the tree sixty times a second. The loop writes transforms and text
 * straight to DOM nodes it holds refs to.
 *
 * The heading is PREDICTED, and it has to be. It is a closed form over
 * (spin0, spinAt, heading0) — see the sim — so the client can rebuild it
 * exactly from what the server sends, but only for turns the server has already
 * seen. A player's own revolution has to move the arrow on the frame their
 * finger completes it, or they are aiming at where the athlete was a round trip
 * ago and the green arc is a lie told 80ms late.
 */
export default function HammerThrowScreen({ room, me, netRef, sendInput }) {
  const fieldRef = useRef(null);
  const arrowRef = useRef(null);
  const spinBarRef = useRef(null);
  const turnsRef = useRef(null);
  const stageRef = useRef(null);
  const clockRef = useRef(null);
  const hammerRef = useRef(null);
  const crewRef = useRef(null);
  const markRefs = useRef(new Map());

  const predRef = useRef(null);
  const rafRef = useRef(0);
  const greenRef = useRef(false);
  const [green, setGreen] = useState(false);
  const [snap, setSnap] = useState(null);

  const myId = me?.id;
  const players = room.players;
  const mine = snap?.a?.[myId] ?? null;
  const attemptsUsed = mine?.j?.length ?? 0;
  const stage = mine?.st ?? 'wind';

  useLayoutEffect(() => {
    // Shaped exactly like one athlete in the shared sim, so the shared module
    // can be run over it verbatim rather than reimplemented here.
    predRef.current = {
      startsAt: null,
      endsAt: null,
      athletes: {
        [myId]: {
          lane: room.lanes?.[myId] ?? 1,
          stage: 'wind',
          spin0: 0,
          spinAt: 0,
          heading0: 0,
          turns: 0,
          lastTurnAt: 0,
          windFrom: 0,
          throwUntil: 0,
          throw: null,
          throws: [],
          best: 0,
        },
      },
    };
  }, [myId, room.lanes]);

  // --- the snapshot feed ----------------------------------------------------
  useEffect(() => {
    const net = netRef.current;
    let alive = true;
    const pump = () => {
      if (!alive) return;
      const latest = net.buffer[net.buffer.length - 1]?.s ?? null;
      // Only the things the JSX actually renders go through React: the marks
      // on the board change three times an attempt, not sixty times a second.
      setSnap((prev) => {
        if (!latest) return prev;
        const sig = JSON.stringify(
          Object.entries(latest.a ?? {}).map(([id, a]) => [id, a.st, a.j.length, a.bt]),
        );
        return sig === prev?.__sig ? prev : { ...latest, __sig: sig };
      });
      setTimeout(pump, 120);
    };
    pump();
    return () => {
      alive = false;
    };
  }, [netRef]);

  // --- the player's own inputs ---------------------------------------------
  // Applied to the local prediction FIRST and sent second, so the arrow moves
  // on the frame the finger moved it.
  const localNow = () => serverNow(netRef.current);

  const handleTurn = () => {
    const pred = predRef.current;
    if (!pred) return;
    hammerThrow.applyInput(pred, myId, { t: 'turn' }, localNow());
    sendInput({ t: 'turn' });
  };

  const handleRelease = () => {
    const pred = predRef.current;
    if (!pred) return;
    const a = pred.athletes[myId];
    // The heading the player SAW, in degrees. The server bounds it against its
    // own reading of the same pure spin — see `applyInput` in the sim.
    const heading = wrapAngle(headingAt(a, localNow())) / RAD;
    sendInput({ t: 'release', v: heading });
    a.stage = 'flight'; // stop winding locally; the server owns the arc
  };

  const handleFoul = () => {
    const pred = predRef.current;
    if (!pred) return;
    sendInput({ t: 'foul' });
    pred.athletes[myId].stage = 'flight';
  };

  // --- the frame loop -------------------------------------------------------
  useEffect(() => {
    let last = performance.now();

    const frame = (now) => {
      rafRef.current = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      const net = netRef.current;
      const pred = predRef.current;
      if (!pred || net.buffer.length === 0) return;

      const sNow = serverNow(net);
      const latest = net.buffer[net.buffer.length - 1].s;
      const authoritative = sampleAt(net, net.lastServerT - BUFFER_MS, []);
      if (pred.startsAt == null && latest.s) {
        pred.startsAt = latest.s;
        pred.endsAt = latest.e;
      }
      const started = sNow >= latest.s;

      // --- the local athlete ------------------------------------------------
      const local = pred.athletes[myId];
      const server = latest.a?.[myId];
      let myHeading = 0;
      let mySpin = MIN_SPIN;

      if (local && server) {
        if (server.st === 'wind') {
          if (local.stage !== 'wind') {
            // A fresh attempt: adopt the server's wind wholesale rather than
            // easing across a reset.
            local.stage = 'wind';
            local.turns = server.tn;
            local.throws = local.throws.slice(0, server.j.length);
          }
          local.best = server.bt;

          const authoritativeHeading = headingAt(
            { spin0: server.s0, spinAt: server.sa, heading0: server.h0 },
            sNow,
          );
          const predicted = headingAt(local, sNow);
          // Both sides are computing the same closed form; the gap is only the
          // turns still in flight. Ease it out rather than snapping the arrow.
          const drift = wrapAngle(authoritativeHeading - predicted);
          local.heading0 += drift * Math.min(1, RECONCILE_RATE * dt);

          myHeading = headingAt(local, sNow);
          mySpin = spinAt(local, sNow);
        } else {
          // In the air: the throw was measured the instant it left her hand and
          // there is nothing for a prediction to add.
          local.stage = server.st;
          myHeading = headingAt(
            { spin0: server.s0, spinAt: server.sa, heading0: server.h0 },
            sNow,
          );
          mySpin = spinAt({ spin0: server.s0, spinAt: server.sa }, sNow);
        }
      }

      // --- the arrow, the meters --------------------------------------------
      const nowGreen = started && server?.st === 'wind' && isGreen(myHeading);
      if (nowGreen !== greenRef.current) {
        greenRef.current = nowGreen;
        setGreen(nowGreen);
      }

      if (arrowRef.current) {
        arrowRef.current.style.transform = `translate(-50%, -100%) rotate(${
          (wrapAngle(myHeading) / RAD).toFixed(1)
        }deg)`;
        arrowRef.current.dataset.green = nowGreen ? '1' : '0';
      }
      if (spinBarRef.current) {
        const pct = clamp((mySpin - MIN_SPIN) / (MAX_SPIN - MIN_SPIN), 0, 1) * 100;
        spinBarRef.current.style.width = `${pct.toFixed(1)}%`;
      }
      if (turnsRef.current) {
        turnsRef.current.textContent = String(server?.tn ?? 0);
      }

      // --- the hammer, and the crew walking out ------------------------------
      const arc = server?.f ? flightPoint(server.f, sNow) : null;
      if (hammerRef.current) {
        if (arc) {
          hammerRef.current.style.opacity = arc.landed ? '0.9' : '1';
          hammerRef.current.style.left = `${50 + (arc.z / FIELD_M) * 50}%`;
          hammerRef.current.style.bottom = `${(arc.x / FIELD_M) * 100}%`;
          hammerRef.current.style.transform = `translate(-50%, 50%) scale(${(1 + arc.air * 0.9).toFixed(2)})`;
        } else {
          hammerRef.current.style.opacity = '0';
        }
      }
      if (crewRef.current) {
        // The officials only walk once the hammer is down, and never for a foul.
        const walk = arc?.measuring ?? 0;
        crewRef.current.style.opacity = walk > 0 ? '1' : '0';
        crewRef.current.style.left = `${50 + (arc ? (arc.z / FIELD_M) * 50 * walk : 0)}%`;
        crewRef.current.style.bottom = `${arc ? (arc.x / FIELD_M) * 100 * walk : 0}%`;
      }

      // --- everyone else's marks --------------------------------------------
      const source = authoritative ?? latest;
      for (const player of players) {
        const node = markRefs.current.get(player.id);
        if (!node) continue;
        const a = source.a?.[player.id];
        const best = a?.bt ?? 0;
        node.style.bottom = `${clamp((best / FIELD_M) * 100, 0, 100)}%`;
        node.style.opacity = best > 0 ? '1' : '0';
      }

      // --- the words --------------------------------------------------------
      if (stageRef.current) {
        stageRef.current.textContent = !started
          ? t.getReady
          : server?.st === 'done'
            ? t.htDone
            : arc
              ? (arc.measuring > 0 ? t.htMeasuring : t.htFlight)
              : nowGreen
                ? t.htGreen
                : (server?.tn ?? 0) > 0
                  ? t.htRelease
                  : t.htWind;
      }
      if (clockRef.current) {
        const left = Math.max(0, (latest.e ?? sNow) - sNow);
        clockRef.current.textContent = started
          ? (left / 1000).toFixed(1)
          : Math.ceil(Math.max(0, (latest.s ?? sNow) - sNow) / 1000).toFixed(0);
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [myId, netRef, players]);

  const throwing = stage === 'wind' && attemptsUsed < ATTEMPTS;

  return (
    <div className="relative flex h-full flex-col bg-gradient-to-b from-sky-900 via-emerald-900 to-emerald-950">
      {/* --- the field, seen from behind the circle ------------------------ */}
      <div ref={fieldRef} className="relative mx-4 mt-3 flex-1 overflow-hidden rounded-2xl bg-emerald-700/80">
        {/* the sector, painted */}
        <div
          className="absolute inset-x-0 bottom-0 top-0"
          style={{
            clipPath: `polygon(50% 0%, ${50 - Math.tan(SECTOR_HALF_DEG * RAD) * 50}% 100%, ${
              50 + Math.tan(SECTOR_HALF_DEG * RAD) * 50
            }% 100%)`,
            background: 'repeating-linear-gradient(0deg,#3f9a37 0 6%,#48a83e 6% 12%)',
            transform: 'scaleY(-1)',
          }}
        />
        {/* the arcs, every ten metres */}
        {[20, 30, 40, 50, 60, 70, 80, 90].map((m) => (
          <div
            key={m}
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 border-t border-white/35"
            style={{ bottom: `${(m / FIELD_M) * 100}%`, width: `${Math.min(100, (m / FIELD_M) * 118)}%` }}
          >
            <span className="absolute left-1/2 -translate-x-1/2 -translate-y-full text-[9px] text-white/60">{m}</span>
          </div>
        ))}

        {/* every athlete's best, as a marker flag out on the grass */}
        {players.map((player) => (
          <div
            key={player.id}
            ref={(n) => { if (n) markRefs.current.set(player.id, n); else markRefs.current.delete(player.id); }}
            style={{ opacity: 0 }}
            className={`pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-1
                        transition-opacity duration-300 ${player.id === myId ? 'z-10' : ''}`}
          >
            <Flag code={player.country} className="h-2.5 w-3.5" />
            <span className="text-[9px] font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
              {player.name}
            </span>
          </div>
        ))}

        {/* the hammer in the air, and the officials walking out to it */}
        <div
          ref={hammerRef}
          style={{ opacity: 0 }}
          className="pointer-events-none absolute h-3 w-3 rounded-full bg-neutral-200 shadow-[0_0_10px_rgba(255,255,255,0.6)]"
        />
        <div
          ref={crewRef}
          style={{ opacity: 0 }}
          className="pointer-events-none absolute -translate-x-1/2 translate-y-1/2 text-sm transition-opacity duration-200"
        >
          🏃‍♀️🏃‍♀️
        </div>

        {/* the circle, and the arrow she is facing */}
        <div className="absolute bottom-0 left-1/2 h-10 w-10 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white/70 bg-amber-200/80" />
        <div
          ref={arrowRef}
          data-green="0"
          style={{ transform: 'translate(-50%, -100%)' }}
          className="absolute bottom-4 left-1/2 h-16 w-0 origin-bottom border-x-[7px] border-b-[26px]
                     border-x-transparent transition-colors duration-75
                     data-[green='1']:border-b-emerald-300 data-[green='0']:border-b-sky-400"
        />
      </div>

      {/* --- the meters ---------------------------------------------------- */}
      <div className="relative mt-2 flex items-center gap-3 px-5">
        <span className="text-[10px] uppercase tracking-wider text-white/60">{t.htSpin}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/50">
          <div ref={spinBarRef} style={{ width: '0%' }} className="h-full rounded-full bg-amber-400" />
        </div>
        <span className="text-xs text-white/70">
          <span ref={turnsRef}>0</span> {t.htTurns}
        </span>
        <span className="text-xs text-white/70">{t.htAttempt(Math.min(attemptsUsed + 1, ATTEMPTS), ATTEMPTS)}</span>
        <span ref={clockRef} className="w-8 text-right font-mono text-xs text-white/80">–</span>
      </div>

      <p
        ref={stageRef}
        className="relative mt-2 text-center text-sm font-semibold text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]"
      >
        –
      </p>

      {/* --- the circle, as a control -------------------------------------- */}
      <div className="relative mx-4 mb-4 mt-2 h-56">
        <SpinPad
          green={green}
          disabled={!throwing}
          onTurn={handleTurn}
          onRelease={handleRelease}
          onFoul={handleFoul}
        />
        <p className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-[11px] leading-tight text-white/70 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]">
          {t.htHint}
        </p>
      </div>

      <Scoreboard room={room} snap={snap} meId={myId} />
    </div>
  );
}

/** Every athlete's three marks, best first — the same shape the other events use. */
function Scoreboard({ room, snap, meId }) {
  const rows = room.players
    .map((player) => ({ player, a: snap?.a?.[player.id] ?? null }))
    .sort((x, y) => (y.a?.bt ?? 0) - (x.a?.bt ?? 0));

  return (
    <div className="border-t border-white/10 bg-black/40 px-4 py-2">
      {rows.map(({ player, a }) => (
        <div
          key={player.id}
          className={`flex items-center gap-2 py-0.5 text-xs ${
            player.id === meId ? 'text-amber-200' : 'text-white/75'
          }`}
        >
          <Flag code={player.country} className="h-3 w-4.5" />
          <span className="flex-1 truncate">{player.name}</span>
          {Array.from({ length: ATTEMPTS }).map((_, i) => {
            const mark = a?.j?.[i];
            const kind = mark?.[2];
            return (
              <span key={i} className="w-14 text-right tabular-nums">
                {mark === undefined
                  ? '—'
                  : isFoul(kind)
                    ? <span className="text-red-400">{FOUL_TEXT[kind]?.() ?? 'X'}</span>
                    : `${mark[0].toFixed(2)}m`}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
