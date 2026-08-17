// The victory share text is the one thing on the ceremony screen that leaves
// the device, so it gets asserted rather than eyeballed.
//
//   node tools/share.test.mjs

import assert from 'node:assert/strict';
import { buildShareText } from '../client/src/share.js';

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

const champion = {
  player: { name: 'Бат', country: 'MN' },
  row: { points: 46, gold: 3, silver: 2, bronze: 0 },
};
const standings = [
  { playerId: 'a', name: 'Бат', points: 46 },
  { playerId: 'b', name: 'Ганзо', points: 44 },
];
const programme = ['sprint_100m', 'archery'];

console.log('\nvictory share text');

test('names the champion with their flag', () => {
  const text = buildShareText({ champion, standings, programme });
  assert.ok(text.includes('🇲🇳'), 'flag missing');
  assert.ok(text.includes('Бат'), 'champion missing');
  assert.ok(text.includes('Аварга'), 'title missing');
});

test('carries points and the medal tally', () => {
  const text = buildShareText({ champion, standings, programme });
  assert.ok(text.includes('46 оноо'));
  assert.ok(text.includes('3-2-0'));
});

test('credits the runner-up', () => {
  assert.ok(buildShareText({ champion, standings, programme }).includes('Ганзо (44)'));
});

test('lists the programme in the reader language', () => {
  const text = buildShareText({ champion, standings, programme });
  assert.ok(text.includes('100м гүйлт'), text);
  assert.ok(text.includes('Сурын харваа'), text);
});

test('a two-player match has no runner-up line dangling', () => {
  const text = buildShareText({ champion, standings: [standings[0]], programme });
  assert.ok(!text.includes('2-р байр'), text);
});

test('survives a solo standing and an empty programme', () => {
  const text = buildShareText({ champion, standings: [], programme: [] });
  assert.ok(text.split('\n').every((line) => line.trim().length > 0), 'blank line in share text');
});

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
