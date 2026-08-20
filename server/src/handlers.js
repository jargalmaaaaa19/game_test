import { ERROR, MAX_PLAYERS, MIN_PLAYERS, PHASE } from '../../shared/constants.js';
import { COUNTRIES } from '../../shared/countries.js';
import { CHARACTERS, SKIN_TONES } from '../../shared/avatars.js';
import { EVENT_CATALOG } from '../../shared/events/index.js';
import { normalizeRoomCode } from './roomCode.js';
import { isCountryTaken, validateIdentity } from './identity.js';
import { abortMatch, broadcast, finishEvent, requestRematch, startMatch } from './phases.js';
import { config } from './config.js';

// How big a field a solo launch gets. Four athletes is enough for a race to
// have a middle — a duel against one bot is either a win or a loss and never a
// position — and small enough that the swipe feed's first frame is not ten
// characters the player has to pick themselves out of.
const DEFAULT_SOLO_BOTS = 3;
import { log } from './log.js';

const fail = (code, message, detail) => ({ ok: false, error: { code, message, ...(detail && { detail }) } });

/** socket.io acks are optional on the wire; never call an undefined callback. */
const respond = (cb, payload) => {
  if (typeof cb === 'function') cb(payload);
  return payload;
};

/**
 * Per-socket token bucket. Cheap insurance: a modded client hammering
 * `player:ready` would otherwise re-broadcast room state to nine phones as fast
 * as it can send.
 */
function createLimiter(capacity, refillPerSec) {
  let tokens = capacity;
  let last = Date.now();
  return function take(cost = 1) {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
    last = now;
    if (tokens < cost) return false;
    tokens -= cost;
    return true;
  };
}

export function registerHandlers(io, store) {
  io.on('connection', (socket) => {
    socket.data.roomId = null;
    socket.data.playerId = null;
    const limit = {
      lobby: createLimiter(10, 2), // create/join/leave/start
      identity: createLimiter(20, 5), // picker taps
      input: createLimiter(60, 40), // in-event input
    };

    log.debug('socket.connected', { socketId: socket.id, userId: socket.data.userId });

    // The catalogs the pickers render from, so the client never hardcodes a list
    // that can drift out of sync with what the server will accept.
    socket.emit('catalog', {
      characters: CHARACTERS,
      skins: SKIN_TONES,
      countries: COUNTRIES,
      events: EVENT_CATALOG,
      limits: { minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, uniqueFlags: config.uniqueFlags },
    });

    const currentRoom = () => (socket.data.roomId ? store.getById(socket.data.roomId) : null);

    const seat = (room, player) => {
      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.playerId = player.id;
    };

    // -----------------------------------------------------------------------
    // Room creation and joining
    // -----------------------------------------------------------------------

    socket.on('room:create', (payload = {}, cb) => {
      if (!limit.lobby()) return respond(cb, fail(ERROR.RATE_LIMITED, 'slow down'));
      if (socket.data.roomId) {
        return respond(cb, fail(ERROR.ALREADY_IN_ROOM, 'leave your current room first'));
      }

      const now = Date.now();
      const room = store.create({ maxPlayers: Number(payload.maxPlayers) || MAX_PLAYERS, now });
      const player = room.addPlayer({
        userId: socket.data.userId,
        socketId: socket.id,
        name: payload.name || socket.data.userName,
        now,
      });
      seat(room, player);

      log.info('room.joined', { roomId: room.id, code: room.code, playerId: player.id, host: true });
      respond(cb, { ok: true, code: room.code, roomId: room.id, playerId: player.id, state: room.snapshot() });
      broadcast(io, room);
    });

    /**
     * A solo launch: room, bots, and the first event, in one call.
     *
     * This is the GameTok door. The feed opens the game and the player is
     * racing — no menu, no lobby, no ready toggle, nothing to tap. Everything
     * it does is something the lobby could do by hand; what it removes is the
     * five taps in between.
     *
     * The bots are seated into a room created HERE, one line earlier, which is
     * why a bot fill is safe to expose at all: there is no room id in the
     * payload, so there is no room but a brand new one for it to reach.
     */
    socket.on('room:solo', (payload = {}, cb) => {
      if (!limit.lobby()) return respond(cb, fail(ERROR.RATE_LIMITED, 'slow down'));
      if (socket.data.roomId) {
        return respond(cb, fail(ERROR.ALREADY_IN_ROOM, 'leave your current room first'));
      }

      const now = Date.now();
      const room = store.create({ maxPlayers: MAX_PLAYERS, now });
      const player = room.addPlayer({
        userId: socket.data.userId,
        socketId: socket.id,
        name: payload.name || socket.data.userName,
        now,
      });
      seat(room, player);
      room.setReady(player.id, true, now);

      // One human plus a field. Clamped to what the room can hold, and to at
      // least one, or the start gate rejects a party of one.
      const asked = Number(payload.bots);
      const wanted = Number.isFinite(asked) ? asked : DEFAULT_SOLO_BOTS;
      room.addBots(Math.max(1, Math.min(wanted, MAX_PLAYERS - 1)), now);

      const result = startMatch(io, room, player.id, now);
      if (!result.ok) {
        log.warn('room.solo.start_failed', { roomId: room.id, code: result.code });
        return respond(cb, fail(result.code, result.message, result.detail));
      }

      log.info('room.solo', { roomId: room.id, playerId: player.id, bots: room.players.size - 1 });
      respond(cb, {
        ok: true,
        code: room.code,
        roomId: room.id,
        playerId: player.id,
        state: room.snapshot(),
        seed: room.seed,
        programme: room.programme,
      });
      broadcast(io, room);
    });

    socket.on('room:join', (payload = {}, cb) => {
      if (!limit.lobby()) return respond(cb, fail(ERROR.RATE_LIMITED, 'slow down'));
      if (socket.data.roomId) {
        return respond(cb, fail(ERROR.ALREADY_IN_ROOM, 'leave your current room first'));
      }

      const code = normalizeRoomCode(payload.code);
      if (!code) return respond(cb, fail(ERROR.INVALID_INPUT, 'that is not a room code'));

      const room = store.getByCode(code);
      if (!room) return respond(cb, fail(ERROR.ROOM_NOT_FOUND, 'no room with that code'));

      const now = Date.now();

      // Reconnect path first: a seat is reclaimed by the SAME user, never by
      // whoever guesses a player id.
      const claimed = payload.playerId ? room.get(String(payload.playerId)) : null;
      if (claimed && claimed.userId === socket.data.userId) {
        room.reattach(claimed.id, socket.id, now);
        seat(room, claimed);
        log.info('room.rejoined', { roomId: room.id, playerId: claimed.id });
        respond(cb, { ok: true, code: room.code, roomId: room.id, playerId: claimed.id, state: room.snapshot(), resumed: true });
        return broadcast(io, room);
      }

      // A tournament in progress does not admit newcomers — five events with a
      // running medal table has no fair place to insert a fresh athlete.
      if (room.phase !== PHASE.HALL) {
        return respond(cb, fail(ERROR.ROOM_LOCKED, 'that match has already started'));
      }
      if (room.isFull) return respond(cb, fail(ERROR.ROOM_FULL, 'that room is full'));

      const player = room.addPlayer({
        userId: socket.data.userId,
        socketId: socket.id,
        name: payload.name || socket.data.userName,
        now,
      });
      seat(room, player);

      log.info('room.joined', { roomId: room.id, code: room.code, playerId: player.id, host: false });
      respond(cb, { ok: true, code: room.code, roomId: room.id, playerId: player.id, state: room.snapshot() });
      broadcast(io, room);
    });

    socket.on('room:leave', (_payload, cb) => {
      const room = currentRoom();
      if (!room) return respond(cb, fail(ERROR.NOT_IN_ROOM, 'you are not in a room'));
      departRoom(io, store, socket, room, 'left');
      respond(cb, { ok: true });
    });

    // -----------------------------------------------------------------------
    // Player configuration: name, face, outfit, flag, ready
    // -----------------------------------------------------------------------

    socket.on('player:identity', (payload = {}, cb) => {
      if (!limit.identity()) return respond(cb, fail(ERROR.RATE_LIMITED, 'slow down'));

      const room = currentRoom();
      if (!room) return respond(cb, fail(ERROR.NOT_IN_ROOM, 'you are not in a room'));
      // Locking the look at kickoff keeps the athlete on the track and the row
      // in the medal table the same person for the whole tournament.
      if (room.phase !== PHASE.HALL) {
        return respond(cb, fail(ERROR.WRONG_PHASE, 'you cannot change kit mid-match'));
      }

      const validation = validateIdentity(payload);
      if (!validation.ok) return respond(cb, fail(validation.code, validation.message));

      const { patch } = validation;
      if (patch.country && isCountryTaken(room, patch.country, socket.data.playerId)) {
        return respond(cb, fail(ERROR.FLAG_TAKEN, 'another athlete is already competing for that country'));
      }

      const player = room.setIdentity(socket.data.playerId, patch, Date.now());
      if (!player) return respond(cb, fail(ERROR.NOT_IN_ROOM, 'your seat is gone'));

      respond(cb, { ok: true, player: room.snapshot().players.find((p) => p.id === player.id) });
      broadcast(io, room);
    });

    socket.on('player:ready', (payload = {}, cb) => {
      if (!limit.identity()) return respond(cb, fail(ERROR.RATE_LIMITED, 'slow down'));

      const room = currentRoom();
      if (!room) return respond(cb, fail(ERROR.NOT_IN_ROOM, 'you are not in a room'));
      if (room.phase !== PHASE.HALL) {
        return respond(cb, fail(ERROR.WRONG_PHASE, 'the match is already running'));
      }

      room.setReady(socket.data.playerId, payload.ready !== false, Date.now());
      respond(cb, { ok: true, startable: room.startability() });
      broadcast(io, room);
    });

    // -----------------------------------------------------------------------
    // Match control
    // -----------------------------------------------------------------------

    socket.on('game:start', (_payload, cb) => {
      if (!limit.lobby()) return respond(cb, fail(ERROR.RATE_LIMITED, 'slow down'));

      const room = currentRoom();
      if (!room) return respond(cb, fail(ERROR.NOT_IN_ROOM, 'you are not in a room'));

      const result = startMatch(io, room, socket.data.playerId);
      if (!result.ok) return respond(cb, fail(result.code, result.message, result.detail));

      respond(cb, { ok: true, seed: room.seed, programme: room.programme });
    });

    socket.on('game:rematch', (_payload, cb) => {
      if (!limit.lobby()) return respond(cb, fail(ERROR.RATE_LIMITED, 'slow down'));
      const room = currentRoom();
      if (!room) return respond(cb, fail(ERROR.NOT_IN_ROOM, 'you are not in a room'));

      const result = requestRematch(io, room, socket.data.playerId);
      if (!result.ok) return respond(cb, fail(result.code, result.message));
      respond(cb, { ok: true });
    });

    /**
     * In-event input. Fire-and-forget on purpose — no ack, no broadcast: the
     * next authoritative snapshot is the answer. Dropping silently past the
     * rate limit beats acking 40 messages a second to ten phones.
     */
    socket.on('game:input', (payload) => {
      if (!limit.input()) return;
      const room = currentRoom();
      if (!room || room.phase !== PHASE.PLAY || !room.eventSim) return;
      room.eventSim.applyInput(room.eventState, socket.data.playerId, payload, Date.now());
    });

    // Dev-only: resolve a heat by hand so the full HALL -> CEREMONY flow is
    // playable before the sims exist. Checked at the call site, not merely
    // declared — an unchecked dev flag once let a bot hijack live rooms.
    socket.on('dev:finish_event', (payload = {}, cb) => {
      if (!config.devTools) return respond(cb, fail(ERROR.INVALID_INPUT, 'unknown event'));
      const room = currentRoom();
      if (!room) return respond(cb, fail(ERROR.NOT_IN_ROOM, 'you are not in a room'));
      if (room.phase !== PHASE.PLAY) return respond(cb, fail(ERROR.WRONG_PHASE, 'no heat running'));

      const placements = Array.isArray(payload.placements) ? payload.placements.map(String) : [];
      finishEvent(io, room, placements, 'dev');
      respond(cb, { ok: true });
    });

    socket.on('disconnect', (reason) => {
      const room = currentRoom();
      log.debug('socket.disconnected', { socketId: socket.id, reason });
      if (!room) return;
      departRoom(io, store, socket, room, 'disconnected');
    });
  });
}

/**
 * A player's socket went away.
 *
 * In the hall the seat is released immediately — a lobby that shows ghosts
 * nobody can start. Mid-match the seat is kept and the sweeper releases it
 * after DISCONNECT_GRACE_MS, so a tunnel or an app switch does not cost
 * somebody their medals.
 */
function departRoom(io, store, socket, room, reason) {
  const now = Date.now();
  const playerId = socket.data.playerId;

  socket.leave(room.id);
  socket.data.roomId = null;
  socket.data.playerId = null;

  if (reason === 'left' || room.phase === PHASE.HALL) room.removePlayer(playerId, now);
  else room.markDisconnected(playerId, now);

  log.info('room.departed', { roomId: room.id, playerId, reason, phase: room.phase });

  if (room.players.size === 0) {
    // Do not destroy here — the store's empty-room grace covers the case where
    // a network blip drops everybody at once.
    return;
  }

  if (room.isInMatch && room.connectedPlayers().length < MIN_PLAYERS) {
    abortMatch(io, room, 'not enough players left');
    return;
  }
  broadcast(io, room);
}

/** Grace expired for a disconnected player — release the seat for real. */
export function expirePlayer(io, room, playerId) {
  room.removePlayer(playerId, Date.now());
  log.info('player.expired', { roomId: room.id, playerId });

  if (room.players.size === 0) return;
  if (room.isInMatch && room.connectedPlayers().length < MIN_PLAYERS) {
    abortMatch(io, room, 'not enough players left');
    return;
  }
  broadcast(io, room);
}
