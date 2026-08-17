// Long Jump.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to draw the run-up and the
// angle dial, so what the player sees is what the server measures.
//
// Three phases per attempt, three attempts each, best jump counts:
//   RUN     tap to build speed down the runway
//   TAKEOFF press and HOLD on or just before the board — past it is a foul
//   ANGLE   release when the dial reads about 45°
//
// Distance is plain projectile range, so 45° really is optimal rather than
// merely asserted. Measurement starts at the BOARD, not at the foot, so taking
// off early costs you exactly the gap you left — which is what makes "just
// before the line" the whole skill.

export const ATTEMPTS = 3;
export const RUNWAY_M = 38; // board sits at this mark
export const COUNTDOWN_MS = 2_500;
export const MAX_ROUND_MS = 50_000;

export const ANGLE_PERIOD_MS = 1_400;
export const MAX_ANGLE_DEG = 90;
export const IDEAL_ANGLE_DEG = 45;

// A run-up tap closer than this is a key repeating, not a stride.
export const MIN_STEP_INTERVAL_MS = 45;
const IDEAL_STEP_MS = 110;

const STEP_IMPULSE = 2.0;
const BROKEN_STRIDE_DECAY = 0.98;
const MAX_SPEED = 10.5; // m/s — a world-class run-up
const DRAG = 1.0;
const G = 13; // tuned, not Earth's: puts a perfect jump at ~8.5m

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function triangle(elapsed, period) {
  const x = ((elapsed % period) + period) % period / period;
  return x < 0.5 ? x * 2 : 2 - x * 2; // 0..1..0
}

/** Where the angle dial reads right now, in degrees. */
export const angleAt = (athlete, now) =>
  triangle(now - athlete.holdAt, ANGLE_PERIOD_MS) * MAX_ANGLE_DEG;

/**
 * Measured distance for one jump.
 *
 * @param {number} speed    m/s at take-off
 * @param {number} angleDeg launch angle
 * @param {number} shortfall metres between the take-off foot and the board
 */
export function jumpDistance(speed, angleDeg, shortfall) {
  const rad = (clamp(angleDeg, 0, MAX_ANGLE_DEG) * Math.PI) / 180;
  const range = (speed * speed * Math.sin(2 * rad)) / G;
  return Math.max(0, range - Math.max(0, shortfall));
}

/** Same economics as the sprint: impulse per SECOND saturates, so spam pays nothing. */
const cadenceFactor = (gap) => clamp(gap / IDEAL_STEP_MS, 0, 1);

function resetAttempt(a, now) {
  a.stage = 'run';
  a.x = 0;
  a.v = 0;
  a.lastStepAt = 0;
  a.holdAt = 0;
  a.takeoffX = 0;
}

function recordJump(a, jump) {
  a.jumps.push(jump);
  if (!jump.foul) a.best = Math.max(a.best, jump.distance);
}

export default {
  id: 'long_jump',

  initState(seats, rng, now) {
    const athletes = {};
    for (const { playerId, lane } of seats) {
      athletes[playerId] = {
        lane,
        stage: 'run', // 'run' -> 'takeoff' (holding) -> back to 'run', or 'done'
        x: 0,
        v: 0,
        lastStepAt: 0,
        holdAt: 0,
        takeoffX: 0,
        jumps: [], // { distance, angle, speed, foul }
        best: 0,
        lastTapAt: 0,
      };
    }
    return { startsAt: now + COUNTDOWN_MS, endsAt: now + COUNTDOWN_MS + MAX_ROUND_MS, athletes };
  },

  /**
   * `input.t` is 'run' (a stride), 'jump' (press and hold at the board) or
   * 'release' with `input.v` = the angle the player saw on the dial.
   *
   * As in archery, the released angle is taken from the CLIENT and then bounded
   * against this server's own reading of the same pure dial — sampling only on
   * the server would charge every player their ping, and trusting the client
   * outright would let a modded one release at exactly 45° every time.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.stage === 'done' || now < state.startsAt) return;
    if (!input) return;

    if (input.t === 'run') {
      if (a.stage !== 'run') return;
      const gap = a.lastStepAt ? now - a.lastStepAt : IDEAL_STEP_MS;
      if (a.lastStepAt && gap < MIN_STEP_INTERVAL_MS) {
        // Tapped before the foot landed: the stride breaks and the clock
        // restarts, so holding the button down never builds any speed.
        a.lastStepAt = now;
        a.v *= BROKEN_STRIDE_DECAY;
        return;
      }
      a.v = Math.min(a.v + STEP_IMPULSE * cadenceFactor(gap), MAX_SPEED);
      a.lastStepAt = now;
      return;
    }

    if (input.t === 'jump') {
      if (a.stage !== 'run') return;
      if (now - a.lastTapAt < 100) return;
      a.lastTapAt = now;

      // Past the board is a foul, decided the instant the button goes down.
      if (a.x > RUNWAY_M) {
        recordJump(a, { distance: 0, angle: 0, speed: a.v, foul: true });
        nextAttempt(a, now);
        return;
      }
      a.stage = 'takeoff';
      a.holdAt = now;
      a.takeoffX = a.x;
      return;
    }

    if (input.t === 'release') {
      if (a.stage !== 'takeoff') return;
      const server = angleAt(a, now);
      const reported = typeof input.v === 'number' && Number.isFinite(input.v) ? input.v : null;
      // 250ms of dial travel is the tolerance: (250/700)*90 ≈ 32°.
      const angle = clamp(
        reported != null && Math.abs(reported - server) <= 32 ? reported : server,
        0,
        MAX_ANGLE_DEG,
      );

      const distance = jumpDistance(a.v, angle, RUNWAY_M - a.takeoffX);
      recordJump(a, {
        distance: Math.round(distance * 100) / 100,
        angle: Math.round(angle),
        speed: Math.round(a.v * 10) / 10,
        foul: false,
      });
      nextAttempt(a, now);
    }
  },

  step(state, dt, now) {
    if (now < state.startsAt) return;

    for (const a of Object.values(state.athletes)) {
      if (a.stage !== 'run') continue;
      a.v *= Math.exp(-DRAG * dt);
      a.x += a.v * dt;

      // Ran through the board without jumping: also a foul, and the attempt is
      // spent. Otherwise a player could simply never commit.
      if (a.x > RUNWAY_M + 1.5) {
        recordJump(a, { distance: 0, angle: 0, speed: a.v, foul: true });
        nextAttempt(a, now);
      }
    }
  },

  isFinished(state, now) {
    if (now >= state.endsAt) return true;
    return Object.values(state.athletes).every((a) => a.stage === 'done');
  },

  /** Player ids, best first: longest jump, then lane so ties are deterministic. */
  placements(state) {
    return Object.entries(state.athletes)
      .sort(([, a], [, b]) => {
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
        x: Math.round(at.x * 100) / 100,
        v: Math.round(at.v * 10) / 10,
        ha: at.holdAt,
        bt: at.best,
        j: at.jumps.map((s) => [s.distance, s.angle, s.foul ? 1 : 0]),
      };
    }
    return { s: state.startsAt, e: state.endsAt, board: RUNWAY_M, a };
  },

  /** Bot seats and stalled-player fill. */
  botInput(state, botId, difficulty = 0.7, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.stage === 'done' || now < state.startsAt) return null;

    if (a.stage === 'takeoff') {
      const dial = angleAt(a, now);
      const target = IDEAL_ANGLE_DEG + (1 - difficulty) * 18;
      return Math.abs(dial - target) < 6 ? { t: 'release', v: dial } : null;
    }
    // Commit near the board, earlier when weaker.
    if (a.x > RUNWAY_M - (0.5 + (1 - difficulty) * 4)) return { t: 'jump' };
    const gap = 150 - difficulty * 50;
    if (a.lastStepAt && now - a.lastStepAt < gap) return null;
    return { t: 'run' };
  },
};

function nextAttempt(a, now) {
  if (a.jumps.length >= ATTEMPTS) {
    a.stage = 'done';
    return;
  }
  resetAttempt(a, now);
}
