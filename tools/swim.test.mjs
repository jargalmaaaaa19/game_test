// Unit test for the 50m backstroke sim. Pure module, so no server and no
// sockets:  node tools/swim.test.mjs

import assert from 'node:assert/strict';
import swim, {
  COUNTDOWN_MS,
  MAX_RACE_MS,
  PATTERN_LEN,
  STROKE_CYCLE_MS,
  gradeFor,
  sideOf,
  strokeValue,
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

/**
 * A real pattern, for the tests where the SIDES are what is under test.
 *
 * `fresh()` takes a constant rng so a race is reproducible, but a constant rng
 * plus the run cap makes the sides PERIODIC — three of one side, one of the
 * other, for ever. A blind alternator scores 75% against that period and looks
 * like it has beaten the game when all it has beaten is the test fixture.
 */
const seeded = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

/**
 * Swim the race at a fixed cadence.
 *
 * `every` is the gap between strokes in ms — the only dial a player really has
 * now, since the arrows wait for them rather than the other way round.
 */
function race(state, id, {
  every = STROKE_CYCLE_MS, wrongEvery = 0, silent = false, from = 0, until = MAX_RACE_MS,
} = {}) {
  const a = state.athletes[id];
  const end = state.startsAt + until;
  let at = state.startsAt + from;
  let strokes = 0;

  while (at < end && !a.done) {
    swim.step(state, 0.005, at);
    if (!silent && at % every < 5) {
      strokes += 1;
      const correct = sideOf(state.sides, a.beat);
      const side = wrongEvery && strokes % wrongEvery === 0 ? 1 - correct : correct;
      swim.applyInput(state, id, { s: side }, at);
    }
    at += 5;
  }
  return a;
}

console.log('\n50m backstroke sim');

test('the pattern is mixed, not taking turns, and it wraps', () => {
  const { sides } = fresh(seeded(7));
  assert.ok(!sides.every((s, i) => (i === 0 ? true : s !== sides[i - 1])), 'it simply alternates');
  let run = 1;
  for (let i = 1; i < sides.length; i += 1) {
    run = sides[i] === sides[i - 1] ? run + 1 : 1;
    assert.ok(run <= 3, `a run of ${run} reads as broken`);
  }
  assert.equal(sideOf(sides, PATTERN_LEN + 5), sideOf(sides, 5));
});

test('an arrow can be answered at any moment — there is nothing to wait for', () => {
  // The whole point of the rebuild. Two swimmers, the same stroke, taken a
  // tenth of a second apart: both spend the arrow they were looking at, and
  // neither is told it was early.
  for (const delay of [1, 40, 500, 3_000]) {
    const state = fresh();
    const a = state.athletes.ace;
    const at = state.startsAt + delay;
    swim.step(state, 0.005, at);
    swim.applyInput(state, 'ace', { s: sideOf(state.sides, 0) }, at);
    assert.equal(a.beat, 1, `a stroke ${delay}ms in was refused`);
    assert.equal(a.hits.wrong, 0);
    assert.ok(a.v > 1.4, `the stroke was worth nothing: ${a.v}`);
  }
});

test('a stroke is worth what the arm had time to load', () => {
  assert.equal(strokeValue(STROKE_CYCLE_MS), 1, 'a full cycle is not full value');
  assert.equal(strokeValue(STROKE_CYCLE_MS * 3), 1, 'a slow stroke is docked for being slow');
  assert.equal(strokeValue(STROKE_CYCLE_MS / 2), 0.5);
  assert.equal(strokeValue(0), 0);
  assert.equal(gradeFor(1), 'perfect');
  assert.equal(gradeFor(0.6), 'good');
  assert.equal(gradeFor(0.2), 'ok'); // in the water, but rushed
});

test('the first stroke off the wall is a full one', () => {
  // There is no previous stroke to have rushed, and charging for one would
  // make the start a lottery.
  const state = fresh();
  const a = state.athletes.ace;
  swim.applyInput(state, 'ace', { s: sideOf(state.sides, 0) }, state.startsAt + 1);
  assert.equal(a.last, 'perfect');
});

test('stroking faster than the arm cycle buys nothing at all', () => {
  // The rate ceiling, and the only one there is. Every cadence at or below the
  // cycle delivers the same impulse per second, so a script at forty strokes a
  // second finishes level with a player holding the rhythm — and the wrong
  // sides it cannot avoid do the rest.
  const times = [25, 60, 130, STROKE_CYCLE_MS].map((every) => race(fresh(), 'ace', { every }).time);
  for (const time of times) assert.ok(time, 'a cadence never finished');
  const spread = Math.max(...times) - Math.min(...times);
  assert.ok(spread < 700, `hammering paid: ${times}`);
});

test('stroking slower than the cycle is slower, in proportion', () => {
  const ideal = race(fresh(), 'ace', { every: STROKE_CYCLE_MS });
  const relaxed = race(fresh(), 'ace', { every: 450 });
  const laboured = race(fresh(), 'ace', { every: 900 });
  assert.ok(ideal.time < relaxed.time, `${ideal.time} vs ${relaxed.time}`);
  assert.ok(relaxed.time < laboured.time, `${relaxed.time} vs ${laboured.time}`);
});

test('both a sharp and a laboured swimmer get home inside the round', () => {
  const sharp = race(fresh(), 'ace', { every: STROKE_CYCLE_MS });
  const laboured = race(fresh(), 'ace', { every: 900 });
  assert.ok(sharp.time > 12_000 && sharp.time < 26_000, `sharp: ${sharp.time}`);
  assert.ok(laboured.done && laboured.time < MAX_RACE_MS, `laboured: ${laboured.time}`);
});

test('the pace settles instead of running away or dying', () => {
  const state = fresh();
  const a = state.athletes.ace;
  race(state, 'ace', { until: 6_000 });
  const early = a.v;
  race(state, 'ace', { from: 6_000, until: 12_000 });
  assert.ok(a.v > 0.5, `the pace died: ${a.v}`);
  assert.ok(Math.abs(a.v - early) < 0.6, `the pace ran away: ${early} then ${a.v}`);
  assert.ok(a.v < 3.3, `past the ceiling: ${a.v}`);
});

test('catching the wrong side costs speed and still spends the arrow', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = state.startsAt + 1;
  const before = a.v;
  swim.applyInput(state, 'ace', { s: 1 - sideOf(state.sides, 0) }, at);
  assert.equal(a.beat, 1, 'a fumbled arrow stayed at the head of the row');
  assert.equal(a.hits.wrong, 1);
  assert.ok(a.v < before);
  assert.equal(a.combo, 0);
});

test('mistakes one after another bite harder than mistakes apart', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = state.startsAt + 1;
  a.v = 2;

  const wrong = () => {
    const before = a.v;
    swim.applyInput(state, 'ace', { s: 1 - sideOf(state.sides, a.beat) }, at);
    return a.v / before;
  };

  const first = wrong();
  const second = wrong();
  const third = wrong();
  assert.ok(second < first, `a repeat cost no more: ${first} then ${second}`);
  assert.ok(third < second, `the streak stopped biting: ${second} then ${third}`);

  // One clean stroke and the hole stops getting deeper.
  swim.applyInput(state, 'ace', { s: sideOf(state.sides, a.beat) }, at);
  assert.equal(a.missStreak, 0);
  assert.ok(Math.abs(wrong() - first) < 1e-9, 'a clean stroke did not clear the streak');
});

test('a stall is recovered by stroking, not waited out', () => {
  const state = fresh();
  const a = state.athletes.ace;
  race(state, 'ace', { until: 4_000 });
  const cruising = a.v;

  race(state, 'ace', { silent: true, from: 4_000, until: 7_000 });
  const stalled = a.v;
  race(state, 'ace', { from: 7_000, until: 11_000 });

  assert.ok(stalled < cruising * 0.5, `the stall was painless: ${cruising} to ${stalled}`);
  assert.ok(a.v > stalled * 1.5, `the pace never came back: ${stalled} to ${a.v}`);
});

test('hammering both buttons is punished at every cadence', () => {
  // With no window to hold them off, this is the defence: the sides are random,
  // so half of a blind hand's strokes catch the water backwards, and a wrong
  // side costs more than a right one earns.
  const read = race(fresh(seeded(7)), 'ace', { until: 12_000 });

  for (const every of [25, 60, 130, STROKE_CYCLE_MS]) {
    const masher = fresh(seeded(7));
    const a = masher.athletes.ace;
    let side = 0;
    for (let at = masher.startsAt; at < masher.startsAt + 12_000 && !a.done; at += 5) {
      swim.step(masher, 0.005, at);
      if (at % every < 5) {
        swim.applyInput(masher, 'ace', { s: side }, at);
        side = 1 - side;
      }
    }
    assert.ok(
      read.x > a.x * 1.5,
      `mashing every ${every}ms reached ${a.x.toFixed(1)}m against a reader's ${read.x.toFixed(1)}m`,
    );
  }
});

test('a swimmer who never strokes glides to a halt', () => {
  const state = fresh();
  const a = state.athletes.ace;
  race(state, 'ace', { silent: true });
  assert.ok(!a.done, 'an idle swimmer finished the race');
  assert.ok(a.v < 0.5, `still moving at ${a.v}`);
  assert.equal(a.beat, 0, 'an untouched row moved on its own');
});

test('a stroke before the gun is ignored', () => {
  const state = fresh();
  swim.applyInput(state, 'ace', { s: sideOf(state.sides, 0) }, T0 + COUNTDOWN_MS - 100);
  assert.equal(state.athletes.ace.beat, 0);
});

test('a garbage payload cannot move a swimmer or crash', () => {
  const state = fresh();
  for (const bad of [null, undefined, {}, { s: 5 }, { s: '0' }, { t: 'nope' }]) {
    swim.applyInput(state, 'ace', bad, state.startsAt + 1);
  }
  assert.equal(state.athletes.ace.beat, 0);
  assert.equal(state.athletes.ace.hits.wrong, 0);
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
  race(state, 'ace', { until: 3_000 });
  const wire = swim.snapshot(state);
  assert.deepEqual(Object.keys(wire).sort(), ['a', 'e', 's', 'sides']);
  assert.deepEqual(
    Object.keys(wire.a.ace).sort(),
    ['b', 'c', 'd', 'j', 'ja', 'l', 'm', 't', 'v', 'x'],
  );
  assert.equal(Math.round(wire.a.ace.x * 100) / 100, wire.a.ace.x, 'x not quantized');
  assert.ok(wire.a.ace.b > 0, 'the row pointer is not on the wire');
});

test('a strong bot swims cleanly, and a weak one swims slower', () => {
  const run = (difficulty) => {
    const state = fresh();
    const a = state.athletes.ace;
    let at = state.startsAt;
    while (at < state.startsAt + MAX_RACE_MS && !a.done) {
      const input = swim.botInput(state, 'ace', difficulty, at);
      if (input) swim.applyInput(state, 'ace', input, at);
      swim.step(state, 0.01, at);
      at += 10;
    }
    return a;
  };
  const strong = run(1);
  const weak = run(0);
  assert.equal(strong.hits.wrong, 0, 'the flawless bot caught the wrong side');
  assert.ok(weak.hits.wrong > 0, 'the hopeless bot never put a hand wrong');
  assert.ok(strong.x >= weak.x, `${strong.x} vs ${weak.x}`);
  assert.ok(strong.done, 'the strong bot never finished');
  assert.ok(strong.time > 12_000, `a bot no human could race: ${strong.time}`);
});

test('the same strokes always produce the same race', () => {
  const one = race(fresh(), 'ace', { until: 9_000 });
  const two = race(fresh(), 'ace', { until: 9_000 });
  assert.equal(one.x, two.x);
  assert.equal(one.beat, two.beat);
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
