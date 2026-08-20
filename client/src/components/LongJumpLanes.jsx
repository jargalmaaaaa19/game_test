import { RUNWAY_M } from '@shared/events/long_jump.js';
import Flag from './Flag.jsx';

// How much runway is on screen behind the board, and how much sand in front of
// it. Showing all 38m would put the athlete in the last 3% of the strip for
// most of the run-up; showing the last 14 makes the approach to the board — the
// only part a player has to read — most of the picture.
export const VISIBLE_M = 14;
export const PIT_M = 11;
export const BOARD_PCT = 66;

/**
 * Where a metre mark sits on the strip, as a percentage of its width. Shared
 * with the screen's render loop, which places the athletes against exactly this
 * scale.
 */
export const pctFor = (x) => (x <= RUNWAY_M
  ? BOARD_PCT - Math.min(1, (RUNWAY_M - x) / VISIBLE_M) * BOARD_PCT
  : BOARD_PCT + Math.min(1, (x - RUNWAY_M) / PIT_M) * (100 - BOARD_PCT));

/**
 * The flat side view of the runway and the pit.
 *
 * What the event looked like before the stadium, and still what it looks like
 * on a device with no WebGL or no Babylon runtime. The rules, the gauge and the
 * measurements are identical; only the drawing is cheaper. One row per athlete,
 * so a player can still see the field around them.
 */
export default function LongJumpLanes({ players, myId, stripRef, laneRefs }) {
  return (
    <div ref={stripRef} className="relative mt-4 space-y-1 rounded-xl border border-neutral-800 bg-neutral-900/70 p-2">
      {players.map((player) => (
        <div
          key={player.id}
          className={[
            'relative h-10 overflow-hidden rounded border',
            player.id === myId ? 'border-white/40 bg-neutral-800/70' : 'border-neutral-800 bg-neutral-900/60',
          ].join(' ')}
        >
          {/* the runway, the board and the sand */}
          <div className="absolute inset-x-0 bottom-0 h-3.5 bg-[#b8462a]" />
          <div
            className="absolute bottom-0 h-3.5 bg-amber-200/35"
            style={{ left: `${BOARD_PCT}%`, right: 0 }}
          />
          <div
            className="absolute bottom-0 h-3.5 w-1 -translate-x-1/2 bg-white"
            style={{ left: `${BOARD_PCT}%` }}
          />
          <div
            className="absolute bottom-0 h-3.5 w-0.5 bg-red-500"
            style={{ left: `${BOARD_PCT}%` }}
          />

          <Flag code={player.country} className="absolute left-1 top-1 h-2.5 w-3.5" />

          {/* One athlete. `bottom` carries the flight arc, `left` the run — both
              written by the screen's loop, never through React. */}
          <div
            ref={(node) => {
              if (node) laneRefs.current.set(player.id, node);
              else laneRefs.current.delete(player.id);
            }}
            data-stage="run"
            style={{ left: '0%', bottom: '14px' }}
            className="absolute h-4 w-2 -translate-x-1/2 rounded-sm bg-white will-change-[left,bottom]
                       data-[stage='flight']:bg-emerald-400"
          />
        </div>
      ))}

      {/* the tape, in the one place it fits on a strip this size */}
      <div className="relative h-3">
        {[2, 4, 6, 8, 10].map((m) => (
          <span
            key={m}
            className="absolute -translate-x-1/2 text-[9px] tabular-nums text-neutral-500"
            style={{ left: `${pctFor(RUNWAY_M + m)}%` }}
          >
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}
