// Medals for the first three places.
//
// Rank is carried by THREE signals at once — metal colour, the numeral, and the
// ribbon shape — because colour alone fails for the ~8% of men with a colour
// vision deficiency, for whom gold and bronze are close to the same swatch.

const METALS = {
  1: { face: '#f6c445', edge: '#c99a12', shine: '#fff3c4', ribbon: '#e5484d', ink: '#4a3800' },
  2: { face: '#cbd5e1', edge: '#94a3b8', shine: '#f8fafc', ribbon: '#0090ff', ink: '#334155' },
  3: { face: '#d08a4e', edge: '#a8623a', shine: '#f0c9a8', ribbon: '#30a46c', ink: '#4a2a12' },
};

export const isMedalRank = (rank) => rank >= 1 && rank <= 3;

export default function Medal({ rank, className = '', title }) {
  const metal = METALS[rank];
  if (!metal) return null;

  return (
    <svg viewBox="0 0 40 52" className={className} role="img" aria-label={title ?? `${rank}`}>
      {title ? <title>{title}</title> : null}

      {/* ribbon — a different cut per rank, so the shape alone reads the place */}
      {rank === 1 ? (
        <path d="M12 0h16l-4 14h-8z" fill={metal.ribbon} />
      ) : rank === 2 ? (
        <path d="M11 0h18l-6 14h-6z" fill={metal.ribbon} />
      ) : (
        <path d="M10 0h20l-8 14h-4z" fill={metal.ribbon} />
      )}
      <path d="M12 0h16l-2 6H14z" fill="#000" opacity="0.18" />

      <circle cx="20" cy="33" r="17" fill={metal.edge} />
      <circle cx="20" cy="33" r="14" fill={metal.face} />
      <path d="M20 21a12 12 0 00-8.4 20.4A12 12 0 0120 21z" fill={metal.shine} opacity="0.55" />

      <text
        x="20"
        y="33"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="16"
        fontWeight="800"
        fill={metal.ink}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {rank}
      </text>
    </svg>
  );
}

/** Compact G/S/B tally used in the tables. */
export function MedalTally({ gold = 0, silver = 0, bronze = 0, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 tabular-nums ${className}`}>
      <Tally count={gold} color="#f6c445" />
      <Tally count={silver} color="#cbd5e1" />
      <Tally count={bronze} color="#d08a4e" />
    </span>
  );
}

function Tally({ count, color }) {
  return (
    <span className={count ? 'flex items-center gap-0.5' : 'flex items-center gap-0.5 opacity-25'}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] font-medium">{count}</span>
    </span>
  );
}
