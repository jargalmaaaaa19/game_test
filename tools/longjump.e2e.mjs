// End-to-end test of the long jump over real sockets: three jumpers, three
// habits, one authoritative measurement.
//
//   DEV_TOOLS=true DEV_PROGRAMME=long_jump npm start
//   node tools/longjump.e2e.mjs

import { io } from 'socket.io-client';
import {
  ATTEMPTS,
  GAUGE_M,
  KIND,
  PERFECT_M,
  RUNWAY_M,
} from '../shared/events/long_jump.js';

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
 * Plays like the real client: reads its own state off the snapshot, runs in on
 * alternating thumbs, and presses the button at a mark of its choosing. Where
 * it presses is now the entire skill of the event.
 */
function autoJumper(socket, playerId, pressAt, clock) {
  let lastRunAt = 0;
  let foot = 0;

  socket.on('game:snapshot', ({ s }) => {
    const a = s.a?.[playerId];
    if (!a || a.st !== 'run') return;
    const now = clock();
    if (now < s.s) return;

    if (RUNWAY_M - a.x <= pressAt) {
      socket.emit('game:input', { t: 'jump' });
      return;
    }
    if (now - lastRunAt >= 110) {
      lastRunAt = now;
      foot = foot === 1 ? 0 : 1;
      socket.emit('game:input', { f: foot });
    }
  });
}

const run = async () => {
  const host = await connect('u_ace');
  const guest = await connect('u_early');
  const stepper = await connect('u_over');

  console.log('\nsetup');
  const room = await call(host, 'room:create', { name: 'Ace' });
  const j1 = await call(guest, 'room:join', { code: room.code, name: 'Early' });
  const j2 = await call(stepper, 'room:join', { code: room.code, name: 'Over' });
  check('three jumpers seated', room.ok && j1.ok && j2.ok);

  for (const s of [host, guest, stepper]) await call(s, 'player:ready', { ready: true });
  const started = await call(host, 'game:start');
  check('long jump drawn first', started.programme?.[0] === 'long_jump', started.programme);
  if (started.programme?.[0] !== 'long_jump') {
    console.log('\n  (start the server with DEV_TOOLS=true DEV_PROGRAMME=long_jump)\n');
    process.exit(1);
  }

  console.log('\nthe competition');
  const play = await waitFor(host, 'game:play');
  check('play phase carries the event + a first frame', Boolean(play.event && play.state));
  check('the line is on the wire', play.state.board === RUNWAY_M, play.state.board);
  check('everyone starts on the runway', Object.values(play.state.a).every((a) => a.st === 'run'));

  const offset = play.t - Date.now();
  const clock = () => Date.now() + offset;

  // Green, orange, and a press that never comes until it is too late.
  autoJumper(host, room.playerId, PERFECT_M * 0.75, clock);
  autoJumper(guest, j1.playerId, GAUGE_M - 0.2, clock);
  autoJumper(stepper, j2.playerId, -1, clock);

  let last = null;
  let sawFlight = false;
  host.on('game:snapshot', ({ s }) => {
    last = s;
    if (Object.values(s.a ?? {}).some((a) => a.st === 'flight' && Array.isArray(a.f))) sawFlight = true;
  });

  const podium = await waitFor(host, 'game:podium');

  console.log('\nresults');
  const name = { [room.playerId]: 'ace', [j1.playerId]: 'early', [j2.playerId]: 'over' };
  const jumps = Object.fromEntries(
    Object.entries(last?.a ?? {}).map(([id, a]) => [name[id], a.j]),
  );
  const best = Object.fromEntries(Object.entries(last?.a ?? {}).map(([id, a]) => [name[id], a.bt]));

  check('everyone used three attempts', Object.values(jumps).every((j) => j.length === ATTEMPTS), jumps);
  check('the arc went out on the wire for every client to draw', sawFlight);
  check('a jump on the wire is just distance and kind',
    Object.values(jumps).flat().every((j) => j.length === 2), jumps.ace);
  check('the green presser landed on the line', jumps.ace.some((j) => j[1] === KIND.PERFECT), jumps.ace);
  check('the orange presser scored, in orange',
    jumps.early.every((j) => j[1] === KIND.GOOD) && best.early > 0, jumps.early);
  check('nobody who pressed in a band scored zero',
    Object.values(jumps).flat().every((j) => j[1] === KIND.FOUL || j[0] > 0), jumps);
  check('running past the line fails the attempt',
    jumps.over.every((j) => j[1] === KIND.FOUL && j[0] === 0), jumps.over);
  check('a failed attempt scores nothing at all', best.over === 0, best);
  check('green beat orange', best.ace > best.early, best);
  check('distances are plausible', best.ace > 1 && best.ace < 10, best);

  const order = podium.placements.map((id) => name[id]);
  check('the green presser takes first', order[0] === 'ace', order);
  check('the one who never jumped is last', order[2] === 'over', order);

  const points = Object.fromEntries(podium.awards.map((a) => [name[a.playerId], a.points]));
  check('10 / 8 / 6 awarded', points.ace === 10 && points.early === 8 && points.over === 6, points);

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error('e2e failed:', err);
  process.exit(1);
});
