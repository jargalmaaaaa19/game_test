// How bots get it wrong.
//
// Every event's `botInput` used to be a metronome with a difficulty-shaped
// offset: perfect alternation down the runway, perfect aim into the wind,
// never a wrong foot, never a foul, never the wrong side. `difficulty` was a
// SPEED dial and nothing else, so the weakest bot in the table still played a
// flawless race — and a flawless slow race beats a good human, because the
// human fumbles and the thing they are racing never did.
//
// Skill now buys two separate things: how quickly a bot acts, and how often it
// fluffs. The mistakes are real ones made through the same `applyInput` a
// phone reaches — a wrong thumb, a stab at the button a stride early, an arrow
// pulled off the gold — so they cost exactly what they cost a player, and a
// bot's result is explainable by watching it.
//
// DETERMINISTIC, like everything else a peer has to agree on: the luck of a
// decision is a hash of WHO is deciding and WHAT they are deciding about, not
// a running random stream. Two consequences, both of which matter more than
// they look:
//
//   - the same decision asked twice gives the same answer, so a bot polled
//     several times inside one tick does not get several rolls of the dice and
//     a fumble that flickers on and off between them;
//   - a test can assert that a weak bot fumbles and a strong one does not,
//     because the mistakes are a function of the match, not of the clock.
//
// Never Math.random(), for the same reason as everywhere else in `shared/`.

import { createRng } from './rng.js';

/**
 * A number in [0,1), stable for one bot's one decision.
 *
 * `occasion` is whatever integer names the decision — the beat, the stride,
 * the attempt, the arrow. `salt` separates two decisions made about the SAME
 * occasion, so a bot's aim wobble and its chance of fluffing the same shot are
 * not the same number wearing two hats.
 */
export function botLuck(botId, occasion, salt = 0) {
  return createRng(`${botId}#${salt}#${Math.floor(occasion) || 0}`)();
}

/** Symmetric wobble in [-spread, +spread]. A spread of 0 is a metronome. */
export function botJitter(botId, occasion, spread, salt = 0) {
  if (!(spread > 0)) return 0;
  return (botLuck(botId, occasion, salt) * 2 - 1) * spread;
}

/**
 * Whether this bot fluffs this one.
 *
 * A chance of 0 never happens, which is what keeps `difficulty: 1` meaning
 * FLAWLESS — the bot tests lean on that, and it is the only clean end for the
 * dial to have. Nothing in the skill table is 1.
 */
export function botSlips(botId, occasion, chance, salt = 0) {
  return chance > 0 && botLuck(botId, occasion, salt) < chance;
}
