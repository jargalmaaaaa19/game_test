import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { pushSnapshot, updateClock } from './interpolation.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3200';
const SEAT_KEY = 'usion-olympics:seat';

/** A stable per-device id so a refresh reclaims the same seat, not a new one. */
function deviceUserId() {
  const key = 'usion-olympics:device';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `dev_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

const readSeat = () => {
  try {
    return JSON.parse(localStorage.getItem(SEAT_KEY) || 'null');
  } catch {
    return null;
  }
};

/**
 * Owns the socket and the mirrored room state.
 *
 * The server's `room:state` snapshot is the single source of truth — nothing
 * here keeps a second copy of the roster it edits optimistically. A ready
 * toggle that renders instantly and then disagrees with the host's screen is
 * worse than one that takes 40ms.
 */
export function useRoomSocket() {
  const socketRef = useRef(null);
  const [connection, setConnection] = useState('connecting');
  const [catalog, setCatalog] = useState(null);
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [error, setError] = useState(null);

  // Low-frequency match events (a handful per match) are React state.
  const [match, setMatch] = useState(null);

  // 20 Hz snapshots are NOT: a setState per tick would re-render the whole tree
  // 20 times a second and starve the render loop. The race reads this ref from
  // its own requestAnimationFrame.
  const netRef = useRef({ buffer: [], offset: null, lastServerT: 0 });

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      auth: {
        // Inside Usion this is where the platform access token goes
        // (Usion.game._fetchDirectAccess); outside it, a dev identity.
        token: window.Usion?.game?.accessToken,
        devUserId: deviceUserId(),
        devUserName: window.Usion?.user?.getName?.(),
      },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnection('connected');
      // Reclaim the seat we held before the refresh / tunnel. The server only
      // honours it for the same authenticated user.
      const seat = readSeat();
      if (seat?.code && seat?.playerId) {
        socket.emit('room:join', seat, (res) => {
          if (res?.ok) {
            setPlayerId(res.playerId);
            setRoom(res.state);
          } else {
            localStorage.removeItem(SEAT_KEY);
          }
        });
      }
    });

    socket.on('disconnect', () => setConnection('disconnected'));
    socket.io.on('reconnect_attempt', () => setConnection('reconnecting'));
    socket.on('connect_error', () => setConnection('disconnected'));

    socket.on('catalog', setCatalog);
    socket.on('room:state', setRoom);

    // --- match lifecycle -----------------------------------------------------
    socket.on('game:started', (d) => setMatch({ kind: 'started', ...d }));
    socket.on('game:intro', (d) => setMatch({ kind: 'intro', ...d }));

    socket.on('game:play', (d) => {
      // A fresh heat starts from an empty buffer — leftover frames from the
      // previous event would interpolate athletes across two different races.
      netRef.current.buffer = [];
      // Sync the clock from `t` even when there is no state to buffer: an event
      // with no sim yet sends no snapshots at all, and its screen still has a
      // deadline to count down to.
      if (d.t) updateClock(netRef.current, d.t, Date.now());
      if (d.state && d.t) pushSnapshot(netRef.current, d.t, d.state);
      setMatch({ kind: 'play', ...d });
    });

    socket.on('game:snapshot', ({ t, s }) => {
      updateClock(netRef.current, t, Date.now());
      pushSnapshot(netRef.current, t, s);
    });

    socket.on('game:podium', (d) => setMatch({ kind: 'podium', ...d }));
    socket.on('game:ceremony', (d) => setMatch({ kind: 'ceremony', ...d }));
    socket.on('game:aborted', (d) => setMatch({ kind: 'aborted', ...d }));
    socket.on('game:rematch', () => {
      netRef.current.buffer = [];
      setMatch(null);
    });

    return () => socket.close();
  }, []);

  /** Promise wrapper over socket.io acks, with a stable error shape. */
  const call = useCallback(
    (event, payload) =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) return resolve({ ok: false, error: { code: 'NETWORK' } });
        socket.emit(event, payload, (res) => resolve(res ?? { ok: false, error: { code: 'NETWORK' } }));
      }),
    [],
  );

  const enterRoom = useCallback(async (event, payload) => {
    setError(null);
    const res = await call(event, payload);
    if (!res.ok) {
      setError(res.error);
      return res;
    }
    setPlayerId(res.playerId);
    setRoom(res.state);
    localStorage.setItem(SEAT_KEY, JSON.stringify({ code: res.code, playerId: res.playerId }));
    return res;
  }, [call]);

  const api = useMemo(
    () => ({
      createRoom: (payload) => enterRoom('room:create', payload),
      joinRoom: (payload) => enterRoom('room:join', payload),

      leaveRoom: async () => {
        await call('room:leave');
        localStorage.removeItem(SEAT_KEY);
        setRoom(null);
        setPlayerId(null);
        setError(null);
      },

      updateIdentity: async (patch) => {
        setError(null);
        const res = await call('player:identity', patch);
        if (!res.ok) setError(res.error);
        return res;
      },

      setReady: async (ready) => {
        setError(null);
        const res = await call('player:ready', { ready });
        if (!res.ok) setError(res.error);
        return res;
      },

      /**
       * In-event input. Fire-and-forget by design — no ack, no promise: the
       * next authoritative snapshot IS the answer. Awaiting a round trip per
       * footstep is what makes a tap feel heavy.
       *
       * `volatile` so steps taken while the link is down are DROPPED rather
       * than queued: flushing a second of buffered footsteps on reconnect
       * would hand the player free speed they never ran.
       */
      sendInput: (payload) => {
        socketRef.current?.volatile.emit('game:input', payload);
      },

      startGame: async () => {
        setError(null);
        const res = await call('game:start');
        if (!res.ok) setError(res.error);
        return res;
      },

      requestRematch: async () => {
        setError(null);
        const res = await call('game:rematch');
        if (!res.ok) setError(res.error);
        return res;
      },

      clearError: () => setError(null),
    }),
    [call, enterRoom],
  );

  const me = room?.players.find((p) => p.id === playerId) ?? null;

  return { connection, catalog, room, me, playerId, error, match, netRef, ...api };
}
