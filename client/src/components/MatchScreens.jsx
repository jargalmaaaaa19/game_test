import { EVENTS_PER_MATCH } from '@shared/constants.js';
import { getCountry } from '@shared/countries.js';
import { t, lang } from '../i18n.js';
import AvatarPortrait from './AvatarPortrait.jsx';
import Medal, { isMedalRank } from './Medal.jsx';
import Flag from './Flag.jsx';

// Sport names ship in the shared catalog (they are the same data the server
// draws from), already keyed by language.
const nameOf = (event) => event?.name?.[lang] ?? event?.name?.en ?? '';

/** Between heats: what is about to be run, and which lane you are in. */
export function IntroScreen({ room, me, match }) {
  const event = match?.event;
  const lane = match?.lanes?.[me?.id];

  return (
    <div className="grid min-h-full place-items-center px-6 text-center">
      <div className="animate-rise">
        <p className="label">{t.eventOf((match?.eventIndex ?? 0) + 1, EVENTS_PER_MATCH)}</p>
        <h1 className="mt-2 text-3xl font-bold">{nameOf(event)}</h1>
        {lane != null && (
          <p className="mt-6 text-sm text-neutral-500">
            {t.lane(lane)} · {t.playersCount(room.players.length, room.maxPlayers)}
          </p>
        )}
      </div>
    </div>
  );
}

/** After a heat: finishing order, points won, running medal table. */
export function PodiumScreen({ room, me, match }) {
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const awards = new Map((match?.awards ?? []).map((a) => [a.playerId, a]));

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <h1 className="text-center text-2xl font-bold">{t.results}</h1>

      <ol className="mt-6 space-y-2">
        {(match?.placements ?? []).map((playerId, index) => {
          const player = byId.get(playerId);
          if (!player) return null;
          const award = awards.get(playerId);
          return (
            <li
              key={playerId}
              className={[
                'flex items-center gap-3 rounded-2xl border p-3',
                playerId === me?.id ? 'border-white/40 bg-white/5' : 'border-neutral-800 bg-neutral-900/50',
              ].join(' ')}
            >
              <span className="grid w-7 shrink-0 place-items-center">
                {isMedalRank(index + 1) ? (
                  <Medal rank={index + 1} className="h-7 w-7" title={t.place(index + 1)} />
                ) : (
                  <span className="font-mono text-lg font-bold text-neutral-500">{index + 1}</span>
                )}
              </span>
              <AvatarPortrait skin={player.skin} build={player.build} outfit={player.outfit} hair={player.hair} className="h-9 w-9" />
              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm">
                <Flag code={player.country} className="h-3 w-4.5" />
                {player.name}
              </span>
              <span className="font-mono text-sm font-semibold text-emerald-400">
                +{award?.points ?? 0}
              </span>
            </li>
          );
        })}
      </ol>

      <MedalTable room={room} standings={match?.standings} me={me} />
      <p className="mt-6 text-center text-xs text-neutral-500">{t.nextEvent}</p>
    </div>
  );
}

function MedalTable({ room, standings, me }) {
  const byId = new Map(room.players.map((p) => [p.id, p]));
  if (!standings?.length) return null;

  return (
    <section className="mt-8">
      <h2 className="label">{t.medalTable}</h2>
      <ol className="space-y-1">
        {standings.map((row, index) => {
          const player = byId.get(row.playerId);
          if (!player) return null;
          return (
            <li
              key={row.playerId}
              className={[
                'flex items-center gap-3 rounded-xl px-3 py-2 text-sm',
                row.playerId === me?.id ? 'bg-white/10' : 'bg-neutral-900/50',
              ].join(' ')}
            >
              <span className="w-5 text-center font-mono text-neutral-500">{index + 1}</span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                <Flag code={player.country} className="h-3 w-4.5" />
                {player.name}
              </span>
              <span className="text-xs text-neutral-500">
                {row.gold}/{row.silver}/{row.bronze}
              </span>
              <span className="w-14 text-right font-mono font-semibold">
                {row.points} {t.points}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
