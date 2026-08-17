import { getCountry } from '@shared/countries.js';

// Flags drawn as SVG, not emoji.
//
// Regional-indicator emoji (🇲🇳) have no glyph on Windows — the OS renders the
// bare letter pair instead, so the picker showed a grid reading "MN JP KR" and
// the whole flag-as-identity idea collapsed. Android and iOS are fine, which is
// exactly why this is easy to miss. Drawing them also keeps the promise that
// nothing is fetched: the platform strips external images at deploy.
//
// These are simplified to read at ~24px: the colour layout plus one dominant
// emblem. They are not heraldically exact and are not meant to be.

const W = 30;
const H = 20;

/** Five-point star as a path, so a flag can carry one without an image. */
function starPath(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.4;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + Math.cos(a) * radius).toFixed(2)},${(cy + Math.sin(a) * radius).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const bands = (colors, dir = 'h', weights) => {
  const w = weights ?? colors.map(() => 1);
  const total = w.reduce((a, b) => a + b, 0);
  const out = [];
  let offset = 0;
  colors.forEach((fill, i) => {
    const size = (w[i] / total) * (dir === 'h' ? H : W);
    out.push(
      dir === 'h'
        ? { t: 'rect', x: 0, y: offset, w: W, h: size + 0.01, fill }
        : { t: 'rect', x: offset, y: 0, w: size + 0.01, h: H, fill },
    );
    offset += size;
  });
  return out;
};

/** Off-centre cross, the Nordic layout. */
const nordic = (bg, cross, inner) => [
  { t: 'rect', x: 0, y: 0, w: W, h: H, fill: bg },
  { t: 'rect', x: 9, y: 0, w: 4, h: H, fill: cross },
  { t: 'rect', x: 0, y: 8, w: W, h: 4, fill: cross },
  ...(inner
    ? [
        { t: 'rect', x: 10, y: 0, w: 2, h: H, fill: inner },
        { t: 'rect', x: 0, y: 9, w: W, h: 2, fill: inner },
      ]
    : []),
];

/** The Union Flag, shrunk into a canton. */
const unionCanton = (x = 0, y = 0, w = 13, h = 9) => [
  { t: 'rect', x, y, w, h, fill: '#012169' },
  { t: 'path', d: `M${x},${y}L${x + w},${y + h}M${x + w},${y}L${x},${y + h}`, stroke: '#fff', sw: 2.4 },
  { t: 'path', d: `M${x},${y}L${x + w},${y + h}M${x + w},${y}L${x},${y + h}`, stroke: '#c8102e', sw: 1 },
  { t: 'path', d: `M${x + w / 2},${y}L${x + w / 2},${y + h}M${x},${y + h / 2}L${x + w},${y + h / 2}`, stroke: '#fff', sw: 3.4 },
  { t: 'path', d: `M${x + w / 2},${y}L${x + w / 2},${y + h}M${x},${y + h / 2}L${x + w},${y + h / 2}`, stroke: '#c8102e', sw: 1.8 },
];

const FLAGS = {
  MN: [
    ...bands(['#c4272f', '#015197', '#c4272f'], 'v'),
    { t: 'rect', x: 3.6, y: 5.5, w: 1.1, h: 4.2, fill: '#ffd900' },
    { t: 'circle', cx: 4.15, cy: 12, r: 1.15, fill: '#ffd900' },
    { t: 'rect', x: 2.9, y: 13.9, w: 2.5, h: 0.9, fill: '#ffd900' },
  ],
  JP: [{ t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#fff' }, { t: 'circle', cx: 15, cy: 10, r: 5.4, fill: '#bc002d' }],
  KR: [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#fff' },
    { t: 'path', d: 'M10.4,10a4.6,4.6 0 0,1 9.2,0a2.3,2.3 0 0,0 -4.6,0a2.3,2.3 0 0,1 -4.6,0', fill: '#cd2e3a' },
    { t: 'path', d: 'M10.4,10a4.6,4.6 0 0,0 9.2,0a2.3,2.3 0 0,1 -4.6,0a2.3,2.3 0 0,0 -4.6,0', fill: '#0047a0' },
  ],
  CN: [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#de2910' },
    { t: 'path', d: starPath(6, 6, 3.2), fill: '#ffde00' },
    { t: 'path', d: starPath(11, 3, 1.1), fill: '#ffde00' },
    { t: 'path', d: starPath(12.5, 6, 1.1), fill: '#ffde00' },
    { t: 'path', d: starPath(11, 9, 1.1), fill: '#ffde00' },
  ],
  US: [
    ...bands(['#b31942', '#fff', '#b31942', '#fff', '#b31942', '#fff', '#b31942']),
    { t: 'rect', x: 0, y: 0, w: 13, h: 11, fill: '#0a3161' },
    { t: 'path', d: starPath(3.5, 3, 1.1), fill: '#fff' },
    { t: 'path', d: starPath(9, 3, 1.1), fill: '#fff' },
    { t: 'path', d: starPath(6.2, 6, 1.1), fill: '#fff' },
    { t: 'path', d: starPath(3.5, 9, 1.1), fill: '#fff' },
    { t: 'path', d: starPath(9, 9, 1.1), fill: '#fff' },
  ],
  BR: [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#009c3b' },
    { t: 'poly', points: '15,2.5 27,10 15,17.5 3,10', fill: '#ffdf00' },
    { t: 'circle', cx: 15, cy: 10, r: 3.6, fill: '#002776' },
  ],
  DE: bands(['#000', '#dd0000', '#ffce00']),
  FR: bands(['#002395', '#fff', '#ed2939'], 'v'),
  GB: unionCanton(0, 0, W, H),
  IT: bands(['#009246', '#fff', '#ce2b37'], 'v'),
  ES: bands(['#aa151b', '#f1bf00', '#aa151b'], 'h', [1, 2, 1]),
  NL: bands(['#ae1c28', '#fff', '#21468b']),
  SE: nordic('#006aa7', '#fecc02'),
  NO: nordic('#ba0c2f', '#fff', '#00205b'),
  PL: bands(['#fff', '#dc143c']),
  TR: [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#e30a17' },
    { t: 'circle', cx: 12, cy: 10, r: 4.2, fill: '#fff' },
    { t: 'circle', cx: 13.6, cy: 10, r: 3.4, fill: '#e30a17' },
    { t: 'path', d: starPath(18.4, 10, 2), fill: '#fff' },
  ],
  RU: bands(['#fff', '#0039a6', '#d52b1e']),
  KZ: [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#00afca' },
    { t: 'circle', cx: 15, cy: 9, r: 3.2, fill: '#fec50c' },
    { t: 'path', d: 'M9.5,13.5q5.5,3 11,0', stroke: '#fec50c', sw: 1, fill: 'none' },
  ],
  IN: [
    ...bands(['#ff9933', '#fff', '#138808']),
    { t: 'circle', cx: 15, cy: 10, r: 2.4, fill: 'none', stroke: '#000088', sw: 0.9 },
  ],
  ID: bands(['#ce1126', '#fff']),
  VN: [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#da251d' },
    { t: 'path', d: starPath(15, 10, 4.4), fill: '#ffff00' },
  ],
  TH: bands(['#a51931', '#f4f5f8', '#2d2a4a', '#f4f5f8', '#a51931'], 'h', [1, 1, 2, 1, 1]),
  PH: [
    { t: 'rect', x: 0, y: 0, w: W, h: 10, fill: '#0038a8' },
    { t: 'rect', x: 0, y: 10, w: W, h: 10, fill: '#ce1126' },
    { t: 'poly', points: '0,0 13,10 0,20', fill: '#fff' },
    { t: 'circle', cx: 4.5, cy: 10, r: 2.2, fill: '#fcd116' },
  ],
  AU: [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#00008b' },
    ...unionCanton(0, 0, 14, 10),
    { t: 'path', d: starPath(7, 15.5, 1.7), fill: '#fff' },
    { t: 'path', d: starPath(21, 6, 1.5), fill: '#fff' },
    { t: 'path', d: starPath(24, 12, 1.5), fill: '#fff' },
    { t: 'path', d: starPath(19, 15, 1.3), fill: '#fff' },
  ],
  NZ: [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#00247d' },
    ...unionCanton(0, 0, 14, 10),
    { t: 'path', d: starPath(21, 5.5, 1.5), fill: '#cc142b' },
    { t: 'path', d: starPath(25, 10, 1.5), fill: '#cc142b' },
    { t: 'path', d: starPath(21, 15, 1.5), fill: '#cc142b' },
    { t: 'path', d: starPath(18, 10.5, 1.3), fill: '#cc142b' },
  ],
  CA: [
    ...bands(['#d52b1e', '#fff', '#d52b1e'], 'v', [1, 2, 1]),
    { t: 'poly', points: '15,4 16.4,8 19.5,7 18,10.5 20,11.5 16.6,12.6 17,16 15,14.4 13,16 13.4,12.6 10,11.5 12,10.5 10.5,7 13.6,8', fill: '#d52b1e' },
  ],
  MX: [
    ...bands(['#006847', '#fff', '#ce1126'], 'v'),
    { t: 'circle', cx: 15, cy: 10, r: 2.4, fill: '#8c6239' },
  ],
  AR: [
    ...bands(['#74acdf', '#fff', '#74acdf']),
    { t: 'circle', cx: 15, cy: 10, r: 2.2, fill: '#f6b40e' },
  ],
  ZA: [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#007a4d' },
    { t: 'poly', points: '0,0 30,0 30,7 0,7', fill: '#de3831' },
    { t: 'poly', points: '0,13 30,13 30,20 0,20', fill: '#002395' },
    { t: 'poly', points: '0,0 13,10 0,20', fill: '#000' },
    { t: 'path', d: 'M0,3L11,10L0,17', stroke: '#ffb612', sw: 2, fill: 'none' },
  ],
  EG: [
    ...bands(['#ce1126', '#fff', '#000']),
    { t: 'circle', cx: 15, cy: 10, r: 2, fill: '#c09300' },
  ],
  NG: bands(['#008751', '#fff', '#008751'], 'v'),
  KE: [
    ...bands(['#000', '#fff', '#bb0000', '#fff', '#006600'], 'h', [5, 1, 6, 1, 5]),
    { t: 'ellipse', cx: 15, cy: 10, rx: 2.4, ry: 4.6, fill: '#bb0000', stroke: '#fff', sw: 0.8 },
  ],
};

function Part({ p }) {
  const stroke = p.stroke ? { stroke: p.stroke, strokeWidth: p.sw ?? 1 } : null;
  switch (p.t) {
    case 'rect':
      return <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill} {...stroke} />;
    case 'circle':
      return <circle cx={p.cx} cy={p.cy} r={p.r} fill={p.fill} {...stroke} />;
    case 'ellipse':
      return <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={p.fill} {...stroke} />;
    case 'poly':
      return <polygon points={p.points} fill={p.fill} {...stroke} />;
    case 'path':
      return <path d={p.d} fill={p.fill ?? 'none'} {...stroke} />;
    default:
      return null;
  }
}

/**
 * @param {string} code ISO country code from the shared catalog
 */
export default function Flag({ code, className = '', title }) {
  const parts = FLAGS[code];
  const label = title ?? getCountry(code)?.name ?? code;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{label}</title>
      <clipPath id={`fc-${code}`}>
        <rect x="0" y="0" width={W} height={H} rx="2.5" />
      </clipPath>
      <g clipPath={`url(#fc-${code})`}>
        {/* A fallback field, so an unlisted code is still a plate rather than a hole. */}
        <rect x="0" y="0" width={W} height={H} fill="#334155" />
        {(parts ?? []).map((p, i) => (
          <Part key={i} p={p} />
        ))}
      </g>
      {/* Hairline: several flags are mostly white and would vanish on a dark card. */}
      <rect
        x="0.4"
        y="0.4"
        width={W - 0.8}
        height={H - 0.8}
        rx="2.2"
        fill="none"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="0.8"
      />
    </svg>
  );
}
