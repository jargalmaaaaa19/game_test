import { randomUUID } from 'node:crypto';
import { MAX_PLAYERS, MIN_PLAYERS, PHASE } from '../../shared/constants.js';
import { createTable } from '../../shared/scoring.js';
import { defaultIdentity } from './identity.js';

/**
 * One party. Holds roster + match state; the phase machine (phases.js) drives
 * transitions, and handlers.js owns all socket I/O. Nothing here touches a
 * socket, which is what makes a room testable without a network.
 */
export class Room {
  constructor({ id, code, maxPlayers = MAX_PLAYERS, now }) {
    this.id = id;
    this.code = code;
    this.maxPlayers = Math.min(Math.max(maxPlayers, MIN_PLAYERS), MAX_PLAYERS);

    /** @type {Map<string, object>} playerId -> player */
    this.players = new Map();
    /** Roster order = join order. `order[0]` is the host, matching the platform. */
    this.order = [];

    this.phase = PHASE.HALL;
    this.phaseEndsAt = null;

    // Filled at kickoff by phases.startMatch.
    this.seed = null;
    this.programme = []; // event ids, in play order
    this.eventIndex = -1;
    this.lanes = {}; // playerId -> lane number
    this.table = {}; // medal table
    this.eventSim = null; // loaded sim module for the current event
    this.eventState = null; // its authoritative state
    this.tickHandle = null;
    this.phaseTimer = null;

    this.createdAt = now;
    this.lastActivityAt = now;
    this.emptySince = null;
    // Bumped on every mutation so a client can drop an out-of-order snapshot.
    this.version = 0;
  }

  touch(now) {
    this.lastActivityAt = now;
    this.version += 1;
  }

  get hostId() {
    return this.order[0] ?? null;
  }

  isHost(playerId) {
    return this.hostId === playerId && playerId != null;
  }

  get(playerId) {
    return this.players.get(playerId) ?? null;
  }

  /** Seats currently occupied — a disconnected player inside grace still holds one. */
  get seatCount() {
    return this.players.size;
  }

  get isFull() {
    return this.players.size >= this.maxPlayers;
  }

  get isInMatch() {
    return this.phase !== PHASE.HALL && this.phase !== PHASE.CEREMONY;
  }

  connectedPlayers() {
    return this.order.map((id) => this.players.get(id)).filter((p) => p && p.connected);
  }

  /**
   * Seat a new player. Identity defaults are assigned here so a player who never
   * opens the picker still has a name, a face and their own flag.
   */
  addPlayer({ playerId, userId, socketId, name, isBot = false, now }) {
    const id = playerId || `p_${randomUUID().slice(0, 8)}`;
    const identity = defaultIdentity(this, name || `Athlete ${this.players.size + 1}`);

    const player = {
      id,
      // The authenticated Usion user behind this seat. A reconnect must present
      // the same one, or a room code would be enough to steal somebody's seat.
      userId: userId ?? null,
      socketId,
      ...identity,
      ready: false,
      connected: !isBot,
      isBot,
      joinedAt: now,
      lastSeenAt: now,
      disconnectedAt: null,
    };

    this.players.set(id, player);
    this.order.push(id);
    this.emptySince = null;
    this.touch(now);
    return player;
  }

  /** Reclaim an existing seat after a reconnect — keeps look, ready flag, points. */
  reattach(playerId, socketId, now) {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.socketId = socketId;
    player.connected = true;
    player.disconnectedAt = null;
    player.lastSeenAt = now;
    this.emptySince = null;
    this.touch(now);
    return player;
  }

  /**
   * Mark a player's socket gone. The seat is NOT freed — DISCONNECT_GRACE_MS of
   * slack means a subway tunnel doesn't cost someone their medals.
   */
  markDisconnected(playerId, now) {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.connected = false;
    player.disconnectedAt = now;
    player.socketId = null;
    if (this.connectedPlayers().length === 0) this.emptySince = now;
    this.touch(now);
    return player;
  }

  /** Free the seat for good. Host moves to the next in roster order. */
  removePlayer(playerId, now) {
    if (!this.players.delete(playerId)) return false;
    this.order = this.order.filter((id) => id !== playerId);
    delete this.lanes[playerId];
    if (this.connectedPlayers().length === 0) this.emptySince = now;
    this.touch(now);
    return true;
  }

  setIdentity(playerId, patch, now) {
    const player = this.players.get(playerId);
    if (!player) return null;
    Object.assign(player, patch);
    // Changing your look un-readies you: nobody should be able to swap country
    // after the host has seen a green room and pressed Start.
    if (patch.country !== undefined || patch.name !== undefined) player.ready = false;
    this.touch(now);
    return player;
  }

  setReady(playerId, ready, now) {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.ready = Boolean(ready);
    this.touch(now);
    return player;
  }

  /**
   * Start gate: at least MIN_PLAYERS present, and everyone who is actually here
   * has readied. A disconnected seat neither blocks the start nor counts toward
   * the minimum.
   */
  startability() {
    const present = this.connectedPlayers();
    if (present.length < MIN_PLAYERS) {
      return { ok: false, reason: 'TOO_FEW_PLAYERS', present: present.length };
    }
    const notReady = present.filter((p) => !p.ready && !p.isBot).map((p) => p.id);
    if (notReady.length > 0) {
      return { ok: false, reason: 'NOT_EVERYONE_READY', notReady };
    }
    return { ok: true, present: present.length };
  }

  resetForMatch(playerIds, now) {
    this.table = createTable(playerIds);
    this.eventIndex = -1;
    this.eventSim = null;
    this.eventState = null;
    this.touch(now);
  }

  /** Back to the hall for a rematch — look and roster survive, scores don't. */
  resetToHall(now) {
    this.phase = PHASE.HALL;
    this.phaseEndsAt = null;
    this.seed = null;
    this.programme = [];
    this.eventIndex = -1;
    this.lanes = {};
    this.table = {};
    this.eventSim = null;
    this.eventState = null;
    for (const player of this.players.values()) player.ready = false;
    this.touch(now);
  }

  /** Everything a client needs to render the hall and the HUD. */
  snapshot() {
    return {
      roomId: this.id,
      code: this.code,
      version: this.version,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      hostId: this.hostId,
      maxPlayers: this.maxPlayers,
      programme: this.programme,
      eventIndex: this.eventIndex,
      currentEventId: this.programme[this.eventIndex] ?? null,
      lanes: this.lanes,
      table: this.table,
      players: this.order.map((id) => {
        const p = this.players.get(id);
        return {
          id: p.id,
          name: p.name,
          skin: p.skin,
          build: p.build,
          hair: p.hair,
          outfit: p.outfit,
          country: p.country,
          ready: p.ready,
          connected: p.connected,
          isBot: p.isBot,
          isHost: this.hostId === p.id,
        };
      }),
    };
  }
}
