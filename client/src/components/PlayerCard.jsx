import { getCountry } from '@shared/countries.js';
import { t } from '../i18n.js';
import AvatarPortrait from './AvatarPortrait.jsx';
import Flag from './Flag.jsx';

export default function PlayerCard({ player, isMe }) {
  const country = getCountry(player.country);

  return (
    <div
      className={[
        'relative flex flex-col items-center gap-2 rounded-2xl border p-3 transition',
        player.ready ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-neutral-800 bg-neutral-900/60',
        !player.connected && 'opacity-40',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {player.isHost && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-950">
          {t.host}
        </span>
      )}

      <AvatarPortrait
        skin={player.skin} build={player.build}
        outfit={player.outfit}
        hair={player.hair}
        className="h-16 w-16"
        title={player.name}
      />

      <div className="flex w-full min-w-0 items-center justify-center gap-1">
        <Flag code={player.country} className="h-3.5 w-5" />
        <span className="truncate text-sm font-medium">{player.name}</span>
      </div>

      <span
        className={[
          'rounded-full px-2 py-0.5 text-[11px] font-medium',
          !player.connected
            ? 'bg-neutral-800 text-neutral-400'
            : player.ready
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-neutral-800 text-neutral-400',
        ].join(' ')}
      >
        {!player.connected ? t.offline : player.ready ? t.ready : t.notReady}
        {isMe ? ' ·' : ''}
      </span>
    </div>
  );
}

export function EmptySeatCard() {
  return (
    <div className="grid min-h-[136px] place-items-center rounded-2xl border border-dashed border-neutral-800 p-3 text-xs text-neutral-600">
      {t.emptySeat}
    </div>
  );
}
