/**
 * One thumb pad — the left/right cadence control the sprint and the long jump
 * both run on.
 *
 * Presentational only: it carries `data-foot` for the screen's pointer handler
 * to read and nothing else. Which foot is owed the next step, and whether the
 * last one landed clean, are decided by the sim and written straight onto the
 * node by the render loop rather than through React — at a sprinter's cadence
 * that changes nine times a second, and nine re-renders a second of the whole
 * screen is not a thing to spend on a ring.
 *
 *   data-next   whose turn it is. The pad you owe a step lit, the other dim.
 *   data-hit    'clean' on an alternating tap, 'wrong' on the same thumb twice
 *               — the moment the athlete starts losing speed, said on the
 *               control that caused it rather than left to be inferred from the
 *               runner slowing down.
 */
export default function FootPad({ foot, label, nodeRef, className = '' }) {
  return (
    <button
      ref={nodeRef}
      type="button"
      data-foot={foot}
      data-next="1"
      data-hit="no"
      aria-label={label}
      className={[
        'grid h-28 w-28 shrink-0 select-none place-items-center rounded-full border-2',
        'text-sm font-bold tracking-widest transition-colors duration-100',
        "data-[next='1']:border-white data-[next='1']:bg-white/20 data-[next='1']:text-white",
        "data-[next='0']:border-white/20 data-[next='0']:bg-black/40 data-[next='0']:text-white/45",
        "data-[hit='clean']:border-emerald-300 data-[hit='clean']:bg-emerald-300/35",
        "data-[hit='wrong']:border-amber-400 data-[hit='wrong']:bg-amber-400/35",
        "data-[hit='wrong']:text-amber-100",
        className,
      ].join(' ')}
    >
      {label}
    </button>
  );
}
