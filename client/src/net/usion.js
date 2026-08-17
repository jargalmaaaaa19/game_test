// Thin wrapper over the Usion SDK.
//
// Two reasons this exists rather than sprinkling `window.Usion?.` through the
// components:
//
// 1. The lobby also runs in a plain browser tab, where there is no host. Every
//    call here degrades to a no-op or a web fallback instead of throwing.
// 2. Only REAL SDK methods may be called — the platform's quality checker
//    rejects a build containing invented ones. Keeping the surface in one file
//    makes that auditable. Everything below is from the SDK reference:
//    `Usion.leaderboard.submit/top/friends/me`, `Usion.game.reportResult`,
//    `Usion.share(contentType, data)`.

const sdk = () => (typeof window !== 'undefined' ? window.Usion : null);

// The SDK script loads outside the Usion app too and then answers with browser
// defaults, so its mere presence proves nothing. Only a config handed to us by
// `Usion.init` means we are really embedded.
let embedded = false;
export const setHost = (hostConfig) => {
  embedded = Boolean(hostConfig);
};
export const isEmbedded = () => embedded;

/**
 * Every game on Usion ships a leaderboard — it is what puts the game in Game
 * Center and what sends the "«Name» beat your record" notification. A player
 * submits their OWN score; you can never write somebody else's.
 */
export async function submitScore(points, metadata) {
  if (!embedded || !Number.isFinite(points)) return null;
  try {
    return await sdk().leaderboard.submit(points, metadata);
  } catch {
    return null;
  }
}

export async function loadBoards(limit = 10) {
  if (!embedded) return { friends: [], top: [] };
  try {
    const [friends, top] = await Promise.all([
      sdk().leaderboard.friends({ limit }),
      sdk().leaderboard.top({ limit }),
    ]);
    return { friends: friends ?? [], top: top ?? [] };
  } catch {
    return { friends: [], top: [] };
  }
}

// The platform documents result cards for a 2–8 player match. This game seats
// up to 10, so a full house is reported as a win without standings rather than
// risking a rejected payload — and it says so out loud instead of failing
// quietly. Raise the registry's cap and this branch goes away.
export const RESULT_CARD_MAX_PLAYERS = 8;

/**
 * Drops a result card into the chat the game was started from. Host only, once
 * per match — a losing peer must never be able to file the result.
 */
export async function reportMatchResult({ winnerId, standings, scores }) {
  if (!embedded || !winnerId) return null;
  try {
    const payload =
      standings.length <= RESULT_CARD_MAX_PLAYERS
        ? { winnerId, standings, scores }
        : { winnerId };
    if (standings.length > RESULT_CARD_MAX_PLAYERS) {
      sdk().log?.(`reportResult: ${standings.length} players, standings omitted`);
    }
    return await sdk().game.reportResult(payload);
  } catch {
    return null;
  }
}

/**
 * Share the victory card.
 *
 * @returns {Promise<'shared'|'copied'|'unavailable'>} which path actually ran,
 *   so the button can tell the player what happened rather than claiming
 *   success it did not achieve.
 */
export async function shareVictory(text) {
  if (embedded) {
    try {
      await sdk().share('text', { text });
      return 'shared';
    } catch {
      /* fall through to the web paths */
    }
  }
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      // A user dismissing the sheet is not a failure — say nothing.
      if (err?.name === 'AbortError') return 'shared';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'unavailable';
  }
}
