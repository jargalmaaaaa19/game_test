// 50m Backstroke.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to draw the cue queue, so
// the arrow the player answers is the arrow the server scores.
//
// A QUEUE, not a metronome. Cues line up at the hit block and WAIT: the one at
// the front stays there until it is answered, and answering it brings the next
// one forward. Nothing expires, nothing streams past, and there is no window to
// be late for — press the matching side whenever you have read it, early or
// otherwise.
//
// That is what makes the lane run at the swimmer's own pace rather than at a
// clock's: the queue only advances when a stroke lands, so a player who is
// struggling gets a lane that waits for them instead of one that buries them.
// It replaced a timed stream whose arrows crossed the screen faster than they
// could be read, and which charged a miss for every one that got away.
//
// What is scored, then, is VOLUME: correct strokes, as many as you can land.
// The side of each is drawn from the match seed and never taken in turns, so
// every cue has to be READ; a wrong side costs speed and does NOT advance the
// queue, which is what stops both buttons being hammered. And the impulse a
// stroke is worth saturates per SECOND (see `cadenceFactor`), so pressing
// faster than a swimmer can pull buys exactly nothing — the sprint learned that
// lesson the hard way when a spammer won the first end-to-end run.
//
// Stop pressing and nothing punishes you but the water: speed decays, the
// swimmer coasts to a halt, and the race is lost by standing still rather than
// by a penalty.

export const DISTANCE_M = 50;
export const COUNTDOWN_MS = 2_500;
export const MAX_RACE_MS = 42_000;

// How long the pattern is before it repeats. The queue index wraps, so the
// stream of cues is endless while the wire still carries a fixed, small array —
// and ninety arrows is far more than anyone memorises inside one heat.
export const PATTERN_LEN = 90;

// The cadence a stroke is worth full value at. Faster than this is neither
// better nor worse (impulse per second is flat below it); slower costs you.
const IDEAL_STROKE_MS = 260;

// Two presses closer together than this are one twitch, not two strokes: the
// clock restarts and nothing is paid, so a held or scripted button never builds
// speed. Same defence as the sprint's stride.
const MIN_STROKE_MS = 45;

// m/s added by a full-value stroke. The FLOOR is what sets this, not the
// ceiling: a swimmer answering correctly but slowly — one stroke every half
// second — must still cover the 50m inside MAX_RACE_MS. Being slow is a worse
// race, not a race that never ends. (At 0.42 it was not: they finished at 46m,
// stranded with the clock out.)
const STROKE_IMPULSE = 0.48;

// Water resistance. A stroke on the wrong side costs most: you have caught the
// water backwards.
const PENALTY = { wrong: 0.75 };

const DRAG = 0.65;
const MAX_SPEED = 2.8; // m/s — a shade over world-record pace

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The side cue `i` calls for: 0 = left, 1 = right.
 *
 * The index WRAPS, which is the whole reason the queue can be endless without
 * the wire carrying an endless array.
 */
export const sideOf = (sides, i) =>
  (sides?.length ? sides[((i % sides.length) + sides.length) % sides.length] : i % 2);

/**
 * What a stroke at this cadence is worth, 0..1.
 *
 * Impulse per SECOND is what this flattens: half the gap gives half the
 * impulse, so tapping twice as fast delivers the same speed. It has to be the
 * ECONOMICS rather than a rate limit — a bare "ignore presses closer than 45ms"
 * hands a script the maximum legal cadence and it beats every human.
 */
export const cadenceFactor = (gap) => clamp(gap / IDEAL_STROKE_MS, 0, 1);

/** How the client labels a stroke: full value, most of it, or laboured. */
export function gradeFor(gap) {
  if (gap >= IDEAL_STROKE_MS * 2.2) return 'ok';
  if (gap >= IDEAL_STROKE_MS) return 'perfect';
  return 'good';
}

export default {
  id: 'freestyle_swim',

  initState(seats, rng, now) {
    // Mixed, not taking turns. Each cue's side is drawn independently, so the
    // pattern cannot be second-guessed and every cue has to be READ.
    //
    // The one constraint is a cap of three of a side in a row. Unconstrained
    // coin flips throw runs of six often enough that players read them as the
    // event being broken rather than as luck.
    const sides = [];
    let previous = -1;
    let run = 0;
    for (let i = 0; i < PATTERN_LEN; i += 1) {
      let side = rng() < 0.5 ? 0 : 1;
      if (side === previous && run >= 2) side = 1 - side;
      run = side === previous ? run + 1 : 0;
      previous = side;
      sides.push(side);
    }

    const athletes = {};
    for (const { playerId, lane } of seats) {
      athletes[playerId] = {
        lane,
        x: 0,
        v: 0,
        beat: 0, // the cue at the front of the queue, waiting to be answered
        combo: 0,
        bestCombo: 0,
        hits: { perfect: 0, good: 0, ok: 0, wrong: 0 },
        last: null, // most recent judgement, for the client's flash
        lastAt: 0,
        lastStrokeAt: 0,
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
   * Answering the cue at the front of the queue is the only thing a press can
   * do. There is no "too early": the cue is sitting there waiting, and a player
   * who has already read it should not be made to wait for an animation.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.done || now < state.startsAt) return;
    if (!input || (input.s !== 0 && input.s !== 1)) return;

    if (input.s !== sideOf(state.sides, a.beat)) {
      // Wrong side. It costs speed and the queue does NOT move on, so the cue
      // still has to be answered — which is exactly what stops a player from
      // hammering both buttons through the whole pattern.
      a.v *= PENALTY.wrong;
      a.hits.wrong += 1;
      a.combo = 0;
      a.last = 'wrong';
      a.lastAt = now;
      return;
    }

    const gap = a.lastStrokeAt ? now - a.lastStrokeAt : IDEAL_STROKE_MS;
    if (a.lastStrokeAt && gap < MIN_STROKE_MS) {
      // Pressed before the arm came round: the stroke breaks and the clock
      // restarts from this press, so holding the button down never completes a
      // stroke at all instead of riding the threshold as a perfect cadence.
      a.lastStrokeAt = now;
      return;
    }

    a.v = Math.min(a.v + STROKE_IMPULSE * cadenceFactor(gap), MAX_SPEED);
    a.hits[gradeFor(gap)] += 1;
    a.combo += 1;
    a.bestCombo = Math.max(a.bestCombo, a.combo);
    a.last = gradeFor(gap);
    a.lastAt = now;
    a.lastStrokeAt = now;
    a.beat += 1; // the queue comes forward
  },

  step(state, dt, now) {
    if (now < state.startsAt) return;

    for (const a of Object.values(state.athletes)) {
      if (a.done) continue;

      // Nothing expires. A swimmer who stops pressing is slowed by the water,
      // which is punishment enough and needs no bookkeeping.
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
    // `sides` is the whole pattern; it is ninety small integers and it never
    // changes, so sending it every tick still costs less than the plumbing to
    // send it once and recover it after a reconnect.
    return { s: state.startsAt, e: state.endsAt, sides: state.sides, a };
  },

  /** Bot seats and stalled-player fill: strokes at a steady, human cadence. */
  botInput(state, botId, difficulty = 0.75, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.done || now < state.startsAt) return null;
    // A weaker bot simply swims at a slower cadence. It never presses the wrong
    // side — being slow is a worse race, which is the honest way for a bot to
    // be beatable.
    const gap = IDEAL_STROKE_MS + (1 - difficulty) * 340;
    if (a.lastStrokeAt && now - a.lastStrokeAt < gap) return null;
    if (!a.lastStrokeAt && now - state.startsAt < 400) return null;
    return { s: sideOf(state.sides, a.beat) };
  },
};
