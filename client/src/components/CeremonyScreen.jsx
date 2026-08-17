import { useEffect, useRef, useState } from 'react';
import { getCountry } from '@shared/countries.js';
import { t } from '../i18n.js';
import { isEmbedded, loadBoards, reportMatchResult, submitScore } from '../net/usion.js';
import AvatarPortrait from './AvatarPortrait.jsx';
import Medal, { MedalTally, isMedalRank } from './Medal.jsx';
import Flag from './Flag.jsx';
import PodiumStand from './PodiumStand.jsx';
import VictoryShareCard from './VictoryShareCard.jsx';

/**
 * Closing ceremony: podium, share card, the match table, and the platform's
 * own records boards.
 *
 * Two different things happen here and they are easy to confuse:
 *   `leaderboard.submit()` is "my best ever" — it feeds Game Center and the
 *   "«Name» beat your record" notification.
 *   `game.reportResult()` is "here is how THIS match went" — it drops a result
 *   card into the chat the game was started from.
 * Both are required; neither replaces the other.
 */
export default function CeremonyScreen({ room, me, match, onRematch }) {
  const standings = match?.standings ?? [];
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const [boards, setBoards] = useState(null);
  const [tab, setTab] = useState('friends');

  // Gate both platform calls behind a ref, not a state flag: a re-render must
  // never file a second result card or a duplicate score.
  const reported = useRef(false);

  useEffect(() => {
    if (reported.current || standings.length === 0) return;
    reported.current = true;

    const mine = standings.find((row) => row.playerId === me?.id);

    (async () => {
      if (mine) {
        await submitScore(mine.points, { golds: mine.gold });
        setBoards(await loadBoards(10));
      }
      // Host only — the authority that decided the outcome is the only client
      // allowed to report it.
      if (me?.isHost && match?.result?.winnerId) {
        await reportMatchResult({
          winnerId: match.result.winnerId,
          standings: match.result.order ?? standings.map((row) => row.playerId),
          scores: match.result.scores ?? {},
        });
      }
    })();
  }, [standings, me, match]);

  const champion = (() => {
    const row = standings[0];
    const player = row && byId.get(row.playerId);
    return player ? { row, player } : null;
  })();

  return (
    <div className="mx-auto w-full max-w-md space-y-8 px-5 py-8">
      <header className="text-center">
        <h1 className="text-2xl font-bold">{t.finalStandings}</h1>
      </header>

      <PodiumStand standings={standings} players={room.players} meId={me?.id} />

      {champion && (
        <VictoryShareCard
          champion={champion}
          standings={standings}
          programme={match?.programme}
          players={room.players}
        />
      )}

      <MatchLeaderboard standings={standings} byId={byId} meId={me?.id} />

      {isEmbedded() && (
        <RecordBoards boards={boards} tab={tab} onTab={setTab} />
      )}

      {me?.isHost && (
        <button type="button" className="btn-primary" onClick={onRematch}>
          {t.playAgain}
        </button>
      )}
    </div>
  );
}

/** Everyone who competed, in order — the podium only has room for three. */
function MatchLeaderboard({ standings, byId, meId }) {
  return (
    <section>
      <h2 className="label">{t.medalTable}</h2>
      <ol className="space-y-1">
        {standings.map((row, index) => {
          const player = byId.get(row.playerId);
          if (!player) return null;
          const rank = index + 1;
          const isMe = row.playerId === meId;

          return (
            <li
              key={row.playerId}
              className={[
                'flex items-center gap-3 rounded-xl border px-3 py-2',
                isMe ? 'border-white/30 bg-white/10' : 'border-transparent bg-neutral-900/60',
              ].join(' ')}
            >
              <span className="grid w-7 shrink-0 place-items-center">
                {isMedalRank(rank) ? (
                  <Medal rank={rank} className="h-7 w-7" title={t.place(rank)} />
                ) : (
                  <span className="font-mono text-sm text-neutral-500">{rank}</span>
                )}
              </span>

              <AvatarPortrait
                skin={player.skin} build={player.build}
                outfit={player.outfit}
                hair={player.hair}
                className="h-8 w-8 shrink-0"
              />

              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm">
                <Flag code={player.country} className="h-3 w-4.5" />
                {player.name}
              </span>

              <MedalTally gold={row.gold} silver={row.silver} bronze={row.bronze} />

              <span className="w-12 shrink-0 text-right font-mono text-sm font-semibold">
                {row.points}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The platform's records boards. Showing friends AND global is the pattern the
 * reference games use: friends is who the player actually competes with, global
 * is the number to chase.
 */
function RecordBoards({ boards, tab, onTab }) {
  const rows = (tab === 'friends' ? boards?.friends : boards?.top) ?? [];

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="label mb-0">{t.yourBest}</h2>
        <div className="flex gap-1 rounded-lg bg-neutral-900 p-0.5 text-xs">
          {['friends', 'global'].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onTab(key)}
              className={[
                'rounded-md px-3 py-1 transition',
                tab === key ? 'bg-neutral-700 text-white' : 'text-neutral-500',
              ].join(' ')}
            >
              {key === 'friends' ? t.friendsBoard : t.globalBoard}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-neutral-900/60 px-3 py-4 text-center text-xs text-neutral-600">
          {t.noRecords}
        </p>
      ) : (
        <ol className="space-y-1">
          {rows.map((entry) => (
            <li
              key={`${entry.user_id}-${entry.rank}`}
              className={[
                'flex items-center gap-3 rounded-xl px-3 py-2 text-sm',
                entry.is_me ? 'bg-white/10' : 'bg-neutral-900/60',
              ].join(' ')}
            >
              <span className="w-6 text-center font-mono text-neutral-500">{entry.rank}</span>
              <span className="min-w-0 flex-1 truncate">{entry.name ?? '—'}</span>
              <span className="font-mono font-semibold">{entry.score}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
