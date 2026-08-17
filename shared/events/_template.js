// Copy this file to add a sport. Everything here is PURE: no DOM, no Phaser, no
// Node APIs, no Math.random(), no Date.now(). The server imports it to run the
// authoritative sim; the client imports the same file for local bot rounds and
// for client-side prediction of the local athlete. Two copies of the rules is
// how a game desyncs.

/** @typedef {{ playerId: string, lane: number }} Seat */

export default {
  id: 'template',

  /**
   * Build the event's slice of room state.
   * @param {Seat[]} seats     lane assignment, already derived from the match seed
   * @param {() => number} rng event-scoped seeded generator
   * @param {number} now       server epoch ms, passed in — never read the clock
   */
  initState(seats, rng, now) {
    return {
      startedAt: now,
      athletes: Object.fromEntries(
        seats.map(({ playerId, lane }) => [playerId, { lane, x: 0, done: false }]),
      ),
    };
  },

  /**
   * Apply one validated input. Must be idempotent-safe under resync and must
   * never trust the payload — it arrived from a phone.
   */
  applyInput(state, playerId, input, now) {
    const athlete = state.athletes[playerId];
    if (!athlete || athlete.done) return;
    // ... clamp, validate, mutate
  },

  /** Fixed timestep. `dt` in SECONDS. */
  step(state, dt, now) {
    // ... advance the sim
  },

  /** True once the event has resolved for everyone (or overtime expired). */
  isFinished(state, now) {
    return Object.values(state.athletes).every((a) => a.done);
  },

  /**
   * THE scoring seam: player ids, best first. Unfinished athletes go last, in a
   * deterministic order (never Object.keys iteration order alone).
   */
  placements(state) {
    return Object.entries(state.athletes)
      .sort((a, b) => {
        if (a[1].done !== b[1].done) return a[1].done ? -1 : 1;
        return b[1].x - a[1].x;
      })
      .map(([playerId]) => playerId);
  },

  /** Drives bot seats in a solo launch and fills for a stalled player. */
  botInput(state, botId, difficulty, now) {
    return null;
  },
};
