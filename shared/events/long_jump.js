// Long Jump.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to draw the run-up, the
// timing gauge and the flight, so what the player sees is what the server
// measures.
//
// ONE decision per attempt, three attempts each, best jump counts:
//   RUN     alternate left/right thumbs down the runway, exactly as the sprint
//   JUMP    hit the button as the white line arrives
//   FLIGHT  the arc, held on the clock so every client draws the same jump
//
// There is no angle to pick. Every jump leaves the board at 45° — the optimal
// launch — so the whole event is WHERE you were standing when you pressed:
//
//   GREEN  the last half-metre into the line: the full speed you built
//   ORANGE the approach: three quarters of it, which costs about half the jump
//   RED    over the line: the attempt is gone
//
// Distance is plain projectile range off that fixed angle, so a jump is worth
// exactly the speed that went into it and nothing else. No gap arithmetic: the
// zone you pressed in IS the score, which is what makes a gauge a fair way to
// show it.

import { botJitter, botSlips } from '../bots.js';

export const ATTEMPTS = 3;
export const RUNWAY_M = 38; // the white line sits at this mark
export const RUNOUT_M = 3; // sand past it; run this far and the attempt is gone
export const COUNTDOWN_MS = 2_500;
export const MAX_ROUND_MS = 50_000;

/** Fixed, and not a choice: 45° is the optimal launch and every jump gets it. */
export const JUMP_ANGLE_DEG = 45;

// The timing gauge, in metres before the line. The button wakes at GAUGE_M and
// the green band is the last stride into the line.
//
// GREEN IS SIZED IN MILLISECONDS, not metres. At the 10.5 m/s ceiling this band
// is about 145ms of running, and at a club run-up nearer 165ms: a server tick,
// a phone's worth of latency, and enough left over that the press a player MEANT
// to make is the press that gets scored. Half a metre looked tidier and was
// unhittable — under one tick, so green came down to which frame the press
// happened to land in. 1.1m was hittable, but it still asked for a reaction
// inside a tenth of a second, which reads as a coin toss to anyone who is not
// already good at this.
//
// Widening it does not make the event safer, only fairer. The board has not
// moved, so being late costs the same foul it always did.
export const GAUGE_M = 4.5;
export const PERFECT_M = 1.5;
// A gauge needs somewhere to show red, so the line is not a wall: cross it and
// you have RUNOUT_M to press (and fail) or run into the sand (and fail).
export const GOOD_FACTOR = 0.75; // orange takes three quarters of your speed

// The arc plus a beat in the sand, held so the camera has something to watch
// and every phone in the room draws the same jump at the same moment. A foul
// gets the same window — the athlete has to be seen blowing it.
export const FLIGHT_MS = 1_600;
export const ARC_FRACTION = 0.62; // of FLIGHT_MS spent in the air

/** How an attempt ended. Also the wire value, and the colour of the gauge. */
export const KIND = { PERFECT: 0, GOOD: 1, FOUL: 2 };

// What the bot skill dial is worth at the weak end: how far a stride wanders,
// how often the same thumb goes down twice, and how often a bot leaves the
// take-off too late and runs through the board. All three scale to nothing at
// difficulty 1. See `shared/bots.js`.
const BOT_WOBBLE_MS = 26;
const BOT_STUMBLE_CHANCE = 0.08;
const BOT_FOUL_CHANCE = 0.3;

// How far ahead of this server's own idea of the athlete a take-off may be
// claimed, in metres.
//
// The client runs the athlete in itself so the strides feel instant, which puts
// its picture a one-way trip ahead of ours — a metre and a half at racing pace
// on a slow phone, and the green band is only 1.5m wide. Judging the press
// where WE think the athlete is therefore scores a jump the player never made:
// they press on green, we call it orange, and if we are still short of the
// gauge we ignore the press altogether and let them run through the board. Two
// fouls out of three attempts, from the far side of a bad connection.
//
// So the press carries the mark it was made at, clamped to somewhere the
// athlete could actually have got to since our last word. Never BEHIND us — a
// claim that rewinds is a claim that steps back out of a foul — and never past
// the end of the runout.
//
// It gives a cheat nothing worth having: the gauge is deterministic and drawn
// from state the client already holds, so a modified client can hit green every
// time by pressing at the right moment. The claim only lets an honest laggy one
// be judged where it was standing.
export const CLAIM_REACH_M = 3;

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

const BAND_EPS = 1e-6; // see `zoneAt`

/**
 * Which band of the gauge the athlete is standing in.
 *
 * 'early' is before the gauge wakes up, and is the one state that is not a
 * jump: the button does not exist yet on the client, and a press that arrives
 * anyway is ignored rather than scored. Without that, a modded client could
 * press from the top of the runway and collect the orange jump for free — the
 * score no longer subtracts the gap, so distance-to-the-line has to be gated
 * somewhere, and it is gated here.
 */
export function zoneAt(x) {
  const gap = RUNWAY_M - x;
  if (gap < 0) return 'foul';
  // The edges are inclusive to within a rounding error, and deliberately so:
  // `38 - 1.1` does not give back exactly 1.1, so an athlete standing exactly
  // on the edge of green tested as orange. A band a player can see themselves
  // entering must not turn on a float's last bit.
  if (gap <= PERFECT_M + BAND_EPS) return 'perfect';
  if (gap <= GAUGE_M + BAND_EPS) return 'good';
  return 'early';
}

const KIND_OF = { perfect: KIND.PERFECT, good: KIND.GOOD, foul: KIND.FOUL };

/**
 * How far a jump travels. Range off a fixed 45° is simply v²/G, and orange
 * spends three quarters of the speed — which, because range goes as the SQUARE
 * of it, lands at a little over half the distance. That gap is the whole
 * reward for hitting green.
 */
export function jumpDistance(speed, kind) {
  if (kind === KIND.FOUL) return 0;
  const v = Math.max(0, kind === KIND.GOOD ? speed * GOOD_FACTOR : speed);
  return (v * v) / G;
}

/**
 * Where a jump in progress is right now.
 *
 * Takes the wire form of the flight — `[until, fromX, range, distance, kind]`,
 * exactly as `snapshot` sends it — and returns {x, y, air, landed}: metres down
 * the runway, metres off the ground, how high through the arc (0..1..0), and
 * how far through the settle in the sand.
 *
 * PURE, and shared by every renderer for the same reason the rest of this file
 * is: the 3D arena and the flat fallback drawing the same jump differently is
 * two implementations of one arc, and they drift. A foul has a range of zero,
 * so this holds the athlete where they blew it — which is exactly what should
 * be on screen.
 */
export function flightPoint(flight, now) {
  if (!flight) return { x: 0, y: 0, air: 0, landed: 0 };
  const [until, fromX, range] = flight;
  const p = clamp((FLIGHT_MS - (until - now)) / FLIGHT_MS, 0, 1);
  const u = clamp(p / ARC_FRACTION, 0, 1);

  // Apex of a projectile whose range is known and whose launch is 45°:
  // R·tan(45°)/4, which is simply a quarter of the range.
  const apex = range / 4;

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
  a.flightUntil = 0;
  a.flight = null;
}

/**
 * Resolve an attempt: measure it, file it, and hand the arc to the clock.
 * Shared by the player's own press and by running out of runway, so the two can
 * never disagree about what a jump was worth.
 */
function resolveJump(a, kind, now) {
  const distance = Math.round(jumpDistance(a.v, kind) * 100) / 100;
  a.jumps.push({ distance, kind, speed: Math.round(a.v * 10) / 10 });
  if (distance > a.best) a.best = distance;

  // The flight is drawn, not simulated: it is a formula, and the athlete has
  // already been measured. What the clock buys is a window in which every
  // client draws the SAME arc — without it the sim snaps the jumper back to the
  // top of the runway on the tick they press, and nobody ever sees the jump.
  a.stage = 'flight';
  a.flightUntil = now + FLIGHT_MS;
  a.flight = { fromX: Math.round(a.x * 100) / 100, range: distance, distance, kind };
}

export default {
  id: 'long_jump',

  initState(seats, rng, now) {
    const athletes = {};
    for (const { playerId, lane } of seats) {
      athletes[playerId] = {
        lane,
        stage: 'run', // 'run' -> 'flight' -> 'run', or 'done'
        x: 0,
        v: 0,
        foot: -1, // last thumb used: 0 left, 1 right, -1 none yet
        lastStepAt: 0,
        flightUntil: 0,
        flight: null,
        jumps: [], // { distance, kind, speed }
        best: 0,
        lastTapAt: 0,
      };
    }
    return { startsAt: now + COUNTDOWN_MS, endsAt: now + COUNTDOWN_MS + MAX_ROUND_MS, athletes };
  },

  /**
   * Two payloads, and both arrived off a phone:
   *
   *   { f: 0 | 1 }   one stride, left thumb or right
   *   { t: 'jump' }  the button, wherever the athlete happens to be standing
   *
   * Nothing here trusts the sender for anything but the fact of the press. The
   * zone is read from the server's own x, so a client cannot claim it was on
   * the line when it was not — which is the whole reason the angle the old
   * version took from the client had to be bounds-checked, and the reason this
   * version has nothing to bounds-check at all.
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

      // The mark the player pressed at, as they saw it — see CLAIM_REACH_M.
      const claimed = Number.isFinite(input.x) ? input.x : a.x;
      const at = clamp(claimed, a.x, Math.min(a.x + CLAIM_REACH_M, RUNWAY_M + RUNOUT_M));

      const zone = zoneAt(at);
      if (zone === 'early') return; // the button is not live yet
      // Take off from there, so the arc starts where the athlete was drawn
      // rather than snapping back to where this server had got to.
      a.x = at;
      resolveJump(a, KIND_OF[zone], now);
    }
  },

  step(state, dt, now) {
    if (now < state.startsAt) return;

    for (const a of Object.values(state.athletes)) {
      if (a.stage === 'run') {
        a.v *= Math.exp(-DRAG * dt);
        a.x += a.v * dt;

        // Over the line and still running. The attempt is gone either way; this
        // is just the version where they never pressed at all.
        if (a.x > RUNWAY_M + RUNOUT_M) resolveJump(a, KIND.FOUL, now);
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
        bt: at.best,
        // The arc, while one is being drawn: when it ends, where it left the
        // ground, how far it flies, what the tape says, and how it ended.
        f: at.stage === 'flight' && at.flight
          ? [at.flightUntil, at.flight.fromX, at.flight.range, at.flight.distance, at.flight.kind]
          : null,
        j: at.jumps.map((s) => [s.distance, s.kind]),
      };
    }
    return { s: state.startsAt, e: state.endsAt, board: RUNWAY_M, a };
  },

  /** Bot seats and stalled-player fill. */
  botInput(state, botId, difficulty = 0.7, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.stage !== 'run' || now < state.startsAt) return null;
    const shaky = clamp(1 - difficulty, 0, 1);
    const attempt = a.jumps.length; // this bot's luck is per ATTEMPT, not per tick

    // Every so often it leaves the take-off too late and runs through the
    // board. Three attempts each and no bot ever fouled, which is the tell
    // that they were not really playing the event — the board is the whole
    // risk in it, and only the humans were carrying any.
    const blown = botSlips(botId, attempt, BOT_FOUL_CHANCE * shaky ** 1.2, 1);

    if (!blown) {
      // Where it means to take off. A strong bot waits for green; a weak one
      // stabs early and collects the orange jump, which is exactly how a weak
      // human plays it — and its aim wanders by attempt, so the same bot does
      // not put three identical jumps in the book.
      //
      // Aimed three quarters of the way into green rather than at its middle,
      // because a bot only gets to look once a tick: at 20 Hz and 10.5 m/s it
      // covers half a metre between looks, and an aim point any deeper is one
      // it can step straight over and out the far side into a foul.
      const press = clamp(
        PERFECT_M * 0.75 + (GAUGE_M - PERFECT_M) * shaky ** 1.5
          + botJitter(botId, attempt, PERFECT_M * shaky, 2),
        0.25,
        GAUGE_M - 0.1,
      );
      if (RUNWAY_M - a.x <= press) return { t: 'jump' };
    }

    const gap = 150 - difficulty * 50 + botJitter(botId, a.steps, BOT_WOBBLE_MS * shaky, 3);
    if (a.lastStepAt && now - a.lastStepAt < gap) return null;

    const stumble = botSlips(botId, a.steps, BOT_STUMBLE_CHANCE * shaky ** 1.2, 4);
    return { f: stumble ? a.foot : (a.foot === 1 ? 0 : 1) };
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
