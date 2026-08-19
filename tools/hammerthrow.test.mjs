// Unit test for the hammer throw sim. Pure module, so no server and no sockets:
//   node tools/hammerthrow.test.mjs

import assert from 'node:assert/strict';
import hammerThrow, {
  ATTEMPTS,
  COUNTDOWN_MS,
  FLIGHT_MS,
  GREEN_HALF_DEG,
  KIND,
  MAX_SPIN,
  MAX_WIND_MS,
  MEASURE_MS,
  MIN_SPIN,
  MIN_TURN_INTERVAL_MS,
  SECTOR_HALF_DEG,
  TURNS_FOR_FULL_POWER,
  flightPoint,
  headingAt,
  isFoul,
  spinAt,
  throwDistance,
  throwPower,
  wrapAngle,
} from '../shared/events/hammer_throw.js';
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

const RAD = Math.PI / 180;
const T0 = 3_000_000;
const seats = [
  { playerId: 'ace', lane: 1 },
  { playerId: 'ok', lane: 2 },
  { playerId: 'idle', lane: 3 },
];
const fresh = () => hammerThrow.initState(seats, () => 0.5, T0);
const live = T0 + COUNTDOWN_MS + 1;

/** Wind `turns` revolutions at a steady cadence. Returns the clock after the last. */
function wind(state, id, { turns = 4, interval = 250, from = live } = {}) {
  let at = from;
  for (let i = 0; i < turns; i += 1) {
    hammerThrow.applyInput(state, id, { t: 'turn' }, at);
    at += interval;
  }
  return at - interval;
}

/**
 * Let go at the exact moment the heading next reads `targetDeg`.
 *
 * Detects the CROSSING rather than sampling for "close enough": at full spin
 * the heading moves about 1.3° per millisecond, so a tolerance window is
 * stepped straight over, and the search then runs on for revolutions while the
 * spin decays — which reads as a hard wind throwing shorter than a soft one.
 */
function releaseAtHeading(state, id, from, targetDeg = 0) {
  const a = state.athletes[id];
  const target = targetDeg * RAD;
  const off = (t) => wrapAngle(headingAt(a, t) - target);

  let at = from;
  let prev = off(at);
  for (let i = 0; i < 20_000; i += 1) {
    const next = at + 0.5;
    const cur = off(next);
    // Heading only ever increases, so a negative-to-positive step IS the pass.
    if (prev < 0 && cur >= 0) {
      if (Math.abs(cur) < Math.abs(prev)) at = next;
      break;
    }
    prev = cur;
    at = next;
  }
  hammerThrow.applyInput(state, id, { t: 'release', v: wrapAngle(headingAt(a, at)) / RAD }, at);
  return at;
}

/** Run the flight + measurement beat out so the attempt recycles. */
function settle(state, at) {
  const after = at + FLIGHT_MS + MEASURE_MS + 50;
  hammerThrow.step(state, 0.1, after);
  return after;
}

const lastThrow = (state, id) => state.athletes[id].throws.at(-1);

// ---------------------------------------------------------------------------
console.log('hammer throw — state');

test('initState seats everyone in the circle, unwound', () => {
  const s = fresh();
  assert.equal(Object.keys(s.athletes).length, 3);
  for (const a of Object.values(s.athletes)) {
    assert.equal(a.stage, 'wind');
    assert.equal(a.turns, 0);
    assert.equal(a.best, 0);
    assert.deepEqual(a.throws, []);
  }
  assert.equal(s.startsAt, T0 + COUNTDOWN_MS);
});

test('nothing happens before the countdown is out', () => {
  const s = fresh();
  hammerThrow.applyInput(s, 'ace', { t: 'turn' }, T0 + 10);
  assert.equal(s.athletes.ace.turns, 0);
});

// ---------------------------------------------------------------------------
console.log('\nhammer throw — the wind');

test('each revolution winds her faster', () => {
  const s = fresh();
  const a = s.athletes.ace;
  let at = live;
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    hammerThrow.applyInput(s, 'ace', { t: 'turn' }, at);
    seen.push(spinAt(a, at));
    at += 250;
  }
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i] > seen[i - 1], `turn ${i} did not add spin (${seen})`);
  }
  assert.ok(seen.at(-1) <= MAX_SPIN, 'spin exceeded its ceiling');
});

test('a faster cadence winds harder than a slow one', () => {
  const fast = fresh();
  const slow = fresh();
  const fastAt = wind(fast, 'ace', { turns: 4, interval: 200 });
  const slowAt = wind(slow, 'ace', { turns: 4, interval: 500 });
  assert.ok(
    spinAt(fast.athletes.ace, fastAt) > spinAt(slow.athletes.ace, slowAt) * 1.5,
    'cadence barely mattered',
  );
});

test('she coasts back down to the idle swing when the finger stops', () => {
  const s = fresh();
  const at = wind(s, 'ace', { turns: 4, interval: 220 });
  const a = s.athletes.ace;
  const spun = spinAt(a, at);
  assert.ok(spinAt(a, at + 3_000) < spun * 0.5, 'spin did not decay');
  assert.ok(Math.abs(spinAt(a, at + 20_000) - MIN_SPIN) < 0.01, 'she did not settle on the swing');
  assert.ok(throwPower(spinAt(a, at + 20_000), 4) < 0.001, 'the idle swing was worth power');
});

test('the release always comes back around, however badly she is wound', () => {
  // The trap this rules out: a decay that converges inside one revolution parks
  // the athlete facing out of the sector, and every release from there is a
  // foul the player was given no way to avoid.
  for (const [turns, interval] of [[1, 620], [1, 900], [2, 700], [3, 260]]) {
    const s = fresh();
    const at = wind(s, 'ace', { turns, interval });
    const a = s.athletes.ace;
    const from = wrapAngle(headingAt(a, at));
    let reached = false;
    for (let t = at; t <= at + 12_000; t += 20) {
      if (Math.abs(wrapAngle(headingAt(a, t))) <= GREEN_HALF_DEG * RAD) { reached = true; break; }
    }
    assert.ok(reached, `${turns} turns @${interval}ms never swung back to green (from ${from})`);
  }
});

test('winding impossibly fast stumbles instead of paying out', () => {
  const honest = fresh();
  const spammer = fresh();
  const honestAt = wind(honest, 'ace', { turns: 6, interval: 240 });
  const spamAt = wind(spammer, 'ace', { turns: 6, interval: MIN_TURN_INTERVAL_MS - 40 });
  assert.ok(
    spinAt(spammer.athletes.ace, spamAt) < spinAt(honest.athletes.ace, honestAt),
    'hammering the input beat an honest cadence',
  );
});

test('heading and spin are closed form — 20Hz and 60fps agree exactly', () => {
  const s = fresh();
  const at = wind(s, 'ace', { turns: 3, interval: 240 });
  const a = s.athletes.ace;
  const target = at + 900;

  // The server ticking at 20Hz and a client predicting at 60fps sample the
  // same pure functions at different moments; they must land on one heading.
  const server = { ...a };
  for (let t = at; t <= target; t += 50) hammerThrow.step(s, 0.05, t);
  const client = { ...a };
  for (let t = at; t <= target; t += 16.67) hammerThrow.step(s, 0.01667, t);

  assert.equal(headingAt(server, target), headingAt(client, target));
  assert.equal(spinAt(server, target), spinAt(client, target));
});

// ---------------------------------------------------------------------------
console.log('\nhammer throw — the release');

test('a full wind released green is a world-class throw, and under the record', () => {
  const s = fresh();
  const at = wind(s, 'ace', { turns: 5, interval: 200 });
  releaseAtHeading(s, 'ace', at, 0);
  const mark = lastThrow(s, 'ace');
  assert.equal(mark.kind, KIND.GREEN);
  assert.ok(mark.distance > 70, `a perfect wind only managed ${mark.distance}m`);
  assert.ok(mark.distance < 86.74, `${mark.distance}m beat the world record`);
});

test('a green release beats the same wind let go wide', () => {
  const green = fresh();
  const wide = fresh();
  const g = wind(green, 'ace', { turns: 5, interval: 200 });
  const w = wind(wide, 'ace', { turns: 5, interval: 200 });
  releaseAtHeading(green, 'ace', g, 0);
  releaseAtHeading(wide, 'ace', w, SECTOR_HALF_DEG - 3);
  assert.ok(
    lastThrow(green, 'ace').distance > lastThrow(wide, 'ace').distance,
    'the green arc bought nothing',
  );
  assert.equal(lastThrow(wide, 'ace').kind, KIND.PLAIN);
});

test('barely winding is a short throw, not a foul', () => {
  const s = fresh();
  const at = wind(s, 'ace', { turns: 1, interval: 620 });
  releaseAtHeading(s, 'ace', at, 0);
  const mark = lastThrow(s, 'ace');
  assert.ok(!isFoul(mark.kind), 'a weak throw was called a foul');
  assert.ok(mark.distance < 45, `one turn threw ${mark.distance}m`);
});

test('turns and spin multiply — one fast turn is not a wind', () => {
  const flick = throwPower(MAX_SPIN, 1);
  const full = throwPower(MAX_SPIN, TURNS_FOR_FULL_POWER);
  assert.ok(flick < full / 2, 'a single flick was worth half a full wind');
  assert.equal(throwPower(MAX_SPIN * 2, TURNS_FOR_FULL_POWER * 2), 1, 'power did not clamp');
});

test('a client-reported heading beyond tolerance is ignored for the server reading', () => {
  const honest = fresh();
  const liar = fresh();
  const h = wind(honest, 'ace', { turns: 5, interval: 200 });
  const l = wind(liar, 'ace', { turns: 5, interval: 200 });

  // Both let go at the same instant, well wide of the arc. The liar claims 0°.
  const at = releaseAtHeading(honest, 'ace', h, SECTOR_HALF_DEG - 4);
  hammerThrow.applyInput(liar, 'ace', { t: 'release', v: 0 }, at);

  assert.equal(lastThrow(liar, 'ace').kind, lastThrow(honest, 'ace').kind);
  assert.equal(lastThrow(liar, 'ace').distance, lastThrow(honest, 'ace').distance);
});

// ---------------------------------------------------------------------------
console.log('\nhammer throw — the fouls');

test('leaving the circle spends the attempt and scores nothing', () => {
  const s = fresh();
  const at = wind(s, 'ace', { turns: 5, interval: 190 });
  hammerThrow.applyInput(s, 'ace', { t: 'foul' }, at + 10);
  const mark = lastThrow(s, 'ace');
  assert.equal(mark.kind, KIND.LEFT_CIRCLE);
  assert.equal(mark.distance, 0);
  assert.equal(s.athletes.ace.best, 0);
  assert.equal(s.athletes.ace.throws.length, 1, 'the attempt was not spent');
});

test('releasing outside the sector is a foul', () => {
  const s = fresh();
  const at = wind(s, 'ace', { turns: 4, interval: 220 });
  releaseAtHeading(s, 'ace', at, SECTOR_HALF_DEG + 12);
  const mark = lastThrow(s, 'ace');
  assert.equal(mark.kind, KIND.OUT_OF_SECTOR);
  assert.equal(mark.distance, 0);
});

test('a foul still flies, so the player sees it go', () => {
  const s = fresh();
  const at = wind(s, 'ace', { turns: 5, interval: 200 });
  hammerThrow.applyInput(s, 'ace', { t: 'foul' }, at + 10);
  const wire = hammerThrow.snapshot(s).a.ace.f;
  assert.ok(wire, 'no arc was handed to the renderer');
  const mid = flightPoint(wire, at + 10 + FLIGHT_MS / 2);
  assert.ok(mid.y > 3, 'the fouled hammer never left the ground');
  assert.equal(flightPoint(wire, at + 10 + FLIGHT_MS + MEASURE_MS).measuring, 0,
    'the crew walked out to measure a foul');
});

test('never letting go spends the attempt where she stands', () => {
  const s = fresh();
  const at = wind(s, 'ace', { turns: 3, interval: 250 });
  hammerThrow.step(s, 0.1, at + MAX_WIND_MS + 100);
  const mark = lastThrow(s, 'ace');
  assert.equal(mark.kind, KIND.NO_THROW);
  assert.equal(s.athletes.ace.stage, 'flight');
});

// ---------------------------------------------------------------------------
console.log('\nhammer throw — the round');

test('three attempts, then done — and the best one counts', () => {
  const s = fresh();
  let at = live;
  const distances = [];
  for (let i = 0; i < ATTEMPTS; i += 1) {
    // Deliberately unequal winds, so "best" has something to choose between.
    const windAt = wind(s, 'ace', { turns: 3 + i, interval: 260 - i * 25, from: at });
    at = releaseAtHeading(s, 'ace', windAt, 0);
    distances.push(lastThrow(s, 'ace').distance);
    at = settle(s, at);
  }
  assert.equal(s.athletes.ace.throws.length, ATTEMPTS);
  assert.equal(s.athletes.ace.stage, 'done');
  assert.equal(s.athletes.ace.best, Math.max(...distances));
});

test('fouling every attempt still ends the round, with nothing on the board', () => {
  const s = fresh();
  let at = live;
  for (let i = 0; i < ATTEMPTS; i += 1) {
    const windAt = wind(s, 'ace', { turns: 3, interval: 220, from: at });
    hammerThrow.applyInput(s, 'ace', { t: 'foul' }, windAt + 10);
    at = settle(s, windAt + 10);
  }
  assert.equal(s.athletes.ace.stage, 'done');
  assert.equal(s.athletes.ace.best, 0);
});

test('the round ends on the clock even if nobody throws', () => {
  const s = fresh();
  assert.equal(hammerThrow.isFinished(s, live), false);
  assert.equal(hammerThrow.isFinished(s, s.endsAt + 1), true);
});

test('placements are longest first, ties broken by lane', () => {
  const s = fresh();
  s.athletes.ace.best = 61.2;
  s.athletes.ok.best = 74.8;
  s.athletes.idle.best = 61.2;
  assert.deepEqual(hammerThrow.placements(s), ['ok', 'ace', 'idle']);
  assert.equal(pointsForPlacement(0), 10);
});

test('a thrower with three fouls still places, and places last', () => {
  const s = fresh();
  s.athletes.ace.best = 0;
  s.athletes.ok.best = 55;
  s.athletes.idle.best = 70;
  assert.deepEqual(hammerThrow.placements(s), ['idle', 'ok', 'ace']);
});

// ---------------------------------------------------------------------------
console.log('\nhammer throw — the wire, and the bots');

test('the snapshot carries enough to rebuild the spin on any client', () => {
  const s = fresh();
  const at = wind(s, 'ace', { turns: 3, interval: 240 });
  const wire = hammerThrow.snapshot(s).a.ace;
  const rebuilt = { spin0: wire.s0, spinAt: wire.sa, heading0: wire.h0 };
  const drift = Math.abs(headingAt(rebuilt, at + 400) - headingAt(s.athletes.ace, at + 400));
  assert.ok(drift < 0.01, `rebuilt heading drifted by ${drift} rad`);
  assert.equal(wire.st, 'wind');
  assert.equal(wire.tn, 3);
});

test('a bot winds up and lets go inside the sector', () => {
  const s = fresh();
  let at = live;
  for (let i = 0; i < 4_000 && s.athletes.ok.stage === 'wind'; i += 1) {
    const input = hammerThrow.botInput(s, 'ok', 0.8, at);
    if (input) hammerThrow.applyInput(s, 'ok', input, at);
    hammerThrow.step(s, 0.02, at);
    at += 20;
  }
  const mark = lastThrow(s, 'ok');
  assert.ok(mark, 'the bot never threw');
  assert.ok(!isFoul(mark.kind), `the bot fouled (${mark.kind})`);
  assert.ok(mark.distance > 35, `the bot only threw ${mark.distance}m`);
});

test('a weak bot is worse than a strong one, and neither is perfect', () => {
  const run = (difficulty) => {
    const s = fresh();
    let at = live;
    for (let i = 0; i < 4_000 && s.athletes.ok.stage === 'wind'; i += 1) {
      const input = hammerThrow.botInput(s, 'ok', difficulty, at);
      if (input) hammerThrow.applyInput(s, 'ok', input, at);
      hammerThrow.step(s, 0.02, at);
      at += 20;
    }
    return lastThrow(s, 'ok').distance;
  };
  const strong = run(0.95);
  const weak = run(0.25);
  assert.ok(strong > weak, `weak bot (${weak}m) matched the strong one (${strong}m)`);
  assert.ok(strong < 86.74, 'a bot beat the world record');
});

// ---------------------------------------------------------------------------
console.log('\nhammer throw — the drawn arc');

test('the arc leaves the hand, peaks, and lands on the mark', () => {
  const distance = 72;
  const until = 10_000 + FLIGHT_MS + MEASURE_MS;
  const wire = [until, distance, 0, KIND.GREEN];

  const start = flightPoint(wire, 10_000);
  const mid = flightPoint(wire, 10_000 + FLIGHT_MS / 2);
  const end = flightPoint(wire, 10_000 + FLIGHT_MS);

  assert.ok(start.x < 0.5 && start.y < 0.5, 'the hammer started mid-air');
  assert.ok(mid.y > start.y && mid.y > end.y, 'there was no apex');
  assert.ok(Math.abs(end.x - distance) < 0.01, `it landed at ${end.x}, not ${distance}`);
  assert.ok(end.y < 0.01, 'it never came down');
});

test('a throw off the centre line lands off the centre line', () => {
  const wire = [10_000 + FLIGHT_MS + MEASURE_MS, 60, 20 * RAD, KIND.PLAIN];
  const end = flightPoint(wire, 10_000 + FLIGHT_MS);
  assert.ok(end.z > 15, `a 20° throw drifted only ${end.z}m across`);
  assert.ok(Math.abs(Math.hypot(end.x, end.z) - 60) < 0.01, 'the range changed with the heading');
});

test('the crew only walk out once the hammer is down', () => {
  const wire = [10_000 + FLIGHT_MS + MEASURE_MS, 60, 0, KIND.GREEN];
  assert.equal(flightPoint(wire, 10_000 + FLIGHT_MS / 2).measuring, 0);
  assert.ok(flightPoint(wire, 10_000 + FLIGHT_MS + MEASURE_MS / 2).measuring > 0.4);
  assert.equal(flightPoint(wire, 10_000 + FLIGHT_MS + MEASURE_MS).measuring, 1);
});

// ---------------------------------------------------------------------------
console.log(failures === 0 ? '\nall green' : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
