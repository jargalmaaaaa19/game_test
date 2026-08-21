import { useCallback, useEffect, useRef, useState } from 'react';
import { PHASE } from '@shared/constants.js';
import { DEFAULT_CHARACTER, DEFAULT_SKIN } from '@shared/avatars.js';
import { DEFAULT_COUNTRY } from '@shared/countries.js';
import { t, errorText } from './i18n.js';
import { SERVER_URL, useRoomSocket } from './net/useRoomSocket.js';
import { invitedRoomId, onInvitedToRoom } from './net/usion.js';
import HomePage from './components/HomePage.jsx';
import LobbyPage from './components/LobbyPage.jsx';
import SprintScreen from './components/SprintScreen.jsx';
import ArcheryScreen from './components/ArcheryScreen.jsx';
import LongJumpScreen from './components/LongJumpScreen.jsx';
import SwimScreen from './components/SwimScreen.jsx';
import { IntroScreen, PodiumScreen } from './components/MatchScreens.jsx';
import CeremonyScreen from './components/CeremonyScreen.jsx';
import PendingEventScreen from './components/PendingEventScreen.jsx';

// Renderers, by event id. A sport with a sim but no screen yet still runs —
// players just watch the phase clock — so the two can land independently.
const EVENT_SCREENS = {
  sprint_100m: SprintScreen,
  archery: ArcheryScreen,
  long_jump: LongJumpScreen,
  freestyle_swim: SwimScreen,
};

const LOOK_KEY = 'usion-olympics:look';

const DEFAULT_LOOK = {
  name: '',
  character: DEFAULT_CHARACTER,
  skin: DEFAULT_SKIN,
  country: DEFAULT_COUNTRY,
};

/**
 * The look is remembered on the device so a returning player never has to build
 * their athlete twice: the picker opens on the athlete they raced as last time.
 * In the Usion host this belongs in `Usion.storage` (durable, survives
 * reinstall); localStorage is the standalone fallback.
 */
function loadLook(hostConfig) {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(LOOK_KEY) || 'null');
  } catch {
    stored = null;
  }
  return {
    ...DEFAULT_LOOK,
    name: hostConfig?.userName || window.Usion?.user?.getName?.() || '',
    ...(stored || {}),
  };
}

export default function App({ hostConfig }) {
  const {
    connection, room, me, error, match, netRef,
    createRoom, joinRoom, soloMatch, linkRoom, leaveRoom, updateIdentity, setReady, startGame, sendInput, clearError,
    requestRematch,
  } = useRoomSocket();

  const phase = room?.phase ?? null;

  const [look, setLook] = useState(() => loadLook(hostConfig));
  const [busy, setBusy] = useState(false);
  const pushTimer = useRef(null);

  useEffect(() => {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  }, [look]);

  // An error belongs to the phase it happened in. Without this, a rejection
  // from mid-match (the server refuses kit changes once the gun has gone) is
  // still sitting on the screen when the match ends and everyone is back in
  // the hall — an error about nothing, blaming the wrong screen.
  useEffect(() => {
    clearError();
  }, [phase, clearError]);

  // Once seated, push look changes to the server — debounced, because dragging
  // through eight outfit colours should not be eight round trips.
  useEffect(() => {
    // Hall only: the server locks kit at kickoff, so pushing here during a race
    // just earns a WRONG_PHASE the player never asked for.
    if (!me || phase !== PHASE.HALL) return undefined;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      updateIdentity({
        name: look.name || undefined,
        character: look.character,
        skin: look.skin,
        country: look.country,
      });
    }, 250);
    return () => clearTimeout(pushTimer.current);
    // `me` is intentionally not a dependency beyond its existence: reacting to
    // every snapshot would echo the server's own state back at it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look, Boolean(me), phase]);

  const guard = useCallback(async (fn) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }, []);

  // The whole look, not just the name: the server dresses the seat as it hands
  // it out, so the athlete a player built is the one that races even when the
  // launch never passes through a lobby.
  const seatLook = () => ({
    name: look.name || undefined,
    character: look.character,
    skin: look.skin,
    country: look.country,
  });

  /**
   * The same look, for a room with nobody in it to be confused by the name.
   *
   * A player who opens the picker and sets no name still has none, and the
   * server names an unnamed seat `Athlete N` — the SAME series it gives the
   * bots. A solo launch would otherwise seat the human as "Athlete 1" between
   * "Athlete 2" and "Athlete 3", with nothing in the results, the medal table
   * or the ceremony to say which row was theirs.
   *
   * Only the solo door gets this. In a room with other people, a seat labelled
   * "You" is a seat labelled wrong on every screen but one.
   */
  const soloSeat = () => {
    const seat = seatLook();
    return seat.name ? seat : { ...seat, name: t.youAthlete };
  };

  // Read through a ref by the invite door, which fires from an effect whose
  // dependency list must not re-arm on every keystroke in the name field, and
  // which needs the look as it stands the moment it runs. It takes the plain
  // seat — it is walking into a room full of other people.
  const seatLookRef = useRef(seatLook);
  seatLookRef.current = seatLook;

  const handleCreate = () => guard(() => createRoom(seatLook()));

  const handleSolo = () => guard(() => soloMatch(soloSeat()));

  // --- arriving from an invite ---------------------------------------------
  // Nobody is ever told a code. The platform owns the friend picker and the
  // delivery; all this game ever sees is a room id, handed over in one of two
  // ways, and its only job is to be in that room when the friend arrives.
  //
  //   AT LAUNCH   the invitee tapped "join" in a chat, so `getLaunchParams()`
  //               carries the roomId before the game has drawn anything.
  //   MID-SESSION `onRoomAssigned` fires — the host tapped invite (ours, or
  //               the app's own Share button) and the platform has put this
  //               session into a room.
  //
  // The second one is registered ONCE and for the whole session, never gated on
  // the launch mode or on whether a game is already running. That is the part
  // this game had wrong: the handler was torn down the moment a room existed,
  // so a player who was already racing bots when their friend was invited never
  // heard about it, and the two of them sat in separate rooms wondering where
  // the other one was. A solo round is exactly the session most likely to be
  // promoted into a real one.
  const [invitePending, setInvitePending] = useState(() => Boolean(invitedRoomId()));
  const [inviteTick, setInviteTick] = useState(0);
  const joinedRef = useRef(null);
  const pendingRoomRef = useRef(invitedRoomId());
  const roomRef = useRef(room);
  roomRef.current = room;

  const takeRoom = useCallback(
    (roomId) => {
      if (!roomId || joinedRef.current === roomId) return;
      joinedRef.current = roomId; // once per room, or a re-render re-joins
      setInvitePending(true);
      guard(async () => {
        // Promoted out of a round against bots: the platform has put somebody
        // real on the way, so the bots come out and we walk into the room they
        // were invited to. Same move the reference implementation makes.
        if (roomRef.current) await leaveRoom();
        return joinRoom({ code: roomId, ...seatLookRef.current() });
      }).finally(() => {
        // Whether it worked or not, stop holding the screen. A room that is
        // gone, full or already racing drops the player on the home screen
        // with the error on it, which is where they can pick an athlete and
        // start a game of their own.
        setInvitePending(false);
      });
    },
    // `look.name` is read at call time on purpose: adding it here would re-arm
    // the effect every keystroke in the name field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guard, joinRoom, leaveRoom],
  );

  /**
   * Teach this server the room the platform actually sent the invitees to.
   *
   * Also claims the id, so the `onRoomAssigned` that follows our own invite is
   * read as "you are in the room you just made" rather than as an invitation
   * out of it.
   */
  const handleLink = useCallback((roomId) => {
    joinedRef.current = roomId;
    return linkRoom(roomId);
  }, [linkRoom]);

  // The registration. Once, on mount, for as long as the game is open.
  useEffect(() => onInvitedToRoom((roomId) => {
    pendingRoomRef.current = roomId;
    setInviteTick((n) => n + 1);
  }), []);

  // And the one place that acts on a room id, once the socket can carry a join.
  useEffect(() => {
    if (connection !== 'connected') return;
    const roomId = pendingRoomRef.current;
    if (!roomId) return;
    pendingRoomRef.current = null;
    // Already in a room with real people in it: this is the id of the room we
    // are standing in, not an invitation out of it. Walking out of a live game
    // on the strength of an echo is the one failure worse than missing one.
    if (roomRef.current && !roomRef.current.players?.some((p) => p.isBot)) return;
    takeRoom(roomId);
  }, [connection, inviteTick, takeRoom]);

  // There is no solo DOOR any more, only a button.
  //
  // The game used to open straight into a round against bots — no menu, no
  // Play button, nothing to tap — on the grounds that a game opening on a
  // lobby is dead content in a swipe feed. The cost of that was everything the
  // home screen is for: the athlete you build, the flag you pick, and the
  // choice between racing bots and racing a friend. All of it existed and none
  // of it was reachable, because the race started before you could see it.
  //
  // So the launch lands here instead, and the first tap starts the race. An
  // INVITE still walks straight in — a player who tapped "join" in a chat has
  // already answered every question this screen would ask them.

  if (connection !== 'connected' && !room) {
    return (
      <div className="grid min-h-full place-items-center px-6 text-center">
        <div className="max-w-xs">
          <p className="text-sm text-neutral-400">
            {connection === 'reconnecting' ? t.reconnecting : t.connecting}
          </p>
          {error && (
            <>
              <p className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {errorText(error)}
              </p>
              {/* The address it is failing against — the first thing anyone
                  needs when a deploy points at the wrong server. */}
              <p className="mt-2 break-all text-[11px] text-neutral-600">{SERVER_URL}</p>
            </>
          )}
          <p className="mt-2 text-xs text-neutral-600">{t.appName}</p>
        </div>
      </div>
    );
  }

  // Joining an invited room: not the home screen, and not an error either —
  // a player who tapped an invite should never be shown a code field on the
  // way in, even for the second it takes to seat them.
  if (!room && invitePending && !error) {
    return (
      <div className="grid min-h-full place-items-center px-6 text-center">
        <div className="max-w-xs">
          <p className="text-sm text-neutral-300">{t.joiningInvite}</p>
          <p className="mt-2 text-xs text-neutral-600">{t.appName}</p>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <HomePage
        look={look}
        onLookChange={setLook}
        onCreate={handleCreate}
        onSolo={handleSolo}
        error={error}
        busy={busy}
      />
    );
  }

  if (room.phase === PHASE.INTRO) {
    return <IntroScreen room={room} me={me} match={match} />;
  }

  if (room.phase === PHASE.PLAY) {
    const Screen = EVENT_SCREENS[room.currentEventId];
    // A sport with a catalog entry but no renderer yet still runs on the server;
    // this screen tells the players what it is and when it ends instead of
    // leaving them on a black page with an id on it.
    if (!Screen) {
      return <PendingEventScreen room={room} me={me} match={match} netRef={netRef} />;
    }
    return (
      <Screen
        room={room}
        me={me}
        netRef={netRef}
        sendInput={sendInput}
        event={match?.kind === 'play' ? match.event : null}
      />
    );
  }

  if (room.phase === PHASE.PODIUM) {
    return <PodiumScreen room={room} me={me} match={match} />;
  }

  if (room.phase === PHASE.CEREMONY) {
    return (
      <CeremonyScreen
        room={room}
        me={me}
        match={match}
        onRematch={() => guard(requestRematch)}
      />
    );
  }

  return (
    <LobbyPage
      room={room}
      me={me}
      look={look}
      onLookChange={setLook}
      onReady={(ready) => guard(() => setReady(ready))}
      onStart={() => guard(startGame)}
      onLink={linkRoom}
      onLeave={() => guard(leaveRoom)}
      error={error}
      busy={busy}
    />
  );
}
