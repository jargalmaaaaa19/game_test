import { DISTANCE_M } from '@shared/events/freestyle_swim.js';
import { t } from '../i18n.js';
import Flag from './Flag.jsx';

/**
 * The flat pool view and the standings list.
 *
 * What the race looked like before the natatorium, and still what it looks
 * like on a device with no WebGL or no Babylon runtime. The rhythm, the
 * judgement and the placings are identical; only the drawing is cheaper.
 */
export default function SwimLanes({ players, myId, snap, laneRefs }) {
  return (
    <>
      <div className="relative mt-4 overflow-hidden rounded-xl border border-sky-900/60 bg-sky-950/50 p-1.5">
        <div className="absolute inset-y-0 right-1.5 w-1 bg-white/70" />
        <div className="flex flex-col gap-1">
          {players.map((player) => (
            <div
              key={player.id}
              className={[
                'relative h-7 rounded border',
                player.id === myId ? 'border-white/40 bg-sky-900/40' : 'border-sky-900/40 bg-sky-900/20',
              ].join(' ')}
            >
              <Flag code={player.country} className="absolute left-1 top-1/2 h-2.5 w-3.5 -translate-y-1/2" />
              <div
                ref={(node) => {
                  if (node) laneRefs.current.set(player.id, node);
                  else laneRefs.current.delete(player.id);
                }}
                style={{ left: '0%' }}
                className="absolute top-1/2 h-3 w-5 -translate-y-1/2 rounded-full bg-sky-300 will-change-[left]
                           data-[done='1']:bg-emerald-400"
              />
            </div>
          ))}
        </div>
      </div>

      <Scoreboard players={players} snap={snap} meId={myId} />
    </>
  );
}

function Scoreboard({ players, snap, meId }) {
  const rows = players
    .map((p) => ({ player: p, a: snap?.a?.[p.id] }))
    .sort((x, y) => {
      const ax = x.a ?? {};
      const by = y.a ?? {};
      if (Boolean(ax.d) !== Boolean(by.d)) return ax.d ? -1 : 1;
      if (ax.d && by.d) return (ax.t ?? 0) - (by.t ?? 0);
      return (by.x ?? 0) - (ax.x ?? 0);
    });

  return (
    <ul className="mt-auto space-y-1 pt-5">
      {rows.map(({ player, a }) => (
        <li
          key={player.id}
          className={[
            'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm',
            player.id === meId ? 'bg-white/10' : 'bg-neutral-900/60',
          ].join(' ')}
        >
          <Flag code={player.country} className="h-3 w-4.5" />
          <span className="min-w-0 flex-1 truncate">{player.name}</span>
          <span className="font-mono text-xs tabular-nums text-neutral-400">
            {a?.d ? t.secs((a.t / 1000).toFixed(2)) : `${(a?.x ?? 0).toFixed(1)}м`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export { DISTANCE_M };
