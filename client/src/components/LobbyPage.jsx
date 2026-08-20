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

  const connected = room.players.filter((p) => p.connected);
  const everyoneReady = connected.length > 0 && connected.every((p) => p.ready);
  const canStart = me?.isHost && connected.length >= MIN_PLAYERS && everyoneReady;

  // Say *why* Start is disabled. A greyed-out button with no reason is the
  // fastest way to get a host tapping it over and over.
  const startBlockedReason =
    connected.length < MIN_PLAYERS ? t.waitingForPlayers : !everyoneReady ? t.waitingForReady : null;

  const [inviting, setInviting] = useState(false);

  /**
   * Invite, the primary way anyone joins.
   *
   * The platform owns the friend picker and delivers the invite into the chat,
   * so nothing here has to render a list of people or a code. The room's own
   * code is what travels as the invite's roomId, because that is the string
   * `room:join` takes when the invitee arrives.
   *
   * Outside the Usion app the SDK resolves `{success:false}` rather than
   * throwing. There is no picker out there and no code to fall back on any
   * more, so the hint under the button is what tells a web player that this
   * door only opens inside the app.
   */
  const invite = async () => {
    setInviting(true);
    try {
      await inviteToRoom(room.code, room.maxPlayers);
    } finally {
      setInviting(false);
    }
  };

  // Leave one empty seat visible as an invitation, but never pad the grid out
  // to ten ghosts.
  const emptySeats = Math.min(Math.max(room.maxPlayers - room.players.length, 0), 1);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-6 px-5 py-8">
      {/* Invite, and nothing else. The platform owns the picker, the roster
          and the delivery; a waiting hall that drew its own code, share sheet
          or friend list would be competing with the app it lives inside — and
          the code is gone entirely now, not demoted. */}
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
