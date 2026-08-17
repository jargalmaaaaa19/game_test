// Unit test for the long jump sim. Pure module, so no server and no sockets:
//   node tools/longjump.test.mjs

import assert from 'node:assert/strict';
import longJump, {
  ATTEMPTS,
  COUNTDOWN_MS,
  IDEAL_ANGLE_DEG,
  MIN_STEP_INTERVAL_MS,
  RUNWAY_M,
  angleAt,
  jumpDistance,
} from '../shared/events/long_jump.js';
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

const T0 = 3_000_000;
const seats = [
  { playerId: 'ace', lane: 1 },
  { playerId: 'ok', lane: 2 },
  { playerId: 'idle', lane: 3 },
];
const fresh = () => longJump.initState(seats, () => 0.5, T0);
const live = T0 + COUNTDOWN_MS + 1;

/** Tap the run button on a clean cadence until the athlete is near the board. */
function runUp(state, id, { stopBefore = 0.6, from = live } = {}) {
  let at = from;
  for (let i = 0; i < 400; i += 1) {
    longJump.applyInput(state, id, { t: 'run' }, at);
    longJump.step(state, 0.11, at);
    at += 110;
    const a = state.athletes[id];
    if (a.stage !== 'run' || a.x >= RUNWAY_M - stopBefore) break;
  }
  return at;
}

console.log('\nlong jump sim');

test('45° is the optimal angle', () => {
  const at45 = jumpDistance(10, 45, 0);
  for (const angle of [15, 30, 40, 50, 60, 75]) {
    assert.ok(jumpDistance(10, angle, 0) < at45, `${angle}° beat 45°`);
  }
});

test('a faster run-up jumps further', () => {
  assert.ok(jumpDistance(10, 45, 0) > jumpDistance(7, 45, 0));
});

test('taking off early costs exactly the gap left behind', () => {
  const full = jumpDistance(10, 45, 0);
  const early = jumpDistance(10, 45, 1.5);
  assert.ok(Math.abs(full - early - 1.5) < 0.001, `${full} - ${early}`);
});

test('a perfect jump lands in a plausible range', () => {
  const d = jumpDistance(10.5, 45, 0);
  assert.ok(d > 7 && d < 9.5, `implausible distance: ${d}`);
});

test('a run-up tap before the gun does nothing', () => {
  const state = fresh();
  longJump.applyInput(state, 'ace', { t: 'run' }, T0 + 100);
  assert.equal(state.athletes.ace.v, 0);
});

test('holding the run button never builds speed', () => {
  const state = fresh();
  let at = live;
  for (let i = 0; i < 300; i += 1) {
    longJump.applyInput(state, 'ace', { t: 'run' }, at);
    at += Math.floor(MIN_STEP_INTERVAL_MS / 3);
  }
  assert.ok(state.athletes.ace.v < 3, `spam reached ${state.athletes.ace.v} m/s`);
});

test('taking off past the board is a foul worth zero', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = runUp(state, 'ace', { stopBefore: -3 }); // deliberately overrun
  a.x = RUNWAY_M + 0.5;
  a.stage = 'run';
  longJump.applyInput(state, 'ace', { t: 'jump' }, at + 500);
  assert.equal(a.jumps.at(-1).foul, true);
  assert.equal(a.jumps.at(-1).distance, 0);
});

test('running through the board without jumping is also a foul', () => {
  const state = fresh();
  const a = state.athletes.ace;
  a.x = RUNWAY_M + 1.0;
  a.v = 9;
  longJump.step(state, 0.2, live + 1000);
  assert.equal(a.jumps.length, 1);
  assert.equal(a.jumps[0].foul, true);
});

test('a release without a take-off is ignored', () => {
  const state = fresh();
  longJump.applyInput(state, 'ace', { t: 'release', v: 45 }, live + 500);
  assert.equal(state.athletes.ace.jumps.length, 0);
});

test('a forged release angle is replaced by the server’s dial', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = runUp(state, 'ace');
  longJump.applyInput(state, 'ace', { t: 'jump' }, at);
  assert.equal(a.stage, 'takeoff');

  const when = at + 900;
  const server = angleAt(a, when);
  longJump.applyInput(state, 'ace', { t: 'release', v: server + 80 }, when);
  assert.ok(
    Math.abs(a.jumps.at(-1).angle - server) <= 1,
    `forged angle accepted: ${a.jumps.at(-1).angle} vs ${server}`,
  );
});

test('a garbage payload cannot jump or crash', () => {
  const state = fresh();
  for (const bad of [null, undefined, {}, { t: 'nope' }, { t: 'release', v: 'x' }]) {
    longJump.applyInput(state, 'ace', bad, live + 400);
  }
  assert.equal(state.athletes.ace.jumps.length, 0);
});

test('each athlete gets exactly three attempts', () => {
  const state = fresh();
  const a = state.athletes.ace;
  let at = live;
  for (let i = 0; i < ATTEMPTS + 2; i += 1) {
    at = runUp(state, 'ace', { from: at });
    if (a.stage !== 'run') break;
    longJump.applyInput(state, 'ace', { t: 'jump' }, at);
    at += 700;
    longJump.applyInput(state, 'ace', { t: 'release', v: angleAt(a, at) }, at);
    at += 300;
  }
  assert.equal(a.jumps.length, ATTEMPTS);
  assert.equal(a.stage, 'done');
});

test('the best of three counts, not the last', () => {
  const state = fresh();
  const a = state.athletes.ace;
  a.jumps = [
    { distance: 6.2, angle: 45, speed: 9, foul: false },
    { distance: 7.4, angle: 45, speed: 10, foul: false },
  ];
  a.best = 7.4;
  a.jumps.push({ distance: 0, angle: 0, speed: 9, foul: true });
  assert.equal(a.best, 7.4);
});

test('a longer best wins, and an athlete who never jumps comes last', () => {
  const state = fresh();
  state.athletes.ace.best = 7.1;
  state.athletes.ok.best = 5.4;
  const order = longJump.placements(state);
  assert.deepEqual(order, ['ace', 'ok', 'idle']);
  assert.equal(state.athletes.idle.best, 0);
});

test('placements award 10 / 8 / 6', () => {
  const state = fresh();
  assert.deepEqual(longJump.placements(state).map((_, i) => pointsForPlacement(i)), [10, 8, 6]);
});

test('the wire snapshot is compact and quantized', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = runUp(state, 'ace');
  longJump.applyInput(state, 'ace', { t: 'jump' }, at);
  longJump.applyInput(state, 'ace', { t: 'release', v: IDEAL_ANGLE_DEG }, at + 700);

  const wire = longJump.snapshot(state);
  assert.deepEqual(Object.keys(wire).sort(), ['a', 'board', 'e', 's']);
  assert.deepEqual(Object.keys(wire.a.ace).sort(), ['bt', 'ha', 'j', 'l', 'st', 'v', 'x']);
  const [distance] = wire.a.ace.j[0];
  assert.equal(Math.round(distance * 100) / 100, distance, 'distance not quantized');
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
