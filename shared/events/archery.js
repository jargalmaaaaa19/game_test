// Archery.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to place its reticle, so
// where the player sees the arrow go is where the server scores it.
//
// AIM AND LOOSE. A stick moves a reticle over the target; a separate button
// looses the arrow. Three arrows each, all against the same wind, and the wind
// is the whole decision — point at the gold and it drifts, point off into the
// wind by the right amount and it does not.
//
// This replaced a pair of timed sweeps (a marker sliding across for angle, a
// gauge bouncing for power). Two things fell out of the change:
//
//  1. It is much more forgiving, which is the point — this is a party game, not
//     a shooting sim. A player who never touches the stick still looses down
//     the middle and only loses what the wind takes, so nobody is ever left
//     with nothing on the scoreboard.
//  2. There is nothing left to cheat. The old sweeps had to be sampled against
//     the server clock and bounded, or a modded client could report the perfect
//     instant every time. An aim is not a measurement, it is a CHOICE — a
//     perfect client and a perfect player send the same number — so the server
//     takes it as given and only clamps the range.

export const ARROWS_PER_ATHLETE = 3;
export const COUNTDOWN_MS = 2_500;
export const MAX_ROUND_MS = 42_000;

// How far off the gold a fully deflected stick points, in target radii. Past
// 1.0 on purpose: overshooting the target has to be possible or there is no
// cost to yanking the stick, and the wind sometimes needs more than a radius
// of correction.
export const AIM_REACH = 1.3;

// Wind's authority, in target radii at full strength. Around 0.55 the gold is
// still reachable in the worst wind, but only if you actually correct for it.
const WIND_PULL = 0.55;

// Two arrows closer together than this are a double-fire, not two decisions.
const MIN_SHOT_INTERVAL_MS = 250;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Ring score from the distance to the centre, in target radii.
 * 10 at the bullseye down to 1 at the rim, 0 off the target.
 */
export function ringScore(r) {
  if (!(r < 1)) return 0; // also catches NaN
  return 11 - Math.max(1, Math.ceil(r * 10));
}

/**
 * Where an arrow loosed at `aim` lands, in target radii from the centre.
 *
 * `aim` is the stick, each axis in [-1, 1], +y up. The reticle the player is
 * looking at sits at `aim * AIM_REACH`; the wind is added on top, which is
 * exactly why the reticle is not a promise.
 */
export function landing(aim, wind) {
  return {
    dx: clamp(num(aim?.x), -1, 1) * AIM_REACH + num(wind?.x) * WIND_PULL,
    dy: clamp(num(aim?.y), -1, 1) * AIM_REACH + num(wind?.y) * WIND_PULL,
  };
}

/** Where to point to cancel a given wind — the bot's target, and the answer. */
export const aimThatCancels = (wind) => ({
  x: clamp((-num(wind?.x) * WIND_PULL) / AIM_REACH, -1, 1),
  y: clamp((-num(wind?.y) * WIND_PULL) / AIM_REACH, -1, 1),
});

export default {
  id: 'archery',

  initState(seats, rng, now) {
    // One wind per arrow, shared by everyone: the same three problems for all
    // athletes is the only version of this that is fair.
    const winds = [];
    for (let i = 0; i < ARROWS_PER_ATHLETE; i += 1) {
      winds.push({
        x: Math.round((rng() * 2 - 1) * 100) / 100,
        y: Math.round((rng() - 0.5) * 100) / 100,
      });
    }

    const startsAt = now + COUNTDOWN_MS;
    const athletes = {};
    for (const { playerId, lane } of seats) {
      athletes[playerId] = {
        lane,
        shots: [], // { dx, dy, score }
        score: 0,
        best: 0,
        done: false,
        // Zero, NOT the start gun: seeding it with `startsAt` put the very
        // first arrow inside its own guard window, so nobody could loose for a
        // quarter of a second after the countdown and a quick player's opener
        // vanished.
        lastShotAt: 0,
      };
    }
    return { startsAt, endsAt: startsAt + MAX_ROUND_MS, winds, athletes };
  },

  /**
   * One arrow. `input.x` and `input.y` are the stick, each in [-1, 1], +y up.
   *
   * Taken at face value and merely clamped — see the note at the top of the
   * file. The only thing worth defending against here is the button being held
   * down or scripted, which the interval covers.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.done || now < state.startsAt) return;
    if (!input) return;
    if (now - a.lastShotAt < MIN_SHOT_INTERVAL_MS) return;
    a.lastShotAt = now;

    const wind = state.winds[a.shots.length] ?? { x: 0, y: 0 };
    const { dx, dy } = landing(input, wind);
    const score = ringScore(Math.hypot(dx, dy));

    a.shots.push({
      dx: Math.round(dx * 100) / 100,
      dy: Math.round(dy * 100) / 100,
      score,
    });
    a.score += score;
    a.best = Math.max(a.best, score);
    if (a.shots.length >= ARROWS_PER_ATHLETE) a.done = true;
  },

  // Nothing moves between arrows: an aim is held by the player's thumb, not by
  // the clock, so there is no per-tick simulation to run.
  step() {},

  isFinished(state, now) {
    if (now >= state.endsAt) return true;
    return Object.values(state.athletes).every((a) => a.done);
  },

  /**
   * Player ids, best first. Total score, then the best single arrow, then lane
   * — a deterministic chain, so every client derives the same order.
   */
  placements(state) {
    return Object.entries(state.athletes)
      .sort(([, a], [, b]) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.best !== a.best) return b.best - a.best;
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
        d: at.done ? 1 : 0,
        sc: at.score,
        sh: at.shots.map((s) => [s.dx, s.dy, s.score]),
      };
    }
    return { s: state.startsAt, e: state.endsAt, w: state.winds, a };
  },

  /** Bot seats and stalled-player fill: corrects for the wind, imperfectly. */
  botInput(state, botId, difficulty = 0.7, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.done || now < state.startsAt) return null;
    // Measured from the gun as well as the last arrow, so a bot does not
    // loose the instant the countdown ends.
    if (now - Math.max(a.lastShotAt, state.startsAt) < 1_600) return null;

    const wind = state.winds[a.shots.length] ?? { x: 0, y: 0 };
    const ideal = aimThatCancels(wind);
    const slop = (1 - difficulty) * 0.3;
    return { x: clamp(ideal.x + slop, -1, 1), y: clamp(ideal.y - slop, -1, 1) };
  },
};
