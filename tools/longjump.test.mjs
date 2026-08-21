// Unit test for the long jump sim. Pure module, so no server and no sockets:
//   node tools/longjump.test.mjs

import assert from 'node:assert/strict';
import longJump, {
  ATTEMPTS,
  CLAIM_REACH_M,
  COUNTDOWN_MS,
  FLIGHT_MS,
  GAUGE_M,
  GOOD_FACTOR,
  KIND,
  MIN_STEP_INTERVAL_MS,
  PERFECT_M,
  RUNOUT_M,
  RUNWAY_M,
  flightPoint,
  jumpDistance,
  zoneAt,
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

/** Run in on a clean alternating cadence until the athlete is near the line. */
function runUp(state, id, { stopBefore = 0.3, from = live } = {}) {
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

/** Press the jump button from wherever the athlete is, and let the flight run. */
function jump(state, id, at) {
  longJump.applyInput(state, id, { t: 'jump' }, at);
  const after = at + FLIGHT_MS + 50;
  longJump.step(state, 0.1, after);
  return after;
}

console.log('\nlong jump sim');

test('the gauge names the band the athlete is standing in', () => {
  assert.equal(zoneAt(RUNWAY_M), 'perfect');
  assert.equal(zoneAt(RUNWAY_M - PERFECT_M), 'perfect'); // the edge is inclusive
  assert.equal(zoneAt(RUNWAY_M - PERFECT_M - 0.01), 'good');
  assert.equal(zoneAt(RUNWAY_M - GAUGE_M), 'good');
  assert.equal(zoneAt(RUNWAY_M - GAUGE_M - 0.01), 'early');
  assert.equal(zoneAt(RUNWAY_M + 0.01), 'foul');
});

test('green pays the full speed, orange three quarters of it', () => {
  const green = jumpDistance(10, KIND.PERFECT);
  const orange = jumpDistance(10, KIND.GOOD);
  assert.ok(Math.abs(orange - jumpDistance(10 * GOOD_FACTOR, KIND.PERFECT)) < 1e-9);
  assert.ok(orange < green * 0.6, `orange is not a real cost: ${orange} vs ${green}`);
});

test('a faster run-up jumps further, in both bands', () => {
  assert.ok(jumpDistance(10, KIND.PERFECT) > jumpDistance(7, KIND.PERFECT));
  assert.ok(jumpDistance(10, KIND.GOOD) > jumpDistance(7, KIND.GOOD));
});

test('a foul measures nothing at any speed', () => {
  assert.equal(jumpDistance(10.5, KIND.FOUL), 0);
  assert.equal(jumpDistance(0, KIND.FOUL), 0);
});

test('a perfect jump lands in a plausible range', () => {
  const d = jumpDistance(10.5, KIND.PERFECT);
  assert.ok(d > 7 && d < 9.5, `implausible distance: ${d}`);
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

test('pressing before the gauge wakes up is ignored, not scored', () => {
  const state = fresh();
  const a = state.athletes.ace;
  runUp(state, 'ace', { stopBefore: GAUGE_M + 2 });
  assert.equal(zoneAt(a.x), 'early');
  longJump.applyInput(state, 'ace', { t: 'jump' }, live + 5_000);
  assert.equal(a.jumps.length, 0, 'an out-of-range press took an attempt');
  assert.equal(a.stage, 'run');
});

test('a press in the green band is a perfect jump', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = runUp(state, 'ace');
  a.x = RUNWAY_M - PERFECT_M / 2;
  jump(state, 'ace', at + 50);
  assert.equal(a.jumps[0][1] ?? a.jumps[0].kind, KIND.PERFECT);
  assert.ok(a.jumps[0].distance > 0);
});

test('a press in the orange band scores, and scores less', () => {
  const green = fresh();
  const orange = fresh();
  const at = runUp(green, 'ace');
  runUp(orange, 'ace');
  orange.athletes.ace.v = green.athletes.ace.v; // same run-up, different press
  green.athletes.ace.x = RUNWAY_M - PERFECT_M / 2;
  orange.athletes.ace.x = RUNWAY_M - GAUGE_M + 0.1;

  jump(green, 'ace', at + 50);
  jump(orange, 'ace', at + 50);
  assert.equal(orange.athletes.ace.jumps[0].kind, KIND.GOOD);
  assert.ok(orange.athletes.ace.best > 0, 'orange scored nothing');
  assert.ok(green.athletes.ace.best > orange.athletes.ace.best);
});

test('the distance is the speed and the band, and nothing else', () => {
  // Two presses in the same band from different marks must measure the same:
  // the old version subtracted the gap, and a gauge cannot honestly draw that.
  const near = fresh();
  const far = fresh();
  const at = runUp(near, 'ace');
  runUp(far, 'ace');
  far.athletes.ace.v = near.athletes.ace.v;
  near.athletes.ace.x = RUNWAY_M - 0.1;
  far.athletes.ace.x = RUNWAY_M - PERFECT_M;
  jump(near, 'ace', at + 50);
  jump(far, 'ace', at + 50);
  assert.equal(near.athletes.ace.best, far.athletes.ace.best);
});

test('over the line is a failed attempt worth zero', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = runUp(state, 'ace');
  a.x = RUNWAY_M + 0.4; // over the white line
  jump(state, 'ace', at + 50);
  assert.equal(a.jumps.length, 1);
  assert.equal(a.jumps[0].kind, KIND.FOUL);
  assert.equal(a.jumps[0].distance, 0);
  assert.equal(a.best, 0);
});

test('running past the line without pressing fails the same way', () => {
  const state = fresh();
  const a = state.athletes.ace;
  a.x = RUNWAY_M + RUNOUT_M - 0.1;
  a.v = 9;
  longJump.step(state, 0.2, live + 1000);
  assert.equal(a.jumps.length, 1);
  assert.equal(a.jumps[0].kind, KIND.FOUL);
  assert.equal(a.stage, 'flight', 'the failure was not held on screen');
});

test('the flight is held on the clock, then the next attempt starts', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = runUp(state, 'ace');
  longJump.applyInput(state, 'ace', { t: 'jump' }, at);
  assert.equal(a.stage, 'flight');

  longJump.step(state, 0.1, at + FLIGHT_MS - 200);
  assert.equal(a.stage, 'flight', 'the flight was cut short');
  longJump.step(state, 0.1, at + FLIGHT_MS + 10);
  assert.equal(a.stage, 'run');
  assert.equal(a.x, 0);
});

test('the drawn arc leaves the line and lands down the pit', () => {
  const state = fresh();
  const at = runUp(state, 'ace');
  state.athletes.ace.x = RUNWAY_M - 0.2; // green, wherever the run-up stopped
  longJump.applyInput(state, 'ace', { t: 'jump' }, at);
  const wire = longJump.snapshot(state).a.ace.f;

  const launch = flightPoint(wire, at);
  const mid = flightPoint(wire, at + FLIGHT_MS * 0.3);
  const land = flightPoint(wire, at + FLIGHT_MS);
  assert.ok(Math.abs(launch.y) < 0.01, `launched at ${launch.y}m off the ground`);
  assert.ok(mid.y > 0.5, `the arc never left the ground: ${mid.y}`);
  assert.ok(mid.x > launch.x && land.x > mid.x, 'the jump did not travel');
  assert.ok(Math.abs(land.y) < 0.01, `landed ${land.y}m off the ground`);
  assert.equal(land.landed, 1);
});

test('a failed attempt holds the athlete where they blew it', () => {
  const state = fresh();
  const a = state.athletes.ace;
  const at = runUp(state, 'ace');
  a.x = RUNWAY_M + 0.4;
  longJump.applyInput(state, 'ace', { t: 'jump' }, at);
  const wire = longJump.snapshot(state).a.ace.f;
  const mid = flightPoint(wire, at + FLIGHT_MS * 0.3);
  assert.equal(mid.y, 0, 'a foul was drawn flying');
  assert.ok(Math.abs(mid.x - (RUNWAY_M + 0.4)) < 0.02, `a foul travelled to ${mid.x}`);
});

test('a garbage payload cannot jump or crash', () => {
  const state = fresh();
  for (const bad of [null, undefined, {}, { t: 'nope' }, { t: 'release', v: 45 }, { f: 7 }]) {
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
    at = jump(state, 'ace', at) + 200;
  }
  assert.equal(a.jumps.length, ATTEMPTS);
  assert.equal(a.stage, 'done');
});

test('the best of three counts, not the last', () => {
  const state = fresh();
  const a = state.athletes.ace;
  a.jumps = [
    { distance: 6.2, kind: KIND.GOOD, speed: 9 },
    { distance: 7.4, kind: KIND.PERFECT, speed: 10 },
  ];
  a.best = 7.4;
  a.jumps.push({ distance: 0, kind: KIND.FOUL, speed: 9 });
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

  const wire = longJump.snapshot(state);
  assert.deepEqual(Object.keys(wire).sort(), ['a', 'board', 'e', 's']);
  assert.deepEqual(Object.keys(wire.a.ace).sort(), ['bt', 'f', 'j', 'l', 'st', 'v', 'x']);
  assert.equal(wire.a.ace.f.length, 5, 'the flight is not the shape the renderers read');
  assert.equal(wire.a.ace.j[0].length, 2, 'a jump on the wire is distance and kind');
  const [distance] = wire.a.ace.j[0];
  assert.equal(Math.round(distance * 100) / 100, distance, 'distance not quantized');

  longJump.step(state, 0.1, at + FLIGHT_MS + 10);
  assert.equal(longJump.snapshot(state).a.ace.f, null, 'a finished flight is still on the wire');
  assert.equal(a.stage, 'run');
});

/** A full round of three attempts at the given skill, and what they were worth. */
function botRound(difficulty, id = 'ace') {
  const state = fresh();
  const a = state.athletes[id];
  let at = live;
  for (let i = 0; i < 2_000 && a.stage !== 'done'; i += 1) {
    const input = longJump.botInput(state, id, difficulty, at);
    if (input) longJump.applyInput(state, id, input, at);
    longJump.step(state, 0.05, at);
    at += 50;
  }
  return a;
}

test('a take-off is judged where the player pressed, not where the packet found them', () => {
  // The client runs the athlete in itself so the strides feel instant, which
  // leaves its picture a one-way trip ahead of the server's. Judged here, a
  // press made on green is scored from a mark still short of the gauge — and
  // an 'early' press is ignored outright, so the athlete runs through the
  // board and fouls. That is two of the three attempts gone on a slow link.
  const state = fresh();
  const a = state.athletes.ace;
  a.v = 10.5;
  // A quarter of a second of one-way latency at racing pace: two and a half
  // metres of runway, and the green band is one and a half wide. This server
  // has them in orange; the player is looking at green.
  const pressedAt = RUNWAY_M - PERFECT_M / 2;
  a.x = pressedAt - 2.5;
  assert.equal(zoneAt(a.x), 'good', 'the lag under test does not cross a band');
  assert.equal(zoneAt(pressedAt), 'perfect');

  longJump.applyInput(state, 'ace', { t: 'jump', x: pressedAt }, live);
  assert.equal(a.jumps.length, 1, 'the press was ignored as early');
  assert.equal(a.jumps[0].kind, KIND.PERFECT, 'a green press was scored as something else');
  assert.equal(a.flight.fromX, pressedAt, 'the arc did not start where they took off');
  assert.equal(a.x, pressedAt, 'the athlete was left behind their own take-off');
});

test('a claimed take-off cannot rewind, or outrun the runway', () => {
  // Forward, only as far as the athlete could plausibly have got since our last
  // word — and never backwards, which would be a way to step out of a foul.
  const beyond = (x, claim) => {
    const state = fresh();
    const a = state.athletes.ace;
    a.v = 9;
    a.x = x;
    longJump.applyInput(state, 'ace', { t: 'jump', x: claim }, live);
    return a;
  };

  const far = beyond(RUNWAY_M - GAUGE_M, RUNWAY_M + 50);
  assert.ok(far.x <= RUNWAY_M - GAUGE_M + CLAIM_REACH_M + 1e-9, `claimed ${far.x}`);

  // Past the board already: a claim that names a spot back up the runway is
  // still a foul, because the claim can only ever move forwards.
  const back = beyond(RUNWAY_M + 0.5, RUNWAY_M - PERFECT_M / 2);
  assert.equal(back.jumps[0].kind, KIND.FOUL, 'a claim rewound out of a foul');

  // And a press with no mark at all still works, for the bots and for anything
  // else that only knows it pressed.
  const plain = fresh();
  plain.athletes.ace.v = 9;
  plain.athletes.ace.x = RUNWAY_M - PERFECT_M / 2;
  longJump.applyInput(plain, 'ace', { t: 'jump' }, live);
  assert.equal(plain.athletes.ace.jumps[0].kind, KIND.PERFECT);
});

test('a flawless bot hits green every time', () => {
  const a = botRound(1);
  assert.equal(a.jumps.length, ATTEMPTS, 'the bot never finished its round');
  assert.deepEqual(a.jumps.map((j) => j.kind), [KIND.PERFECT, KIND.PERFECT, KIND.PERFECT]);
});

test('a weak bot settles for orange, and sometimes runs through the board', () => {
  // Difficulty 0 is a player who cannot read the gauge: it stabs early and
  // takes the orange jump, or leaves it too late and fouls. What it never does
  // is find green — that is what the top of the dial is buying.
  const seen = new Set();
  for (const id of ['ace', 'ok', 'idle']) {
    for (const jump of botRound(0, id).jumps) seen.add(jump.kind);
  }
  assert.ok(!seen.has(KIND.PERFECT), 'a hopeless bot found green');
  assert.ok(seen.has(KIND.GOOD), 'a hopeless bot never completed a jump at all');
  assert.ok(seen.has(KIND.FOUL), 'no bot ever fouled — the board was a risk only humans carried');
});

test('the skill dial is a ladder, not a switch', () => {
  // The point of the rebuild. Every bot in the table used to jump flawlessly
  // and only the SPEED of the run-up moved, so a field of them was a wall no
  // human could get through. Best-of-three has to fall as the dial does.
  const best = [1, 0.7, 0.4, 0].map((d) => botRound(d).best);
  assert.ok(best[0] >= best[1], `${best[0]} then ${best[1]}`);
  assert.ok(best[1] >= best[3], `${best[1]} then ${best[3]}`);
  assert.ok(best[0] > best[3] + 1, `the top and bottom of the dial jump the same: ${best}`);
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
