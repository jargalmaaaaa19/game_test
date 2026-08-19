// Unit test for the archery sim. Pure module, so no server and no sockets:
//   node tools/archery.test.mjs

import assert from 'node:assert/strict';
import archery, {
  ARROWS_PER_ATHLETE,
  COUNTDOWN_MS,
  AIM_REACH,
  aimThatCancels,
  landing,
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

/** Loose one arrow at a stick position, returning a time past the guard. */
function shoot(state, id, aim, at) {
  archery.applyInput(state, id, aim, at);
  return at + 400;
}

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
  const calm = landing({ x: 0, y: 0 }, { x: 0, y: 0 });
  const gusty = landing({ x: 0, y: 0 }, { x: 0.8, y: 0 });
  assert.ok(Math.abs(calm.dx) < 0.001, `calm shot drifted: ${calm.dx}`);
  assert.ok(gusty.dx > 0.3, `wind did nothing: ${gusty.dx}`);
});

test('leaning into the wind cancels it, in both axes', () => {
  for (const wind of [{ x: 0.6, y: 0 }, { x: -0.9, y: 0.4 }, { x: 0.2, y: -0.5 }]) {
    const shot = landing(aimThatCancels(wind), wind);
    assert.ok(Math.hypot(shot.dx, shot.dy) < 0.02, `${JSON.stringify(wind)}`);
  }
});

test('the reticle is where you point', () => {
  const right = landing({ x: 0.5, y: 0 }, { x: 0, y: 0 });
  const up = landing({ x: 0, y: 0.5 }, { x: 0, y: 0 });
  assert.ok(Math.abs(right.dx - 0.5 * AIM_REACH) < 1e-9, `x: ${right.dx}`);
  assert.ok(Math.abs(up.dy - 0.5 * AIM_REACH) < 1e-9, `y: ${up.dy}`);
});

test('the stick cannot reach further than its own range', () => {
  const yanked = landing({ x: 40, y: -40 }, { x: 0, y: 0 });
  assert.ok(Math.abs(yanked.dx) <= AIM_REACH + 1e-9, `x escaped: ${yanked.dx}`);
  assert.ok(Math.abs(yanked.dy) <= AIM_REACH + 1e-9, `y escaped: ${yanked.dy}`);
});

test('doing nothing still puts an arrow on the target in a calm wind', () => {
  // The forgiving floor. This is a party game: a player who never touches the
  // stick must still score rather than be handed a zero.
  const state = fresh();
  shoot(state, 'ace', { x: 0, y: 0 }, live);
  assert.equal(state.athletes.ace.shots[0].score, 10);
});

test('a shot before the gun is ignored', () => {
  const state = fresh();
  archery.applyInput(state, 'ace', { x: 0, y: 0 }, T0 + 100);
  assert.equal(state.athletes.ace.shots.length, 0);
});

test('a double press inside the guard window does not loose twice', () => {
  const state = fresh();
  archery.applyInput(state, 'ace', { x: 0, y: 0 }, live);
  archery.applyInput(state, 'ace', { x: 0, y: 0 }, live + 10);
  assert.equal(state.athletes.ace.shots.length, 1, 'a second press inside the guard was taken');
});

test('a garbage payload cannot crash, and is a shot down the middle', () => {
  const state = fresh();
  for (const bad of [null, undefined]) {
    archery.applyInput(state, 'ace', bad, live + 1000);
  }
  assert.equal(state.athletes.ace.shots.length, 0);

  // Nonsense axes are neither a crash nor a cheat: a zero aim is the middle,
  // which is exactly what an absent aim should mean.
  archery.applyInput(state, 'ace', { x: 'x', y: null }, live + 2000);
  assert.equal(state.athletes.ace.shots.length, 1);
  assert.equal(state.athletes.ace.shots[0].score, 10);
});

test('each athlete fires exactly three arrows, then is done', () => {
  const state = fresh();
  let at = live;
  for (let i = 0; i < ARROWS_PER_ATHLETE + 2; i += 1) at = shoot(state, 'ace', { x: 0, y: 0 }, at);
  assert.equal(state.athletes.ace.shots.length, ARROWS_PER_ATHLETE);
  assert.equal(state.athletes.ace.done, true);
});

test('the round ends once everyone has shot', () => {
  const state = fresh();
  let at = live;
  for (const id of ['ace', 'ok', 'idle']) {
    for (let i = 0; i < ARROWS_PER_ATHLETE; i += 1) at = shoot(state, id, { x: 0, y: 0 }, at);
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
  for (let i = 0; i < ARROWS_PER_ATHLETE; i += 1) at = shoot(state, 'ace', { x: 0, y: 0 }, at);
  for (let i = 0; i < ARROWS_PER_ATHLETE; i += 1) at = shoot(state, 'ok', { x: -0.95, y: 0.8 }, at);

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
  shoot(state, 'ace', { x: 0, y: 0 }, live);
  const wire = archery.snapshot(state);
  assert.deepEqual(Object.keys(wire).sort(), ['a', 'e', 's', 'w']);
  assert.deepEqual(Object.keys(wire.a.ace).sort(), ['d', 'l', 'sc', 'sh']);
  const [dx] = wire.a.ace.sh[0];
  assert.equal(Math.round(dx * 100) / 100, dx, 'landing not quantized');
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
