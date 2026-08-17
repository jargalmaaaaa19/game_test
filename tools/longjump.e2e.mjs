// End-to-end test of the long jump over real sockets: three jumpers, three
// habits, one authoritative measurement.
//
//   DEV_TOOLS=true DEV_PROGRAMME=long_jump npm start
//   node tools/longjump.e2e.mjs

import { io } from 'socket.io-client';
import { ATTEMPTS, IDEAL_ANGLE_DEG, RUNWAY_M, angleAt } from '../shared/events/long_jump.js';

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
 * Plays like the real client: reads its own stage off the snapshot and taps.
 * `style` decides where it commits — which is the entire skill of the event.
 */
function autoJumper(socket, playerId, style, clock) {
  let lastRunAt = 0;
  let released = '';

  socket.on('game:snapshot', ({ s }) => {
    const a = s.a?.[playerId];
    if (!a || a.st === 'done') return;
    const now = clock();
    if (now < s.s) return;

    if (a.st === 'takeoff') {
      const dial = angleAt({ holdAt: a.ha }, now);
      const key = String(a.ha);
      // 'good' waits for ~45°; 'flat' bails out immediately at a poor angle.
      const want = style === 'good' ? Math.abs(dial - IDEAL_ANGLE_DEG) < 6 : dial > 8;
      if (want && released !== key) {
        released = key;
        socket.emit('game:input', { t: 'release', v: dial });
      }
      return;
    }

    // 'foul' deliberately runs past the board before committing.
    const commitAt = style === 'foul' ? RUNWAY_M + 0.6 : RUNWAY_M - 0.5;
    if (a.x >= commitAt) {
      socket.emit('game:input', { t: 'jump' });
      return;
    }
    if (now - lastRunAt >= 110) {
      lastRunAt = now;
      socket.emit('game:input', { t: 'run' });
    }
  });
}

const run = async () => {
  const host = await connect('u_ace');
  const guest = await connect('u_flat');
  const fouler = await connect('u_foul');

  console.log('\nsetup');
  const room = await call(host, 'room:create', { name: 'Ace' });
  const j1 = await call(guest, 'room:join', { code: room.code, name: 'Flat' });
  const j2 = await call(fouler, 'room:join', { code: room.code, name: 'Foul' });
  check('three jumpers seated', room.ok && j1.ok && j2.ok);

  for (const s of [host, guest, fouler]) await call(s, 'player:ready', { ready: true });
  const started = await call(host, 'game:start');
  check('long jump drawn first', started.programme?.[0] === 'long_jump', started.programme);
  if (started.programme?.[0] !== 'long_jump') {
    console.log('\n  (start the server with DEV_TOOLS=true DEV_PROGRAMME=long_jump)\n');
    process.exit(1);
  }

  console.log('\nthe competition');
  const play = await waitFor(host, 'game:play');
  check('play phase carries the event + a first frame', Boolean(play.event && play.state));
  check('the board is on the wire', play.state.board === RUNWAY_M, play.state.board);
  check('everyone starts on the runway', Object.values(play.state.a).every((a) => a.st === 'run'));

  const offset = play.t - Date.now();
  const clock = () => Date.now() + offset;

  autoJumper(host, room.playerId, 'good', clock);
  autoJumper(guest, j1.playerId, 'flat', clock);
  autoJumper(fouler, j2.playerId, 'foul', clock);

  let last = null;
  host.on('game:snapshot', ({ s }) => { last = s; });

  const podium = await waitFor(host, 'game:podium');

  console.log('\nresults');
  const name = { [room.playerId]: 'ace', [j1.playerId]: 'flat', [j2.playerId]: 'foul' };
  const jumps = Object.fromEntries(
    Object.entries(last?.a ?? {}).map(([id, a]) => [name[id], a.j]),
  );
  const best = Object.fromEntries(Object.entries(last?.a ?? {}).map(([id, a]) => [name[id], a.bt]));

  check('everyone used three attempts', Object.values(jumps).every((j) => j.length === ATTEMPTS), jumps);
  check('the aimer recorded a legal jump', jumps.ace.some((j) => !j[2] && j[0] > 0), jumps.ace);
  check('every one of the fouler’s attempts is a foul', jumps.foul.every((j) => j[2] === 1), jumps.foul);
  check('a foul measures zero', jumps.foul.every((j) => j[0] === 0), jumps.foul);
  check('the fouler’s best stays 0', best.foul === 0, best);
  check('45° beat a flat take-off', best.ace > best.flat, best);
  check('distances are plausible', best.ace > 1 && best.ace < 10, best);

  const order = podium.placements.map((id) => name[id]);
  check('the 45° jumper takes first', order[0] === 'ace', order);
  check('the fouler is last', order[2] === 'foul', order);

  const points = Object.fromEntries(podium.awards.map((a) => [name[a.playerId], a.points]));
  check('10 / 8 / 6 awarded', points.ace === 10 && points.flat === 8 && points.foul === 6, points);

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error('e2e failed:', err);
  process.exit(1);
});
