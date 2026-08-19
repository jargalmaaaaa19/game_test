import { randomInt } from 'node:crypto';
import {
  ERROR,
  EVENTS_PER_MATCH,
  CELEBRATION_MS,
  EVENT_OVERTIME_MS,
  PHASE,
  PHASE_DURATION_MS,
  TICK_MS,
} from '../../shared/constants.js';
import { createRng, shuffle } from '../../shared/rng.js';
import { drawProgramme, getEvent } from '../../shared/events/index.js';
import { awardEvent, standings } from '../../shared/scoring.js';
import { config } from './config.js';
import { log } from './log.js';

// ---------------------------------------------------------------------------
// Event simulations are loaded lazily from shared/events/<id>.js. A sport that
// has a catalog entry but no module yet still runs the match — its heat is
// resolved by the overtime clock and flagged `unsimulated`, so the programme,
// the podium and the medal table can be built and played against before all
// twelve sims exist.
// ---------------------------------------------------------------------------
const simCache = new Map();

async function loadSim(eventId) {
  if (simCache.has(eventId)) return simCache.get(eventId);
  let sim = null;
  try {
    const mod = await import(`../../shared/events/${eventId}.js`);
    sim = mod.default ?? null;
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    log.warn('event.sim_missing', { eventId });
  }
  simCache.set(eventId, sim);
  return sim;
}

const broadcast = (io, room) => io.to(room.id).emit('room:state', room.snapshot());

function clearPhaseTimers(room) {
  if (room.phaseTimer) {
    clearTimeout(room.phaseTimer);
    room.phaseTimer = null;
  }
  if (room.tickHandle) {
    clearInterval(room.tickHandle);
    room.tickHandle = null;
  }
}

function schedule(room, ms, fn) {
  if (room.phaseTimer) clearTimeout(room.phaseTimer);
  room.phaseTimer = setTimeout(fn, ms);
  // A pending phase timer must never hold the process open during shutdown.
  room.phaseTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Kickoff
// ---------------------------------------------------------------------------

/**
 * The host pressed Start.
 *
 * Everything that shapes the match — which five sports, and who runs in which
 * lane — is derived from one seed generated here and broadcast with the
 * kickoff. That is what lets a reconnecting client rebuild the programme
 * without asking anyone, and it is why lane 1 is never simply "the player who
 * sent the invite".
 *
 * @returns {{ok: true} | {ok: false, code: string, message: string, detail?: object}}
 */
export function startMatch(io, room, requesterId, now = Date.now()) {
  if (!room.isHost(requesterId)) {
    return { ok: false, code: ERROR.NOT_HOST, message: 'only the host can start the match' };
  }
  if (room.phase !== PHASE.HALL) {
    return { ok: false, code: ERROR.WRONG_PHASE, message: `cannot start from phase ${room.phase}` };
  }

  const gate = room.startability();
  if (!gate.ok) {
    return {
      ok: false,
      code: ERROR[gate.reason],
      message:
        gate.reason === 'TOO_FEW_PLAYERS'
          ? 'need at least 2 connected players'
          : 'everyone present must be ready',
      detail: gate,
    };
  }

  const competitors = room.connectedPlayers();
  const playerIds = competitors.map((p) => p.id);

  // One seed, two derived generators — keeping the draw and the lane shuffle on
  // separate streams means adding a sport later doesn't reshuffle lanes.
  room.seed = randomInt(2 ** 31 - 1);
  const programmeRng = createRng(`${room.seed}:programme`);
  const laneRng = createRng(`${room.seed}:lanes`);

  try {
    const forced = config.devTools ? config.devProgramme.filter((id) => getEvent(id)) : [];
    const drawn = drawProgramme(programmeRng, playerIds.length, EVENTS_PER_MATCH);
    if (forced.length > 0) {
      log.warn('programme.forced', { roomId: room.id, forced });
      room.programme = [...forced, ...drawn.filter((id) => !forced.includes(id))].slice(
        0,
        EVENTS_PER_MATCH,
      );
    } else {
      room.programme = drawn;
    }
  } catch (err) {
    log.error('programme.draw_failed', { roomId: room.id, players: playerIds.length, err: String(err) });
    return { ok: false, code: ERROR.INVALID_INPUT, message: 'no valid programme for this roster' };
  }

  room.lanes = {};
  shuffle(laneRng, playerIds).forEach((id, index) => {
    room.lanes[id] = index + 1;
  });

  room.resetForMatch(playerIds, now);

  log.info('match.started', {
    roomId: room.id,
    code: room.code,
    seed: room.seed,
    players: playerIds.length,
    programme: room.programme,
  });

  io.to(room.id).emit('game:started', {
    seed: room.seed,
    programme: room.programme.map((id) => getEvent(id)),
    lanes: room.lanes,
    competitors: playerIds,
  });

  beginEvent(io, room, 0, now);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-event cycle: INTRO -> PLAY -> PODIUM
// ---------------------------------------------------------------------------

function beginEvent(io, room, index, now = Date.now()) {
  clearPhaseTimers(room);

  room.eventIndex = index;
  room.eventSim = null;
  room.eventState = null;
  room.phase = PHASE.INTRO;
  room.phaseEndsAt = now + PHASE_DURATION_MS[PHASE.INTRO];
  room.touch(now);

  const event = getEvent(room.programme[index]);
  io.to(room.id).emit('game:intro', {
    eventIndex: index,
    event,
    lanes: room.lanes,
    endsAt: room.phaseEndsAt,
  });
  broadcast(io, room);

  schedule(room, PHASE_DURATION_MS[PHASE.INTRO], () => beginPlay(io, room));
}

async function beginPlay(io, room) {
  const now = Date.now();
  clearPhaseTimers(room);

  const eventId = room.programme[room.eventIndex];
  const event = getEvent(eventId);
  const seats = Object.entries(room.lanes)
    .filter(([playerId]) => room.players.has(playerId))
    .map(([playerId, lane]) => ({ playerId, lane }))
    .sort((a, b) => a.lane - b.lane);

  room.phase = PHASE.PLAY;
  room.phaseEndsAt = now + event.durationMs;
  room.touch(now);

  const sim = await loadSim(eventId);
  // The room can be torn down or restarted while the import is in flight.
  if (room.phase !== PHASE.PLAY || room.programme[room.eventIndex] !== eventId) return;

  room.eventSim = sim;
  room.heatOver = false;

  // Only what the renderer needs goes on the wire — see the event's `snapshot`.
  // `t` is the server clock: phones skew by seconds, so every countdown and
  // deadline a client shows is derived from this, never from its own Date.now().
  const wire = () => (sim.snapshot ? sim.snapshot(room.eventState) : room.eventState);

  if (sim) {
    room.eventState = sim.initState(seats, createRng(`${room.seed}:${eventId}`), now);
    let last = now;
    room.tickHandle = setInterval(() => {
      const t = Date.now();
      const dt = Math.min((t - last) / 1000, 0.25); // clamped: a stalled loop must not teleport the sim
      last = t;
      sim.step(room.eventState, dt, t);
      io.to(room.id).emit('game:snapshot', { i: room.eventIndex, t, s: wire() });
      // Hold on the finish before cutting to the results. The tick keeps
      // running, so the athletes keep animating and the stragglers keep
      // swimming in — this replaces the overtime backstop's timer, which is
      // moot once the heat is known to be over.
      if (!room.heatOver && sim.isFinished(room.eventState, t)) {
        room.heatOver = true;
        schedule(room, CELEBRATION_MS, () => {
          finishEvent(io, room, sim.placements(room.eventState), 'finished');
        });
      }
    }, TICK_MS);
    room.tickHandle.unref?.();
  }

  io.to(room.id).emit('game:play', {
    eventIndex: room.eventIndex,
    event,
    endsAt: room.phaseEndsAt,
    simulated: Boolean(sim),
    // Seed the client with a first frame so nothing waits a tick to draw.
    t: now,
    state: sim ? wire() : null,
  });
  broadcast(io, room);

  // Overtime backstop: a heat always ends, whether or not every athlete
  // finished and whether or not a sim exists yet.
  schedule(room, event.durationMs + EVENT_OVERTIME_MS, () => {
    const placements = room.eventSim
      ? room.eventSim.placements(room.eventState)
      : fallbackPlacements(room);
    finishEvent(io, room, placements, 'overtime');
  });
}

/**
 * Deterministic ordering when no sim resolved the heat — lane order, which came
 * from the match seed. Placeholder scoring, never a real result: it is flagged
 * on the wire so the podium can say so.
 */
function fallbackPlacements(room) {
  return Object.entries(room.lanes)
    .filter(([playerId]) => room.players.has(playerId))
    .sort((a, b) => a[1] - b[1])
    .map(([playerId]) => playerId);
}

/**
 * Resolve the current heat. Called by the sim when everyone has finished, by
 * the overtime backstop, or by a future event module directly.
 */
export function finishEvent(io, room, placements, reason = 'finished') {
  if (room.phase !== PHASE.PLAY) return; // already resolved — timers can race
  const now = Date.now();
  clearPhaseTimers(room);

  // Anyone the sim omitted (left mid-heat, never started) is appended, so the
  // medal table always covers the full roster.
  const seen = new Set(placements);
  const full = [...placements, ...room.order.filter((id) => !seen.has(id))].filter((id) =>
    room.players.has(id),
  );

  const awards = awardEvent(room.table, full);

  room.phase = PHASE.PODIUM;
  room.phaseEndsAt = now + PHASE_DURATION_MS[PHASE.PODIUM];
  room.eventSim = null;
  room.eventState = null;
  room.touch(now);

  io.to(room.id).emit('game:podium', {
    eventIndex: room.eventIndex,
    eventId: room.programme[room.eventIndex],
    placements: full,
    awards,
    table: room.table,
    standings: standings(room.table),
    reason,
    endsAt: room.phaseEndsAt,
  });
  broadcast(io, room);

  log.info('event.finished', {
    roomId: room.id,
    eventId: room.programme[room.eventIndex],
    reason,
    placements: full,
  });

  schedule(room, PHASE_DURATION_MS[PHASE.PODIUM], () => {
    const next = room.eventIndex + 1;
    if (next < room.programme.length) beginEvent(io, room, next);
    else beginCeremony(io, room);
  });
}

// ---------------------------------------------------------------------------
// Closing ceremony
// ---------------------------------------------------------------------------

function beginCeremony(io, room) {
  const now = Date.now();
  clearPhaseTimers(room);

  room.phase = PHASE.CEREMONY;
  room.phaseEndsAt = null; // terminal until the host calls a rematch
  room.touch(now);

  const final = standings(room.table);
  io.to(room.id).emit('game:ceremony', {
    standings: final,
    table: room.table,
    programme: room.programme,
    // The client submits its own leaderboard score and the HOST alone calls
    // Usion.game.reportResult with this ordering — never a losing peer.
    result: {
      winnerId: final[0]?.playerId ?? null,
      order: final.map((row) => row.playerId),
      scores: Object.fromEntries(final.map((row) => [row.playerId, row.points])),
    },
  });
  broadcast(io, room);

  log.info('match.finished', { roomId: room.id, winner: final[0]?.playerId, standings: final });
}

/** Host calls a rematch: same room, same roster, fresh seed on the next start. */
export function requestRematch(io, room, requesterId, now = Date.now()) {
  if (!room.isHost(requesterId)) {
    return { ok: false, code: ERROR.NOT_HOST, message: 'only the host can call a rematch' };
  }
  if (room.phase !== PHASE.CEREMONY) {
    return { ok: false, code: ERROR.WRONG_PHASE, message: 'the match is still running' };
  }
  clearPhaseTimers(room);
  room.resetToHall(now);
  io.to(room.id).emit('game:rematch', {});
  broadcast(io, room);
  return { ok: true };
}

/**
 * A match that can no longer be played (everyone but one player gone) ends
 * gracefully rather than freezing on a track nobody is running.
 */
export function abortMatch(io, room, reason) {
  if (room.phase === PHASE.HALL) return;
  clearPhaseTimers(room);
  const now = Date.now();
  room.resetToHall(now);
  io.to(room.id).emit('game:aborted', { reason });
  broadcast(io, room);
  log.warn('match.aborted', { roomId: room.id, reason });
}

export { broadcast, clearPhaseTimers };
