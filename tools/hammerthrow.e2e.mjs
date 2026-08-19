// End-to-end test of the hammer throw over real sockets: three throwers, three
// habits, one authoritative measurement.
//
//   DEV_TOOLS=true DEV_PROGRAMME=hammer_throw npm start
//   node tools/hammerthrow.e2e.mjs
//
// What only this test can prove: that the server loads the sim by filename off
// the catalog id, that a `turn` off a socket winds the same athlete the pure
// module does, and that the heading a client releases on survives the round
// trip. The unit test runs the rules; this runs the wiring.

import { io } from 'socket.io-client';
import {
  ATTEMPTS,
  GREEN_HALF_DEG,
  KIND,
  headingAt,
  isFoul,
  wrapAngle,
} from '../shared/events/hammer_throw.js';

const URL = process.env.SMOKE_URL || 'http://localhost:3200';
const RAD = Math.PI / 180;

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
    setTimeout(() => reject(new Error(`${devUserId} never connected`)), 5_000);
  });

const call = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    socket.emit(event, payload, (res) => (res?.ok ? resolve(res) : reject(new Error(JSON.stringify(res)))));
    setTimeout(() => reject(new Error(`${event} timed out`)), 5_000);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The three habits under test:
 *   ace     winds hard and waits for the green arc
 *   scrappy winds hard and lets go the moment it is wound, wherever it points
 *   reckless winds hard and leaves the circle
 */
async function play(socket, role, state) {
  const wind = () => socket.emit('game:input', { t: 'turn' });

  // Everyone winds. The cadence is a real thumb's, not a spin loop.
  for (let i = 0; i < 8; i += 1) {
    wind();
    await sleep(190);
  }

  if (role === 'reckless') {
    socket.emit('game:input', { t: 'foul' });
    return;
  }

  if (role === 'scrappy') {
    socket.emit('game:input', { t: 'release', v: 0 });
    return;
  }

  // The ace keeps winding and releases on the sweep into green, exactly as the
  // screen does: heading read from the last snapshot, reported in degrees.
  for (let i = 0; i < 260; i += 1) {
    const mine = state.snap?.a?.[state.playerId];
    if (!mine || mine.st !== 'wind') break;
    const heading = wrapAngle(
      headingAt({ spin0: mine.s0, spinAt: mine.sa, heading0: mine.h0 }, state.serverT + (Date.now() - state.at)),
    );
    if (Math.abs(heading) <= GREEN_HALF_DEG * RAD * 0.7) {
      socket.emit('game:input', { t: 'release', v: heading / RAD });
      return;
    }
    if (i % 12 === 0) wind();
    await sleep(16);
  }
  socket.emit('game:input', { t: 'release', v: 0 });
}

async function main() {
  console.log(`hammer throw e2e — ${URL}\n`);

  const host = await connect('e2e-ace');
  const b = await connect('e2e-scrappy');
  const c = await connect('e2e-reckless');
  const sockets = [host, b, c];
  const roles = ['ace', 'scrappy', 'reckless'];

  const created = await call(host, 'room:create', { name: 'Ace' });
  const code = created.code;
  const joined = [
    { socket: host, playerId: created.playerId },
    { socket: b, playerId: (await call(b, 'room:join', { code, name: 'Scrappy' })).playerId },
    { socket: c, playerId: (await call(c, 'room:join', { code, name: 'Reckless' })).playerId },
  ];
  check('three throwers seated', joined.every((j) => j.playerId));

  // Every socket tracks the event feed for itself, exactly as a screen does.
  const states = joined.map((j) => {
    const state = { playerId: j.playerId, snap: null, serverT: 0, at: Date.now(), events: [] };
    j.socket.on('game:snapshot', ({ t, s }) => {
      state.snap = s;
      state.serverT = t;
      state.at = Date.now();
    });
    j.socket.on('game:podium', (payload) => state.events.push(payload));
    return state;
  });

  for (const j of joined) await call(j.socket, 'player:ready', { ready: true });
  await call(host, 'game:start');
  check('match started on the forced programme', true);

  // INTRO, then the countdown inside the event itself.
  await sleep(4_500 + 2_600);
  check('the sim is running server-side', Boolean(states[0].snap?.a), states[0].snap ? undefined : 'no snapshot');

  // Three attempts each, played concurrently by three different habits.
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    await Promise.all(joined.map((j, i) => play(j.socket, roles[i], states[i])));
    await sleep(4_800); // the arc plus the officials walking out
  }

  await sleep(1_500);
  const final = states[0].snap;
  const marks = joined.map((j) => final?.a?.[j.playerId]?.j ?? []);

  check('everyone used all three attempts', marks.every((m) => m.length === ATTEMPTS), marks.map((m) => m.length));

  const [aceMarks, scrappyMarks, recklessMarks] = marks;
  const aceBest = final?.a?.[joined[0].playerId]?.bt ?? 0;
  const scrappyBest = final?.a?.[joined[1].playerId]?.bt ?? 0;

  check('the ace has a measured mark', aceBest > 30, aceBest);
  check(
    'the ace released green at least once',
    aceMarks.some((m) => m[2] === KIND.GREEN),
    aceMarks,
  );
  check('winding hard and aiming beats winding hard alone', aceBest >= scrappyBest, { aceBest, scrappyBest });
  check(
    'leaving the circle fouled every reckless attempt',
    recklessMarks.every((m) => m[2] === KIND.LEFT_CIRCLE),
    recklessMarks,
  );
  check(
    'a foul scores nothing',
    recklessMarks.every((m) => m[0] === 0) && (final?.a?.[joined[2].playerId]?.bt ?? 0) === 0,
    recklessMarks,
  );
  check(
    'no mark beat the world record',
    marks.flat().every((m) => m[0] < 86.74),
    marks.flat().map((m) => m[0]),
  );

  // The event has to actually resolve, or the match hangs on the overtime clock.
  await sleep(6_000);
  const result = states[0].events.find((e) => e.eventId === 'hammer_throw');
  check('the event resolved and was scored', Boolean(result?.placements?.length), result?.reason);
  check('it resolved by finishing, not by the overtime backstop', result?.reason === 'finished', result?.reason);
  if (result) {
    // NOT "the reckless one placed last": a thrower who never got a mark ties
    // on zero with anyone else who did not, and that tie breaks on LANE, which
    // is drawn from the match seed and owes nothing to who joined when. What
    // has to hold is the part that is actually a rule.
    const measured = joined.filter((j) => (final?.a?.[j.playerId]?.bt ?? 0) > 0).map((j) => j.playerId);
    const blank = joined.filter((j) => (final?.a?.[j.playerId]?.bt ?? 0) === 0).map((j) => j.playerId);
    const worstMeasured = Math.max(...measured.map((id) => result.placements.indexOf(id)));
    const bestBlank = Math.min(...blank.map((id) => result.placements.indexOf(id)));
    check(
      'every measured mark placed above every thrower without one',
      measured.length === 0 || blank.length === 0 || worstMeasured < bestBlank,
      { placements: result.placements, measured, blank },
    );
  }

  sockets.forEach((s) => s.close());
  console.log(failures === 0 ? '\nall green' : `\n${failures} failing`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('e2e crashed:', err.message);
  process.exit(1);
});
