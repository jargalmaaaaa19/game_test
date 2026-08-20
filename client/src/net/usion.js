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
//    `Usion.share(contentType, data)`, `Usion.game.invite({roomId, maxPlayers})`,
//    `Usion.game.onRoomAssigned(cb)`, `Usion.getLaunchParams()`.

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
 * The room a player was invited into, if the game was opened from an invite.
 *
 * `getLaunchParams()` is the SDK's own answer to "how did this session start",
 * and it carries `{path, ref, roomId, mode}`. A roomId here means somebody
 * tapped an invite, and the whole point of the invite flow is that they never
 * have to be told a code.
 *
 * Returns null outside the app, where there are no launch params and no invite.
 */
export function invitedRoomId() {
  if (!embedded) return null;
  try {
    const params = sdk().getLaunchParams?.();
    return params?.roomId || null;
  } catch {
    return null;
  }
}

/**
 * The same answer, but arriving late.
 *
 * An invite can be accepted while the game is ALREADY open — the host taps
 * invite, a friend accepts, and the platform pushes `GAME_ROOM_ASSIGNED` into
 * a session that has been sitting on the home screen. Reading launch params
 * once at boot misses that entirely, so both paths are wired.
 *
 * @returns {() => void} unsubscribe-ish: the SDK keeps one handler per event,
 *   so this clears it rather than removing a specific listener.
 */
export function onInvitedToRoom(handler) {
  if (!embedded) return () => {};
  try {
    sdk().game.onRoomAssigned((payload) => {
      const roomId = payload?.roomId || null;
      if (roomId) handler(roomId);
    });
    return () => {
      try {
        sdk().game.onRoomAssigned(() => {});
      } catch {
        /* nothing to clear */
      }
    };
  } catch {
    return () => {};
  }
}

/**
 * Ask the platform to send an invite for this room.
 *
 * The host never sees a code: the platform opens its own friend picker and
 * delivers the invite into the chat. `roomId` is OUR room code — the same
 * string `room:join` takes — because the id the invite carries comes back to
 * the invitee verbatim, and it is also what the direct-access token is minted
 * against (see `_fetchDirectAccess` in the SDK).
 *
 * @returns {Promise<{success: boolean, invited: string[]}>} `success:false`
 *   outside the Usion app, where the SDK resolves rather than throws — so the
 *   caller can fall back to sharing the code instead of claiming it sent one.
 */
export async function inviteToRoom(roomId, maxPlayers) {
  if (!embedded || !roomId) return { success: false, invited: [] };
  try {
    const res = await sdk().game.invite({
      roomId,
      ...(Number.isFinite(maxPlayers) && maxPlayers > 0 ? { maxPlayers } : {}),
    });
    return { success: Boolean(res?.success), invited: res?.invited ?? [] };
  } catch {
    return { success: false, invited: [] };
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
