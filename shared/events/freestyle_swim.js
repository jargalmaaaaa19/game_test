// 50m Freestyle.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to draw the cues sliding
// toward the hit line, so the beat the player sees is the beat the server
// judges.
//
// A rhythm event: cues arrive on a fixed beat, each calling for a LEFT or RIGHT
// stroke. Hit the beat and you pull; miss it, or catch the water on the wrong
// side, and you stall. The stroke pattern mostly alternates — with the odd
// doubled side drawn from the match seed, so it has to be read rather than
// merely drummed.

export const DISTANCE_M = 50;
export const COUNTDOWN_MS = 2_500;
export const LEAD_IN_MS = 1_500; // gun to first cue, so nobody starts mid-beat
export const BEAT_MS = 480;
export const TOTAL_BEATS = 90; // more than a fast swim needs
export const MAX_RACE_MS = 42_000;

// Judgement windows, in ms either side of the beat.
export const WINDOW = { perfect: 70, good: 140, ok: 220 };

// Steady-state speed is impulse × (1/BEAT) ÷ DRAG, so these read directly as
// ~2.5 / 1.9 / 1.4 m/s. The floor matters: at 0.3 an "ok" swimmer never covered
// the 50m inside the round at all and just watched the clock expire, which is a
// punishment, not a difficulty curve. Every timing that lands inside a window
// must still finish.
const IMPULSE = { perfect: 0.78, good: 0.6, ok: 0.45 };

// Water resistance. A missed beat costs more than a mistimed one, and a stroke
// on the wrong side costs most of all — you have caught the water backwards.
const PENALTY = { miss: 0.82, wrong: 0.75, splash: 0.9 };

const DRAG = 0.65;
const MAX_SPEED = 2.8; // m/s — a shade over world-record pace

// These take PRIMITIVES, not a state object, on purpose. The sim's state calls
// the field `startsAt` while the wire snapshot calls it `s`, so a helper that
// reached into "state" silently produced NaN on the client — the cue lane
// rendered nothing and every stroke was judged as a splash. Passing the number
// makes the mismatch impossible.

/** When cue `i` should be struck, on the server clock. */
export const beatTime = (startsAt, i) => startsAt + LEAD_IN_MS + i * BEAT_MS;

/** 0 = left, 1 = right. */
export const sideOf = (sides, i) => sides?.[i] ?? i % 2;

/** How good a press at `now` was against beat `i`; null if outside every window. */
export function judge(startsAt, i, now) {
  const delta = Math.abs(now - beatTime(startsAt, i));
  if (delta <= WINDOW.perfect) return 'perfect';
  if (delta <= WINDOW.good) return 'good';
  if (delta <= WINDOW.ok) return 'ok';
  return null;
}

/**
 * Charge every cue whose window has already closed.
 *
 * Called from BOTH `step` and `applyInput`. Doing it only on the tick left a
 * press up to one tick (50ms) after a beat expired being judged against that
 * dead beat — the player was told "early" for a stroke that was actually on
 * time for the NEXT cue. Expiring first makes the judgement independent of
 * where the press happens to fall between ticks.
 */
function expireStaleBeats(state, a, now) {
  while (a.beat < TOTAL_BEATS && beatTime(state.startsAt, a.beat) + WINDOW.ok < now) {
    a.v *= PENALTY.miss;
    a.hits.miss += 1;
    a.combo = 0;
    a.last = 'miss';
    a.lastAt = now;
    a.beat += 1;
  }
}

export default {
  id: 'freestyle_swim',

  initState(seats, rng, now) {
    // Mostly alternating, with a repeat about a quarter of the time. Pure
    // alternation is a drum roll; pure randomness is not a swimming stroke.
    const sides = [];
    let side = 0;
    for (let i = 0; i < TOTAL_BEATS; i += 1) {
      sides.push(side);
      if (rng() > 0.25) side = side === 0 ? 1 : 0;
    }

    const athletes = {};
    for (const { playerId, lane } of seats) {
      athletes[playerId] = {
        lane,
        x: 0,
        v: 0,
        beat: 0, // the next unresolved cue
        combo: 0,
        bestCombo: 0,
        hits: { perfect: 0, good: 0, ok: 0, miss: 0, wrong: 0 },
        last: null, // most recent judgement, for the client's flash
        lastAt: 0,
        done: false,
        time: null,
      };
    }
    return {
      startsAt: now + COUNTDOWN_MS,
      endsAt: now + COUNTDOWN_MS + MAX_RACE_MS,
      sides,
      athletes,
    };
  },

  /**
   * One stroke. `input.s` is the side pressed (0 left, 1 right).
   *
   * Only the NEXT unresolved cue can be struck, and it can be struck once. That
   * is what stops a player from simply hammering both buttons: a press with no
   * cue in range is a splash, and splashing costs speed. Rate-limiting the
   * button instead would just hand a script the maximum legal stroke rate — the
   * sprint already taught that lesson the hard way.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.done || now < state.startsAt) return;
    if (!input || (input.s !== 0 && input.s !== 1)) return;

    expireStaleBeats(state, a, now);
    if (a.beat >= TOTAL_BEATS) return;

    const grade = judge(state.startsAt, a.beat, now);
    if (!grade) {
      // Nothing to hit: an early flail. No cue is consumed, so it cannot be
      // used to skip ahead either.
      a.v *= PENALTY.splash;
      a.last = 'splash';
      a.lastAt = now;
      return;
    }

    if (input.s !== sideOf(state.sides, a.beat)) {
      a.v *= PENALTY.wrong;
      a.hits.wrong += 1;
      a.combo = 0;
      a.last = 'wrong';
    } else {
      a.v = Math.min(a.v + IMPULSE[grade], MAX_SPEED);
      a.hits[grade] += 1;
      a.combo += 1;
      a.bestCombo = Math.max(a.bestCombo, a.combo);
      a.last = grade;
    }
    a.lastAt = now;
    a.beat += 1;
  },

  step(state, dt, now) {
    if (now < state.startsAt) return;

    for (const a of Object.values(state.athletes)) {
      if (a.done) continue;

      // Any cue whose window has closed unstruck is a miss, so a player who
      // simply stops is slowed by the water rather than coasting.
      expireStaleBeats(state, a, now);

      a.v *= Math.exp(-DRAG * dt);
      a.x += a.v * dt;

      if (a.x >= DISTANCE_M) {
        a.x = DISTANCE_M;
        a.v = 0;
        a.done = true;
        a.time = Math.round(now - state.startsAt);
      }
    }
  },

  isFinished(state, now) {
    if (now >= state.endsAt) return true;
    return Object.values(state.athletes).every((a) => a.done);
  },

  /**
   * Player ids, best first. Finishers by time; anyone still swimming is ranked
   * by distance. Lane breaks any remaining tie so every client agrees.
   */
  placements(state) {
    return Object.entries(state.athletes)
      .sort(([, a], [, b]) => {
        if (a.done !== b.done) return a.done ? -1 : 1;
        if (a.done && b.done && a.time !== b.time) return a.time - b.time;
        if (!a.done && b.x !== a.x) return b.x - a.x;
        return a.lane - b.lane;
      })
      .map(([playerId]) => playerId);
  },

  /** Compact wire form — quantized, and only what the renderer draws. */
  snapshot(state) {
    const a = {};
    for (const [id, at] of Object.entries(state.athletes)) {
      a[id] = {
        l: at.lane,
        x: Math.round(at.x * 100) / 100,
        v: Math.round(at.v * 100) / 100,
        b: at.beat,
        c: at.combo,
        j: at.last,
        ja: at.lastAt,
        d: at.done ? 1 : 0,
        t: at.time,
      };
    }
    // `sides` is the whole pattern; it is ~90 small integers and it never
    // changes, so sending it every tick still costs less than the plumbing to
    // send it once and recover it after a reconnect.
    return { s: state.startsAt, e: state.endsAt, sides: state.sides, a };
  },

  /** Bot seats and stalled-player fill: strokes on the beat, imperfectly. */
  botInput(state, botId, difficulty = 0.75, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.done || now < state.startsAt || a.beat >= TOTAL_BEATS) return null;
    const lead = (1 - difficulty) * WINDOW.ok;
    if (Math.abs(now - beatTime(state.startsAt, a.beat)) > Math.max(30, lead)) return null;
    return { s: sideOf(state.sides, a.beat) };
  },
};
