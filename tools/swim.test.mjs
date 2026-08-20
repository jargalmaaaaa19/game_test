// Unit test for the 50m backstroke sim. Pure module, so no server and no
// sockets:  node tools/swim.test.mjs

import assert from 'node:assert/strict';
import swim, {
  COUNTDOWN_MS,
  DISTANCE_M,
  MAX_RACE_MS,
  PATTERN_LEN,
  cadenceFactor,
  sideOf,
} from '../shared/events/freestyle_swim.js';
import { pointsForPlacement } from '../shared/scoring.js';

let failures = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name} — ${err.message}`);
  }
};

const T0 = 4_000_000;
const seats = [
  { playerId: 'ace', lane: 1 },
  { playerId: 'ok', lane: 2 },
  { playerId: 'idle', lane: 3 },
];
const fresh = (rng = () => 0.5) => swim.initState(seats, rng, T0);
const live = (state) => state.startsAt + 1;

/**
 * Swim the race: answer the cue at the front of the queue every `gap` ms until
 * the swimmer is home or the round is out.
 *
 * `wrongEvery` catches the water backwards on every nth stroke; `silent` puts
 * a swimmer in the water who never presses at all.
 */
function race(state, id, { gap = 260, wrongEvery = 0, silent = false, until = MAX_RACE_MS } = {}) {
  const a = state.athletes[id];
  const end = state.startsAt + until;
  let at = state.startsAt;
  let lastPress = state.startsAt;
  let strokes = 0;

  while (at < end && !a.done) {
    swim.step(state, 0.05, at);
    if (!silent && at - lastPress >= gap) {
      strokes += 1;
      const correct = sideOf(state.sides, a.beat);
      const side = wrongEvery && strokes % wrongEvery === 0 ? 1 - correct : correct;
      swim.applyInput(state, id, { s: side }, at);
      lastPress = at;
    }
    at += 50;
  }
  return a;
}

console.log('\n50m backstroke sim');

test('the stroke pattern is mixed, not taking turns', () => {
  let seed = 7;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const { sides } = fresh(rng);
  const alternating = sides.every((s, i) => (i === 0 ? true : s !== sides[i - 1]));
  assert.ok(!alternating, 'the pattern simply alternates — nothing has to be read');

  let run = 1;
  for (let i = 1; i < sides.length; i += 1) {
    run = sides[i] === sides[i - 1] ? run + 1 : 1;
    assert.ok(run <= 3, `a run of ${run} of one side reads as broken`);
  }
});

test('the queue wraps, so it never runs out of cues', () => {
  const { sides } = fresh();
  assert.equal(sides.length, PATTERN_LEN);
  assert.equal(sideOf(sides, PATTERN_LEN), sideOf(sides, 0));
  assert.equal(sideOf(sides, PATTERN_LEN * 3 + 5), sideOf(sides, 5));
});

test('the cue at the front waits — a press right off the gun counts', () => {
  const state = fresh();
  const a = state.athletes.ace;
  swim.applyInput(state, 'ace', { s: sideOf(state.sides, 0) }, live(state));
  assert.equal(a.beat, 1, 'an early press was refused');
  assert.ok(a.v > 0, 'an early press paid nothing');
  assert.equal(a.hits.wrong, 0);
});

test('a correct stroke brings the queue forward; a wrong one does not', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const wrong = 1 - sideOf(state.sides, 0);

  swim.applyInput(state, 'ace', { s: wrong }, live(state));
  assert.equal(a.beat, 0, 'the wrong side advanced the queue');
  assert.equal(a.hits.wrong, 1);

  swim.applyInput(state, 'ace', { s: sideOf(state.sides, 0) }, live(state) + 300);
  assert.equal(a.beat, 1, 'the right side did not advance the queue');
});

test('catching the wrong side costs speed', () => {
  const state = fresh();
  const a = state.athletes.ace;
  swim.applyInput(state, 'ace', { s: sideOf(state.sides, 0) }, live(state));
  const before = a.v;
  swim.applyInput(state, 'ace', { s: 1 - sideOf(state.sides, 1) }, live(state) + 300);
  assert.ok(a.v < before, 'a wrong stroke was free');
});

test('nothing expires: standing still loses no cue, only speed', () => {
  const state = fresh();
  const a = state.athletes.ace;
  race(state, 'ace', { silent: true, until: 6_000 });
  assert.equal(a.beat, 0, 'a cue expired while nobody was pressing');
  assert.equal(a.hits.wrong, 0);
  assert.equal(a.combo, 0);
  assert.ok(a.x < 0.001, 'a swimmer who never strokes still moved');
});

test('landing more strokes beats landing fewer', () => {
  const brisk = race(fresh(), 'ace', { gap: 260 });
  const slow = race(fresh(), 'ace', { gap: 700 });
  assert.ok(brisk.x > slow.x, `${brisk.x} vs ${slow.x}`);
});

test('a steady swimmer finishes the 50m', () => {
  const a = race(fresh(), 'ace', { gap: 260 });
  assert.ok(a.done, `never finished; reached ${a.x}m`);
  assert.equal(a.x, DISTANCE_M);
});

test('the finishing time is in a plausible range', () => {
  const a = race(fresh(), 'ace', { gap: 260 });
  assert.ok(a.time > 14_000 && a.time < 32_000, `implausible time: ${a.time}`);
});

test('even a laboured swimmer gets home inside the round', () => {
  const a = race(fresh(), 'ace', { gap: 520 });
  assert.ok(a.done, `a slow but correct swimmer was still at ${a.x}m`);
});

test('pressing twice as fast buys almost nothing', () => {
  // Impulse per second is flat below the ideal cadence, so the ONLY thing a
  // faster presser gains is a smoother impulse train — small, frequent pushes
  // lose less to drag between them than big, rare ones. That is worth about 9%
  // off the clock, and it has to be paid for by reading every arrow correctly
  // at eight a second. The guard here is that it stays a rounding error rather
  // than becoming the way to win.
  const brisk = race(fresh(), 'ace', { gap: 260 });
  const frantic = race(fresh(), 'ace', { gap: 130 });
  assert.ok(brisk.done && frantic.done);
  assert.ok(
    frantic.time > brisk.time * 0.85,
    `spam finished in ${frantic.time} against ${brisk.time}`,
  );
});

test('a held button never completes a stroke', () => {
  const state = fresh();
  const a = state.athletes.ace;
  let at = live(state);
  for (let i = 0; i < 400; i += 1) {
    swim.applyInput(state, 'ace', { s: sideOf(state.sides, a.beat) }, at);
    at += 15; // faster than an arm can come round
  }
  assert.ok(a.v < 1, `a held button reached ${a.v} m/s`);
});

test('hammering both buttons is punished, not rewarded', () => {
  const read = race(fresh(), 'ace', { gap: 260, until: 10_000 });

  const masher = fresh();
  const a = masher.athletes.ace;
  let at = masher.startsAt;
  let side = 0;
  while (at < masher.startsAt + 10_000 && !a.done) {
    swim.step(masher, 0.05, at);
    swim.applyInput(masher, 'ace', { s: side }, at);
    side = 1 - side;
    at += 50;
  }
  assert.ok(read.x > a.x, `mashing reached ${a.x}m against a reader's ${read.x}m`);
});

test('the cadence factor flattens impulse per second', () => {
  assert.equal(cadenceFactor(10_000), 1);
  assert.ok(cadenceFactor(130) > 0.4 && cadenceFactor(130) < 0.6);
  assert.equal(cadenceFactor(0), 0);
});

test('a garbage payload cannot move a swimmer or crash', () => {
  const state = fresh();
  for (const bad of [null, undefined, {}, { s: 5 }, { s: '0' }, { t: 'nope' }]) {
    swim.applyInput(state, 'ace', bad, live(state));
  }
  assert.equal(state.athletes.ace.beat, 0);
  assert.equal(state.athletes.ace.v, 0);
});

test('a stroke before the gun is ignored', () => {
  const state = fresh();
  swim.applyInput(state, 'ace', { s: sideOf(state.sides, 0) }, T0 + COUNTDOWN_MS - 100);
  assert.equal(state.athletes.ace.beat, 0);
  assert.equal(state.athletes.ace.v, 0);
});

test('placements are finishers by time, then the rest by distance', () => {
  const state = fresh();
  state.athletes.ace.done = true;
  state.athletes.ace.time = 21_000;
  state.athletes.ok.x = 30;
  state.athletes.idle.x = 5;
  assert.deepEqual(swim.placements(state), ['ace', 'ok', 'idle']);
});

test('placements award 10 / 8 / 6', () => {
  const state = fresh();
  assert.deepEqual(swim.placements(state).map((_, i) => pointsForPlacement(i)), [10, 8, 6]);
});

test('the wire snapshot is compact and quantized', () => {
  const state = fresh();
  race(state, 'ace', { gap: 260, until: 3_000 });
  const wire = swim.snapshot(state);
  assert.deepEqual(Object.keys(wire).sort(), ['a', 'e', 's', 'sides']);
  assert.deepEqual(
    Object.keys(wire.a.ace).sort(),
    ['b', 'c', 'd', 'j', 'ja', 'l', 't', 'v', 'x'],
  );
  assert.equal(Math.round(wire.a.ace.x * 100) / 100, wire.a.ace.x, 'x not quantized');
  assert.ok(wire.a.ace.b > 0, 'the queue pointer is not on the wire');
});

test('a strong bot swims correctly, and a weak one swims slower', () => {
  const run = (difficulty) => {
    const state = fresh();
    const a = state.athletes.ace;
    let at = state.startsAt;
    while (at < state.startsAt + 12_000 && !a.done) {
      const input = swim.botInput(state, 'ace', difficulty, at);
      if (input) swim.applyInput(state, 'ace', input, at);
      swim.step(state, 0.05, at);
      at += 50;
    }
    return a;
  };
  const strong = run(1);
  const weak = run(0);
  assert.equal(strong.hits.wrong, 0, 'the bot caught the wrong side');
  assert.ok(strong.x > weak.x, `${strong.x} vs ${weak.x}`);
});

test('the same strokes always produce the same race', () => {
  const one = race(fresh(), 'ace', { gap: 260, until: 9_000 });
  const two = race(fresh(), 'ace', { gap: 260, until: 9_000 });
  assert.equal(one.x, two.x);
  assert.equal(one.beat, two.beat);
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
