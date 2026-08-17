import { getHair, getOutfit, getSkin } from '@shared/avatars.js';

/**
 * Flat SVG stand-in for the 3D athlete.
 *
 * Deliberately plain: it holds the same box while a portrait renders, and takes
 * over for good if WebGL or the Babylon runtime is unavailable. It carries the
 * player's actual colours so a fallback still identifies who it is — it just
 * does not try to reproduce the hairstyle or the outfit's cut.
 */
export default function Athlete({ skin, hair, outfit, className = '', title }) {
  // `build` is intentionally ignored: the flat fallback does not model it.
  const s = getSkin(skin).hex;
  const o = getOutfit(outfit).primary;
  const h = getHair(hair).color;

  return (
    <svg viewBox="0 0 64 80" className={className} role="img" aria-label={title}>
      {title ? <title>{title}</title> : null}
      <ellipse cx="32" cy="75" rx="15" ry="3" fill="#000" opacity="0.35" />

      <rect x="24" y="54" width="7" height="18" rx="3.5" fill={s} />
      <rect x="33" y="54" width="7" height="18" rx="3.5" fill={s} />
      <ellipse cx="27.5" cy="72" rx="5.5" ry="3" fill="#eceff3" />
      <ellipse cx="36.5" cy="72" rx="5.5" ry="3" fill="#eceff3" />

      <path d="M20 32c0-5 5.4-8 12-8s12 3 12 8v20c0 2.2-1.8 4-4 4H24c-2.2 0-4-1.8-4-4V32z" fill={o} />
      <circle cx="19" cy="48" r="3.4" fill={s} />
      <circle cx="45" cy="48" r="3.4" fill={s} />

      <circle cx="32" cy="15" r="11" fill={s} />
      <path d="M21.4 12a11 11 0 0121.2 0z" fill={h} />
      <circle cx="28" cy="15.5" r="1.7" fill="#241f1e" />
      <circle cx="36" cy="15.5" r="1.7" fill="#241f1e" />
      <ellipse cx="23.5" cy="18.5" rx="2.2" ry="1.3" fill="#f2758a" opacity="0.55" />
      <ellipse cx="40.5" cy="18.5" rx="2.2" ry="1.3" fill="#f2758a" opacity="0.55" />
      <ellipse cx="32" cy="20" rx="2" ry="1.4" fill="#7a2530" />
    </svg>
  );
}
