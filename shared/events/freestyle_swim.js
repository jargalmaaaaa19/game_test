// 50m Freestyle.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to draw the cues sliding
// toward the hit line, so the beat the player sees is the beat the server
// judges.
//
// Cues flow across a hit zone, each calling for a LEFT or RIGHT stroke, and the
// side is drawn fresh from the match seed every cue — no turn-taking, so it
// cannot be drummed out from memory. Strike one while it is over the zone and
// you pull; catch the wrong side, or let it flow past unstruck, and you stall.
//
// VOLUME is what decides the heat. Every landed stroke is worth about the same
// (a crisp one a little more), so the swimmer who lands the most of them wins —
// the race is how many of a dense stream of cues you can keep up with, not how
// exactly you time any single one of them.
//
// The whole pattern goes out on the wire and the lane shows it coming, so a
// player can read the next few strokes and have the right thumb ready. What
// that buys is preparation, not free speed: a press with no cue over the zone
// is a splash that costs speed and consumes nothing (see `applyInput`), which
// is what stops a known pattern collapsing into hammering both buttons.

export const DISTANCE_M = 50;
export const COUNTDOWN_MS = 2_500;
export const LEAD_IN_MS = 1_500; // gun to first cue, so nobody starts mid-beat
// Cues come thick and fast: closer together on the lane and quicker across it
// than a stroke rhythm needs, because the event is now decided by how many you
// land rather than by how precisely you land any one of them.
export const BEAT_MS = 380;
export const TOTAL_BEATS = 130; // enough to still be arriving for a slow swim
// Sits inside the phase backstop (durationMs 45s + 5s overtime), and is set so
// that a swimmer landing every OTHER cue still touches the wall — last, and
// twenty seconds down, but in the water rather than stranded mid-pool when the
// clock kills the heat.
export const MAX_RACE_MS = 46_000;

/**
 * How far either side of the beat a cue can be struck.
 *
 * SYMMETRIC, where this used to only open once the cue had landed. The cue now
 * flows across the hit zone rather than stopping on it, so the honest question
 * is "was the arrow over the block when you pressed", and that has an early
 * side as well as a late one.
 */
export const HIT_WINDOW_MS = 170;

// Tiers, for the flash the client shows. They name how close to the middle of
// the zone the press was; they are not what the impulse is paid on.
export const TIER = { perfect: 60, good: 115 };

// Impulse runs smoothly from SLOW (answered as the window closes) to FAST
// (answered instantly), so there is something to gain from every millisecond
// rather than three steps to land on.
//
// Steady-state speed is impulse × (1/BEAT) ÷ DRAG, so these read as ~2.4 and
// ~1.4 m/s. The floor matters: a swimmer who answers every cue late but
// correctly must still cover the 50m inside MAX_RACE_MS. Being slow is a worse
// race, not a race that never ends.
const IMPULSE_FAST = 0.68;
const IMPULSE_SLOW = 0.55;

// Water resistance. A stroke on the wrong side costs most — you have caught
// the water backwards.
//
// `miss` is per CUE, and the cues now come 63% more often than they did, so
// the old 0.82 was quietly charging half as much again over a race: a swimmer
// answering every other cue was dragged down to under a metre a second and
// could not finish at all. Falling behind should cost you the race, not strand
// you in the water.
const PENALTY = { miss: 0.93, wrong: 0.75, splash: 0.9 };

const DRAG = 0.65;
const MAX_SPEED = 2.8; // m/s — a shade over world-record pace

// These take PRIMITIVES, not a state object, on purpose. The sim's state calls
// the field `startsAt` while the wire snapshot calls it `s`, so a helper that
// reached into "state" silently produced NaN on the client — the cue lane
// rendered nothing and every stroke was judged as a splash. Passing the number
// makes the mismatch impossible.

/** When cue `i` should be struck, on the server clock. */
export const beatTime = (startsAt, i) => startsAt + LEAD_IN_MS + i * BEAT_MS;

/** 0 = left, 1 = right. */
export const sideOf = (sides, i) => sides?.[i] ?? i % 2;

/** How long after cue `i` landed a press at `now` came. Negative = too early. */
export const reactionTo = (startsAt, i, now) => now - beatTime(startsAt, i);

/**
 * The tier a press at `now` earns against cue `i`; null if it does not count.
 *
 * Graded on the DISTANCE from the beat, either side of it: the cue rides
 * across the hit zone rather than parking on it, so it is over the block for a
 * moment before the beat as well as after.
 */
export function judge(startsAt, i, now) {
  const r = Math.abs(reactionTo(startsAt, i, now));
  if (r > HIT_WINDOW_MS) return null;
  if (r <= TIER.perfect) return 'perfect';
  if (r <= TIER.good) return 'good';
  return 'ok';
}

/**
 * Charge every cue whose window has already closed.
 *
 * Called from BOTH `step` and `applyInput`. Doing it only on the tick left a
 * press up to one tick (50ms) after a beat expired being judged against that
 * dead beat — the player was told "early" for a stroke that was actually on
 * time for the NEXT cue. Expiring first makes the judgement independent of
 * where the press happens to fall between ticks.
 */
function expireStaleBeats(state, a, now) {
  while (a.beat < TOTAL_BEATS && beatTime(state.startsAt, a.beat) + HIT_WINDOW_MS < now) {
    a.v *= PENALTY.miss;
    a.hits.miss += 1;
    a.combo = 0;
    a.last = 'miss';
    a.lastAt = now;
    a.beat += 1;
  }
}

export default {
  id: 'freestyle_swim',

  initState(seats, rng, now) {
    // Mixed, not taking turns. Each cue's side is drawn independently, so the
    // pattern cannot be learned and every cue has to be READ — which is the
    // whole point of scoring reactions.
    //
    // The one constraint is a cap of three of a side in a row. Unconstrained
    // coin flips throw runs of six often enough that players read them as the
    // event being broken rather than as luck.
    const sides = [];
    let previous = -1;
    let run = 0;
    for (let i = 0; i < TOTAL_BEATS; i += 1) {
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
        beat: 0, // the next unresolved cue
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
   * Only the NEXT unresolved cue can be struck, and it can be struck once. That
   * is what stops a player from simply hammering both buttons: a press with no
   * cue in range is a splash, and splashing costs speed. Rate-limiting the
   * button instead would just hand a script the maximum legal stroke rate — the
   * sprint already taught that lesson the hard way.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.done || now < state.startsAt) return;
    if (!input || (input.s !== 0 && input.s !== 1)) return;

    expireStaleBeats(state, a, now);
    if (a.beat >= TOTAL_BEATS) return;

    const grade = judge(state.startsAt, a.beat, now);
    if (!grade) {
      // The cue has not landed yet: a guess, not a reaction. No cue is
      // consumed, so guessing cannot be used to skip ahead either — it just
      // costs speed, which is what stops both buttons being hammered.
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
      // THE point of the event: a smooth ramp on reaction time, so the swimmer
      // who answers first pulls hardest. Everyone who answers correctly moves;
      // how much is a race between thumbs.
      const r = Math.abs(reactionTo(state.startsAt, a.beat, now));
      const promptness = 1 - Math.min(r, HIT_WINDOW_MS) / HIT_WINDOW_MS;
      a.v = Math.min(a.v + IMPULSE_SLOW + (IMPULSE_FAST - IMPULSE_SLOW) * promptness, MAX_SPEED);
      a.hits[grade] += 1;
      a.combo += 1;
      a.bestCombo = Math.max(a.bestCombo, a.combo);
      a.last = grade;
    }
    a.lastAt = now;
    a.beat += 1;
  },

  step(state, dt, now) {
    if (now < state.startsAt) return;

    for (const a of Object.values(state.athletes)) {
      if (a.done) continue;

      // Any cue whose window has closed unstruck is a miss, so a player who
      // simply stops is slowed by the water rather than coasting.
      expireStaleBeats(state, a, now);

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
    // `sides` is the whole pattern; it is ~90 small integers and it never
    // changes, so sending it every tick still costs less than the plumbing to
    // send it once and recover it after a reconnect.
    return { s: state.startsAt, e: state.endsAt, sides: state.sides, a };
  },

  /** Bot seats and stalled-player fill: strokes on the beat, imperfectly. */
  botInput(state, botId, difficulty = 0.75, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.done || now < state.startsAt || a.beat >= TOTAL_BEATS) return null;
    // A bot has a reaction time like everyone else — a better one when the
    // difficulty is higher. It must never answer at r=0: that is faster than a
    // human nervous system and would win every heat.
    const r = reactionTo(state.startsAt, a.beat, now);
    const reflex = (1 - difficulty) * HIT_WINDOW_MS;
    if (r < reflex || r > HIT_WINDOW_MS) return null;
    return { s: sideOf(state.sides, a.beat) };
  },
};
