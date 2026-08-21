// Unit test for bot fallibility. Pure modules, no server and no sockets:
//   node tools/bots.test.mjs
//
// Two things are under test. The luck itself — deterministic, uncorrelated
// between decisions, and off entirely at difficulty 1 — and the claim the
// whole exercise rests on: that every event's skill dial now produces a LADDER
// of results rather than a wall of flawless ones.

import assert from 'node:assert/strict';
import { botJitter, botLuck, botSlips } from '../shared/bots.js';
import swim, { MAX_RACE_MS as SWIM_MS } from '../shared/events/freestyle_swim.js';
import sprint, { MAX_RACE_MS as SPRINT_MS } from '../shared/events/sprint_100m.js';
import longJump, { MAX_ROUND_MS as LJ_MS } from '../shared/events/long_jump.js';
import archery, { MAX_ROUND_MS as ARCHERY_MS } from '../shared/events/archery.js';
import { createRng } from '../shared/rng.js';

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

console.log('\nbot fallibility');

test('the same decision asked twice gives the same answer', () => {
  // The play tick polls a bot several times inside one tick. If luck were a
  // stream, a fumble would flicker on and off between those polls and the bot
  // would act on whichever one happened to be asked last.
  assert.equal(botLuck('bot_a', 7), botLuck('bot_a', 7));
  assert.equal(botSlips('bot_a', 7, 0.5), botSlips('bot_a', 7, 0.5));
  assert.equal(botJitter('bot_a', 7, 100), botJitter('bot_a', 7, 100));
});

test('different bots, occasions and salts decide independently', () => {
  assert.notEqual(botLuck('bot_a', 7), botLuck('bot_b', 7), 'two bots share one fate');
  assert.notEqual(botLuck('bot_a', 7), botLuck('bot_a', 8), 'one bot repeats itself');
  assert.notEqual(botLuck('bot_a', 7, 1), botLuck('bot_a', 7, 2), 'salts collide');
});

test('the luck is spread across the whole range', () => {
  const xs = Array.from({ length: 400 }, (_, i) => botLuck('bot_a', i));
  assert.ok(Math.min(...xs) < 0.02, `never low: ${Math.min(...xs)}`);
  assert.ok(Math.max(...xs) > 0.98, `never high: ${Math.max(...xs)}`);
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05, `lopsided: ${mean}`);
  const slips = xs.filter((x) => x < 0.25).length / xs.length;
  assert.ok(Math.abs(slips - 0.25) < 0.06, `a 25% chance fired ${(slips * 100).toFixed(0)}% of the time`);
});

test('difficulty 1 is flawless, and nothing else is', () => {
  // The one clean meaning for the top of a skill dial, and every event's bot
  // leans on it: chance 0 never fires, spread 0 never wobbles.
  assert.equal(botSlips('bot_a', 1, 0), false);
  assert.equal(botSlips('bot_a', 1, -1), false);
  assert.equal(botJitter('bot_a', 1, 0), 0);
  const ever = Array.from({ length: 200 }, (_, i) => botSlips('bot_a', i, 0.2)).some(Boolean);
  assert.ok(ever, 'a real chance never fired at all');
});

test('a garbage bot id or occasion cannot crash a tick', () => {
  for (const [id, n] of [[undefined, 0], [null, NaN], ['', -1], [7, 1.5], ['bot', Infinity]]) {
    const x = botLuck(id, n);
    assert.ok(x >= 0 && x < 1, `${id}/${n} gave ${x}`);
  }
});

/**
 * Run one event with a field of bots at the given skills, exactly as the play
 * tick does — including polling several times across the tick.
 */
function field(mod, skills, maxMs, tag) {
  const seats = skills.map((_, i) => ({ playerId: `bot_${tag}_${i}`, lane: i + 1 }));
  const state = mod.initState(seats, createRng(`m:${tag}`), T0);
  let last = T0;
  for (let t = T0 + 50; t < T0 + maxMs; t += 50) {
    for (let i = 0; i < skills.length; i += 1) {
      for (let sub = 1; sub <= 3; sub += 1) {
        const at = last + ((t - last) * sub) / 3;
        const input = mod.botInput(state, seats[i].playerId, skills[i], at);
        if (input) mod.applyInput(state, seats[i].playerId, input, at);
      }
    }
    last = t;
    mod.step(state, 0.05, t);
    if (mod.isFinished(state, t)) break;
  }
  return seats.map((s) => state.athletes[s.playerId]);
}

/** Best first, so a ladder reads as "strictly worse the further down you go". */
const descends = (xs, slack = 0) => xs.every((x, i) => i === 0 || xs[i - 1] >= x - slack);

// The real table, spread across the events. Two matches each, because a single
// one can flatter a dial that only works on one seed.
const SKILLS = [0.86, 0.64, 0.42, 0.33];

test('the swim field strings out instead of finishing together', () => {
  for (const tag of ['a', 'b']) {
    const [best, , , worst] = field(swim, SKILLS, SWIM_MS + 1_000, `sw${tag}`);
    assert.ok(best.done, 'the strongest bot did not finish');
    const worstAt = worst.done ? worst.time : SWIM_MS;
    assert.ok(worstAt - best.time > 8_000, `the field came home together: ${best.time} vs ${worstAt}`);
    assert.ok(best.hits.wrong <= 2, `the strong bot was a mess: ${JSON.stringify(best.hits)}`);
    assert.ok(worst.hits.wrong >= 1, 'the weak bot never caught the water backwards');
  }
});

test('the sprint field strings out too', () => {
  for (const tag of ['a', 'b']) {
    const times = field(sprint, SKILLS, SPRINT_MS + 1_000, `sp${tag}`)
      .map((a) => (a.done ? a.time : SPRINT_MS));
    assert.ok(descends(times.map((t) => -t)), `not a ladder: ${times}`);
    assert.ok(times[3] - times[0] > 2_000, `a dead heat: ${times}`);
  }
});

test('the long jump field is a ladder of bands', () => {
  for (const tag of ['a', 'b']) {
    const bests = field(longJump, SKILLS, LJ_MS + 1_000, `lj${tag}`).map((a) => a.best);
    assert.ok(descends(bests, 0.9), `not a ladder: ${bests}`);
    assert.ok(bests[0] - bests[3] > 1.5, `the whole field jumped the same: ${bests}`);
  }
});

test('the archery field is a ladder of rings', () => {
  for (const tag of ['a', 'b']) {
    const scores = field(archery, SKILLS, ARCHERY_MS + 1_000, `ar${tag}`).map((a) => a.score);
    assert.ok(descends(scores, 2), `not a ladder: ${scores}`);
    assert.ok(scores[0] - scores[3] >= 4, `every bot shot the same round: ${scores}`);
    assert.ok(scores[0] < 30, 'the strongest bot shot a perfect thirty, which is the old complaint');
  }
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
