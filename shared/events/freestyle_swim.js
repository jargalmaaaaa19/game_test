// 50m Backstroke.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to draw the lane, so the
// arrow the player answers is the arrow the server scores.
//
// A PIANO ROLL PINNED TO THE POOL. Every cue belongs to a MARK on the water —
// cue i is at `i * STROKE_M` metres — not to a moment on a clock. It is the
// swimmer who moves, and the lane scrolls because they do:
//
//   - stroke well and you speed up, so the next arrow arrives sooner, so you
//     stroke sooner again. Tapping fast IS swimming fast.
//   - let one go by unstruck and it is a miss: the water takes speed back and
//     the arrows immediately start arriving slower.
//   - stop, and you glide to a halt with the arrows stopping alongside you.
//
// That is the whole reason the cues are measured in metres. A clock-driven
// stream runs at its own pace no matter how the player is doing, which is how
// the arrows ended up crossing the screen faster than anyone could read them
// and charging a miss for every one that got away. Pinned to distance, the lane
// can only ever move as fast as the swimmer it belongs to.
//
// DRAG IS QUADRATIC, and it has to be. With cues every STROKE_M metres, the
// impulse a swimmer collects per second is proportional to their speed — so
// against linear drag every speed is an equilibrium and the race either runs
// away to infinity or dies to zero on the third decimal place of a constant.
// Against v², there is exactly one stable speed for a given quality of stroke,
// which is the honest way to say "swim better, go faster".

export const DISTANCE_M = 50;
export const COUNTDOWN_MS = 2_500;
export const MAX_RACE_MS = 42_000;

// How far apart the arrows sit on the water, and how big a mark counts as
// struck. The window is ±0.32m, which at racing pace is about a quarter of a
// second — long enough to read an arrow, short enough to miss one.
export const STROKE_M = 0.62;
export const REACH_M = 0.32;

// How long the pattern is before it repeats. The cue index wraps, so the lane
// is endless while the wire still carries a fixed, small array — and ninety
// arrows is far more than anyone memorises inside one heat.
export const PATTERN_LEN = 90;

// The push off the wall. Without it a swimmer starts at a dead stop, and a
// lane that scrolls with the swimmer would never bring them their first arrow.
const PUSH_OFF = 1.4;

// What a stroke is worth, struck at the near edge of its window versus scraping
// the far one. Steady speed is IMPULSE / (STROKE_M * DRAG), so these read as
// about 2.6 m/s for a swimmer who meets every arrow early and 1.3 for one who
// is always late — a 19-second 50m against a 38-second one, both inside the
// round.
const IMPULSE_FAST = 0.5;
const IMPULSE_SLOW = 0.25;

// Water resistance, per metre per second SQUARED — see the note at the top.
const DRAG = 0.31;
const MAX_SPEED = 3.2; // m/s — a hard ceiling, well over world-record pace

// A missed arrow costs speed; the wrong side costs more, because you have
// caught the water backwards; a stroke at nothing at all is a splash.
const PENALTY = { miss: 0.86, wrong: 0.78, splash: 0.93 };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const EDGE_EPS = 1e-9; // see `promptnessAt`

/** Where cue `i` sits, in metres from the wall. */
export const cueAt = (i) => (i + 1) * STROKE_M;

/**
 * The side cue `i` calls for: 0 = left, 1 = right.
 *
 * The index WRAPS, which is the whole reason the lane can be endless without
 * the wire carrying an endless array.
 */
export const sideOf = (sides, i) =>
  (sides?.length ? sides[((i % sides.length) + sides.length) % sides.length] : i % 2);

/**
 * How well placed a stroke at `x` is against cue `i`: 1 at the near edge of the
 * window, 0 at the far one, null outside it.
 *
 * Meeting an arrow EARLY is what pays. That is the feedback loop the whole
 * event runs on — an early stroke is a faster swimmer, a faster swimmer meets
 * the next arrow sooner, and the lane winds itself up under a player who is
 * reading ahead.
 */
export function promptnessAt(i, x) {
  const gap = x - cueAt(i);
  // The edges are inclusive to within a rounding error, and deliberately so:
  // `cueAt(3) - REACH_M` does not give back exactly -REACH_M when subtracted
  // again, so a swimmer sitting exactly on the near edge tested as out of
  // reach. A window a player can watch themselves enter must not turn on a
  // float's last bit.
  if (gap < -REACH_M - EDGE_EPS || gap > REACH_M + EDGE_EPS) return null;
  return clamp((REACH_M - gap) / (2 * REACH_M), 0, 1);
}

/** How the client labels a stroke. */
export function gradeFor(promptness) {
  if (promptness >= 0.72) return 'perfect';
  if (promptness >= 0.36) return 'good';
  return 'ok';
}

/**
 * Charge every arrow the swimmer has already gone past unstruck.
 *
 * Called from BOTH `step` and `applyInput`: expiring first makes a press
 * independent of where it happens to fall between ticks, which is what stopped
 * a player being told "early" for a stroke that was on time for the next cue.
 */
function expirePassed(a) {
  while (a.x > cueAt(a.beat) + REACH_M) {
    a.v *= PENALTY.miss;
    a.hits.miss += 1;
    a.combo = 0;
    a.last = 'miss';
    a.beat += 1;
  }
}

export default {
  id: 'freestyle_swim',

  initState(seats, rng, now) {
    // Mixed, not taking turns. Each cue's side is drawn independently, so the
    // pattern cannot be second-guessed and every arrow has to be READ.
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
        v: PUSH_OFF, // off the wall, so the first arrow is already on its way
        beat: 0, // the next unstruck cue
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
   * Judged on WHERE the swimmer is, never on when the press arrived, so a
   * player's ping cannot cost them an arrow: the pool does not move while the
   * packet is in flight.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.done || now < state.startsAt) return;
    if (!input || (input.s !== 0 && input.s !== 1)) return;

    expirePassed(a);

    const promptness = promptnessAt(a.beat, a.x);
    if (promptness === null) {
      // Nothing within reach: a stroke at open water. It costs a little speed
      // and consumes no cue, which is what stops both buttons being hammered —
      // and it has to be the ECONOMICS rather than a rate limit, or a script
      // simply presses at the maximum legal rate and beats every human.
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
      a.v = Math.min(a.v + IMPULSE_SLOW + (IMPULSE_FAST - IMPULSE_SLOW) * promptness, MAX_SPEED);
      const grade = gradeFor(promptness);
      a.hits[grade] += 1;
      a.combo += 1;
      a.bestCombo = Math.max(a.bestCombo, a.combo);
      a.last = grade;
    }
    a.lastAt = now;
    // Struck or fumbled, the arrow is behind you now. A cue that stayed put
    // after a wrong side would sit in the water while the swimmer drifted past
    // it, and the lane would stall instead of flowing.
    a.beat += 1;
  },

  step(state, dt, now) {
    if (now < state.startsAt) return;

    for (const a of Object.values(state.athletes)) {
      if (a.done) continue;

      // Quadratic, not exponential: with cues pinned to distance, only a drag
      // that grows with speed gives the race a stable pace. See the head note.
      a.v = Math.max(0, a.v - DRAG * a.v * a.v * dt);
      a.x += a.v * dt;

      expirePassed(a);

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

  /** Bot seats and stalled-player fill: meets the arrows, more or less early. */
  botInput(state, botId, difficulty = 0.75, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.done || now < state.startsAt) return null;
    // Where in the window this bot likes to strike: a strong one meets the
    // arrow as it arrives, a weak one scrapes the back of the window and swims
    // slower for it. Never at the very edge — that is a reaction no human has.
    const aim = REACH_M - 2 * REACH_M * (0.15 + (1 - difficulty) * 0.7);
    if (a.x - cueAt(a.beat) < aim) return null;
    return { s: sideOf(state.sides, a.beat) };
  },
};
