// 100m Dash.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority at 20 Hz; the client runs the SAME module to predict its own
// athlete so taps feel instant. Two implementations of these numbers is how the
// runner on your screen ends up somewhere else on everybody else's.
//
// The mechanic is a two-footed cadence: alternate left/right. Mashing one side
// still moves you, badly — that is what makes alternation a skill rather than a
// tapping-speed contest.

export const RACE_DISTANCE = 100; // metres
export const COUNTDOWN_MS = 3_000; // "on your marks" before the gun
export const MAX_RACE_MS = 25_000; // hard stop; stragglers are placed by distance

// A human alternating thumbs tops out around 12–14 steps/s. Anything faster is
// a script or a held key repeating.
export const MIN_STEP_INTERVAL_MS = 45;

// The cadence that yields a full-value stride. Shorter gaps are scaled down in
// proportion (see cadenceFactor), so impulse-per-SECOND saturates: tapping
// twice as fast buys exactly nothing.
const IDEAL_STEP_MS = 110;

const STEP_IMPULSE = 2.15; // m/s added by a clean step at the ideal cadence
const WRONG_FOOT_FACTOR = 0.22; // same foot twice: you stumble
const BROKEN_STRIDE_DECAY = 0.98; // tapping before your foot lands costs you
const FALSE_START_PENALTY_MS = 600;
const MAX_SPEED = 12.4; // ~Bolt's peak, so a perfect run lands near 10s
const DRAG = 1.15; // exponential velocity decay per second

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Rhythm bonus: an even cadence beats a ragged one. Compares this gap with the
 * previous gap, so it rewards holding a tempo rather than simply going faster.
 */
function rhythmFactor(gap, lastGap) {
  if (!lastGap) return 1;
  const drift = Math.abs(gap - lastGap) / Math.max(gap, lastGap);
  return 1.15 - clamp(drift, 0, 1) * 0.35; // 1.15 (metronomic) .. 0.80 (ragged)
}

/**
 * A stride needs time to push off. Half the gap gives half the impulse, so the
 * value delivered per second is flat above the ideal cadence.
 *
 * This is the whole defence against tap-spam, and it has to be the ECONOMICS
 * rather than a rate limit: a bare "ignore steps closer than 45ms" hands a
 * script the maximum legal cadence and it beats every human. (It did — the
 * spammer won the first end-to-end run.)
 */
const cadenceFactor = (gap) => clamp(gap / IDEAL_STEP_MS, 0, 1);

export default {
  id: 'sprint_100m',

  initState(seats, rng, now) {
    const athletes = {};
    for (const { playerId, lane } of seats) {
      athletes[playerId] = {
        lane,
        x: 0, // metres down the track
        v: 0, // m/s
        foot: -1, // last foot used: 0 left, 1 right, -1 none yet
        steps: 0,
        lastStepAt: 0,
        lastGap: 0,
        blockedUntil: 0, // false-start penalty
        falseStart: false,
        done: false,
        time: null, // ms from the gun
      };
    }
    return { startsAt: now + COUNTDOWN_MS, endsAt: now + COUNTDOWN_MS + MAX_RACE_MS, athletes };
  },

  /**
   * One step. `input.f` is the foot (0 left, 1 right).
   *
   * Everything here re-validates: this payload came off a phone and the sender
   * has every reason to lie about it.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.done) return;

    const foot = input && input.f === 1 ? 1 : 0;

    // Off the blocks early: no impulse, and you are held at the line briefly.
    if (now < state.startsAt) {
      a.falseStart = true;
      a.blockedUntil = state.startsAt + FALSE_START_PENALTY_MS;
      return;
    }
    if (now < a.blockedUntil) return;

    const gap = a.lastStepAt ? now - a.lastStepAt : IDEAL_STEP_MS;

    // Tapped before the previous foot landed: the stride breaks, and the clock
    // RESTARTS from this tap. Someone holding the button down therefore never
    // completes a stride at all, instead of riding the threshold as a perfect
    // cadence.
    if (a.lastStepAt && gap < MIN_STEP_INTERVAL_MS) {
      a.lastStepAt = now;
      a.lastGap = 0;
      a.v *= BROKEN_STRIDE_DECAY;
      return;
    }

    const footFactor = foot === a.foot ? WRONG_FOOT_FACTOR : 1;
    const impulse = STEP_IMPULSE * footFactor * cadenceFactor(gap) * rhythmFactor(gap, a.lastGap);

    a.v = Math.min(a.v + impulse, MAX_SPEED);
    a.foot = foot;
    a.steps += 1;
    a.lastGap = gap;
    a.lastStepAt = now;
  },

  step(state, dt, now) {
    if (now < state.startsAt) return;

    for (const a of Object.values(state.athletes)) {
      if (a.done) continue;
      // Exponential decay, not linear: stop tapping and you coast down rather
      // than stopping dead, which is what running actually feels like.
      a.v *= Math.exp(-DRAG * dt);
      a.x += a.v * dt;

      if (a.x >= RACE_DISTANCE) {
        a.x = RACE_DISTANCE;
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
   * Player ids, best first. Finishers by time; anyone still running is ranked
   * by distance behind them. Lane breaks any remaining tie so every client
   * derives the identical order from the identical state.
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

  /**
   * Compact wire form, sent 20×/s to every phone in the room. Positions are
   * quantized to a centimetre and speeds to a decimal — a full-precision float
   * costs bytes nobody can see.
   */
  snapshot(state) {
    const a = {};
    for (const [id, at] of Object.entries(state.athletes)) {
      a[id] = {
        l: at.lane,
        x: Math.round(at.x * 100) / 100,
        v: Math.round(at.v * 10) / 10,
        d: at.done ? 1 : 0,
        t: at.time,
        fs: at.falseStart ? 1 : 0,
      };
    }
    return { s: state.startsAt, e: state.endsAt, a };
  },

  /** Bot seats and stalled-player fill. Alternates with human-ish jitter. */
  botInput(state, botId, difficulty = 0.75, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.done || now < state.startsAt) return null;
    const targetGap = 150 - difficulty * 55; // 150ms (weak) .. 95ms (strong)
    if (a.lastStepAt && now - a.lastStepAt < targetGap) return null;
    return { f: a.foot === 1 ? 0 : 1 };
  },
};
