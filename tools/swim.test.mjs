// Unit test for the 50m freestyle sim. Pure module, so no server and no
// sockets:  node tools/swim.test.mjs

import assert from 'node:assert/strict';
import swim, {
  BEAT_MS,
  COUNTDOWN_MS,
  DISTANCE_M,
  LEAD_IN_MS,
  TOTAL_BEATS,
  WINDOW,
  beatTime,
  judge,
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
  { playerId: 'sloppy', lane: 2 },
  { playerId: 'idle', lane: 3 },
];
const fresh = (rng = () => 0.5) => swim.initState(seats, rng, T0);

/**
 * Swim a whole race deterministically. `offset` is how far off the beat this
 * swimmer presses; `wrongEvery` makes them catch the wrong side periodically.
 */
function race(state, id, { offset = 0, wrongEvery = 0, silent = false } = {}) {
  const tick = 50;
  let strokes = 0;
  for (let now = state.startsAt; now <= state.endsAt; now += tick) {
    const a = state.athletes[id];
    if (!a.done && !silent && a.beat < TOTAL_BEATS) {
      const target = beatTime(state.startsAt, a.beat) + offset;
      if (now <= target && target < now + tick) {
        strokes += 1;
        const correct = sideOf(state.sides, a.beat);
        const wrong = wrongEvery && strokes % wrongEvery === 0;
        swim.applyInput(state, id, { s: wrong ? 1 - correct : correct }, target);
      }
    }
    swim.step(state, tick / 1000, now);
    if (state.athletes[id].done) break;
  }
  return state.athletes[id];
}

console.log('\n50m freestyle sim');

test('the beat grid is evenly spaced after the lead-in', () => {
  const state = fresh();
  assert.equal(beatTime(state.startsAt, 0), state.startsAt + LEAD_IN_MS);
  assert.equal(beatTime(state.startsAt, 3) - beatTime(state.startsAt, 2), BEAT_MS);
});

test('judgement windows widen from perfect to ok, then stop', () => {
  const state = fresh();
  const at = beatTime(state.startsAt, 0);
  assert.equal(judge(state.startsAt, 0, at), 'perfect');
  assert.equal(judge(state.startsAt, 0, at + WINDOW.perfect + 5), 'good');
  assert.equal(judge(state.startsAt, 0, at + WINDOW.good + 5), 'ok');
  assert.equal(judge(state.startsAt, 0, at + WINDOW.ok + 5), null);
});

test('the stroke pattern mostly alternates but is not a drum roll', () => {
  const state = fresh(() => 0.9); // always flips
  const alternating = state.sides.every((s, i) => i === 0 || s !== state.sides[i - 1]);
  assert.equal(alternating, true);

  const sticky = fresh(() => 0.1); // never flips
  assert.equal(sticky.sides.every((s) => s === sticky.sides[0]), true);
});

test('a swimmer on the beat finishes the 50m', () => {
  const a = race(fresh(), 'ace');
  assert.equal(a.done, true, `only reached ${a.x}m`);
  assert.equal(a.x, DISTANCE_M);
});

test('the finishing time is in a plausible range', () => {
  const { time } = race(fresh(), 'ace');
  assert.ok(time > 18_000 && time < 34_000, `implausible time: ${time}ms`);
});

test('perfect timing beats sloppy timing', () => {
  const perfect = race(fresh(), 'ace');
  const sloppy = race(fresh(), 'ace', { offset: WINDOW.good + 20 });
  assert.ok(perfect.time < sloppy.time, `${perfect.time} vs ${sloppy.time}`);
});

test('catching the wrong side costs more than a late stroke', () => {
  const late = race(fresh(), 'ace', { offset: WINDOW.perfect + 10 });
  const wrong = race(fresh(), 'ace', { wrongEvery: 3 });
  assert.ok(wrong.x <= late.x || wrong.time > late.time, `wrong ${wrong.time} vs late ${late.time}`);
});

test('a swimmer who never strokes does not move', () => {
  const a = race(fresh(), 'idle', { silent: true });
  assert.equal(a.x, 0);
  assert.equal(a.done, false);
});

test('missed beats are charged even when the player does nothing', () => {
  const state = fresh();
  race(state, 'idle', { silent: true });
  assert.ok(state.athletes.idle.hits.miss > 10, state.athletes.idle.hits);
});

test('hammering both buttons is punished, not rewarded', () => {
  const state = fresh();
  const onBeat = race(fresh(), 'ace');

  // Mash every 60ms, alternating sides regardless of the cue.
  let side = 0;
  const tick = 50;
  for (let now = state.startsAt; now <= state.endsAt; now += tick) {
    for (let k = 0; k < 1; k += 1) {
      swim.applyInput(state, 'sloppy', { s: side }, now + k * 25);
      side = 1 - side;
    }
    swim.step(state, tick / 1000, now);
    if (state.athletes.sloppy.done) break;
  }
  const masher = state.athletes.sloppy;
  assert.ok(
    !masher.done || masher.time > onBeat.time,
    `mashing matched the beat: ${masher.time} vs ${onBeat.time}`,
  );
});

test('a garbage payload cannot move a swimmer or crash', () => {
  const state = fresh();
  const at = beatTime(state.startsAt, 0);
  for (const bad of [null, undefined, {}, { s: 'left' }, { s: 7 }, { s: -1 }]) {
    swim.applyInput(state, 'ace', bad, at);
  }
  assert.equal(state.athletes.ace.x, 0);
  assert.ok(Number.isFinite(state.athletes.ace.v));
});

test('placements are finishers by time, then the rest by distance', () => {
  const state = fresh();
  race(state, 'ace');
  race(state, 'sloppy', { offset: WINDOW.good + 30 });
  const order = swim.placements(state);
  assert.equal(order[0], 'ace', JSON.stringify(order));
  assert.equal(order[2], 'idle');
});

test('placements award 10 / 8 / 6', () => {
  const state = fresh();
  assert.deepEqual(swim.placements(state).map((_, i) => pointsForPlacement(i)), [10, 8, 6]);
});

test('the wire snapshot is compact and quantized', () => {
  const state = fresh();
  race(state, 'ace');
  const wire = swim.snapshot(state);
  assert.deepEqual(Object.keys(wire).sort(), ['a', 'e', 's', 'sides']);
  assert.deepEqual(Object.keys(wire.a.ace).sort(), ['b', 'c', 'd', 'j', 'ja', 'l', 't', 'v', 'x']);
  assert.equal(Math.round(wire.a.ace.x * 100) / 100, wire.a.ace.x);
});

test('the same strokes always produce the same race', () => {
  const a = swim.snapshot(fresh()).sides;
  const b = swim.snapshot(fresh()).sides;
  assert.deepEqual(a, b, 'stroke pattern is not deterministic');
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
