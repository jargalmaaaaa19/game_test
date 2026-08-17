import { useCallback, useEffect, useRef, useState } from 'react';
import { PHASE } from '@shared/constants.js';
import { DEFAULT_BUILD, DEFAULT_HAIR, DEFAULT_OUTFIT, DEFAULT_SKIN } from '@shared/avatars.js';
import { DEFAULT_COUNTRY } from '@shared/countries.js';
import { t } from './i18n.js';
import { useRoomSocket } from './net/useRoomSocket.js';
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
  skin: DEFAULT_SKIN,
  build: DEFAULT_BUILD,
  hair: DEFAULT_HAIR,
  outfit: DEFAULT_OUTFIT,
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
    createRoom, joinRoom, leaveRoom, updateIdentity, setReady, startGame, sendInput, clearError,
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
        skin: look.skin,
        build: look.build,
        hair: look.hair,
        outfit: look.outfit,
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
  const handleJoin = (code) => guard(() => joinRoom({ code, name: look.name || undefined }));

  if (connection !== 'connected' && !room) {
    return (
      <div className="grid min-h-full place-items-center px-6 text-center">
        <div>
          <p className="text-sm text-neutral-400">
            {connection === 'reconnecting' ? t.reconnecting : t.connecting}
          </p>
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
        onJoin={handleJoin}
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
