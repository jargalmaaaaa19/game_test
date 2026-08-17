// End-to-end smoke test for the three lobby flows: room create/join, player
// configuration, and the host's Start Game draw.
//
//   USION_AUTH_REQUIRED=false DEV_TOOLS=true node server/src/index.js
//   node tools/smoke.mjs
//
// Exits non-zero on the first failed assertion.

import { io } from 'socket.io-client';
import { EVENTS_PER_MATCH } from '../shared/constants.js';

const URL = process.env.SMOKE_URL || 'http://localhost:3200';

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
};

const connect = (devUserId) =>
  new Promise((resolve, reject) => {
    const socket = io(URL, { auth: { devUserId }, transports: ['websocket'] });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });

const call = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

const waitFor = (socket, event, timeoutMs = 4000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

const run = async () => {
  const [host, guest, third] = await Promise.all([
    connect('user_host'),
    connect('user_guest'),
    connect('user_third'),
  ]);

  console.log('\nroom creation + joining');
  const created = await call(host, 'room:create', { name: 'Bat' });
  check('host creates a room', created.ok === true, created);
  check('code is 4 chars', created.code?.length === 4, created.code);
  check('host is host', created.state.hostId === created.playerId);

  const badJoin = await call(guest, 'room:join', { code: 'ZZZZ9' });
  check('malformed code rejected', badJoin.error?.code === 'INVALID_INPUT', badJoin);

  const missing = await call(guest, 'room:join', { code: 'ZZZZ' });
  check('unknown code rejected', missing.error?.code === 'ROOM_NOT_FOUND', missing);

  // Lowercase + a confusable O for 0 is what a player actually types.
  const messy = created.code.toLowerCase().replace('0', 'o');
  const joined = await call(guest, 'room:join', { code: messy });
  check('guest joins via normalized code', joined.ok === true, joined);
  check('roster has 2', joined.state.players.length === 2);

  const joined3 = await call(third, 'room:join', { code: created.code });
  check('third joins', joined3.ok === true, joined3);

  console.log('\nplayer configuration');
  const look = await call(guest, 'player:identity', {
    name: '  Ganzo​  ',
    hair: 'h_ponytail',
    outfit: 'o_blazer',
    country: 'JP',
  });
  check('identity accepted', look.ok === true, look);
  check('name trimmed + zero-width stripped', look.player?.name === 'Ganzo', look.player);

  const badHair = await call(guest, 'player:identity', { hair: 'h_nope' });
  check('unknown hairstyle rejected', badHair.error?.code === 'INVALID_INPUT', badHair);

  const badOutfit = await call(guest, 'player:identity', { outfit: 'o_nope' });
  check('unknown outfit rejected', badOutfit.error?.code === 'INVALID_INPUT', badOutfit);

  const clash = await call(third, 'player:identity', { country: 'JP' });
  check('duplicate flag rejected', clash.error?.code === 'FLAG_TAKEN', clash);

  const ok3 = await call(third, 'player:identity', { name: 'Saraa', country: 'KR' });
  check('free flag accepted', ok3.ok === true, ok3);

  console.log('\nready + start gating');
  const notHost = await call(guest, 'game:start');
  check('non-host cannot start', notHost.error?.code === 'NOT_HOST', notHost);

  const tooEarly = await call(host, 'game:start');
  check('start blocked while unready', tooEarly.error?.code === 'NOT_EVERYONE_READY', tooEarly);

  await call(host, 'player:ready', { ready: true });
  await call(guest, 'player:ready', { ready: true });
  const readyState = await call(third, 'player:ready', { ready: true });
  check('all ready reported startable', readyState.startable?.ok === true, readyState);

  console.log('\ngame start');
  const startedPromise = waitFor(guest, 'game:started');
  const introPromise = waitFor(third, 'game:intro');
  const started = await call(host, 'game:start');
  check('host starts', started.ok === true, started);

  const broadcastStart = await startedPromise;
  check(
    `${EVENTS_PER_MATCH} sports drawn`,
    broadcastStart.programme?.length === EVENTS_PER_MATCH,
    broadcastStart.programme?.map((e) => e.id),
  );
  check(
    'no sport drawn twice',
    new Set(broadcastStart.programme.map((e) => e.id)).size === EVENTS_PER_MATCH,
  );
  check(
    'lanes assigned to every competitor',
    Object.keys(broadcastStart.lanes).length === 3 &&
      new Set(Object.values(broadcastStart.lanes)).size === 3,
    broadcastStart.lanes,
  );
  check('seed broadcast for deterministic replay', Number.isFinite(broadcastStart.seed));

  const intro = await introPromise;
  check('first event intro fires', intro.eventIndex === 0 && Boolean(intro.event?.id), intro);

  const lockedOut = await call(await connect('user_late'), 'room:join', { code: created.code });
  check('late joiner locked out mid-match', lockedOut.error?.code === 'ROOM_LOCKED', lockedOut);

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error('smoke run failed:', err);
  process.exit(1);
});
