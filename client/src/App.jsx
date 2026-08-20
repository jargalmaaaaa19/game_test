import { useCallback, useEffect, useRef, useState } from 'react';
import { PHASE } from '@shared/constants.js';
import { DEFAULT_CHARACTER, DEFAULT_SKIN } from '@shared/avatars.js';
import { DEFAULT_COUNTRY } from '@shared/countries.js';
import { t, errorText } from './i18n.js';
import { SERVER_URL, useRoomSocket } from './net/useRoomSocket.js';
import { invitedRoomId, launchedSolo, onInvitedToRoom } from './net/usion.js';
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
 * their athlete twice — which is also what makes a zero-tap solo launch
 * possible later. In the Usion host this belongs in `Usion.storage` (durable,
 * survives reinstall); localStorage is the standalone fallback.
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
    createRoom, joinRoom, soloMatch, leaveRoom, updateIdentity, setReady, startGame, sendInput, clearError,
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

  const handleCreate = () => guard(() => createRoom({ name: look.name || undefined }));
  const handleSolo = () => guard(() => soloMatch({ name: look.name || undefined }));

  // --- arriving from an invite ---------------------------------------------
  // The invited player never sees a code. The platform hands us the room, and
  // the only correct thing to do with it is walk straight in: a player who
  // tapped "join" in a chat has already answered every question the home
  // screen would ask them.
  //
  // Two doors, because an invite can be accepted before the game is open (the
  // roomId is in the launch params) or while it is already sitting on the home
  // screen (GAME_ROOM_ASSIGNED arrives live). Missing the second one strands
  // the most common case of all: the host invites a friend who is already in
  // the game.
  const [invitePending, setInvitePending] = useState(() => Boolean(invitedRoomId()));
  const joinedRef = useRef(null);

  const acceptInvite = useCallback(
    (roomId) => {
      if (!roomId || joinedRef.current === roomId) return;
      joinedRef.current = roomId; // once per room, or a re-render re-joins
      setInvitePending(true);
      guard(() => joinRoom({ code: roomId, name: look.name || undefined })).finally(() =>
        setInvitePending(false),
      );
    },
    // `look.name` is read at call time on purpose: adding it here would re-arm
    // the effect every keystroke in the name field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guard, joinRoom],
  );

  useEffect(() => {
    // Wait for the socket: joining before the connection is up just fails.
    if (connection !== 'connected' || room) return undefined;
    const launched = invitedRoomId();
    if (launched) acceptInvite(launched);
    return onInvitedToRoom(acceptInvite);
  }, [connection, room, acceptInvite]);

  // The solo door. A launch that is not an invite starts a round against bots
  // the moment the socket is up — no menu, no Play button, nothing to tap. The
  // invite door above runs first and claims the session when there is a room to
  // join, so the two can never both fire.
  const soloRef = useRef(false);
  useEffect(() => {
    if (connection !== 'connected' || room || soloRef.current) return;
    if (invitedRoomId() || !launchedSolo(hostConfig)) return;
    soloRef.current = true;
    guard(() => soloMatch({ name: look.name || undefined }));
    // `look.name` is read at call time, as with the invite: adding it here
    // would re-arm the effect on every keystroke in the name field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, room, guard, soloMatch, hostConfig]);

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
      onLeave={() => guard(leaveRoom)}
      error={error}
      busy={busy}
    />
  );
}
