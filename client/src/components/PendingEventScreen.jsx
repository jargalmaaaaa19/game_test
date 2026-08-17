import { useEffect, useState } from 'react';
import { EVENTS_PER_MATCH } from '@shared/constants.js';
import { getEvent } from '@shared/events/index.js';
import { serverNow } from '../net/interpolation.js';
import { t, lang } from '../i18n.js';
import AvatarPortrait from './AvatarPortrait.jsx';
import Flag from './Flag.jsx';

/**
 * The screen for an event that has a catalog entry but no simulation yet.
 *
 * The heat still runs on the server — it resolves on the overtime clock — so
 * the players are not stuck, they just have nothing to do. Before this existed
 * they got the raw event id on a black page: no name, no clock, no idea whether
 * the game had crashed. Dead time is fine; unexplained dead time is not.
 */
export default function PendingEventScreen({ room, me, match, netRef }) {
  const event = match?.event ?? getEvent(room.currentEventId);
  const endsAt = match?.endsAt ?? room.phaseEndsAt ?? null;
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!endsAt) return undefined;
    // Twice a second is plenty for a seconds display and costs nothing; the
    // race screen's 60fps loop would be pure waste here.
    const tick = () => setRemaining(Math.max(0, endsAt - serverNow(netRef.current)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [endsAt, netRef]);

  const total = event?.durationMs ?? 1;
  const progress = remaining == null ? 0 : 1 - Math.min(1, remaining / total);
  const seconds = remaining == null ? null : Math.ceil(remaining / 1000);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-8 px-5 py-10">
      <header className="text-center">
        <p className="label mb-1">{t.eventOf((room.eventIndex ?? 0) + 1, EVENTS_PER_MATCH)}</p>
        <h1 className="text-3xl font-bold">{event?.name?.[lang] ?? event?.name?.en ?? room.currentEventId}</h1>
        <p className="mt-3 inline-block rounded-full bg-amber-400/10 px-3 py-1 text-xs text-amber-300/90">
          {t.comingSoon}
        </p>
      </header>

      <div>
        {seconds != null && (
          <p className="text-center font-mono text-5xl font-bold tabular-nums">{seconds}</p>
        )}
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-neutral-400 transition-[width] duration-500 ease-linear"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <p className="mt-3 text-center text-xs text-neutral-500">{t.autoAdvance}</p>
      </div>

      {/* Show the field anyway: an empty screen reads as a broken one. */}
      <ul className="space-y-1">
        {room.players.map((player) => (
          <li
            key={player.id}
            className={[
              'flex items-center gap-3 rounded-xl px-3 py-2 text-sm',
              player.id === me?.id ? 'bg-white/10' : 'bg-neutral-900/60',
            ].join(' ')}
          >
            <span className="w-5 text-center font-mono text-xs text-neutral-500">
              {room.lanes?.[player.id] ?? '–'}
            </span>
            <AvatarPortrait
              skin={player.skin}
              build={player.build}
              hair={player.hair}
              outfit={player.outfit}
              className="h-8 w-8 shrink-0"
            />
            <Flag code={player.country} className="h-3 w-4.5" />
            <span className="min-w-0 flex-1 truncate">{player.name}</span>
            {!player.connected && <span className="text-xs text-neutral-500">{t.offline}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
