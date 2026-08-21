// End-to-end test of the invite path over real sockets.
//
//   DEV_TOOLS=true npm start
//   node tools/invite.e2e.mjs
//
// The platform's friend picker cannot be driven from here, but everything the
// invite actually DOES can: the host opens a room, the id that travels in the
// invite is the room's own code, and the invitee hands that id straight to
// `room:join` and lands in the same room. If this passes and players still
// cannot meet, the fault is in the picker, not in the game.

import { io } from 'socket.io-client';
import { ROOM_CODE_LENGTH } from '../shared/constants.js';

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

const run = async () => {
  const host = await connect('u_host');
  const friend = await connect('u_friend');
  const stranger = await connect('u_stranger');

  console.log('\nthe host opens a room');
  const room = await call(host, 'room:create', {
    name: 'Host', character: 'ch_2', skin: 'sk_6', country: 'JP',
  });
  check('the room opened', room.ok === true, room);
  check('its id is a code an invite can carry', typeof room.code === 'string'
    && room.code.length === ROOM_CODE_LENGTH, room.code);
  check('the host wears the athlete they built', (() => {
    const me = room.state.players.find((p) => p.id === room.playerId);
    return me?.character === 'ch_2' && me?.skin === 'sk_6' && me?.country === 'JP';
  })(), room.state.players[0]);

  console.log('\nthe friend follows the invite');
  // Exactly what the client does with the id the invite hands back.
  const joined = await call(friend, 'room:join', { code: room.code, name: 'Friend' });
  check('the friend got in', joined.ok === true, joined);
  check('into the SAME room, not one of their own', joined.roomId === room.roomId,
    { host: room.roomId, friend: joined.roomId });
  check('and both are on the same roster', joined.state.players.length === 2,
    joined.state.players.map((p) => p.name));

  console.log('\nthe ids that are NOT invitations');
  const placeholder = await call(stranger, 'room:join', { code: 'standalone_a1b2c3d4' });
  check('a standalone_* placeholder is refused, not silently joined',
    placeholder.ok === false, placeholder);
  check('and it is refused as INVALID_INPUT — the error a player saw on the home screen',
    placeholder.error?.code === 'INVALID_INPUT', placeholder.error);

  const missing = await call(stranger, 'room:join', { code: 'ZZZZ' });
  check('a well-formed code for no room is ROOM_NOT_FOUND', missing.error?.code === 'ROOM_NOT_FOUND',
    missing.error);

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error('e2e failed:', err);
  process.exit(1);
});
