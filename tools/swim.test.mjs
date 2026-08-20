// Unit test for the 50m freestyle sim. Pure module, so no server and no
// sockets:  node tools/swim.test.mjs

import assert from 'node:assert/strict';
import swim, {
  BEAT_MS,
  COUNTDOWN_MS,
  DISTANCE_M,
  LEAD_IN_MS,
  HIT_WINDOW_MS,
  TIER,
  TOTAL_BEATS,
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
 * Swim a whole race deterministically.
 *
 *   offset      how far off the beat this swimmer presses, either sign
 *   wrongEvery  catch the wrong side every nth stroke
 *   everyNth    only bother with every nth cue, letting the rest flow past —
 *               this is what "lands fewer strokes" means now that volume is
 *               what the event pays for
 */
function race(state, id, { offset = 0, wrongEvery = 0, everyNth = 1, silent = false } = {}) {
  const tick = 50;
  let strokes = 0;
  let seen = 0;
  for (let now = state.startsAt; now <= state.endsAt; now += tick) {
    const a = state.athletes[id];
    if (!a.done && !silent && a.beat < TOTAL_BEATS) {
      const target = beatTime(state.startsAt, a.beat) + offset;
      if (now <= target && target < now + tick) {
        seen += 1;
        if (seen % everyNth === 0) {
          strokes += 1;
          const correct = sideOf(state.sides, a.beat);
          const wrong = wrongEvery && strokes % wrongEvery === 0;
          swim.applyInput(state, id, { s: wrong ? 1 - correct : correct }, target);
        }
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

test('reaction tiers run fast to slow, then the cue expires', () => {
  const state = fresh();
  const at = beatTime(state.startsAt, 0);
  assert.equal(judge(state.startsAt, 0, at), 'perfect');
  assert.equal(judge(state.startsAt, 0, at + TIER.perfect + 5), 'good');
  assert.equal(judge(state.startsAt, 0, at + TIER.good + 5), 'ok');
  assert.equal(judge(state.startsAt, 0, at + HIT_WINDOW_MS + 5), null);
});

test('the hit window is symmetric — a cue can be struck on the way in', () => {
  const state = fresh();
  const at = beatTime(state.startsAt, 0);
  assert.equal(judge(state.startsAt, 0, at - 1), 'perfect');
  assert.equal(judge(state.startsAt, 0, at - (TIER.good - 5)), 'good');
  assert.equal(judge(state.startsAt, 0, at - (HIT_WINDOW_MS + 5)), null);
});

test('landing MORE strokes beats landing fewer', () => {
  // The event is decided by volume: same window, same wind, one swimmer simply
  // keeps up with the stream and the other answers every third cue.
  const busy = race(fresh(), 'ace');
  const sparse = race(fresh(), 'ace', { everyNth: 3 });
  assert.ok(busy.x > sparse.x, `busy ${busy.x}m vs sparse ${sparse.x}m`);
});

test('the stroke pattern is mixed, not taking turns', () => {
  // A coin that always says "heads" still may not produce a run past three.
  const sticky = fresh(() => 0.1);
  let run = 1;
  let longest = 1;
  for (let i = 1; i < sticky.sides.length; i += 1) {
    run = sticky.sides[i] === sticky.sides[i - 1] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  assert.ok(longest <= 3, `a run of ${longest} of the same side`);

  // And the sides are NOT a strict alternation any more: turn-taking is what
  // the mixing replaced, so a sequence that alternates perfectly would mean
  // the draw is being ignored.
  const mixed = fresh(() => 0.1);
  const alternating = mixed.sides.every((s, i) => i === 0 || s !== mixed.sides[i - 1]);
  assert.equal(alternating, false);
});

test('answering faster moves you faster', () => {
  const quick = race(fresh(), 'ace', { offset: 40 });
  const dawdling = race(fresh(), 'ace', { offset: HIT_WINDOW_MS - 20 });
  assert.ok(quick.time < dawdling.time, `quick ${quick.time} vs slow ${dawdling.time}`);
});

test('even the slowest correct answer still finishes inside the round', () => {
  const slow = race(fresh(), 'ace', { offset: HIT_WINDOW_MS - 10 });
  assert.equal(slow.done, true, `only reached ${slow.x}m`);
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

test('catching the wrong side costs more than a slow stroke', () => {
  const late = race(fresh(), 'ace', { offset: TIER.perfect + 10 });
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
  race(state, 'sloppy', { offset: TIER.good + 30 });
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
