// Unit test for the 50m backstroke sim. Pure module, so no server and no
// sockets:  node tools/swim.test.mjs

import assert from 'node:assert/strict';
import swim, {
  COUNTDOWN_MS,
  DISTANCE_M,
  MAX_RACE_MS,
  PATTERN_LEN,
  REACH_M,
  STROKE_M,
  cueAt,
  promptnessAt,
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

/**
 * Swim the race.
 *
 * `aim` is WHERE in each arrow's window the stroke lands: 1 is the near edge,
 * the earliest a stroke can be made, and 0 is scraping the far one. That is the
 * whole skill of the event, so it is the only dial the helper has.
 */
function race(state, id, { aim = 0.8, wrongEvery = 0, silent = false, until = MAX_RACE_MS } = {}) {
  const a = state.athletes[id];
  const end = state.startsAt + until;
  let at = state.startsAt;
  let strokes = 0;

  while (at < end && !a.done) {
    swim.step(state, 0.03, at);
    if (!silent) {
      const p = promptnessAt(a.beat, a.x);
      if (p !== null && p <= aim) {
        strokes += 1;
        const correct = sideOf(state.sides, a.beat);
        const side = wrongEvery && strokes % wrongEvery === 0 ? 1 - correct : correct;
        swim.applyInput(state, id, { s: side }, at);
      }
    }
    at += 30;
  }
  return a;
}

console.log('\n50m backstroke sim');

test('the arrows are marks on the water, evenly spaced', () => {
  assert.ok(cueAt(0) > 0);
  assert.ok(Math.abs(cueAt(5) - cueAt(4) - STROKE_M) < 1e-9);
  assert.ok(cueAt(80) > DISTANCE_M - STROKE_M * 2, 'the lane runs out before the wall does');
});

test('the pattern is mixed, not taking turns, and it wraps', () => {
  let seed = 7;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const { sides } = fresh(rng);
  assert.ok(!sides.every((s, i) => (i === 0 ? true : s !== sides[i - 1])), 'it simply alternates');
  let run = 1;
  for (let i = 1; i < sides.length; i += 1) {
    run = sides[i] === sides[i - 1] ? run + 1 : 1;
    assert.ok(run <= 3, `a run of ${run} reads as broken`);
  }
  assert.equal(sideOf(sides, PATTERN_LEN + 5), sideOf(sides, 5));
});

test('an arrow is answerable across a window, and nowhere else', () => {
  assert.equal(promptnessAt(3, cueAt(3) - REACH_M - 0.01), null, 'answerable before it arrives');
  assert.equal(promptnessAt(3, cueAt(3) + REACH_M + 0.01), null, 'answerable after it is gone');
  // To a tolerance, not exactly: `cueAt(3) - REACH_M` does not subtract back to
  // exactly -REACH_M, so the edges land a rounding error either side of 1 and
  // 0. Demanding equality here tests the float unit, not the rule.
  assert.ok(Math.abs(promptnessAt(3, cueAt(3) - REACH_M) - 1) < 1e-9, 'the near edge is not full value');
  assert.ok(Math.abs(promptnessAt(3, cueAt(3) + REACH_M)) < 1e-9, 'the far edge is not worth zero');
  assert.ok(Math.abs(promptnessAt(3, cueAt(3)) - 0.5) < 1e-9);
});

test('the swimmer pushes off the wall, so the first arrow arrives', () => {
  const state = fresh();
  const a = state.athletes.ace;
  assert.ok(a.v > 0, 'a dead stop would mean the lane never scrolls');
  race(state, 'ace', { silent: true, until: 2_000 });
  assert.ok(a.x > 0, 'the swimmer never left the wall');
});

test('meeting the arrows early swims faster than scraping them late', () => {
  const early = race(fresh(), 'ace', { aim: 0.95 });
  const late = race(fresh(), 'ace', { aim: 0.05 });
  assert.ok(early.done && late.done, `early=${early.done} late=${late.done}`);
  assert.ok(early.time < late.time, `${early.time} vs ${late.time}`);
});

test('both a sharp and a laboured swimmer get home inside the round', () => {
  const early = race(fresh(), 'ace', { aim: 0.95 });
  const late = race(fresh(), 'ace', { aim: 0.05 });
  assert.ok(early.time > 12_000 && early.time < 26_000, `sharp: ${early.time}`);
  assert.ok(late.time < MAX_RACE_MS, `laboured: ${late.time}`);
});

test('the pace settles instead of running away or dying', () => {
  // Quadratic drag is what makes this true. Against linear drag, cues pinned to
  // distance make impulse-per-second proportional to speed, and the race either
  // accelerates for ever or decays to nothing.
  const state = fresh();
  const a = state.athletes.ace;
  race(state, 'ace', { aim: 0.8, until: 6_000 });
  const early = a.v;
  race(state, 'ace', { aim: 0.8, until: 6_000 });
  assert.ok(a.v > 0.5, `the pace died: ${a.v}`);
  assert.ok(Math.abs(a.v - early) < 0.6, `the pace ran away: ${early} then ${a.v}`);
  assert.ok(a.v < 3.3, `past the ceiling: ${a.v}`);
});

test('letting an arrow go by is a miss, and it costs speed', () => {
  const state = fresh();
  const a = state.athletes.ace;
  race(state, 'ace', { aim: 0.8, until: 3_000 });
  const before = a.v;
  const beat = a.beat;

  // Swim on without pressing until the next arrow is behind us.
  let at = state.startsAt + 3_000;
  while (a.beat === beat && at < state.startsAt + 8_000) {
    swim.step(state, 0.03, at);
    at += 30;
  }
  assert.equal(a.beat, beat + 1, 'the passed arrow was never charged');
  assert.equal(a.hits.miss, 1);
  assert.ok(a.v < before, 'a miss was free');
  assert.equal(a.combo, 0);
});

test('a stroke at open water is a splash, and consumes no arrow', () => {
  const state = fresh();
  const a = state.athletes.ace;
  a.x = cueAt(0) - REACH_M - 0.2; // nothing within reach yet
  const beat = a.beat;
  const before = a.v;
  swim.applyInput(state, 'ace', { s: sideOf(state.sides, beat) }, state.startsAt + 1);
  assert.equal(a.beat, beat, 'a splash ate an arrow');
  assert.ok(a.v < before, 'a splash was free');
  assert.equal(a.last, 'splash');
});

test('hammering both buttons is punished, not rewarded', () => {
  const read = race(fresh(), 'ace', { aim: 0.8, until: 10_000 });

  const masher = fresh();
  const a = masher.athletes.ace;
  let at = masher.startsAt;
  let side = 0;
  while (at < masher.startsAt + 10_000 && !a.done) {
    swim.step(masher, 0.03, at);
    swim.applyInput(masher, 'ace', { s: side }, at);
    side = 1 - side;
    at += 30;
  }
  assert.ok(read.x > a.x, `mashing reached ${a.x}m against a reader's ${read.x}m`);
});

test('catching the wrong side costs speed and still spends the arrow', () => {
  const state = fresh();
  const a = state.athletes.ace;
  a.x = cueAt(0);
  const before = a.v;
  swim.applyInput(state, 'ace', { s: 1 - sideOf(state.sides, 0) }, state.startsAt + 1);
  assert.equal(a.beat, 1, 'a fumbled arrow stayed in the water');
  assert.equal(a.hits.wrong, 1);
  assert.ok(a.v < before);
});

test('a swimmer who never strokes glides to a halt', () => {
  const state = fresh();
  const a = state.athletes.ace;
  race(state, 'ace', { silent: true });
  assert.ok(!a.done, 'an idle swimmer finished the race');
  assert.ok(a.v < 0.5, `still moving at ${a.v}`);
  assert.ok(a.hits.miss > 0, 'gliding past arrows charged nothing');
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
  race(state, 'ace', { aim: 0.8, until: 3_000 });
  const wire = swim.snapshot(state);
  assert.deepEqual(Object.keys(wire).sort(), ['a', 'e', 's', 'sides']);
  assert.deepEqual(Object.keys(wire.a.ace).sort(), ['b', 'c', 'd', 'j', 'ja', 'l', 't', 'v', 'x']);
  assert.equal(Math.round(wire.a.ace.x * 100) / 100, wire.a.ace.x, 'x not quantized');
  assert.ok(wire.a.ace.b > 0, 'the cue pointer is not on the wire');
});

test('a strong bot swims cleanly, and a weak one swims slower', () => {
  const run = (difficulty) => {
    const state = fresh();
    const a = state.athletes.ace;
    let at = state.startsAt;
    while (at < state.startsAt + MAX_RACE_MS && !a.done) {
      const input = swim.botInput(state, 'ace', difficulty, at);
      if (input) swim.applyInput(state, 'ace', input, at);
      swim.step(state, 0.03, at);
      at += 30;
    }
    return a;
  };
  const strong = run(1);
  const weak = run(0);
  assert.equal(strong.hits.wrong, 0, 'the bot caught the wrong side');
  assert.ok(strong.x >= weak.x, `${strong.x} vs ${weak.x}`);
  assert.ok(strong.done, 'the strong bot never finished');
});

test('the same strokes always produce the same race', () => {
  const one = race(fresh(), 'ace', { aim: 0.8, until: 9_000 });
  const two = race(fresh(), 'ace', { aim: 0.8, until: 9_000 });
  assert.equal(one.x, two.x);
  assert.equal(one.beat, two.beat);
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
