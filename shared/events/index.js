// The sports catalog and the draw.
//
// EVERY entry here has a working simulation in this folder and a screen in the
// client. The catalog is what players are promised, so a sport that only exists
// as a name is a lie the lobby tells — it previously listed thirteen and could
// only play four.
//
// A match plays EVENTS_PER_MATCH of these, drawn from the match seed. The draw
// spreads control schemes: a run of tapping games is the fastest way to make a
// party game feel like one game played five times.
//
// Each descriptor is metadata only. The simulation lives in its own module next
// to this one and implements the contract in `_template.js`; the phase machine
// calls `finishEvent(room, placements)` when it resolves.

import { EVENTS_PER_MATCH } from '../constants.js';
import { shuffle } from '../rng.js';

/**
 * How the player controls this event — used to diversify the draw.
 *
 * Only the schemes an implemented sport actually uses are listed. Adding a
 * scheme here before a sport uses it is how the catalog drifted into listing
 * nine sports that did not exist.
 */
export const INPUT_SCHEME = {
  ALTERNATE_TAP: 'alternate_tap', // left/right hammering — the sprint
  TAP_AND_HOLD: 'tap_and_hold', // mash, then press-and-release — the long jump
  AIM_DRAG: 'aim_drag', // sweep and lock — archery
  RHYTHM: 'rhythm', // strike on the beat — the swim
};

export const EVENT_CATALOG = [
  {
    id: 'sprint_100m',
    name: { en: '100m Sprint', mn: '100м гүйлт' },
    input: INPUT_SCHEME.ALTERNATE_TAP,
    scoring: 'lowest_time',
    durationMs: 30_000,
    maxLanes: 10,
  },
  {
    id: 'long_jump',
    name: { en: 'Long Jump', mn: 'Уртын харайлт' },
    input: INPUT_SCHEME.TAP_AND_HOLD,
    scoring: 'highest_score',
    durationMs: 50_000,
    maxLanes: 10,
  },
  {
    id: 'archery',
    name: { en: 'Target Shooting', mn: 'Буудлага' },
    input: INPUT_SCHEME.AIM_DRAG,
    scoring: 'highest_score',
    durationMs: 45_000,
    maxLanes: 10,
  },
  {
    id: 'freestyle_swim',
    name: { en: '50m Backstroke', mn: '50м нуруун сэлэлт' },
    input: INPUT_SCHEME.RHYTHM,
    scoring: 'lowest_time',
    durationMs: 45_000,
    maxLanes: 10,
  },
];

const BY_ID = new Map(EVENT_CATALOG.map((e) => [e.id, e]));

export const getEvent = (id) => BY_ID.get(id) || null;

/** Events this roster size can actually play. */
export function eligibleEvents(playerCount) {
  return EVENT_CATALOG.filter(
    (e) => playerCount >= (e.minPlayers ?? 1) && playerCount <= e.maxLanes,
  );
}

/**
 * Draw the match programme.
 *
 * Deterministic in `rng`, so the same seed always yields the same five sports —
 * a reconnecting client rebuilds the programme without asking anyone. Picks
 * greedily, preferring an input scheme not yet drawn, so the five events feel
 * like five different games.
 *
 * @param {() => number} rng   seeded generator from shared/rng.js
 * @param {number} playerCount roster size at kickoff
 * @param {number} count       how many to draw
 * @returns {string[]} event ids, in play order
 */
export function drawProgramme(rng, playerCount, count = EVENTS_PER_MATCH) {
  const pool = shuffle(rng, eligibleEvents(playerCount));
  const chosen = [];
  const usedSchemes = new Set();

  while (chosen.length < count && pool.length > 0) {
    let index = pool.findIndex((e) => !usedSchemes.has(e.input));
    if (index === -1) index = 0; // every scheme already drawn — take the next
    const [event] = pool.splice(index, 1);
    chosen.push(event.id);
    usedSchemes.add(event.input);
  }

  if (chosen.length < count) {
    throw new Error(
      `catalog too small: drew ${chosen.length}/${count} for ${playerCount} players`,
    );
  }
  return chosen;
}
