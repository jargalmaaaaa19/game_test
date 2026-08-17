import { randomUUID } from 'node:crypto';
import {
  DISCONNECT_GRACE_MS,
  EMPTY_ROOM_GRACE_MS,
  ROOM_TTL_MS,
} from '../../shared/constants.js';
import { allocateRoomCode } from './roomCode.js';
import { Room } from './room.js';
import { log } from './log.js';

/**
 * In-memory room registry.
 *
 * Single-process by design: rooms are short-lived and every player in a room
 * must land on the same node anyway. Running more than one instance means
 * sticky sessions plus a socket.io adapter (Redis) — see README.
 */
export class RoomStore {
  constructor() {
    /** @type {Map<string, Room>} */
    this.byId = new Map();
    /** @type {Map<string, string>} code -> roomId */
    this.byCode = new Map();
  }

  create({ maxPlayers, now }) {
    const code = allocateRoomCode((c) => this.byCode.has(c));
    const room = new Room({ id: `room_${randomUUID()}`, code, maxPlayers, now });
    this.byId.set(room.id, room);
    this.byCode.set(code, room.id);
    log.info('room.created', { roomId: room.id, code, maxPlayers: room.maxPlayers });
    return room;
  }

  getById(roomId) {
    return this.byId.get(roomId) ?? null;
  }

  getByCode(code) {
    const roomId = this.byCode.get(code);
    return roomId ? this.byId.get(roomId) ?? null : null;
  }

  destroy(room, reason) {
    if (!this.byId.has(room.id)) return;
    if (room.tickHandle) clearInterval(room.tickHandle);
    if (room.phaseTimer) clearTimeout(room.phaseTimer);
    this.byId.delete(room.id);
    this.byCode.delete(room.code);
    log.info('room.destroyed', { roomId: room.id, code: room.code, reason });
  }

  /**
   * Periodic maintenance. Two separate clocks on purpose:
   * a player's grace (they may come back) and the room's grace (everyone left).
   *
   * @param {(room: Room, playerId: string) => void} onPlayerExpired
   */
  sweep(now, onPlayerExpired) {
    for (const room of this.byId.values()) {
      for (const player of [...room.players.values()]) {
        if (player.connected || player.disconnectedAt == null) continue;
        if (now - player.disconnectedAt < DISCONNECT_GRACE_MS) continue;
        onPlayerExpired(room, player.id);
      }

      if (now - room.createdAt > ROOM_TTL_MS) {
        this.destroy(room, 'ttl');
        continue;
      }
      if (room.emptySince != null && now - room.emptySince > EMPTY_ROOM_GRACE_MS) {
        this.destroy(room, 'empty');
      }
    }
  }

  stats() {
    return {
      rooms: this.byId.size,
      players: [...this.byId.values()].reduce((n, r) => n + r.players.size, 0),
    };
  }
}
