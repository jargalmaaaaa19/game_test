// Archery.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to place its reticle, so
// where the player sees the arrow go is where the server scores it.
//
// HOLD TO AIM, RELEASE TO FIRE. One finger anywhere on the glass drags the
// crosshair; lifting it fires from wherever the crosshair was. Three shots
// each, and TWO forces pull the shot off the gold:
//
//  1. SWAY — the barrel drifting, drawn on screen. The player counters it by
//     dragging against it, and the skill is releasing on the beat where the
//     drift has carried the crosshair home.
//  2. WIND — invisible, announced in the HUD, and added only once the shot is
//     away. The crosshair is where you are POINTING, never a promise.
//
// The two are deliberately different KINDS of problem: one is a moving thing
// you chase, the other a fixed number you lean into.
//
// Sway is a pure function of the round's seed and the clock, so the server
// computes the same drift the client drew and the shot stays honest without a
// timestamp on the wire. What the client sends is only the DRAG — the part the
// player chose — and a choice is not a measurement: a perfect client and a
// perfect player send the same number, so the server takes it as given and
// clamps the range.
//
// A player who never touches the glass still fires down the middle and loses
// only what the drift and the wind take, so nobody is ever left with nothing on
// the scoreboard. This is a party game, not a shooting sim.

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

// How far the crosshair drifts on its own, in target radii. Two rings' worth:
// enough that standing still is never the right answer, gentle enough that it
// can be chased with one thumb.
export const SWAY_REACH = 0.22;

// Two arrows closer together than this are a double-fire, not two decisions.
const MIN_SHOT_INTERVAL_MS = 250;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Where the barrel has drifted to at `now`, in target radii.
 *
 * PURE, and a function of the clock rather than a value on the wire: the client
 * draws the crosshair with it at 60fps and the server scores the shot with it,
 * so neither has to tell the other where the sight was. Two waves of different,
 * incommensurate periods, which is what stops the drift reading as a metronome
 * a player can simply memorise.
 */
export function swayAt(seed, now) {
  const t = now / 1000;
  const a = num(seed) * 6.283;
  return {
    x: (Math.sin(t * 0.83 + a) * 0.62 + Math.sin(t * 1.97 + a * 2.3) * 0.38) * SWAY_REACH,
    y: (Math.cos(t * 0.67 + a * 1.4) * 0.62 + Math.sin(t * 1.51 + a * 3.1) * 0.38) * SWAY_REACH,
  };
}

/**
 * Ring score from the distance to the centre, in target radii.
 * 10 at the bullseye down to 1 at the rim, 0 off the target.
 */
export function ringScore(r) {
  if (!(r < 1)) return 0; // also catches NaN
  return 11 - Math.max(1, Math.ceil(r * 10));
}

/**
 * Where the crosshair is sitting, in target radii from the centre.
 *
 * `aim` is the drag, each axis in [-1, 1], +y up. This is what the player can
 * SEE — their drag plus the drift — and the client draws it from exactly this
 * call, so the picture and the score cannot disagree.
 */
export function crosshairAt(aim, sway) {
  return {
    dx: clamp(num(aim?.x), -1, 1) * AIM_REACH + num(sway?.x),
    dy: clamp(num(aim?.y), -1, 1) * AIM_REACH + num(sway?.y),
  };
}

/**
 * Where a shot fired at `aim` lands, in target radii from the centre: the
 * crosshair, plus the wind that was never on the crosshair to begin with.
 */
export function landing(aim, wind, sway) {
  const at = crosshairAt(aim, sway);
  return {
    dx: at.dx + num(wind?.x) * WIND_PULL,
    dy: at.dy + num(wind?.y) * WIND_PULL,
  };
}

/** The drag that cancels a given wind and drift — the bot's aim, and the answer. */
export const aimThatCancels = (wind, sway) => ({
  x: clamp((-num(wind?.x) * WIND_PULL - num(sway?.x)) / AIM_REACH, -1, 1),
  y: clamp((-num(wind?.y) * WIND_PULL - num(sway?.y)) / AIM_REACH, -1, 1),
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

    // The drift is the same for everyone, from the same seed: one shared set
    // of conditions is the only version of this that is fair.
    const sway = Math.round(rng() * 1000) / 1000;

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
    return { startsAt, endsAt: startsAt + MAX_ROUND_MS, winds, sway, athletes };
  },

  /**
   * One shot. `input.x` and `input.y` are the drag, each in [-1, 1], +y up.
   *
   * The drag is taken at face value and merely clamped — see the note at the
   * top of the file. The drift is NOT taken from the client: it is recomputed
   * here from the seed and this server's own clock, so a modded client cannot
   * claim the barrel was steadier than it was. The only other thing worth
   * defending against is the trigger being scripted, which the interval covers.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.done || now < state.startsAt) return;
    if (!input) return;
    if (now - a.lastShotAt < MIN_SHOT_INTERVAL_MS) return;
    a.lastShotAt = now;

    const wind = state.winds[a.shots.length] ?? { x: 0, y: 0 };
    const { dx, dy } = landing(input, wind, swayAt(state.sway, now));
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

  // Nothing to advance: the drift is a function of the clock rather than a
  // thing that has to be stepped, and an aim is held by the player's thumb.
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
    return { s: state.startsAt, e: state.endsAt, w: state.winds, k: state.sway, a };
  },

  /** Bot seats and stalled-player fill: corrects for the wind, imperfectly. */
  botInput(state, botId, difficulty = 0.7, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.done || now < state.startsAt) return null;
    // Measured from the gun as well as the last arrow, so a bot does not
    // loose the instant the countdown ends.
    if (now - Math.max(a.lastShotAt, state.startsAt) < 1_600) return null;

    const wind = state.winds[a.shots.length] ?? { x: 0, y: 0 };
    const ideal = aimThatCancels(wind, swayAt(state.sway, now));
    const slop = (1 - difficulty) * 0.3;
    return { x: clamp(ideal.x + slop, -1, 1), y: clamp(ideal.y - slop, -1, 1) };
  },
};
