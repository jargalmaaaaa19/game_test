// Hammer Throw.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to spin the athlete, point
// the release arrow and draw the flight, so what the player sees is what the
// server measures.
//
// Three stages per attempt, three attempts each, best throw counts:
//   WIND    draw circles on the glass — each completed revolution winds the
//           athlete faster, and she coasts back down the moment you stop
//   RELEASE let go inside the green arc, which is the only heading that sends
//           the hammer down the middle of the sector
//   FLIGHT  the arc, then the crew walking out to the mark, both held on the
//           clock so every phone draws the same throw
//
// WHY A REVOLUTION IS THE INPUT, and not the finger's angular velocity: a
// velocity is a number a phone reports about itself, and the one thing a modded
// client would report is a large one. A completed turn is timed by the SERVER
// between two arrivals, exactly as the sprint times a stride, so the ceiling is
// how fast a thumb can actually move and not how bold the payload is.
//
// THIS EVENT FOULS, and the long jump deliberately does not. That is not an
// inconsistency, it is the difference between a mistake and a wager. Over there
// a mistimed press is punished in metres because the alternative teaches
// nothing; here leaving the circle is the ONLY thing holding the spin back —
// without it "wind as fast as your thumb allows" is strictly dominant, every
// throw is a maximum throw, and the event is a tap-speed contest with a cage
// around it. The foul is the price of the fastest spin, which is what makes
// choosing a speed a decision. It costs the attempt, never the round: there are
// three, and the scoreboard keeps the best.

export const ATTEMPTS = 3;
export const COUNTDOWN_MS = 2_500;
export const MAX_ROUND_MS = 50_000;

// The legal landing sector, and the much narrower heading that actually sends
// the hammer down the middle of it. The green arc is what the player aims at;
// the sector is what forgives them for missing it.
export const SECTOR_HALF_DEG = 34.92; // World Athletics
export const GREEN_HALF_DEG = 15;

// A "revolution" arriving faster than this is a finger that jumped the circle
// or a key repeating — a real thumb does not lap a 120px ring in 80ms. Counted
// as a stumble rather than rejected outright, so a genuinely fast player feels
// a wobble instead of a control that silently ignores them.
export const MIN_TURN_INTERVAL_MS = 90;
const IDEAL_TURN_MS = 250; // a fast, sustainable revolution
// What the FIRST revolution is credited with. Standing start: an athlete is not
// already at speed because her first turn happened to be quick, and without
// this a single flick off a standstill is worth two thirds of a full wind.
const FIRST_TURN_MS = 620;
const STUMBLE_FACTOR = 0.55; // what winding impossibly fast is worth

// Spin, in radians per second of ATHLETE rotation. The finger and the athlete
// are deliberately not 1:1 — four turns of the thumb is a throw, and a thrower
// who mirrored the thumb exactly would be a blur.
export const MAX_SPIN = 26; // ~4.1 turns a second, and the ceiling on power
const SPIN_BLEND = 0.62; // how much of a new cadence replaces the old spin
// She coasts down when the finger stops — gently.
//
// This number is the difference between skill and luck. Power is read at the
// INSTANT of release, and the release has to wait for the arrow to sweep into
// green, so whatever the spin bleeds off during that wait is charged to the
// player for something they did not choose. At 1.35/s a single sweep cost a
// third of the throw and the same wind scored 47m or 68m depending on where
// the arrow happened to be — a slot machine wearing a skill check. At 0.45 the
// wait costs about a tenth, which is a reason to keep winding rather than a
// verdict, while putting the phone down still coasts her to a stop inside the
// attempt clock.
export const SPIN_DECAY = 0.45; // per second

// The floor the coast settles onto: the hammer is swinging around her head
// from the moment she steps in, and it never stops swinging while she holds it.
//
// This is not decoration, it is what keeps the release REACHABLE. The decay
// above converges, so a spin that ends at zero also ends at a FIXED heading —
// and a gentle wind converges in less than one revolution, parking her facing
// out of the sector with no way to ever come back round. Every release from
// there is a foul the player was given no way to avoid. With a floor the arrow
// always sweeps back to green eventually, so a bad wind costs metres, which is
// the long jump's rule and the right one: fouls are for wagers, not for traps.
export const MIN_SPIN = 1.6; // rad/s — about four seconds a revolution

// Turns are the other half of power: a single fast revolution is a flick, and a
// hammer thrower who has not wound up does not throw far however quick it was.
export const TURNS_FOR_FULL_POWER = 3;

// Real gravity and a real launch angle, because unlike the long jump this event
// has a real number everybody knows — the world record is 86.74m, and a game
// that hands it out for a decent throw has nothing left to be impressed by.
// A perfect wind released green lands just under it.
const G = 9.81;
const LAUNCH_DEG = 42;
const MIN_LAUNCH_SPEED = 12; // m/s — never wound at all, ~15m
const MAX_LAUNCH_SPEED = 28.3; // m/s — everything, released green, ~85m

export const GREEN_BONUS = 1.05;
// What a heading outside the green arc costs, per degree off it. At the edge of
// the sector this has taken about a fifth off the throw, which is enough to
// make the arc worth waiting for and small enough that a scrappy release is
// still a throw and not a punishment.
const HEADING_PENALTY_PER_DEG = 0.01;

// Nobody is allowed to stand in the circle winding forever: a player who never
// releases spends the attempt where they stand.
export const MAX_WIND_MS = 12_000;

// The arc, and then the crew walking the tape out to it. Both are drawn rather
// than simulated — the throw was measured the instant it left her hand — and
// both are held on the clock so ten phones show the same hammer at the same
// point in the sky and the same officials arriving at the same moment.
export const FLIGHT_MS = 2_000;
export const MEASURE_MS = 2_400;

// Throw kinds, on the wire and in the record.
export const KIND = {
  PLAIN: 0,
  GREEN: 1,
  OUT_OF_SECTOR: 2, // released facing the wrong way — it landed outside the lines
  LEFT_CIRCLE: 3, // wound so hard the finger left the ring
  NO_THROW: 4, // never let go
};

/** True for the fouls: they are recorded, they are drawn, they score nothing. */
export const isFoul = (kind) => kind >= KIND.OUT_OF_SECTOR;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const RAD = Math.PI / 180;

/** Signed radians into [-PI, PI], so every heading test is one comparison. */
export function wrapAngle(a) {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/**
 * How fast she is turning right now, in rad/s.
 *
 * Closed form, not integrated: the spin decays exponentially from whatever the
 * last completed revolution set it to. A client predicting at 60fps and a
 * server ticking at 20Hz have to agree on this to the radian, and the only way
 * two different timesteps agree is if neither of them is stepping.
 */
export const spinAt = (a, now) =>
  MIN_SPIN
  + Math.max(0, a.spin0 - MIN_SPIN)
    * Math.exp(-SPIN_DECAY * Math.max(0, now - a.spinAt) / 1000);

/**
 * Where she is facing right now, in radians, 0 straight down the sector.
 *
 * The integral of the decay above, for the same reason it is closed form.
 */
export function headingAt(a, now) {
  const dt = Math.max(0, now - a.spinAt) / 1000;
  const wound = Math.max(0, a.spin0 - MIN_SPIN);
  return (
    a.heading0
    + MIN_SPIN * dt
    + (wound * (1 - Math.exp(-SPIN_DECAY * dt))) / SPIN_DECAY
  );
}

/** True while the release arrow is green — the window the player is waiting for. */
export const isGreen = (heading) => Math.abs(wrapAngle(heading)) <= GREEN_HALF_DEG * RAD;

/** True once the heading has swung past the lines painted on the grass. */
export const isOutOfSector = (heading) => Math.abs(wrapAngle(heading)) > SECTOR_HALF_DEG * RAD;

/**
 * Power, 0..1 — the two halves of a throw multiplied, never added.
 *
 * Spin alone is a flick and turns alone is a slow walk in a circle; a thrower
 * needs both, and multiplying is what makes the third revolution at speed worth
 * more than the first two put together.
 */
export const throwPower = (spin, turns) =>
  clamp((spin - MIN_SPIN) / (MAX_SPIN - MIN_SPIN), 0, 1)
  * clamp(turns / TURNS_FOR_FULL_POWER, 0, 1);

/** Plain projectile range off a real 42° launch. */
export function flightRange(speed) {
  return (speed * speed * Math.sin(2 * LAUNCH_DEG * RAD)) / G;
}

/**
 * Measured distance for one throw — what goes on the scoreboard.
 *
 * @param {number} power   0..1, from `throwPower`
 * @param {number} heading radians off the centre line at release
 */
export function throwDistance(power, heading) {
  const speed = MIN_LAUNCH_SPEED + clamp(power, 0, 1) * (MAX_LAUNCH_SPEED - MIN_LAUNCH_SPEED);
  const offDeg = Math.abs(wrapAngle(heading)) / RAD;
  const accuracy = isGreen(heading)
    ? GREEN_BONUS
    : 1 - (offDeg - GREEN_HALF_DEG) * HEADING_PENALTY_PER_DEG;
  return Math.max(0, flightRange(speed) * accuracy);
}

/**
 * Where a throw in progress is right now.
 *
 * Takes the wire form — `[until, distance, heading, kind]`, exactly as
 * `snapshot` sends it — and returns {x, z, y, air, landed, measuring}: metres
 * down the sector, metres across it, metres up, how high through the arc
 * (0..1..0), how far through the settle, and how far the officials have walked.
 *
 * PURE, and shared by every renderer for the same reason the rest of this file
 * is: the 3D arena and a flat fallback drawing the same throw differently is
 * two implementations of one arc, and they drift.
 */
export function flightPoint(throwWire, now) {
  if (!throwWire) return { x: 0, z: 0, y: 0, air: 0, landed: 0, measuring: 0 };
  const [until, distance, heading, kind] = throwWire;

  // `until` ends the whole beat — the arc and then the walk out to the mark.
  const total = FLIGHT_MS + MEASURE_MS;
  const elapsed = clamp(total - (until - now), 0, total);
  const u = clamp(elapsed / FLIGHT_MS, 0, 1);

  // A foul still flies: it is thrown, it lands somewhere, and the player is
  // owed the sight of it going. What it does not get is a measurement.
  const flown = distance * u;
  const apex = (distance * Math.tan(LAUNCH_DEG * RAD)) / 4;

  return {
    x: flown * Math.cos(heading),
    z: flown * Math.sin(heading),
    y: Math.max(0, 4 * apex * u * (1 - u)),
    air: 4 * u * (1 - u),
    landed: u >= 1 ? 1 : 0,
    measuring: isFoul(kind)
      ? 0
      : clamp((elapsed - FLIGHT_MS) / MEASURE_MS, 0, 1),
  };
}

/** Same economics as the sprint: a revolution is worth what its cadence is worth. */
const cadenceSpin = (interval) => clamp((2 * Math.PI * 1000) / interval, 0, MAX_SPIN);

function resetAttempt(a, now) {
  a.stage = 'wind';
  a.spin0 = 0;
  a.spinAt = now;
  a.heading0 = 0;
  a.turns = 0;
  a.lastTurnAt = 0;
  a.windFrom = 0;
  a.throwUntil = 0;
  a.throw = null;
}

function recordThrow(a, mark) {
  a.throws.push(mark);
  if (!isFoul(mark.kind) && mark.distance > a.best) a.best = mark.distance;
}

/**
 * Turn a release into a mark: measure it, file it, and hand the arc to the
 * clock. Shared by the player's own release, by the wind timing out and by a
 * foul, so the three can never measure the same throw differently.
 */
function releaseThrow(a, heading, now, forcedKind = null) {
  const power = throwPower(spinAt(a, now), a.turns);
  const kind =
    forcedKind ??
    (isOutOfSector(heading)
      ? KIND.OUT_OF_SECTOR
      : isGreen(heading)
        ? KIND.GREEN
        : KIND.PLAIN);

  // A foul is thrown but never measured. The distance below is what the arena
  // draws, not what the scoreboard reads — `recordThrow` refuses to bank it.
  const distance = Math.round(throwDistance(power, heading) * 100) / 100;

  recordThrow(a, {
    distance: isFoul(kind) ? 0 : distance,
    heading: Math.round((wrapAngle(heading) / RAD) * 10) / 10,
    spin: Math.round(spinAt(a, now) * 10) / 10,
    turns: Math.round(a.turns * 10) / 10,
    kind,
  });

  a.stage = 'flight';
  a.throwUntil = now + FLIGHT_MS + MEASURE_MS;
  a.throw = { distance, heading: wrapAngle(heading), kind };
}

export default {
  id: 'hammer_throw',

  initState(seats, rng, now) {
    const athletes = {};
    for (const { playerId, lane } of seats) {
      athletes[playerId] = {
        lane,
        stage: 'wind', // 'wind' -> 'flight' -> 'wind', or 'done'
        spin0: 0, // rad/s at the last completed revolution
        // When that revolution landed — seeded to the gun, not to zero, or the
        // idle swing would have been turning since the epoch.
        spinAt: now + COUNTDOWN_MS,
        heading0: 0, // heading at that same moment
        turns: 0, // revolutions this attempt
        lastTurnAt: 0,
        windFrom: 0, // when this attempt's winding started
        throwUntil: 0,
        throw: null,
        throws: [], // { distance, heading, spin, turns, kind }
        best: 0,
      };
    }
    return { startsAt: now + COUNTDOWN_MS, endsAt: now + COUNTDOWN_MS + MAX_ROUND_MS, athletes };
  },

  /**
   * Three payloads, and every one of them arrived off a phone:
   *
   *   { t: 'turn' }             one completed revolution of the finger
   *   { t: 'release', v: deg }  let go, with the heading the player SAW
   *   { t: 'foul' }             the finger left the ring
   *
   * As in the long jump, the released heading is taken from the CLIENT and then
   * bounded against this server's own reading of the same pure spin — sampling
   * only here would charge every player their ping on the one input where a
   * fifth of a second is the whole skill, and trusting the client outright
   * would let a modded one release at exactly 0° every time.
   *
   * The foul is the exception that needs no bound: no client has ever cheated
   * by declaring its own attempt void, so it is taken at its word.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.stage === 'done' || now < state.startsAt) return;
    if (!input) return;

    if (input.t === 'turn') {
      if (a.stage !== 'wind') return;
      if (!a.windFrom) a.windFrom = now;

      const interval = a.lastTurnAt ? now - a.lastTurnAt : FIRST_TURN_MS;
      const target = cadenceSpin(interval);
      // Impossibly fast: the wind breaks and the clock restarts, so hammering
      // the input never builds a spin no thumb could have produced.
      const gain = interval < MIN_TURN_INTERVAL_MS ? STUMBLE_FACTOR : 1;

      a.heading0 = headingAt(a, now);
      a.spin0 = clamp(
        spinAt(a, now) * (1 - SPIN_BLEND) + target * SPIN_BLEND * gain,
        0,
        MAX_SPIN,
      );
      a.spinAt = now;
      a.lastTurnAt = now;
      a.turns += 1;
      return;
    }

    if (input.t === 'foul') {
      if (a.stage !== 'wind') return;
      releaseThrow(a, headingAt(a, now), now, KIND.LEFT_CIRCLE);
      return;
    }

    if (input.t === 'release') {
      if (a.stage !== 'wind') return;
      const server = headingAt(a, now);
      const reported =
        typeof input.v === 'number' && Number.isFinite(input.v) ? input.v * RAD : null;
      // At full spin the athlete crosses the green arc in about 115ms, so the
      // tolerance is one arc's width: close enough to absorb a phone's latency,
      // tight enough that a client cannot simply post 0° and collect.
      const heading =
        reported != null && Math.abs(wrapAngle(reported - server)) <= GREEN_HALF_DEG * RAD
          ? reported
          : server;
      releaseThrow(a, heading, now);
    }
  },

  step(state, dt, now) {
    if (now < state.startsAt) return;

    for (const a of Object.values(state.athletes)) {
      // Stood in the circle winding and never let go: the attempt is spent
      // where she stands, rather than leaving her turning all round.
      if (a.stage === 'wind' && a.windFrom && now - a.windFrom > MAX_WIND_MS) {
        releaseThrow(a, headingAt(a, now), now, KIND.NO_THROW);
        continue;
      }

      if (a.stage === 'flight' && now >= a.throwUntil) nextAttempt(a, now);
    }
  },

  isFinished(state, now) {
    if (now >= state.endsAt) return true;
    return Object.values(state.athletes).every((a) => a.stage === 'done');
  },

  /** Player ids, best first: longest throw, then lane so ties are deterministic. */
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
        // The spin, as the two numbers `spinAt`/`headingAt` need to rebuild it
        // on any client at any frame rate.
        s0: Math.round(at.spin0 * 100) / 100,
        sa: at.spinAt,
        h0: Math.round(at.heading0 * 1000) / 1000,
        tn: at.turns,
        bt: at.best,
        // The throw, while one is in the air: when the whole beat ends, how far
        // it goes, which way, and what kind of mark it is.
        f: at.stage === 'flight' && at.throw
          ? [at.throwUntil, at.throw.distance, Math.round(at.throw.heading * 1000) / 1000, at.throw.kind]
          : null,
        j: at.throws.map((s) => [s.distance, s.heading, s.kind]),
      };
    }
    return { s: state.startsAt, e: state.endsAt, a };
  },

  /** Bot seats and stalled-player fill. */
  botInput(state, botId, difficulty = 0.7, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.stage !== 'wind' || now < state.startsAt) return null;

    // Wind up first, at a cadence its difficulty can sustain.
    const interval = IDEAL_TURN_MS + (1 - difficulty) * 260;
    if (a.turns < TURNS_FOR_FULL_POWER || !a.lastTurnAt) {
      if (!a.lastTurnAt || now - a.lastTurnAt >= interval) return { t: 'turn' };
      return null;
    }

    // Wound up: let go on the green arc, aiming earlier the weaker it is, so a
    // soft bot releases wide rather than releasing perfectly a bit slower.
    const heading = wrapAngle(headingAt(a, now));
    const window = GREEN_HALF_DEG * RAD * (0.35 + difficulty * 0.6);
    if (Math.abs(heading) <= window) return { t: 'release', v: heading / RAD };
    if (now - a.lastTurnAt >= interval) return { t: 'turn' };
    return null;
  },
};

function nextAttempt(a, now) {
  if (a.throws.length >= ATTEMPTS) {
    a.stage = 'done';
    a.throw = null;
    a.throwUntil = 0;
    return;
  }
  resetAttempt(a, now);
}
