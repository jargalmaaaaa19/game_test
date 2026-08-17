// Archery.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to draw the sweeping aim
// marker and the power gauge, so what the player sees is what the server
// scores.
//
// Two taps per arrow: the first locks the ANGLE off a marker sweeping across
// the target, the second locks POWER off a gauge sweeping up and down. Three
// arrows each, all against the same wind, and the wind is what turns "tap
// twice" into a decision.

export const ARROWS_PER_ATHLETE = 3;
export const COUNTDOWN_MS = 2_500;
export const MAX_ROUND_MS = 42_000;

// Sweep periods. Angle is the slower, more forgiving one; power is where the
// tension lives.
export const AIM_PERIOD_MS = 1_800;
export const POWER_PERIOD_MS = 1_100;

// A tap closer than this to the previous one is a double-fire, not a decision.
const MIN_TAP_INTERVAL_MS = 120;

// Ballistics, in target radii (1.0 = the outer ring's edge).
const SPREAD = 0.9; // how far a full-left/right aim throws the arrow
const POWER_IDEAL = 0.72; // the power that flies flat
const DROP = 2.2; // how hard an under- or over-powered shot misses vertically
const WIND_PULL = 0.55; // wind's authority, before power divides it

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Triangle wave in [-1, 1] — sweeps out and back rather than snapping around. */
function triangle(elapsed, period) {
  const x = ((elapsed % period) + period) % period / period;
  return x < 0.5 ? x * 4 - 1 : 3 - x * 4;
}

/** Where the aim marker is right now, in [-1, 1]. */
export const aimAt = (athlete, now) => triangle(now - athlete.stageAt, AIM_PERIOD_MS);

/** Where the power gauge is right now, in [0, 1]. */
export const powerAt = (athlete, now) => (triangle(now - athlete.stageAt, POWER_PERIOD_MS) + 1) / 2;

/**
 * Ring score from the distance to the centre, in target radii.
 * 10 at the bullseye down to 1 at the rim, 0 off the target.
 */
export function ringScore(r) {
  if (!(r < 1)) return 0; // also catches NaN
  return 11 - Math.max(1, Math.ceil(r * 10));
}

/** Where an arrow lands, in target radii from the centre. */
export function landing(aim, power, wind) {
  const p = clamp(power, 0.35, 1);
  return {
    dx: aim * SPREAD + (wind.x * WIND_PULL) / p,
    dy: (POWER_IDEAL - power) * DROP + (wind.y * WIND_PULL) / p,
  };
}

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

    const athletes = {};
    for (const { playerId, lane } of seats) {
      athletes[playerId] = {
        lane,
        stage: 'aim', // 'aim' -> 'power' -> back to 'aim', or 'done'
        stageAt: now + COUNTDOWN_MS,
        aim: 0,
        shots: [], // { dx, dy, score }
        score: 0,
        best: 0,
        lastTapAt: 0,
      };
    }
    return { startsAt: now + COUNTDOWN_MS, endsAt: now + COUNTDOWN_MS + MAX_ROUND_MS, winds, athletes };
  },

  /**
   * One tap. `input.t` is 'aim' or 'power'; `input.v` is the value the player
   * actually saw on their screen.
   *
   * The value is taken from the CLIENT, then bounded against what this server's
   * own clock says the sweep should read. Sampling purely on the server would
   * charge every player their ping — you release on the bullseye and score a 7.
   * Trusting the client outright would let a modded one send 0.72 every time.
   * So: accept the player's number when it is within one plausible round trip
   * of ours, otherwise use ours.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.stage === 'done' || now < state.startsAt) return;
    if (!input || (input.t !== 'aim' && input.t !== 'power')) return;
    if (input.t !== a.stage) return; // out of order: ignore rather than guess
    if (now - a.lastTapAt < MIN_TAP_INTERVAL_MS) return;
    a.lastTapAt = now;

    const reported = typeof input.v === 'number' && Number.isFinite(input.v) ? input.v : null;

    if (a.stage === 'aim') {
      const server = aimAt(a, now);
      const v = reported != null && Math.abs(reported - server) <= 0.35 ? reported : server;
      a.aim = clamp(v, -1, 1);
      a.stage = 'power';
      a.stageAt = now;
      return;
    }

    const server = powerAt(a, now);
    const v = reported != null && Math.abs(reported - server) <= 0.3 ? reported : server;
    const power = clamp(v, 0, 1);

    const wind = state.winds[a.shots.length] ?? { x: 0, y: 0 };
    const { dx, dy } = landing(a.aim, power, wind);
    const score = ringScore(Math.hypot(dx, dy));

    a.shots.push({
      dx: Math.round(dx * 100) / 100,
      dy: Math.round(dy * 100) / 100,
      score,
    });
    a.score += score;
    a.best = Math.max(a.best, score);

    if (a.shots.length >= ARROWS_PER_ATHLETE) {
      a.stage = 'done';
    } else {
      a.stage = 'aim';
      a.stageAt = now;
    }
  },

  // Nothing moves between taps — the sweeps are pure functions of the clock, so
  // there is no per-tick simulation to run.
  step() {},

  isFinished(state, now) {
    if (now >= state.endsAt) return true;
    return Object.values(state.athletes).every((a) => a.stage === 'done');
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
        st: at.stage,
        sa: at.stageAt,
        am: at.aim,
        sc: at.score,
        sh: at.shots.map((s) => [s.dx, s.dy, s.score]),
      };
    }
    return { s: state.startsAt, e: state.endsAt, w: state.winds, a };
  },

  /** Bot seats and stalled-player fill: aims into the wind, roughly. */
  botInput(state, botId, difficulty = 0.7, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.stage === 'done' || now < state.startsAt) return null;
    if (now - a.lastTapAt < 700) return null;

    const wind = state.winds[a.shots.length] ?? { x: 0, y: 0 };
    const slop = (1 - difficulty) * 0.5;
    if (a.stage === 'aim') {
      return { t: 'aim', v: clamp(-wind.x * 0.85 + slop, -1, 1) };
    }
    return { t: 'power', v: clamp(POWER_IDEAL + slop * 0.5, 0, 1) };
  },
};
