import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/constants.js';

// Codes are read aloud and typed on phones, so: no ambiguous glyphs (see the
// alphabet in shared/constants.js), and normalization maps the mistakes people
// actually make — lowercase, O for 0, I/L for 1.
const CONFUSABLES = { O: '0', Q: '0', I: '1', L: '1', S: '5', Z: '2' };

/** Cryptographically random code. Not sequential — codes must not be guessable. */
export function generateRoomCode(length = ROOM_CODE_LENGTH) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Fold a user-typed code onto the canonical alphabet.
 * @returns {string|null} normalized code, or null if it can't be a valid code
 */
export function normalizeRoomCode(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== ROOM_CODE_LENGTH) return null;

  let out = '';
  for (const ch of raw) {
    if (ROOM_CODE_ALPHABET.includes(ch)) {
      out += ch;
      continue;
    }
    // The confusable table maps INTO the alphabet; if the target isn't in it
    // either, the character is simply invalid.
    const mapped = CONFUSABLES[ch];
    if (mapped && ROOM_CODE_ALPHABET.includes(mapped)) {
      out += mapped;
      continue;
    }
    return null;
  }
  return out;
}

/**
 * Draw a code that isn't in use. `isTaken` is passed in so this module stays
 * free of store knowledge (and testable).
 */
export function allocateRoomCode(isTaken, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    const code = generateRoomCode();
    if (!isTaken(code)) return code;
  }
  // 32^4 ≈ 1M codes; exhausting 50 draws means the space is genuinely crowded.
  for (let i = 0; i < attempts; i += 1) {
    const code = generateRoomCode(ROOM_CODE_LENGTH + 1);
    if (!isTaken(code)) return code;
  }
  throw new Error('room code space exhausted');
}
