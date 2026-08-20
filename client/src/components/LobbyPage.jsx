import { useState } from 'react';
import { MIN_PLAYERS } from '@shared/constants.js';
import { t, errorText } from '../i18n.js';
import { inviteToRoom, isEmbedded } from '../net/usion.js';
import PlayerCard, { EmptySeatCard } from './PlayerCard.jsx';
import AvatarStudio from './AvatarStudio.jsx';

export default function LobbyPage({
  room,
  me,
  look,
  onLookChange,
  onReady,
  onStart,
  onLeave,
  error,
  busy,
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const connected = room.players.filter((p) => p.connected);
  const everyoneReady = connected.length > 0 && connected.every((p) => p.ready);
  const canStart = me?.isHost && connected.length >= MIN_PLAYERS && everyoneReady;

  // Say *why* Start is disabled. A greyed-out button with no reason is the
  // fastest way to get a host tapping it over and over.
  const startBlockedReason =
    connected.length < MIN_PLAYERS ? t.waitingForPlayers : !everyoneReady ? t.waitingForReady : null;

  const [inviting, setInviting] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard is blocked in some WebViews — the code is on screen anyway */
    }
  };

  /**
   * Invite, the primary way anyone joins.
   *
   * The platform owns the friend picker and delivers the invite into the chat,
   * so nothing here has to render a list of people or a code. The room's own
   * code is what travels as the invite's roomId, because that is the string
   * `room:join` takes when the invitee arrives.
   *
   * Outside the Usion app the SDK resolves `{success:false}` rather than
   * throwing, and there is no picker to fall back on — so that path copies the
   * code instead of pretending an invite was sent.
   */
  const invite = async () => {
    setInviting(true);
    try {
      const { success } = await inviteToRoom(room.code, room.maxPlayers);
      if (!success) await copyCode();
    } finally {
      setInviting(false);
    }
  };

  // Leave one empty seat visible as an invitation, but never pad the grid out
  // to ten ghosts.
  const emptySeats = Math.min(Math.max(room.maxPlayers - room.players.length, 0), 1);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-6 px-5 py-8">
      {/* Invite first, code second. Reading a code out loud is what you do
          when the platform cannot introduce two players to each other; inside
          Usion it can, so the code stops being the way in and becomes the
          fallback it always should have been. It stays VISIBLE rather than
          hidden behind a menu: a player on the web build, or one whose invite
          never arrived, still needs it. */}
      <header className="text-center">
        <button
          type="button"
          onClick={invite}
          disabled={inviting}
          className="btn-primary w-full text-lg"
        >
          {inviting ? t.inviting : t.inviteFriends}
        </button>
        <p className="mt-3 text-xs text-neutral-500">
          {isEmbedded() ? t.inviteHint : t.inviteHintWeb}
        </p>
        <button
          type="button"
          onClick={copyCode}
          className="mt-2 font-mono text-2xl font-bold tracking-[0.25em] text-neutral-400 transition active:scale-95"
        >
          {room.code}
        </button>
        <p className="mt-1 text-[11px] text-neutral-600">{copied ? t.copied : t.tapToCopy}</p>
      </header>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="label mb-0">{t.athletes}</h2>
          <span className="text-xs text-neutral-500">
            {t.playersCount(room.players.length, room.maxPlayers)}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {room.players.map((player) => (
            <PlayerCard key={player.id} player={player} isMe={player.id === me?.id} />
          ))}
          {Array.from({ length: emptySeats }, (_, i) => (
            <EmptySeatCard key={`empty-${i}`} />
          ))}
        </div>
      </section>

      {editing && (
        <section className="card animate-rise">
          <h2 className="label">{t.myAthlete}</h2>
          <AvatarStudio
            value={look}
            onChange={onLookChange}
            takenCountries={room.players.map((p) => p.country)}
          />
          <button type="button" className="btn-secondary mt-5" onClick={() => setEditing(false)}>
            {t.done}
          </button>
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {errorText(error)}
        </p>
      )}

      <div className="mt-auto space-y-3 pt-2">
        <button
          type="button"
          className={me?.ready ? 'btn-secondary' : 'btn-primary'}
          onClick={() => onReady(!me?.ready)}
          disabled={busy}
        >
          {me?.ready ? t.cancelReady : t.imReady}
        </button>

        {me?.isHost ? (
          <>
            <button type="button" className="btn-primary" onClick={onStart} disabled={!canStart || busy}>
              {t.startGame}
            </button>
            {startBlockedReason && (
              <p className="text-center text-xs text-neutral-500">{startBlockedReason}</p>
            )}
          </>
        ) : (
          <p className="text-center text-xs text-neutral-500">{t.waitingForHost}</p>
        )}

        <div className="flex gap-3">
          {!editing && (
            <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>
              {t.edit}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onLeave}>
            {t.leaveRoom}
          </button>
        </div>
      </div>
    </div>
  );
}
