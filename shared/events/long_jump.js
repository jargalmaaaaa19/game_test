// Long Jump.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to draw the run-up, the
// angle dial and the flight, so what the player sees is what the server
// measures.
//
// Four stages per attempt, three attempts each, best jump counts:
//   RUN     alternate left/right thumbs down the runway, exactly as the sprint
//   TAKEOFF press and HOLD to plant the foot — where you plant it is the skill
//   ANGLE   the dial sweeps 0°..90°; release it at about 45°
//   FLIGHT  the arc, held on the clock so every client draws the same jump
//
// Distance is plain projectile range, so 45° really is optimal rather than
// merely asserted. Measurement starts at the BOARD, not at the foot, so taking
// off early costs exactly the gap you left behind — which is what makes "right
// on the line" the whole point.
//
// THERE ARE NO FOULS. Stepping over the board is a mistake you pay for in
// metres, not an attempt struck off: an arcade event that answers a mistimed
// press with a zero and a shrug spends a third of the player's game teaching
// nothing. Past the board the overshoot is docked at OVERSTEP_FACTOR, which is
// steep enough that reaching for the line never beats hitting it.

export const ATTEMPTS = 3;
export const RUNWAY_M = 38; // board sits at this mark
export const RUNOUT_M = 4; // sand past it; run this far and the attempt is spent
export const COUNTDOWN_MS = 2_500;
export const MAX_ROUND_MS = 50_000;

export const ANGLE_PERIOD_MS = 1_400; // 700ms up, 700ms back down
export const MAX_ANGLE_DEG = 90;
export const IDEAL_ANGLE_DEG = 45;
// A dial held forever would park an athlete on the board for the rest of the
// round. Three sweeps is long enough to pick an angle and short enough that a
// player who put the phone down still gets a jump on the board.
export const MAX_HOLD_MS = ANGLE_PERIOD_MS * 3;

// The window BEFORE the board that counts as perfect — on the line, or a
// boot's length short of it.
export const PERFECT_M = 0.4;
export const PERFECT_BONUS = 1.06; // what nailing it is worth
export const OVERSTEP_FACTOR = 2.4; // metres docked per metre past the board

// The arc plus a beat in the sand, held so the camera has something to watch
// and every phone in the room draws the same jump at the same moment.
export const FLIGHT_MS = 1_600;
export const ARC_FRACTION = 0.62; // of FLIGHT_MS spent in the air

// Jump kinds, on the wire and in the record.
export const KIND = { PLAIN: 0, PERFECT: 1, OVERSTEP: 2, NO_JUMP: 3 };

// A run-up tap closer than this is a key repeating, not a stride.
export const MIN_STEP_INTERVAL_MS = 45;
const IDEAL_STEP_MS = 110;

const STEP_IMPULSE = 2.0;
const WRONG_FOOT_FACTOR = 0.22; // same thumb twice: you stumble, as in the sprint
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
 * Metres between the take-off foot and the board. Positive is short of it,
 * negative is over it — one signed number, so every rule below reads as a
 * single comparison instead of a pair of branches.
 */
export const boardGap = (takeoffX) => RUNWAY_M - takeoffX;

/** True for a take-off on the line, or a boot's length before it. */
export const isPerfect = (gap) => gap >= 0 && gap <= PERFECT_M;

/**
 * What the gap costs, in metres off the tape. Short of the board you lose the
 * runway you left unused, which is simply where the measurement starts. Past
 * it you lose considerably more than the overshoot gained you, or stepping
 * over would be the optimal play and the board would stop meaning anything.
 */
export const gapPenalty = (gap) => (gap >= 0 ? gap : -gap * OVERSTEP_FACTOR);

/** How far the athlete physically travels through the air. */
export function flightRange(speed, angleDeg) {
  const rad = (clamp(angleDeg, 0, MAX_ANGLE_DEG) * Math.PI) / 180;
  return (speed * speed * Math.sin(2 * rad)) / G;
}

/**
 * Measured distance for one jump — what goes on the scoreboard.
 *
 * @param {number} speed    m/s at take-off
 * @param {number} angleDeg launch angle
 * @param {number} gap      metres from the take-off foot to the board, signed
 */
export function jumpDistance(speed, angleDeg, gap) {
  const range = flightRange(speed, angleDeg) * (isPerfect(gap) ? PERFECT_BONUS : 1);
  return Math.max(0, range - gapPenalty(gap));
}

/**
 * Where a jump in progress is right now.
 *
 * Takes the wire form of the flight — `[until, fromX, range, distance, angle,
 * kind]`, exactly as `snapshot` sends it — and returns {x, y, air, landed}:
 * metres down the runway, metres off the ground, how high through the arc
 * (0..1..0), and how far through the settle in the sand.
 *
 * PURE, and shared by every renderer for the same reason the rest of this file
 * is: the 3D arena and the flat fallback drawing the same jump differently is
 * two implementations of one arc, and they drift.
 */
export function flightPoint(flight, now) {
  if (!flight) return { x: 0, y: 0, air: 0, landed: 0 };
  const [until, fromX, range, , angleDeg] = flight;
  const p = clamp((FLIGHT_MS - (until - now)) / FLIGHT_MS, 0, 1);
  const u = clamp(p / ARC_FRACTION, 0, 1);

  // Apex of a projectile whose range and launch angle are known: R·tanθ/4.
  // Capped, because the dial reaches 90° and a jump straight up would put the
  // athlete through the roof of the stadium.
  const apex = Math.max(0.25, Math.min(range * 0.55 + 0.4, (range * Math.tan((angleDeg * Math.PI) / 180)) / 4));

  return {
    x: fromX + range * u,
    y: Math.max(0, 4 * apex * u * (1 - u)),
    air: 4 * u * (1 - u),
    landed: u >= 1 ? clamp((p - ARC_FRACTION) / (1 - ARC_FRACTION), 0, 1) : 0,
  };
}

/** Same economics as the sprint: impulse per SECOND saturates, so spam pays nothing. */
const cadenceFactor = (gap) => clamp(gap / IDEAL_STEP_MS, 0, 1);

function resetAttempt(a) {
  a.stage = 'run';
  a.x = 0;
  a.v = 0;
  a.foot = -1;
  a.lastStepAt = 0;
  a.holdAt = 0;
  a.takeoffX = 0;
  a.flightUntil = 0;
  a.flight = null;
}

function recordJump(a, jump) {
  a.jumps.push(jump);
  if (jump.distance > a.best) a.best = jump.distance;
}

/**
 * Turn a held take-off into a jump: measure it, file it, and hand the arc to
 * the clock. Shared by the player's own release and by the hold timing out, so
 * the two can never measure the same jump differently.
 */
function releaseJump(a, angle, now) {
  const gap = boardGap(a.takeoffX);
  const perfect = isPerfect(gap);
  const range = flightRange(a.v, angle) * (perfect ? PERFECT_BONUS : 1);
  const distance = Math.max(0, range - gapPenalty(gap));
  const kind = perfect ? KIND.PERFECT : gap < 0 ? KIND.OVERSTEP : KIND.PLAIN;

  recordJump(a, {
    distance: Math.round(distance * 100) / 100,
    angle: Math.round(angle),
    speed: Math.round(a.v * 10) / 10,
    kind,
  });

  // The flight is drawn, not simulated: it is a formula, and the athlete has
  // already been measured. What the clock buys is a window in which every
  // client draws the SAME arc — without it the sim snaps the jumper back to the
  // top of the runway on the tick they let go, and nobody ever sees the jump.
  a.stage = 'flight';
  a.flightUntil = now + FLIGHT_MS;
  a.flight = {
    fromX: Math.round(a.takeoffX * 100) / 100,
    range: Math.round(range * 100) / 100,
    distance: Math.round(distance * 100) / 100,
    angle: Math.round(angle),
    kind,
  };
}

export default {
  id: 'long_jump',

  initState(seats, rng, now) {
    const athletes = {};
    for (const { playerId, lane } of seats) {
      athletes[playerId] = {
        lane,
        stage: 'run', // 'run' -> 'takeoff' -> 'flight' -> 'run', or 'done'
        x: 0,
        v: 0,
        foot: -1, // last thumb used: 0 left, 1 right, -1 none yet
        lastStepAt: 0,
        holdAt: 0,
        takeoffX: 0,
        flightUntil: 0,
        flight: null,
        jumps: [], // { distance, angle, speed, kind }
        best: 0,
        lastTapAt: 0,
      };
    }
    return { startsAt: now + COUNTDOWN_MS, endsAt: now + COUNTDOWN_MS + MAX_ROUND_MS, athletes };
  },

  /**
   * Three payloads, and every one of them arrived off a phone:
   *
   *   { f: 0 | 1 }              one stride, left thumb or right
   *   { t: 'jump' }             plant the foot and start the dial
   *   { t: 'release', v: deg }  let go, with the angle the player SAW
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

    // A stride. `{ t: 'run' }` is still accepted as a footless step, so a
    // keyboard with nothing but a spacebar can still run the athlete in.
    if (input.f === 0 || input.f === 1 || input.t === 'run') {
      if (a.stage !== 'run') return;
      const foot = input.f === 1 ? 1 : input.f === 0 ? 0 : a.foot === 1 ? 0 : 1;
      const gap = a.lastStepAt ? now - a.lastStepAt : IDEAL_STEP_MS;

      if (a.lastStepAt && gap < MIN_STEP_INTERVAL_MS) {
        // Tapped before the foot landed: the stride breaks and the clock
        // restarts, so holding a button down never builds any speed.
        a.lastStepAt = now;
        a.v *= BROKEN_STRIDE_DECAY;
        return;
      }

      const footFactor = foot === a.foot ? WRONG_FOOT_FACTOR : 1;
      a.v = Math.min(a.v + STEP_IMPULSE * footFactor * cadenceFactor(gap), MAX_SPEED);
      a.foot = foot;
      a.lastStepAt = now;
      return;
    }

    if (input.t === 'jump') {
      if (a.stage !== 'run') return;
      if (now - a.lastTapAt < 100) return;
      a.lastTapAt = now;
      // Wherever the foot lands, it counts — over the board included. The
      // arithmetic in `gapPenalty` is the only thing that judges it.
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
      releaseJump(a, angle, now);
    }
  },

  step(state, dt, now) {
    if (now < state.startsAt) return;

    for (const a of Object.values(state.athletes)) {
      if (a.stage === 'run') {
        a.v *= Math.exp(-DRAG * dt);
        a.x += a.v * dt;

        // Ran into the sand without ever committing. Not a foul — nothing was
        // stepped over — but the attempt is spent, or a player could simply
        // never jump and never be measured.
        if (a.x > RUNWAY_M + RUNOUT_M) {
          recordJump(a, {
            distance: 0,
            angle: 0,
            speed: Math.round(a.v * 10) / 10,
            kind: KIND.NO_JUMP,
          });
          nextAttempt(a);
        }
        continue;
      }

      // Held past three sweeps of the dial: take the jump at whatever it reads,
      // rather than leaving the athlete standing on the board all round.
      if (a.stage === 'takeoff' && now - a.holdAt > MAX_HOLD_MS) {
        releaseJump(a, angleAt(a, now), now);
        continue;
      }

      if (a.stage === 'flight' && now >= a.flightUntil) nextAttempt(a);
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
        // The arc, while one is being drawn: when it ends, where it left the
        // ground, how far it really flies, what the tape says, and its shape.
        f: at.stage === 'flight' && at.flight
          ? [
            at.flightUntil,
            at.flight.fromX,
            at.flight.range,
            at.flight.distance,
            at.flight.angle,
            at.flight.kind,
          ]
          : null,
        j: at.jumps.map((s) => [s.distance, s.angle, s.kind]),
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
    if (a.stage !== 'run') return null;

    // Commit near the board, sloppier when weaker.
    if (a.x > RUNWAY_M - (0.2 + (1 - difficulty) * 4)) return { t: 'jump' };
    const gap = 150 - difficulty * 50;
    if (a.lastStepAt && now - a.lastStepAt < gap) return null;
    return { f: a.foot === 1 ? 0 : 1 };
  },
};

function nextAttempt(a) {
  if (a.jumps.length >= ATTEMPTS) {
    a.stage = 'done';
    a.flight = null;
    a.flightUntil = 0;
    return;
  }
  resetAttempt(a);
}
