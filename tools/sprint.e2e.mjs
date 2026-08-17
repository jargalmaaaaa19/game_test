// End-to-end test of the 100m over real sockets: three athletes, three
// cadences, one authoritative race.
//
//   DEV_TOOLS=true DEV_PROGRAMME=sprint_100m npm start
//   node tools/sprint.e2e.mjs
//
// Verifies the whole client<->server contract: inputs go up, snapshots come
// back to EVERY player, and the podium pays 10 / 8 / 6.

import { io } from 'socket.io-client';
import { EVENTS_PER_MATCH } from '../shared/constants.js';
import { MIN_STEP_INTERVAL_MS } from '../shared/events/sprint_100m.js';

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
const waitFor = (s, event, ms = 60_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (d) => {
      clearTimeout(timer);
      resolve(d);
    });
  });

const run = async () => {
  const host = await connect('u_alt');
  const mash = await connect('u_mash');
  const idle = await connect('u_idle');

  // Count snapshots per client — the point of a broadcast is that everyone gets
  // it, including the player who is doing nothing.
  const snapshots = { host: 0, mash: 0, idle: 0 };
  host.on('game:snapshot', () => { snapshots.host += 1; });
  mash.on('game:snapshot', () => { snapshots.mash += 1; });
  idle.on('game:snapshot', () => { snapshots.idle += 1; });

  let lastSnapshot = null;
  host.on('game:snapshot', (d) => { lastSnapshot = d; });

  console.log('\nsetup');
  const room = await call(host, 'room:create', { name: 'Alt' });
  check('room created', room.ok === true, room);
  const j1 = await call(mash, 'room:join', { code: room.code, name: 'Mash' });
  const j2 = await call(idle, 'room:join', { code: room.code, name: 'Idle' });
  check('three athletes seated', j1.ok && j2.ok);

  await call(host, 'player:ready', { ready: true });
  await call(mash, 'player:ready', { ready: true });
  await call(idle, 'player:ready', { ready: true });

  const started = await call(host, 'game:start');
  check('match started', started.ok === true, started);
  check(`${EVENTS_PER_MATCH} sports drawn`, started.programme?.length === EVENTS_PER_MATCH);
  check(
    'DEV_PROGRAMME put the sprint first',
    started.programme?.[0] === 'sprint_100m',
    started.programme,
  );
  if (started.programme?.[0] !== 'sprint_100m') {
    console.log('\n  (start the server with DEV_TOOLS=true DEV_PROGRAMME=sprint_100m)\n');
    process.exit(1);
  }

  console.log('\nthe race');
  const play = await waitFor(host, 'game:play');
  check('play phase carries the event + a first frame', Boolean(play.event && play.state), play.event?.id);
  check('the first frame already has all three lanes', Object.keys(play.state.a).length === 3);

  const gunAt = play.state.s; // server clock
  const offset = play.t - Date.now(); // serverNow ≈ Date.now() + offset
  const serverNow = () => Date.now() + offset;

  // Three cadences: a clean alternation, a one-footed masher, and a player who
  // never touches the screen.
  let foot = 0;
  const altTimer = setInterval(() => {
    if (serverNow() < gunAt) return;
    foot = foot === 1 ? 0 : 1;
    host.emit('game:input', { f: foot });
  }, 110);
  const mashTimer = setInterval(() => {
    if (serverNow() < gunAt) return;
    mash.emit('game:input', { f: 1 });
  }, 110);
  // Faster than any human — the server must ignore these entirely.
  const cheatTimer = setInterval(() => {
    if (serverNow() < gunAt) return;
    idle.emit('game:input', { f: Math.random() > 0.5 ? 1 : 0 });
  }, Math.max(4, Math.floor(MIN_STEP_INTERVAL_MS / 8)));

  const podium = await waitFor(host, 'game:podium');
  clearInterval(altTimer);
  clearInterval(mashTimer);
  clearInterval(cheatTimer);

  console.log('\nresults');
  check('snapshots reached the runner', snapshots.host > 40, snapshots.host);
  check('snapshots reached the idle player too', snapshots.idle > 40, snapshots.idle);
  check('every lane is in the snapshot', Object.keys(lastSnapshot?.s?.a ?? {}).length === 3);

  const [first, second, third] = podium.placements;
  const nameOf = { [room.playerId]: 'alt', [j1.playerId]: 'mash', [j2.playerId]: 'spam' };
  check('the clean alternation wins', nameOf[first] === 'alt', podium.placements.map((p) => nameOf[p]));
  check('the one-footed masher is second', nameOf[second] === 'mash');
  check('the sub-threshold spammer is last', nameOf[third] === 'spam');

  const points = Object.fromEntries(podium.awards.map((a) => [nameOf[a.playerId], a.points]));
  check('10 / 8 / 6 awarded', points.alt === 10 && points.mash === 8 && points.spam === 6, points);

  const table = podium.table[first];
  check('the winner is credited a gold', table?.gold === 1 && table?.points === 10, table);
  check('the heat resolved by finishing, not by the clock', podium.reason === 'finished', podium.reason);

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error('e2e failed:', err);
  process.exit(1);
});
