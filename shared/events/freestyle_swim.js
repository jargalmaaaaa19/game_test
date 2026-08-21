// 50m Backstroke.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to draw the lane, so the
// arrow the player answers is the arrow the server scores.
//
// A STREAM THAT BANKS UP AT A LINE. Arrows come on continuously and run at a
// line near the left of the lane. Answer the leading one — press, and it is
// destroyed where it stands, at any point on its way in — and everything
// behind it comes on. Nothing has to arrive first and no press is ever refused.
//
// The line is a WALL, not a drain. An arrow nobody answers reaches it and
// STOPS there, and the queue banks up behind it:
//
//   PRESS FAST and arrows die early, one per press, so more of them go down
//   per second and the swimmer winds up. Rate is speed here — an arrow is
//   worth the same whenever it is answered, so the only way to go faster is to
//   answer more of them, and the only way to do that is to read ahead.
//
//   STOP PRESSING and the leading arrow reaches the line, and the swimmer
//   STOPS. Not eased down by a fraction, not charged a penalty and carried on
//   — held, until the arrow standing on the line is answered. Speed is
//   something this event lends against work, and it calls the loan in the
//   moment the work stops.
//
// That replaced a per-miss penalty, which was quieter and worse. It cost a
// fixed fraction of speed and let the arrow through, so a player falling
// behind got a slow leak they could neither see nor point at, and the arrow
// they had been reading vanished while they were still reading it. A wall
// explains itself: the thing you did not answer is still there, and you are
// not moving until you do.
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

// How long an arrow takes to run from the back of the lane to the line.
//
// It is also the grace: an arrow that arrives unanswered stops the swimmer, so
// this is how long a player may go without pressing before they are standing
// still. Generous on purpose — the wall is a hard rule and a hard rule needs a
// soft clock, or a moment's inattention costs the race. A player pressing at
// anything like a rhythm never sees the line at all.
export const DRIFT_MS = 1_200;

// How hard the swimmer brakes while an arrow stands unanswered on the line, in
// metres per second squared. Half a second from racing pace to a stop: fast
// enough to read as STOPPING rather than as drifting, slow enough that the 3D
// swimmer settles instead of snapping.
const STALL_BRAKE = 5;

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

// What catching the water backwards costs, as the fraction of speed kept. The
// only penalty left in the event: letting an arrow reach the line is not
// charged for at all, it simply stops you until you deal with it.
const PENALTY = { wrong: 0.8 };

// Wrong sides that come one after another bite harder: the penalty is raised
// to this power per repeat, so a second costs about a third more than the
// first and a fifth costs double. Capped, because a player already stalled
// does not need the hole dug deeper — and one clean answer clears it.
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
const BOT_LAPSE_CHANCE = 0.09;
const BOT_LAPSE_MS = 1_000;

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

/**
 * How the client labels an answered arrow: how much of its run was left.
 *
 * An arrow answered off the line itself grades 'ok' — it was answered, and the
 * swimmer was stopped while it stood there. The grade is a nudge to read
 * further ahead, never a penalty; the penalty is the stopping.
 */
export function gradeFor(drift) {
  if (drift <= 0.34) return 'perfect'; // cut down while it was still coming
  if (drift <= 0.67) return 'good';
  return 'ok'; // answered at or near the line
}

/**
 * Is the leading arrow standing on the line, waiting to be answered?
 *
 * Exported because the renderer needs the same answer the sim has — the arrow
 * that has stopped is drawn differently, and the swimmer beside it is stopping
 * for a reason the player should be able to see.
 */
export const isStalled = (a, now) => now >= a.dueAt;

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
        dueAt: startsAt + DRIFT_MS, // when it reaches the line and stops there
        combo: 0,
        bestCombo: 0,
        missStreak: 0,
        hits: { perfect: 0, good: 0, ok: 0, wrong: 0 },
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
    // Destroyed either way, and the next arrow starts its own run at the line.
    // It gets the full DRIFT_MS however long the last one stood there: a player
    // who was stopped is moving again the moment they answer, which is the
    // whole bargain the wall offers.
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

      // An arrow is standing on the line unanswered: the swimmer stops. Not a
      // fraction off the top — a brake, held until the arrow is dealt with.
      if (isStalled(a, now)) a.v = Math.max(0, a.v - STALL_BRAKE * dt);

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

    // Look away for a moment: long enough that this arrow reaches the line and
    // the bot is caught standing still, which is what a distracted human does.
    //
    // A DELAY, never a skip. Nothing expires now, so a bot that declined to
    // answer an arrow would decline the same arrow for ever — the beat its luck
    // is keyed on cannot advance until somebody presses — and it would sit at
    // the wall until the round timed out.
    const lapse = botSlips(botId, a.beat, BOT_LAPSE_CHANCE * shaky ** 1.4, 1) ? BOT_LAPSE_MS : 0;

    const gap = BOT_GAP_MS + BOT_SLOW_MS * shaky ** 1.25 + lapse
      + botJitter(botId, a.beat, BOT_WOBBLE_MS * shaky, 2);
    if (a.lastAt && now - a.lastAt < gap) return null;

    const side = sideOf(state.sides, a.beat);
    const fumble = botSlips(botId, a.beat, BOT_WRONG_CHANCE * shaky ** 1.2, 3);
    return { s: fumble ? 1 - side : side };
  },
};
