// Pure constants shared by the server sim and the client renderer.
// No DOM, no Node APIs, no engine references — this file is imported by both.

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

// One match plays every sport in the catalog, in a seed-shuffled order. Keep
// this at or below the catalog size — `drawProgramme` throws rather than
// repeat a sport, so asking for more events than exist means no match can
// start at all.
export const EVENTS_PER_MATCH = 4;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

export const ROOM_CODE_LENGTH = 4;
// No O/0/I/1 — these get misread when a code is shouted across a room.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const PHASE = {
  HALL: 'hall',
  INTRO: 'intro',
  PLAY: 'play',
  PODIUM: 'podium',
  CEREMONY: 'ceremony',
};

export const PHASE_DURATION_MS = {
  [PHASE.INTRO]: 4_000,
  [PHASE.PODIUM]: 6_000,
  [PHASE.CEREMONY]: 30_000,
};

// A player who has not finished an event by this margin past its nominal
// duration is placed last for that event and the match moves on.
export const EVENT_OVERTIME_MS = 5_000;

export const NAME_MAX_LENGTH = 16;
export const CHAT_MAX_LENGTH = 60;

// A disconnected player keeps their seat (and their medal points) for this long.
export const DISCONNECT_GRACE_MS = 20_000;
// An empty room is swept this long after the last player leaves, so a network
// blip that drops everyone at once does not destroy a live tournament.
export const EMPTY_ROOM_GRACE_MS = 60_000;
// Hard ceiling on room lifetime, regardless of activity.
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

export const SWEEP_INTERVAL_MS = 15_000;

export const ERROR = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_LOCKED: 'ROOM_LOCKED',
  ALREADY_IN_ROOM: 'ALREADY_IN_ROOM',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  NOT_HOST: 'NOT_HOST',
  TOO_FEW_PLAYERS: 'TOO_FEW_PLAYERS',
  NOT_EVERYONE_READY: 'NOT_EVERYONE_READY',
  FLAG_TAKEN: 'FLAG_TAKEN',
  INVALID_INPUT: 'INVALID_INPUT',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  WRONG_PHASE: 'WRONG_PHASE',
};
