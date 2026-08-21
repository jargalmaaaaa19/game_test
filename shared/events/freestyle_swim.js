// 50m Backstroke.
//
// PURE: no DOM, no Node, no Math.random(), no Date.now(). The server runs this
// as the authority; the client runs the SAME module to draw the lane, so the
// arrow the player answers is the arrow the server scores.
//
// A QUEUE, NOT A TIMELINE. Arrows sit in a row with the next one on the line,
// and a stroke answers whichever arrow is at the head of it. There is no window
// to hit and nothing to wait for: press, and that arrow is gone and the row
// comes on. The row therefore moves at the speed of the player's hands and at
// no other speed — the swimmer has no vote in it and neither does any clock.
//
// It took three tries to get here. The arrows were pinned to the water first,
// so a swimmer going well got them FASTER — the display sped up exactly when it
// became hardest to read. Then they were pinned to a travel time with a window
// straddling the line, which fixed the reading but kept the waiting: the player
// could see the arrow coming, knew which side it wanted, and had to sit on
// their hands until it arrived. A cue you have already read is a cue you should
// be allowed to answer.
//
// SO THE RATE CEILING MOVED INTO THE STROKE. The window used to be what stopped
// a masher — nothing could be answered before it arrived, which capped the
// stroke rate at one per travel time. With the window gone, that job belongs to
// the arm: a stroke needs time to load, so one taken half a cycle after the
// last is worth half as much. Impulse per SECOND is therefore flat at or below
// the cycle, and hammering the buttons twice as fast buys exactly nothing.
// (This is the sprint's economics, and it is the same economics for the same
// reason: a rate limit hands a script the maximum legal rate, and the script
// then beats every human. The sprint learned that the hard way.)
//
// The pattern of sides is random, so a hammered button is the wrong side half
// the time, and a wrong side costs more than a right one earns. Between the two
// there is no way to play this by speed alone.
//
// DRAG IS QUADRATIC. Against linear drag the field spreads without bound — a
// player who strokes twice as often ends up twice as fast, and the last swimmer
// is still mid-pool when the round times out. Against v² that same doubling is
// worth √2, which keeps a beginner inside the round without taking anything
// away from the player who reads best.

import { botJitter, botSlips } from '../bots.js';

export const DISTANCE_M = 50;
export const COUNTDOWN_MS = 2_500;
export const MAX_RACE_MS = 42_000;

// A full arm cycle: the gap at which a stroke is worth everything it can be.
//
// Strokes closer together than this are RUSHED and scale down in proportion,
// which is what makes the impulse-per-second flat below it — see the head note.
// Strokes further apart are worth full value each, but there are fewer of them,
// so the fastest way down the pool is to hold this cadence exactly. That is the
// rhythm the event is really asking for, and at ~3.8 strokes a second it is a
// rhythm a thumb can actually hold.
export const STROKE_CYCLE_MS = 260;

// How long the pattern is before it repeats. The cue index wraps, so the lane
// is endless while the wire still carries a fixed, small array — and ninety
// arrows is far more than anyone memorises inside one heat.
export const PATTERN_LEN = 90;

// The push off the wall, so nobody starts from a dead stop.
const PUSH_OFF = 1.4;

// What a fully loaded stroke is worth. Steady speed is
// sqrt(IMPULSE_FULL * strokes-per-second / DRAG), which at the ideal cadence is
// about 2.75 m/s — an 18-second 50m — falling to about 1.3 for a swimmer
// managing one stroke a second, which still gets home inside the round.
const IMPULSE_FULL = 0.61;

// Water resistance, per metre per second SQUARED — see the note at the top.
const DRAG = 0.31;
const MAX_SPEED = 3.2; // m/s — a hard ceiling, well over world-record pace

// What catching the water backwards costs, as the fraction of speed kept.
const WRONG_PENALTY = 0.8;

// Wrong sides that come one after another bite harder: the penalty is raised to
// this power per repeat, so a second costs about a third more than the first
// and a fifth costs double. Capped, because a player already stalled does not
// need the hole dug deeper — and one clean stroke clears it.
const STREAK_BITE = 0.35;
const STREAK_CAP = 4;

// What the bot skill dial is worth at the weak end: how much slower than the
// ideal cycle a hopeless bot strokes, how much its cadence wanders, and how
// often it catches an arrow on the wrong side. All three scale to nothing at
// difficulty 1, which is the only clean meaning for the top of a skill dial.
// See `shared/bots.js` for why the luck is a hash and not a stream.
const BOT_DRAG_MS = 620;
const BOT_WOBBLE_MS = 90;
const BOT_WRONG_CHANCE = 0.13;

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
 * How much of a stroke was actually in the water, from the gap since the last
 * one: 1 for a full arm cycle, proportionally less for anything rushed.
 *
 * This is the whole economy of the event and it has to be the ECONOMICS rather
 * than a rate limit. A bare "ignore strokes closer than N ms" hands a script
 * the fastest legal cadence and the script wins; scaling the value instead
 * makes the fastest legal cadence worth exactly what the ideal one is worth,
 * and the wrong sides a fast hand cannot avoid do the rest.
 */
export const strokeValue = (gap) => clamp(gap / STROKE_CYCLE_MS, 0, 1);

/** How the client labels a stroke — what it says is "was that a full stroke?" */
export function gradeFor(value) {
  if (value >= 0.9) return 'perfect';
  if (value >= 0.55) return 'good';
  return 'ok'; // in the water, but rushed: the arm never loaded
}

export default {
  id: 'freestyle_swim',

  initState(seats, rng, now) {
    // Mixed, not taking turns. Each cue's side is drawn independently, so the
    // pattern cannot be second-guessed and every arrow has to be READ. It is
    // also the real answer to button-mashing: a hammered side is right half the
    // time, and a wrong side costs more than a right one earns.
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
        beat: 0, // the arrow at the head of the row
        strokeAt: 0, // when the last stroke went in, for the arm cycle
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
   * One stroke. `input.s` is the side pressed (0 left, 1 right).
   *
   * Always answers the arrow at the head of the row, whatever the clock says.
   * Nothing here can reject a press for being early, because there is no longer
   * anything for it to be early FOR: the arrow the player is looking at is the
   * arrow this answers, and it goes whether they got the side right or not.
   */
  applyInput(state, playerId, input, now) {
    const a = state.athletes[playerId];
    if (!a || a.done || now < state.startsAt) return;
    if (!input || (input.s !== 0 && input.s !== 1)) return;

    // The first stroke off the wall is a full one: there is no previous stroke
    // to have rushed, and charging one for it would make the start a lottery.
    const value = strokeValue(a.strokeAt ? now - a.strokeAt : STROKE_CYCLE_MS);
    a.strokeAt = now;

    if (input.s !== sideOf(state.sides, a.beat)) {
      a.missStreak += 1;
      a.v *= bite(WRONG_PENALTY, a.missStreak);
      a.hits.wrong += 1;
      a.combo = 0;
      a.last = 'wrong';
    } else {
      a.missStreak = 0; // one clean stroke and the hole stops getting deeper
      a.v = Math.min(a.v + IMPULSE_FULL * value, MAX_SPEED);
      const grade = gradeFor(value);
      a.hits[grade] += 1;
      a.combo += 1;
      a.bestCombo = Math.max(a.bestCombo, a.combo);
      a.last = grade;
    }
    a.lastAt = now;
    // Answered or fumbled, that arrow is spent. A cue that stayed at the head
    // after a wrong side would have to be answered twice, and the row would
    // stall on the player's mistake instead of carrying on past it.
    a.beat += 1;
  },

  step(state, dt, now) {
    if (now < state.startsAt) return;

    for (const a of Object.values(state.athletes)) {
      if (a.done) continue;

      // Quadratic, not exponential: see the head note. A stroke rate buys the
      // square root of itself, which is what keeps the field together.
      a.v = Math.max(0, a.v - DRAG * a.v * a.v * dt);
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
        // How far down the row this swimmer has got. The client draws the queue
        // from here and animates the slide itself, because the slide is
        // decoration now — there is no arrival for it to be lying about.
        b: at.beat,
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
   * Bot seats and stalled-player fill: strokes at a cadence, and sometimes
   * catches the water on the wrong side.
   *
   * Skill is read on three axes, all keyed to the BEAT so a bot polled several
   * times inside one tick does not get several rolls of the dice. A strong
   * swimmer holds the arm cycle almost exactly and rarely errs; a weak one
   * strokes well inside it, wanders, and fumbles one arrow in eight.
   */
  botInput(state, botId, difficulty = 0.75, now = 0) {
    const a = state.athletes[botId];
    if (!a || a.done || now < state.startsAt) return null;
    const shaky = clamp(1 - difficulty, 0, 1);

    // Stroking SLOWER than the cycle is what makes a weak bot slow: each stroke
    // is worth full value, there are simply fewer of them. Stroking faster
    // would gain it nothing, which is exactly the point of the economy.
    const gap = STROKE_CYCLE_MS + BOT_DRAG_MS * shaky ** 1.3
      + botJitter(botId, a.beat, BOT_WOBBLE_MS * shaky, 1);
    if (a.strokeAt && now - a.strokeAt < gap) return null;

    const side = sideOf(state.sides, a.beat);
    const fumble = botSlips(botId, a.beat, BOT_WRONG_CHANCE * shaky ** 1.2, 2);
    return { s: fumble ? 1 - side : side };
  },
};
