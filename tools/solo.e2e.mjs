// End-to-end test of a SOLO launch over real sockets: one human, a field of
// bots, and a heat that resolves without a second phone anywhere.
//
//   DEV_TOOLS=true DEV_PROGRAMME=sprint_100m npm start
//   node tools/solo.e2e.mjs
//
// This is the GameTok door: the feed opens the game and the player is racing.
// If it breaks, the game is dead content in the feed — it opens on a lobby
// nobody else is ever going to walk into.

import { io } from 'socket.io-client';

const URL = process.env.SMOKE_URL || 'http://localhost:3200';

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
};

const connect = (devUserId) =>
  new Promise((resolve, reject) => {
    const s = io(URL, { auth: { devUserId }, transports: ['websocket'] });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });

const call = (s, event, payload) => new Promise((r) => s.emit(event, payload, r));
const waitFor = (s, event, ms = 90_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (d) => {
      clearTimeout(timer);
      resolve(d);
    });
  });

const run = async () => {
  const solo = await connect('u_solo');

  console.log('\nthe solo door');
  const started = await call(solo, 'room:solo', { name: 'Ganzo', bots: 3 });
  check('one call seats the room and starts the match', started.ok === true, started);
  if (!started.ok) process.exit(1);

  const roster = started.state?.players ?? [];
  const bots = roster.filter((p) => p.isBot);
  check('the player is seated with a field of bots', roster.length === 4 && bots.length === 3, {
    roster: roster.length, bots: bots.length,
  });
  check('every bot is a competitor, not a dead seat', bots.every((b) => b.connected), bots);
  check('the programme was drawn', Array.isArray(started.programme) && started.programme.length > 0,
    started.programme);
  check('no lobby was shown on the way — the match is already live',
    started.state?.phase !== 'hall', started.state?.phase);

  console.log('\nthe heat');
  const play = await waitFor(solo, 'game:play');
  check('play phase carries the event + a first frame', Boolean(play.event && play.state));

  const lanes = Object.keys(play.state.a ?? {});
  check('every seat is racing, bots included', lanes.length === 4, lanes.length);

  // Watch the bots actually move. `botInput` is wired through the same
  // `applyInput` a phone reaches, so if this is flat the bots are seated but
  // nobody is playing them.
  const first = {};
  const last = {};
  const result = {};
  solo.on('game:snapshot', ({ s }) => {
    for (const [id, a] of Object.entries(s.a ?? {})) {
      const progress = a.x ?? a.sc ?? a.bt ?? 0;
      if (first[id] === undefined) first[id] = progress;
      last[id] = progress;
      // What separates a field once everyone is home. Distance saturates at
      // the finish line — three bots that all ran the 100m all read 100 — so
      // the spread has to be measured on the TIME, where the event has one.
      result[id] = a.t ?? a.sc ?? a.bt ?? progress;
    }
  });

  const podium = await waitFor(solo, 'game:podium');

  console.log('\nresults');
  const botIds = bots.map((b) => b.id);
  const moved = botIds.filter((id) => (last[id] ?? 0) > (first[id] ?? 0));
  check('the bots played the event, not just sat in it', moved.length === botIds.length, {
    moved: moved.length, of: botIds.length,
  });
  check('the field is spread, not a dead heat',
    new Set(botIds.map((id) => Math.round((result[id] ?? 0) * 10))).size > 1,
    botIds.map((id) => result[id]));
  check('everyone is placed, human and bots alike',
    podium.placements?.length === 4, podium.placements);
  check('points were awarded', (podium.awards ?? []).length === 4, podium.awards?.length);

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error('e2e failed:', err);
  process.exit(1);
});
