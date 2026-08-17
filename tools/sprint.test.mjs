// Unit test for the 100m sim. Pure module, so no server and no sockets:
//   node tools/sprint.test.mjs

import assert from 'node:assert/strict';
import sprint, { COUNTDOWN_MS, MIN_STEP_INTERVAL_MS, RACE_DISTANCE } from '../shared/events/sprint_100m.js';
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

const T0 = 1_000_000;
const seats = [
  { playerId: 'alt', lane: 1 }, // alternates cleanly
  { playerId: 'mash', lane: 2 }, // hammers one foot
  { playerId: 'idle', lane: 3 }, // never taps
];

/**
 * Run a race deterministically: fixed 20 Hz steps, each runner tapping on its
 * own cadence. No wall clock anywhere — `now` is passed in, which is the whole
 * reason the sim can be replayed identically on a client.
 */
function race({ altGap = 110, mashGap = 110, durationMs = 20_000 } = {}) {
  const state = sprint.initState(seats, () => 0.5, T0);
  const tick = 50;
  const last = { alt: 0, mash: 0 };

  for (let now = T0; now <= T0 + COUNTDOWN_MS + durationMs; now += tick) {
    for (let sub = 0; sub < tick; sub += 5) {
      const at = now + sub;
      if (at - last.alt >= altGap) {
        const a = state.athletes.alt;
        sprint.applyInput(state, 'alt', { f: a.foot === 1 ? 0 : 1 }, at);
        last.alt = at;
      }
      if (at - last.mash >= mashGap) {
        sprint.applyInput(state, 'mash', { f: 1 }, at); // same foot, always
        last.mash = at;
      }
    }
    sprint.step(state, tick / 1000, now);
  }
  return state;
}

console.log('\n100m sim');

test('a clean alternating cadence finishes the 100m', () => {
  const state = race();
  assert.equal(state.athletes.alt.done, true, 'alternator did not finish');
  assert.equal(state.athletes.alt.x, RACE_DISTANCE);
});

test('finish time is in a plausible sprint range', () => {
  const { time } = race().athletes.alt;
  assert.ok(time > 9_000 && time < 16_000, `implausible time: ${time}ms`);
});

test('alternating beats mashing one foot', () => {
  const state = race();
  assert.ok(
    state.athletes.alt.x > state.athletes.mash.x,
    `mash ${state.athletes.mash.x} >= alt ${state.athletes.alt.x}`,
  );
});

test('a runner who never taps does not move', () => {
  assert.equal(race().athletes.idle.x, 0);
});

test('a step that comes too early breaks the stride instead of counting', () => {
  const state = sprint.initState(seats, () => 0.5, T0);
  const now = T0 + COUNTDOWN_MS + 1000;
  sprint.applyInput(state, 'alt', { f: 0 }, now);
  const afterFirst = state.athletes.alt.v;
  sprint.applyInput(state, 'alt', { f: 1 }, now + MIN_STEP_INTERVAL_MS - 5);
  assert.ok(state.athletes.alt.v < afterFirst, 'sub-threshold step was rewarded');
});

test('holding the button down never gets you moving', () => {
  const state = sprint.initState(seats, () => 0.5, T0);
  let now = T0 + COUNTDOWN_MS;
  for (let i = 0; i < 400; i += 1) {
    sprint.applyInput(state, 'alt', { f: i % 2 }, now);
    now += 5; // a key repeating far faster than a thumb can move
  }
  assert.ok(state.athletes.alt.v < 3, `spam reached ${state.athletes.alt.v} m/s`);
});

test('tapping at twice the ideal cadence is no faster than tapping at it', () => {
  const ideal = race({ altGap: 110 }).athletes.alt;
  const frantic = race({ altGap: 55 }).athletes.alt;
  // Impulse per second saturates, so the frantic runner must not gain more than
  // a rounding error. If this fails, spam beats skill.
  assert.ok(
    frantic.time >= ideal.time - 400,
    `frantic ${frantic.time}ms vs ideal ${ideal.time}ms`,
  );
});

test('tapping before the gun is a false start and adds nothing', () => {
  const state = sprint.initState(seats, () => 0.5, T0);
  sprint.applyInput(state, 'alt', { f: 0 }, T0 + 500);
  assert.equal(state.athletes.alt.v, 0);
  assert.equal(state.athletes.alt.falseStart, true);
});

test('a garbage payload cannot move a runner backwards or crash', () => {
  const state = sprint.initState(seats, () => 0.5, T0);
  const now = T0 + COUNTDOWN_MS + 1000;
  for (const bad of [null, undefined, {}, { f: 'left' }, { f: 99 }, { f: -1 }]) {
    sprint.applyInput(state, 'alt', bad, now + 200);
  }
  assert.ok(state.athletes.alt.x >= 0 && Number.isFinite(state.athletes.alt.v));
});

test('placements are finishers by time, then the rest by distance', () => {
  const order = sprint.placements(race());
  assert.deepEqual(order, ['alt', 'mash', 'idle']);
});

test('placements award 10 / 8 / 6', () => {
  const order = sprint.placements(race());
  assert.deepEqual(order.map((_, i) => pointsForPlacement(i)), [10, 8, 6]);
});

test('the wire snapshot is compact and quantized', () => {
  const state = race({ durationMs: 3_000 });
  const wire = sprint.snapshot(state);
  const x = wire.a.alt.x;
  assert.equal(Math.round(x * 100) / 100, x, 'x is not quantized to centimetres');
  assert.deepEqual(Object.keys(wire.a.alt).sort(), ['d', 'fs', 'l', 't', 'v', 'x']);
});

test('the same inputs always produce the same race', () => {
  const a = sprint.snapshot(race());
  const b = sprint.snapshot(race());
  assert.deepEqual(a, b, 'sim is not deterministic — client prediction would drift');
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
