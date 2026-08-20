import { ERROR, NAME_MAX_LENGTH } from '../../shared/constants.js';
import {
  CHARACTERS,
  SKIN_TONES,
  characterDesign,
  isCharacter,
  isSkin,
} from '../../shared/avatars.js';
import { DEFAULT_COUNTRY, isCountry } from '../../shared/countries.js';
import { config } from './config.js';

// Strip anything that could break a name out of its own label: control chars,
// zero-width characters, and the bidi overrides used to spoof another player's
// name. Built from escapes on purpose — as literals these are invisible in an
// editor and get mangled by tooling.
const UNSAFE = new RegExp(
  '[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]',
  'g',
);

/**
 * @returns {string} a display name that is always safe to render, never empty
 */
export function sanitizeName(input, fallback = 'Athlete') {
  if (typeof input !== 'string') return fallback;
  const cleaned = input.replace(UNSAFE, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  // Spread, not slice: a 16-char cut must not split a surrogate pair and leave
  // half an emoji behind.
  return [...cleaned].slice(0, NAME_MAX_LENGTH).join('');
}

/**
 * Validate a player's requested look. Unknown ids are rejected rather than
 * silently defaulted — a client sending garbage is a bug worth surfacing.
 *
 * @returns {{ok: true, patch: object} | {ok: false, code: string, message: string}}
 */
export function validateIdentity(patch) {
  if (!patch || typeof patch !== 'object') {
    return { ok: false, code: ERROR.INVALID_INPUT, message: 'identity payload required' };
  }

  const out = {};

  if (patch.name !== undefined) out.name = sanitizeName(patch.name);

  if (patch.skin !== undefined) {
    if (!isSkin(patch.skin)) {
      return { ok: false, code: ERROR.INVALID_INPUT, message: `unknown skin tone: ${patch.skin}` };
    }
    out.skin = patch.skin;
  }

  // A character is chosen whole, and RESOLVED here rather than on the client.
  // Hairstyle, outfit and build are no longer things a client may ask for: they
  // are what the character is, so a payload that sets them individually is an
  // old client rather than a supported one. Resolving server-side is also what
  // keeps every renderer working unchanged — what goes out on the snapshot is
  // still a fully described look.
  if (patch.character !== undefined) {
    if (!isCharacter(patch.character)) {
      return {
        ok: false,
        code: ERROR.INVALID_INPUT,
        message: `unknown character: ${patch.character}`,
      };
    }
    out.character = patch.character;
    Object.assign(out, characterDesign(patch.character));
  }

  if (patch.country !== undefined) {
    if (!isCountry(patch.country)) {
      return { ok: false, code: ERROR.INVALID_INPUT, message: `unknown country: ${patch.country}` };
    }
    out.country = patch.country;
  }

  if (Object.keys(out).length === 0) {
    return { ok: false, code: ERROR.INVALID_INPUT, message: 'nothing to update' };
  }
  return { ok: true, patch: out };
}

/**
 * Flags are claimed first-come-first-served so the flag stays a reliable way to
 * tell athletes apart on a crowded track. Arbitrated here, on the server — two
 * clients checking locally would both think they got Mongolia.
 */
export function isCountryTaken(room, code, exceptPlayerId) {
  if (!config.uniqueFlags) return false;
  for (const player of room.players.values()) {
    if (player.id !== exceptPlayerId && player.country === code) return true;
  }
  return false;
}

// Draw order for auto-assigned flags, so a room where nobody opens the picker
// still fields distinguishable athletes.
const FALLBACK_COUNTRIES = [
  DEFAULT_COUNTRY, 'JP', 'KR', 'US', 'BR', 'DE', 'FR', 'IT', 'KZ', 'CA', 'AU', 'MX',
];

/**
 * A look for a player who has not opened the picker yet (solo launch, bots).
 *
 * Everyone used to get DEFAULT_CHARACTER in DEFAULT_SKIN, which meant a field
 * of bots was four copies of one athlete wearing four different flags — on a
 * track, at a distance, indistinguishable. The seat index walks the catalogue
 * instead, so a race has a field in it. A human who opens the picker overwrites
 * all of this anyway.
 */
export function defaultIdentity(room, name) {
  const taken = new Set([...room.players.values()].map((p) => p.country));
  const country = config.uniqueFlags
    ? FALLBACK_COUNTRIES.find((c) => !taken.has(c)) || DEFAULT_COUNTRY
    : DEFAULT_COUNTRY;

  // Where in the room this seat lands. Deliberately the seat COUNT rather than
  // a random draw: the same room always dresses its athletes the same way, so
  // a reconnect and a replay agree with what everyone already saw.
  const seat = room.players.size;
  const character = CHARACTERS[seat % CHARACTERS.length].id;
  const skin = SKIN_TONES[(seat * 3) % SKIN_TONES.length].id;

  return {
    name: sanitizeName(name),
    character,
    skin,
    ...characterDesign(character),
    country,
  };
}
