import { RACE_DISTANCE } from '@shared/events/sprint_100m.js';
import AvatarPortrait from './AvatarPortrait.jsx';
import Flag from './Flag.jsx';

/**
 * The flat lane view.
 *
 * This is what the race looked like before the stadium, and it is still what
 * it looks like on a device with no WebGL or no Babylon runtime — which is a
 * real device, not a theoretical one: locked-down WebViews and browsers with
 * hardware acceleration off both land here. The rules, the input and the
 * placings are identical; only the drawing is cheaper.
 *
 * `trackRef` and `laneRefs` are filled for the caller's animation loop, which
 * writes transforms straight onto these nodes.
 */
export default function SprintLanes({ players, myId, trackRef, laneRefs }) {
  return (
    <div ref={trackRef} className="relative mx-5 my-4 flex-1 overflow-hidden">
      <div className="absolute inset-y-0 right-0 w-1 bg-white/70" />
      <div className="absolute -top-1 right-2 text-[10px] font-semibold text-neutral-500">
        {RACE_DISTANCE}м
      </div>

      <div className="flex h-full flex-col justify-center gap-1.5">
        {players.map((player) => {
          const isMe = player.id === myId;
          return (
            <div
              key={player.id}
              className={[
                'relative h-11 rounded-lg border',
                isMe ? 'border-white/40 bg-white/5' : 'border-neutral-900 bg-neutral-900/40',
              ].join(' ')}
            >
              <Flag code={player.country} className="absolute left-1 top-1/2 h-2.5 w-3.5 -translate-y-1/2" />
              <div
                ref={(node) => {
                  if (node) laneRefs.current.set(player.id, node);
                  else laneRefs.current.delete(player.id);
                }}
                className="absolute left-1 top-1/2 -translate-y-1/2 will-change-transform
                           data-[done='1']:drop-shadow-[0_0_6px_rgba(52,211,153,0.9)]"
              >
                <AvatarPortrait
                  skin={player.skin}
                  build={player.build}
                  outfit={player.outfit}
                  hair={player.hair}
                  className="h-9 w-9"
                  title={player.name}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
