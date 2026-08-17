// End-to-end test of archery over real sockets: three archers, three
// strategies, one authoritative scorecard.
//
//   DEV_TOOLS=true DEV_PROGRAMME=archery npm start
//   node tools/archery.e2e.mjs

import { io } from 'socket.io-client';
import archery, { ARROWS_PER_ATHLETE, aimAt, powerAt } from '../shared/events/archery.js';

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

/**
 * Plays like the real client: reads its own stage and stageAt off the snapshot,
 * evaluates the SAME pure sweep function, and sends what it saw.
 */
function autoArcher(socket, playerId, style, clock) {
  let lastSentStage = null;
  let lastSentAt = 0;

  socket.on('game:snapshot', ({ s }) => {
    const a = s.a?.[playerId];
    if (!a || a.st === 'done') return;
    const now = clock();
    if (now < s.s) return;

    const key = `${a.st}:${a.sa}`;
    if (key === lastSentStage || now - lastSentAt < 220) return;

    const wind = s.w[a.sh.length] ?? { x: 0, y: 0 };
    if (a.st === 'aim') {
      const live = aimAt({ stageAt: a.sa }, now);
      // Aim as close to the ideal as the sweep currently allows — the server
      // only accepts values within one round trip of its own reading.
      const want = style === 'good' ? -(wind.x * 0.55) / 0.72 / 0.9 : 0.9;
      const v = Math.max(live - 0.3, Math.min(live + 0.3, want));
      lastSentStage = key;
      lastSentAt = now;
      socket.emit('game:input', { t: 'aim', v });
    } else {
      const live = powerAt({ stageAt: a.sa }, now);
      const want = style === 'good' ? 0.72 : 0.4;
      const v = Math.max(live - 0.25, Math.min(live + 0.25, want));
      lastSentStage = key;
      lastSentAt = now;
      socket.emit('game:input', { t: 'power', v });
    }
  });
}

const run = async () => {
  const host = await connect('u_ace');
  const guest = await connect('u_wild');
  const idle = await connect('u_idle');

  console.log('\nsetup');
  const room = await call(host, 'room:create', { name: 'Ace' });
  const j1 = await call(guest, 'room:join', { code: room.code, name: 'Wild' });
  const j2 = await call(idle, 'room:join', { code: room.code, name: 'Idle' });
  check('three archers seated', room.ok && j1.ok && j2.ok);

  for (const s of [host, guest, idle]) await call(s, 'player:ready', { ready: true });
  const started = await call(host, 'game:start');
  check('archery drawn first', started.programme?.[0] === 'archery', started.programme);
  if (started.programme?.[0] !== 'archery') {
    console.log('\n  (start the server with DEV_TOOLS=true DEV_PROGRAMME=archery)\n');
    process.exit(1);
  }

  console.log('\nthe round');
  const play = await waitFor(host, 'game:play');
  check('play phase carries the event + a first frame', Boolean(play.event && play.state));
  check(`${ARROWS_PER_ATHLETE} winds generated`, play.state.w?.length === ARROWS_PER_ATHLETE, play.state.w);
  check('every archer starts on the aim stage', Object.values(play.state.a).every((a) => a.st === 'aim'));

  const offset = play.t - Date.now();
  const clock = () => Date.now() + offset;

  autoArcher(host, room.playerId, 'good', clock);
  autoArcher(guest, j1.playerId, 'wild', clock);
  // `idle` never shoots.

  let lastSnapshot = null;
  host.on('game:snapshot', ({ s }) => { lastSnapshot = s; });

  const podium = await waitFor(host, 'game:podium');

  console.log('\nresults');
  const byId = { [room.playerId]: 'ace', [j1.playerId]: 'wild', [j2.playerId]: 'idle' };
  const shots = Object.fromEntries(
    Object.entries(lastSnapshot?.a ?? {}).map(([id, a]) => [byId[id], a.sh.map((x) => x[2])]),
  );
  const totals = Object.fromEntries(
    Object.entries(lastSnapshot?.a ?? {}).map(([id, a]) => [byId[id], a.sc]),
  );

  check('the aimer fired three arrows', shots.ace?.length === ARROWS_PER_ATHLETE, shots);
  check('the wild shooter fired three arrows', shots.wild?.length === ARROWS_PER_ATHLETE, shots);
  check('the idle archer fired none and scored 0', shots.idle?.length === 0 && totals.idle === 0, totals);
  check('every arrow scored inside 0..10', Object.values(shots).flat().every((v) => v >= 0 && v <= 10), shots);
  check('aiming into the wind beat aiming wild', totals.ace > totals.wild, totals);

  const order = podium.placements.map((id) => byId[id]);
  check('the aimer takes first', order[0] === 'ace', order);
  check('the idle archer is last', order[2] === 'idle', order);

  const points = Object.fromEntries(podium.awards.map((a) => [byId[a.playerId], a.points]));
  check('10 / 8 / 6 awarded', points.ace === 10 && points.wild === 8 && points.idle === 6, points);
  check('the round resolved by shooting, not the clock', podium.reason === 'finished', podium.reason);

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error('e2e failed:', err);
  process.exit(1);
});
