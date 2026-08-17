// Placement -> points -> medal table.
//
// Every event reports `placements` (an array of player ids, best first). That is
// the ONLY path into the score, so the server, a local bot round, and a replay
// all score identically regardless of whether the event measures time, distance
// or survival.

export const PLACEMENT_POINTS = [10, 8, 6, 5, 4, 3, 2, 1, 1, 1];

export function pointsForPlacement(index) {
  return PLACEMENT_POINTS[index] ?? 1;
}

/** Fresh medal table for a roster. */
export function createTable(playerIds) {
  const table = {};
  for (const id of playerIds) {
    table[id] = { points: 0, gold: 0, silver: 0, bronze: 0, placements: [] };
  }
  return table;
}

/**
 * Fold one event's result into the table. Returns the per-player award so the
 * podium screen can animate "+8" without recomputing.
 */
export function awardEvent(table, placements) {
  const awards = [];
  placements.forEach((playerId, index) => {
    const row = table[playerId];
    if (!row) return;
    const points = pointsForPlacement(index);
    row.points += points;
    row.placements.push(index + 1);
    if (index === 0) row.gold += 1;
    else if (index === 1) row.silver += 1;
    else if (index === 2) row.bronze += 1;
    awards.push({ playerId, place: index + 1, points });
  });
  return awards;
}

/**
 * Final ordering, best first. Ties break on golds, then silvers, then bronzes,
 * then the better single placement — a deterministic chain, so every client
 * renders the same podium.
 */
export function standings(table) {
  return Object.entries(table)
    .map(([playerId, row]) => ({ playerId, ...row }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.gold !== a.gold) return b.gold - a.gold;
      if (b.silver !== a.silver) return b.silver - a.silver;
      if (b.bronze !== a.bronze) return b.bronze - a.bronze;
      return Math.min(...a.placements, 99) - Math.min(...b.placements, 99);
    });
}
