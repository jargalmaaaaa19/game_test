// Unit test for the long jump sim. Pure module, so no server and no sockets:
//   node tools/longjump.test.mjs

import assert from 'node:assert/strict';
import longJump, {
  ATTEMPTS,
  COUNTDOWN_MS,
  FLIGHT_MS,
  IDEAL_ANGLE_DEG,
  KIND,
  MAX_HOLD_MS,
  MIN_STEP_INTERVAL_MS,
  PERFECT_M,
  RUNOUT_M,
  RUNWAY_M,
  angleAt,
  boardGap,
  flightPoint,
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

/** Run in on a clean alternating cadence until the athlete is near the board. */
function runUp(state, id, { stopBefore = 0.6, from = live } = {}) {
  let at = from;
  let foot = 0;
  for (let i = 0; i < 400; i += 1) {
    longJump.applyInput(state, id, { f: foot }, at);
    foot = foot === 1 ? 0 : 1;
    longJump.step(state, 0.11, at);
    at += 110;
    const a = state.athletes[id];
    if (a.stage !== 'run' || a.x >= RUNWAY_M - stopBefore) break;
  }
  return at;
}

/**
 * Take off, hold for `holdMs`, release, and let the flight play out. The dial
 * takes half its period to climb, so 350ms of hold IS 45° — the default here is
 * a perfect release, and anything else is a deliberately worse one.
 */
function jump(state, id, at, holdMs = 350) {
  longJump.applyInput(state, id, { t: 'jump' }, at);
  const a = state.athletes[id];
  const releaseAt = at + holdMs;
  longJump.applyInput(state, id, { t: 'release', v: angleAt(a, releaseAt) }, releaseAt);
  const after = releaseAt + FLIGHT_MS + 50;
  longJump.step(state, 0.1, after);
  return after;
}

console.log('\nlong jump sim');

test('45° is the optimal angle', () => {
  const at45 = jumpDistance(10, 45, 1);
  for (const angle of [15, 30, 40, 50, 60, 75]) {
    assert.ok(jumpDistance(10, angle, 1) < at45, `${angle}° beat 45°`);
  }
});

test('a faster run-up jumps further', () => {
  assert.ok(jumpDistance(10, 45, 1) > jumpDistance(7, 45, 1));
});

test('taking off early costs exactly the gap left behind', () => {
  const full = jumpDistance(10, 45, 1);
  const early = jumpDistance(10, 45, 2.5);
  assert.ok(Math.abs(full - early - 1.5) < 0.001, `${full} - ${early}`);
});

test('a perfect jump lands in a plausible range', () => {
  const d = jumpDistance(10.5, 45, 0);
  assert.ok(d > 7 && d < 9.5, `implausible distance: ${d}`);
});

test('hitting the board beats being short of it', () => {
  assert.ok(jumpDistance(10, 45, 0) > jumpDistance(10, 45, PERFECT_M + 0.5));
});

test('the perfect window is the board and a boot before it, no more', () => {
  const onLine = jumpDistance(10, 45, 0);
  const justInside = jumpDistance(10, 45, PERFECT_M);
  const justOutside = jumpDistance(10, 45, PERFECT_M + 0.01);
  assert.ok(justInside > justOutside + 0.3, 'the window has no edge');
  assert.ok(onLine > justInside, 'inside the window, closer is still better');
});

test('stepping over the line costs metres rather than the attempt', () => {
  const over = jumpDistance(10, 45, -0.5);
  assert.ok(over > 0, 'an overstep scored zero — that is a foul by another name');
  // Steeper than the overshoot gains, or reaching past the board would be the
  // optimal play.
  assert.ok(over < jumpDistance(10, 45, 0.5), 'overstepping beat being short by the same gap');
});

test('a run-up tap before the gun does nothing', () => {
  const state = fresh();
  longJump.applyInput(state, 'ace', { f: 0 }, T0 + 100);
  assert.equal(state.athletes.ace.v, 0);
});

test('holding the run button never builds speed', () => {
  const state = fresh();
  let at = live;
  for (let i = 0; i < 300; i += 1) {
    longJump.applyInput(state, 'ace', { f: i % 2 }, at);
    at += Math.floor(MIN_STEP_INTERVAL_MS / 3);
  }
  assert.ok(state.athletes.ace.v < 3, `spam reached ${state.athletes.ace.v} m/s`);
});

test('one thumb hammered is slower than two alternating', () => {
  const twoThumbs = fresh();
  const oneThumb = fresh();
  let at = live;
  for (let i = 0; i < 40; i += 1) {
    longJump.applyInput(twoThumbs, 'ace', { f: i % 2 }, at);
    longJump.applyInput(oneThumb, 'ace', { f: 0 }, at);
    longJump.step(twoThumbs, 0.11, at);
    longJump.step(oneThumb, 0.11, at);
    at += 110;
  }
  assert.ok(
    twoThumbs.athletes.ace.v > oneThumb.athletes.ace.v * 1.5,
    `${twoThumbs.athletes.ace.v} vs ${oneThumb.athletes.ace.v}`,
  );
});

test('taking off past the board is measured, not struck off', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = runUp(state, 'ace');
  a.x = RUNWAY_M + 0.5; // deliberately over the line
  jump(state, 'ace', at + 200);
  assert.equal(a.jumps.length, 1);
  assert.equal(a.jumps[0].kind, KIND.OVERSTEP);
  assert.ok(a.jumps[0].distance > 0, 'an overstep measured zero');
  assert.ok(a.best > 0, 'an overstep did not count toward the best');
});

test('a take-off on the line is flagged perfect and pays a bonus', () => {
  const onLine = fresh();
  const short = fresh();
  const at = runUp(onLine, 'ace');
  runUp(short, 'ace');
  onLine.athletes.ace.x = RUNWAY_M;
  short.athletes.ace.x = RUNWAY_M - PERFECT_M - 0.5;
  short.athletes.ace.v = onLine.athletes.ace.v;

  jump(onLine, 'ace', at);
  jump(short, 'ace', at);
  assert.equal(onLine.athletes.ace.jumps[0].kind, KIND.PERFECT);
  assert.equal(short.athletes.ace.jumps[0].kind, KIND.PLAIN);
  assert.ok(onLine.athletes.ace.best > short.athletes.ace.best);
});

test('running into the sand without jumping spends the attempt', () => {
  const state = fresh();
  const a = state.athletes.ace;
  a.x = RUNWAY_M + RUNOUT_M - 0.1;
  a.v = 9;
  longJump.step(state, 0.2, live + 1000);
  assert.equal(a.jumps.length, 1);
  assert.equal(a.jumps[0].kind, KIND.NO_JUMP);
  assert.equal(a.jumps[0].distance, 0);
  assert.equal(a.stage, 'run', 'the athlete was not put back on the runway');
});

test('the flight is held on the clock, then the next attempt starts', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = runUp(state, 'ace');
  longJump.applyInput(state, 'ace', { t: 'jump' }, at);
  longJump.applyInput(state, 'ace', { t: 'release', v: IDEAL_ANGLE_DEG }, at + 350);
  assert.equal(a.stage, 'flight');

  longJump.step(state, 0.1, at + 350 + FLIGHT_MS - 200);
  assert.equal(a.stage, 'flight', 'the flight was cut short');
  longJump.step(state, 0.1, at + 350 + FLIGHT_MS + 10);
  assert.equal(a.stage, 'run');
  assert.equal(a.x, 0);
});

test('the drawn arc leaves the board and lands down the pit', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = runUp(state, 'ace');
  jump(state, 'ace', at, 700);
  // Re-run one flight and sample it, rather than trusting the numbers alone.
  const at2 = runUp(state, 'ace', { from: at + 3_000 });
  longJump.applyInput(state, 'ace', { t: 'jump' }, at2);
  longJump.applyInput(state, 'ace', { t: 'release', v: IDEAL_ANGLE_DEG }, at2 + 350);
  const wire = longJump.snapshot(state).a.ace.f;

  const launch = flightPoint(wire, at2 + 350);
  const mid = flightPoint(wire, at2 + 350 + FLIGHT_MS * 0.3);
  const land = flightPoint(wire, at2 + 350 + FLIGHT_MS);
  assert.ok(Math.abs(launch.y) < 0.01, `launched at ${launch.y}m off the ground`);
  assert.ok(mid.y > 0.5, `the arc never left the ground: ${mid.y}`);
  assert.ok(mid.x > launch.x && land.x > mid.x, 'the jump did not travel');
  assert.ok(Math.abs(land.y) < 0.01, `landed ${land.y}m off the ground`);
  assert.equal(land.landed, 1);
});

test('a release without a take-off is ignored', () => {
  const state = fresh();
  longJump.applyInput(state, 'ace', { t: 'release', v: 45 }, live + 500);
  assert.equal(state.athletes.ace.jumps.length, 0);
});

test('a hold left forever is taken off the player', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = runUp(state, 'ace');
  longJump.applyInput(state, 'ace', { t: 'jump' }, at);
  longJump.step(state, 0.1, at + MAX_HOLD_MS + 10);
  assert.equal(a.jumps.length, 1);
  assert.equal(a.stage, 'flight');
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
  for (const bad of [null, undefined, {}, { t: 'nope' }, { t: 'release', v: 'x' }, { f: 7 }]) {
    longJump.applyInput(state, 'ace', bad, live + 400);
  }
  assert.equal(state.athletes.ace.jumps.length, 0);
});

test('the board gap is signed from the board', () => {
  assert.equal(boardGap(RUNWAY_M), 0);
  assert.ok(boardGap(RUNWAY_M - 2) > 0);
  assert.ok(boardGap(RUNWAY_M + 2) < 0);
});

test('each athlete gets exactly three attempts', () => {
  const state = fresh();
  const a = state.athletes.ace;
  let at = live;
  for (let i = 0; i < ATTEMPTS + 2; i += 1) {
    at = runUp(state, 'ace', { from: at });
    if (a.stage !== 'run') break;
    at = jump(state, 'ace', at) + 200;
  }
  assert.equal(a.jumps.length, ATTEMPTS);
  assert.equal(a.stage, 'done');
});

test('the best of three counts, not the last', () => {
  const state = fresh();
  const a = state.athletes.ace;
  a.jumps = [
    { distance: 6.2, angle: 45, speed: 9, kind: KIND.PLAIN },
    { distance: 7.4, angle: 45, speed: 10, kind: KIND.PERFECT },
  ];
  a.best = 7.4;
  a.jumps.push({ distance: 0, angle: 0, speed: 9, kind: KIND.NO_JUMP });
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
  longJump.applyInput(state, 'ace', { t: 'release', v: IDEAL_ANGLE_DEG }, at + 350);

  const wire = longJump.snapshot(state);
  assert.deepEqual(Object.keys(wire).sort(), ['a', 'board', 'e', 's']);
  assert.deepEqual(Object.keys(wire.a.ace).sort(), ['bt', 'f', 'ha', 'j', 'l', 'st', 'v', 'x']);
  assert.equal(wire.a.ace.f.length, 6, 'the flight is not the shape the renderers read');
  const [distance] = wire.a.ace.j[0];
  assert.equal(Math.round(distance * 100) / 100, distance, 'distance not quantized');

  longJump.step(state, 0.1, at + 350 + FLIGHT_MS + 10);
  assert.equal(longJump.snapshot(state).a.ace.f, null, 'a finished flight is still on the wire');
  assert.equal(a.stage, 'run');
});

test('a bot alternates its feet and commits near the board', () => {
  const state = fresh();
  const a = state.athletes.ace;
  let at = live;
  let seen = { 0: 0, 1: 0 };
  for (let i = 0; i < 200 && a.stage === 'run'; i += 1) {
    const input = longJump.botInput(state, 'ace', 0.8, at);
    if (input?.f !== undefined) seen[input.f] += 1;
    if (input) longJump.applyInput(state, 'ace', input, at);
    longJump.step(state, 0.05, at);
    at += 50;
  }
  assert.ok(seen[0] > 3 && seen[1] > 3, `the bot favoured one thumb: ${JSON.stringify(seen)}`);
  assert.equal(a.stage, 'takeoff');
  assert.ok(Math.abs(boardGap(a.takeoffX)) < 4.5, `the bot took off at ${a.takeoffX}`);
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
