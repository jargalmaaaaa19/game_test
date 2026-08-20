// End-to-end test of the 50m freestyle over real sockets: three swimmers,
// three senses of rhythm, one authoritative clock.
//
//   DEV_TOOLS=true DEV_PROGRAMME=freestyle_swim npm start
//   node tools/swim.e2e.mjs

import { io } from 'socket.io-client';
import { sideOf } from '../shared/events/freestyle_swim.js';

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
 * Plays like the real client: answers the cue at the front of its own queue,
 * every `gap` ms. `wrongEvery` catches the water backwards every few strokes.
 *
 * The queue pointer comes off the SNAPSHOT rather than a clock, which it can
 * now afford to: nothing expires, so a pointer that is a tick stale costs
 * nothing but a tick. Under the old timed stream that lag was most of the
 * window and the swimmer had to predict the beat instead.
 */
function autoSwimmer(socket, playerId, { gap = 260, wrongEvery = 0 }, play, clock) {
  let strokes = 0;
  let beat = 0;
  let done = false;

  socket.on('game:snapshot', ({ s }) => {
    const a = s.a?.[playerId];
    if (!a) return;
    if (a.d) done = true;
    beat = a.b;
  });

  const stroke = () => {
    if (done) return;
    if (clock() >= play.state.s) {
      strokes += 1;
      const correct = sideOf(play.state.sides, beat);
      const wrong = wrongEvery && strokes % wrongEvery === 0;
      socket.emit('game:input', { s: wrong ? 1 - correct : correct });
    }
    setTimeout(stroke, gap);
  };
  setTimeout(stroke, Math.max(0, play.state.s - clock()));
}

const run = async () => {
  const host = await connect('u_ace');
  const guest = await connect('u_late');
  const idle = await connect('u_idle');

  console.log('\nsetup');
  const room = await call(host, 'room:create', { name: 'Ace' });
  const j1 = await call(guest, 'room:join', { code: room.code, name: 'Late' });
  const j2 = await call(idle, 'room:join', { code: room.code, name: 'Idle' });
  check('three swimmers seated', room.ok && j1.ok && j2.ok);

  for (const s of [host, guest, idle]) await call(s, 'player:ready', { ready: true });
  const started = await call(host, 'game:start');
  check('the swim drawn first', started.programme?.[0] === 'freestyle_swim', started.programme);
  if (started.programme?.[0] !== 'freestyle_swim') {
    console.log('\n  (start the server with DEV_TOOLS=true DEV_PROGRAMME=freestyle_swim)\n');
    process.exit(1);
  }

  console.log('\nthe race');
  const play = await waitFor(host, 'game:play');
  check('play phase carries the event + a first frame', Boolean(play.event && play.state));
  check('the stroke pattern is on the wire', Array.isArray(play.state.sides), typeof play.state.sides);
  check('everyone starts on beat 0 at the wall', Object.values(play.state.a).every((a) => a.b === 0 && a.x === 0));

  const offset = play.t - Date.now();
  const clock = () => Date.now() + offset;

  autoSwimmer(host, room.playerId, { gap: 260 }, play, clock);
  autoSwimmer(guest, j1.playerId, { gap: 520 }, play, clock); // correct, but a laboured cadence
  // `idle` never strokes.

  let last = null;
  host.on('game:snapshot', ({ s }) => { last = s; });

  const podium = await waitFor(host, 'game:podium');

  console.log('\nresults');
  const name = { [room.playerId]: 'ace', [j1.playerId]: 'late', [j2.playerId]: 'idle' };
  const state = Object.fromEntries(Object.entries(last?.a ?? {}).map(([id, a]) => [name[id], a]));

  check('the on-beat swimmer finished', state.ace?.d === 1, state.ace);
  check('the idle swimmer never left the wall', state.idle?.x === 0 && state.idle?.d === 0, state.idle);
  // The queue WAITS. An idle swimmer's cue is still cue zero at the end of the
  // round — the water is what punished them, not a stack of charged misses.
  check('an idle swimmer loses no cues, only the race', state.idle?.b === 0, state.idle?.b);
  check(
    'on-beat beat late',
    state.late?.d === 1 ? state.ace.t < state.late.t : state.ace.x > state.late.x,
    { ace: state.ace?.t, late: state.late?.t ?? state.late?.x },
  );
  check('the winning time is plausible', state.ace?.t > 18_000 && state.ace?.t < 34_000, state.ace?.t);

  const order = podium.placements.map((id) => name[id]);
  check('the on-beat swimmer takes first', order[0] === 'ace', order);
  check('the idle swimmer is last', order[2] === 'idle', order);

  const points = Object.fromEntries(podium.awards.map((a) => [name[a.playerId], a.points]));
  check('10 / 8 / 6 awarded', points.ace === 10 && points.late === 8 && points.idle === 6, points);

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error('e2e failed:', err);
  process.exit(1);
});
