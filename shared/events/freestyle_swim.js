// 50m Backstroke.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to draw the lane, so the
// arrow the player answers is the arrow the server scores.
//
// A STREAM YOU CUT DOWN. Arrows come on continuously and cross a line at the
// far end of the lane. Answer the leading one — press, and it is destroyed
// where it stands, at any point on its way in — and everything behind it comes
// on. Nothing has to arrive first and no press is ever refused.
//
// The stream never stops for anybody, and that is the whole pressure in the
// event:
//
//   PRESS FAST and arrows die early, one per press, so more of them go down
//   per second and the swimmer winds up. Rate is speed here — a stroke is
//   worth the same whenever it lands, so the only way to go faster is to
//   answer more arrows, and the only way to do that is to read ahead.
//
//   PRESS SLOWLY and the leading arrow reaches the line on its own and is gone
//   anyway, charged as a miss. The lane does not stop and wait to be answered:
//   it takes the speed and carries on, with the row still flowing and the
//   buttons still live, so a bad patch is a bad patch and never a freeze.
//
// MASHING IS ANSWERED BY THE PATTERN, not by a rate limit. The sides are drawn
// independently, so a hammered button is the wrong side half the time, and a
// wrong side multiplies speed away faster than a right one adds it back: at
// fifty-fifty the equilibrium is IMPULSE·p/(1-p), which is under a metre a
// second however fast the hand goes. A player who reads gets the square root
// of their rate; a player who guesses gets a constant, and a low one.
//
// (A rate limit was tried instead, twice — first as a travel time an arrow had
// to finish before it could be answered, then as an arm cycle that scaled a
// stroke down for being early. Both worked, and both put the lane in the
// position of refusing a press the player could see was right. The pattern is
// the honest defence: it costs the masher and it costs the reader nothing.)
//
// DRAG IS QUADRATIC. Against linear drag the field spreads without bound — a
// player who presses twice as often ends up twice as fast, and the last
// swimmer is still mid-pool when the round times out. Against v² that same
// doubling is worth √2, which keeps a beginner inside the round without taking
// anything away from the player who reads best.

import { botJitter, botSlips } from '../bots.js';

export const DISTANCE_M = 50;
export const COUNTDOWN_MS = 2_500;
export const MAX_RACE_MS = 42_000;

// How long an unanswered arrow takes to cross the line.
//
// This is the pace the lane sets on its own, and the floor under the whole
// event: answer fewer than about one arrow a second and the stream is taking
// them off you faster than you are cutting them down. It is deliberately a
// pace a distracted player can beat and a good one laps — the pressure has to
// come from wanting to go FASTER, not from being unable to keep up at all.
export const DRIFT_MS = 900;

// How long the pattern is before it repeats. The cue index wraps, so the lane
// is endless while the wire still carries a fixed, small array — and ninety
// arrows is far more than anyone memorises inside one heat.
export const PATTERN_LEN = 90;

// The push off the wall, so nobody starts from a dead stop.
const PUSH_OFF = 1.4;

// What one answered arrow is worth, whenever it is answered.
//
// Flat on purpose: the reward for pressing early is that you get to press
// again sooner, and paying for it twice would make the timing of a press
// matter more than the number of them. Steady speed is sqrt(IMPULSE * presses
// per second / DRAG) — about 2.8 m/s at five a second, an 18-second 50m, down
// to 1.3 for a swimmer managing one, which still gets home inside the round.
const IMPULSE = 0.5;

// Water resistance, per metre per second SQUARED — see the note at the top.
const DRAG = 0.31;
const MAX_SPEED = 3.2; // m/s — a hard ceiling, well over world-record pace

// What the two mistakes cost, as the fraction of speed kept. An arrow let
// through is the cheaper one; the wrong side costs more, because you have
// caught the water backwards as well as wasted the arrow.
const PENALTY = { miss: 0.86, wrong: 0.8 };

// Mistakes that come one after another bite harder: the penalty is raised to
// this power per repeat, so a second costs about a third more than the first
// and a fifth costs double. Capped, because a player already stalled does not
// need the hole dug deeper — and one clean answer clears it.
const STREAK_BITE = 0.35;
const STREAK_CAP = 4;

// What the bot skill dial is worth at the weak end: how much slower than the
// quick end a hopeless bot presses, how much its rhythm wanders, and how often
// it takes the wrong side or lets one through. All of it scales to nothing at
// difficulty 1, which is the only clean meaning for the top of a skill dial.
// See `shared/bots.js` for why the luck is a hash and not a stream.
const BOT_GAP_MS = 205;
const BOT_SLOW_MS = 700;
const BOT_WOBBLE_MS = 90;
const BOT_WRONG_CHANCE = 0.12;
const BOT_LAPSE_CHANCE = 0.07;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** A penalty, sharpened by how many mistakes came immediately before it. */
const bite = (base, streak) => base ** (1 + STREAK_BITE * Math.min(streak, STREAK_CAP));

/**
 * The side cue `i` calls for: 0 = left, 1 = right.
 *
 * The index WRAPS, which is the whole reason the lane can be endless without
 * the wire carrying an endless array.
 */
export const sideOf = (sides, i) =>
  (sides?.length ? sides[((i % sides.length) + sides.length) % sides.length] : i % 2);

/**
 * How far the leading arrow has come, 0 (just on) to 1 (crossing the line).
 *
 * Exported because the renderer places the whole row off this one number: the
 * k-th arrow from the front sits at `k + 1 - driftAt(...)` slots from the
 * line. Drawing it any other way is a second implementation of the rule, and
 * the two would disagree about exactly when an arrow was gone.
 */
export const driftAt = (dueAt, now) => clamp(1 - (dueAt - now) / DRIFT_MS, 0, 1);

/** How the client labels an answered arrow: how much of its run was left. */
export function gradeFor(drift) {
  if (drift <= 0.34) return 'perfect'; // cut down while it was still coming
  if (drift <= 0.67) return 'good';
  return 'ok'; // answered, but only just
}

/**
 * Charge every arrow that has reached the line unanswered and bring on the
 * next.
 *
 * Called from `step` for everybody and from `applyInput` before a press is
 * judged, so a press can never be scored against an arrow that was already
 * gone — and so the stream keeps moving for a player who has stopped pressing
 * altogether. Nothing here waits for input, which is the point: the lane does
 * not freeze on a player, it leaves them behind.
 */
function drainPassed(a, now) {
  while (now >= a.dueAt) {
    a.missStreak += 1;
    a.v *= bite(PENALTY.miss, a.missStreak);
    a.hits.miss += 1;
    a.combo = 0;
    a.last = 'miss';
    a.lastAt = a.dueAt;
    a.beat += 1;
    // From when it crossed, not from `now`: the cadence has to come out the
    // same whether the tick that noticed was early or late.
    a.dueAt += DRIFT_MS;
  }
}

export default {
  id: 'freestyle_swim',

  initState(seats, rng, now) {
    // Mixed, not taking turns. Each cue's side is drawn independently, so the
    // pattern cannot be second-guessed and every arrow has to be READ. It is
    // also the only thing standing between this lane and a masher, so it can
    // never become predictable.
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

    const startsAt = now + COUNTDOWN_MS;
    const athletes = {};
    for (const { playerId, lane } of seats) {
      athletes[playerId] = {
        lane,
        x: 0,
        v: PUSH_OFF,
        beat: 0, // the leading arrow
        dueAt: startsAt + DRIFT_MS, // when it reaches the line unanswered
        combo: 0,
        bestCombo: 0,
        missStreak: 0,
        hits: { perfect: 0, good: 0, ok: 0, miss: 0, wrong: 0 },
        last: null, // most recent judgement, for the client's flash
        lastAt: 0,
        done: false,
        time: null,
      };
    }
    return {
      startsAt,
      endsAt: startsAt + MAX_RACE_MS,
      sides,
      athletes,
    };
  },

  /**
   * One press. `input.s` is the side (0 left, 1 right) and `input.b`, when the
   * sender knows it, is WHICH ARROW they were answering.
   *
   * Answers the leading arrow wherever it has got to. Nothing here can refuse a
   * press for being early, because there is nothing for it to be early FOR: the
   * arrow the player is looking at is the arrow this destroys, and it goes
   * whether they read the side right or not.
   *
   * The arrow index is the one thing that has to travel with the press. A
   * client moves its row the instant a thumb goes down and the packet arrives
   * here a trip later, so the two counts are always a little apart — and if a
   * press is ever LOST on the way (dropped, or over the input rate limit) they
   * stay apart for good. From that moment every press answers one arrow while
   * the player is looking at another, so every side reads as the wrong side and
   * the swimmer stalls for reasons nothing on their screen explains. It is not
   * a hypothetical: hammering the buttons past the rate limit produced exactly
   * that, and no amount of guessing on the client could unpick it afterwards.
   *
   * So a press that names an arrow this lane has already spent, or has not
   * reached, is simply DROPPED — no impulse, no penalty, no advance. The client
   * sees its count stop moving and takes the server's, which is the only honest
   * repair. It gives a cheat nothing: the pattern is on the wire already, so a
   * modded client could always send the right side; naming the arrow lets this
   * lane refuse a press, never conjure one.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.done || now < state.startsAt) return;
    if (!input || (input.s !== 0 && input.s !== 1)) return;

    drainPassed(a, now);

    // Aimed at a different arrow than the one in front of us.
    if (typeof input.b === 'number' && input.b !== a.beat) return;

    if (input.s !== sideOf(state.sides, a.beat)) {
      a.missStreak += 1;
      a.v *= bite(PENALTY.wrong, a.missStreak);
      a.hits.wrong += 1;
      a.combo = 0;
      a.last = 'wrong';
    } else {
      a.missStreak = 0; // one clean answer and the hole stops getting deeper
      a.v = Math.min(a.v + IMPULSE, MAX_SPEED);
      const grade = gradeFor(driftAt(a.dueAt, now));
      a.hits[grade] += 1;
      a.combo += 1;
      a.bestCombo = Math.max(a.bestCombo, a.combo);
      a.last = grade;
    }
    a.lastAt = now;
    // Destroyed either way, and the next arrow gets a clear run at the line.
    // An arrow that inherited what was left of the last one's run would charge
    // a fast player a miss for pressing, which is precisely backwards.
    a.beat += 1;
    a.dueAt = now + DRIFT_MS;
  },

  step(state, dt, now) {
    if (now < state.startsAt) return;

    for (const a of Object.values(state.athletes)) {
      if (a.done) continue;

      // Quadratic, not exponential: see the head note. A press rate buys the
      // square root of itself, which is what keeps the field together.
      a.v = Math.max(0, a.v - DRAG * a.v * a.v * dt);
      a.x += a.v * dt;

      // The stream runs on its own clock, for everyone, always.
      drainPassed(a, now);

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
        // When the leading arrow reaches the line. The client draws the whole
        // row from this and its own count, so the stream keeps flowing between
        // packets instead of stepping once every tick.
        da: at.dueAt,
        c: at.combo,
        m: at.missStreak,
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

  /**
   * Bot seats and stalled-player fill: presses at a rate, and sometimes takes
   * the wrong side or lets one through.
   *
   * Rate IS skill here, so the dial is mostly the gap between presses — a
   * strong bot answers about five arrows a second, a hopeless one barely beats
   * the stream. The lapse is what stops a weak bot being merely slow and
   * spotless: it costs the arrow AND the miss, which is what a distracted human
   * actually does.
   */
  botInput(state, botId, difficulty = 0.75, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.done || now < state.startsAt) return null;
    const shaky = clamp(1 - difficulty, 0, 1);

    // Sit this one out and let it cross the line.
    if (botSlips(botId, a.beat, BOT_LAPSE_CHANCE * shaky ** 1.4, 1)) return null;

    const gap = BOT_GAP_MS + BOT_SLOW_MS * shaky ** 1.25
      + botJitter(botId, a.beat, BOT_WOBBLE_MS * shaky, 2);
    if (a.lastAt && now - a.lastAt < gap) return null;

    const side = sideOf(state.sides, a.beat);
    const fumble = botSlips(botId, a.beat, BOT_WRONG_CHANCE * shaky ** 1.2, 3);
    return { s: fumble ? 1 - side : side };
  },
};
