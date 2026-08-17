import { getCountry } from '@shared/countries.js';
import { t } from '../i18n.js';
import AvatarPortrait from './AvatarPortrait.jsx';
import Flag from './Flag.jsx';
import Medal from './Medal.jsx';

// Silver, gold, bronze — the arrangement of an actual podium, and the reason
// the champion reads as the centre of the picture rather than the leftmost of
// three rows.
const ORDER = [2, 1, 3];

const BLOCK = {
  1: { height: 'h-24', face: 'from-amber-300/25 to-amber-500/5', edge: 'border-amber-300/40' },
  2: { height: 'h-16', face: 'from-slate-300/20 to-slate-400/5', edge: 'border-slate-300/30' },
  3: { height: 'h-12', face: 'from-orange-400/20 to-orange-600/5', edge: 'border-orange-400/30' },
};

/**
 * The prize-winning three.
 *
 * A room can finish with two players, so every block renders only if somebody
 * actually stands on it — an empty bronze step is a bug that looks like a
 * missing player.
 */
export default function PodiumStand({ standings, players, meId }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const winners = ORDER.map((rank) => {
    const row = standings[rank - 1];
    const player = row && byId.get(row.playerId);
    return player ? { rank, row, player } : null;
  }).filter(Boolean);

  if (winners.length === 0) return null;

  return (
    <div className="flex items-end justify-center gap-2">
      {winners.map(({ rank, row, player }) => {
        const block = BLOCK[rank];
        const country = getCountry(player.country);
        const isMe = player.id === meId;

        return (
          <div key={player.id} className="flex w-1/3 max-w-[7.5rem] flex-col items-center">
            <Medal
              rank={rank}
              className={rank === 1 ? 'mb-1 h-11 w-11' : 'mb-1 h-9 w-9'}
              title={t.place(rank)}
            />

            <AvatarPortrait
              skin={player.skin} build={player.build}
              outfit={player.outfit}
              hair={player.hair}
              className={rank === 1 ? 'h-20 w-20' : 'h-16 w-16'}
              title={player.name}
            />

            <div className="mt-1 flex w-full min-w-0 items-center justify-center gap-1">
              <Flag code={player.country} className="h-3 w-4.5" />
              <span
                className={[
                  'truncate text-xs',
                  isMe ? 'font-bold text-white' : 'font-medium text-neutral-300',
                ].join(' ')}
              >
                {player.name}
              </span>
            </div>

            <div
              className={[
                'mt-2 flex w-full items-start justify-center rounded-t-lg border-x border-t bg-gradient-to-b pt-2',
                block.height,
                block.face,
                block.edge,
              ].join(' ')}
            >
              <span className="font-mono text-sm font-bold text-neutral-200">
                {row.points}
                <span className="ml-1 text-[10px] font-normal text-neutral-500">{t.points}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
