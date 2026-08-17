// Unit test for the archery sim. Pure module, so no server and no sockets:
//   node tools/archery.test.mjs

import assert from 'node:assert/strict';
import archery, {
  ARROWS_PER_ATHLETE,
  COUNTDOWN_MS,
  aimAt,
  landing,
  powerAt,
  ringScore,
} from '../shared/events/archery.js';
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

const T0 = 2_000_000;
const seats = [
  { playerId: 'ace', lane: 1 },
  { playerId: 'ok', lane: 2 },
  { playerId: 'idle', lane: 3 },
];

// A deterministic "rng" so the winds are known: x = 2*0.5-1 = 0, y = 0.5-0.5 = 0
const noWind = () => 0.5;
const fresh = (rng = noWind) => archery.initState(seats, rng, T0);
const live = T0 + COUNTDOWN_MS + 1;

/** Fire one arrow with exact values, bypassing the sweep by matching it. */
function shoot(state, id, aim, power, at) {
  const a = state.athletes[id];
  // Feed the server the value its own clock would read, offset to the target:
  // applyInput bounds the client value against the sweep, so tests must aim
  // within tolerance of it — same rule a real client plays under.
  const serverAim = aimAt(a, at);
  archery.applyInput(state, id, { t: 'aim', v: clampNear(aim, serverAim, 0.35) }, at);
  const at2 = at + 200;
  const serverPower = powerAt(a, at2);
  archery.applyInput(state, id, { t: 'power', v: clampNear(power, serverPower, 0.3) }, at2);
  return at2 + 200;
}

const clampNear = (want, server, tol) =>
  Math.max(server - tol, Math.min(server + tol, want));

console.log('\narchery sim');

test('the bullseye scores 10 and the rim scores 1', () => {
  assert.equal(ringScore(0), 10);
  assert.equal(ringScore(0.05), 10);
  assert.equal(ringScore(0.15), 9);
  assert.equal(ringScore(0.95), 1);
});

test('a miss scores 0', () => {
  assert.equal(ringScore(1), 0);
  assert.equal(ringScore(3.2), 0);
  assert.equal(ringScore(NaN), 0);
});

test('every ring from 10 down to 1 is reachable', () => {
  const seen = new Set();
  for (let r = 0; r < 1; r += 0.01) seen.add(ringScore(r));
  assert.deepEqual([...seen].sort((a, b) => b - a), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
});

test('wind pushes the arrow off centre', () => {
  const calm = landing(0, 0.72, { x: 0, y: 0 });
  const gusty = landing(0, 0.72, { x: 0.8, y: 0 });
  assert.ok(Math.abs(calm.dx) < 0.001, `calm shot drifted: ${calm.dx}`);
  assert.ok(gusty.dx > 0.3, `wind did nothing: ${gusty.dx}`);
});

test('aiming into the wind cancels it', () => {
  const wind = { x: 0.6, y: 0 };
  const power = 0.72;
  const aim = -(wind.x * 0.55) / power / 0.9; // solve dx = 0
  const shot = landing(aim, power, wind);
  assert.ok(Math.abs(shot.dx) < 0.02, `compensation failed: ${shot.dx}`);
});

test('under- and over-powering miss high and low in opposite directions', () => {
  const weak = landing(0, 0.5, { x: 0, y: 0 });
  const strong = landing(0, 0.95, { x: 0, y: 0 });
  assert.ok(weak.dy > 0.3, `weak shot did not drop: ${weak.dy}`);
  assert.ok(strong.dy < -0.3, `strong shot did not fly high: ${strong.dy}`);
});

test('a shot before the gun is ignored', () => {
  const state = fresh();
  archery.applyInput(state, 'ace', { t: 'aim', v: 0 }, T0 + 100);
  assert.equal(state.athletes.ace.stage, 'aim');
  assert.equal(state.athletes.ace.shots.length, 0);
});

test('power before angle is ignored — the stages cannot be skipped', () => {
  const state = fresh();
  archery.applyInput(state, 'ace', { t: 'power', v: 0.72 }, live);
  assert.equal(state.athletes.ace.shots.length, 0);
  assert.equal(state.athletes.ace.stage, 'aim');
});

test('a double tap inside the guard window does not fire twice', () => {
  const state = fresh();
  archery.applyInput(state, 'ace', { t: 'aim', v: 0 }, live);
  const stage = state.athletes.ace.stage;
  archery.applyInput(state, 'ace', { t: 'power', v: 0.72 }, live + 10);
  assert.equal(state.athletes.ace.stage, stage, 'second tap inside 120ms was accepted');
});

test('a client value far from the sweep is replaced by the server’s', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const server = aimAt(a, live);
  archery.applyInput(state, 'ace', { t: 'aim', v: server + 5 }, live); // an impossible claim
  assert.ok(Math.abs(a.aim - server) < 0.001, `forged aim accepted: ${a.aim} vs ${server}`);
});

test('a garbage payload cannot fire or crash', () => {
  const state = fresh();
  for (const bad of [null, undefined, {}, { t: 'aim', v: 'x' }, { t: 'nope', v: 0 }]) {
    archery.applyInput(state, 'ace', bad, live + 1000);
  }
  assert.equal(state.athletes.ace.shots.length, 0);
});

test('each athlete fires exactly three arrows, then is done', () => {
  const state = fresh();
  let at = live;
  for (let i = 0; i < ARROWS_PER_ATHLETE + 2; i += 1) at = shoot(state, 'ace', 0, 0.72, at);
  assert.equal(state.athletes.ace.shots.length, ARROWS_PER_ATHLETE);
  assert.equal(state.athletes.ace.stage, 'done');
});

test('the round ends once everyone has shot', () => {
  const state = fresh();
  let at = live;
  for (const id of ['ace', 'ok', 'idle']) {
    for (let i = 0; i < ARROWS_PER_ATHLETE; i += 1) at = shoot(state, id, 0, 0.72, at);
  }
  assert.equal(archery.isFinished(state, at), true);
});

test('everyone shoots the same three winds', () => {
  const state = fresh(() => 0.9);
  assert.equal(state.winds.length, ARROWS_PER_ATHLETE);
  assert.ok(state.winds.every((w) => Number.isFinite(w.x) && Number.isFinite(w.y)));
});

test('a higher total wins, and an athlete who never shoots comes last', () => {
  const state = fresh();
  let at = live;
  for (let i = 0; i < ARROWS_PER_ATHLETE; i += 1) at = shoot(state, 'ace', 0, 0.72, at);
  for (let i = 0; i < ARROWS_PER_ATHLETE; i += 1) at = shoot(state, 'ok', -0.9, 0.45, at);

  const order = archery.placements(state);
  assert.equal(order[0], 'ace', JSON.stringify(order.map((id) => [id, state.athletes[id].score])));
  assert.equal(order[2], 'idle');
  assert.equal(state.athletes.idle.score, 0);
});

test('placements award 10 / 8 / 6', () => {
  const state = fresh();
  assert.deepEqual(archery.placements(state).map((_, i) => pointsForPlacement(i)), [10, 8, 6]);
});

test('the wire snapshot is compact and quantized', () => {
  const state = fresh();
  shoot(state, 'ace', 0, 0.72, live);
  const wire = archery.snapshot(state);
  assert.deepEqual(Object.keys(wire).sort(), ['a', 'e', 's', 'w']);
  assert.deepEqual(Object.keys(wire.a.ace).sort(), ['am', 'l', 'sa', 'sc', 'sh', 'st']);
  const [dx] = wire.a.ace.sh[0];
  assert.equal(Math.round(dx * 100) / 100, dx, 'landing not quantized');
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
