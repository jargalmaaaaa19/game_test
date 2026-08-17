import { useEffect, useState } from 'react';
import { cachedPortrait, renderPortrait } from '../avatar3d/portraits.js';
import Athlete from './Athlete.jsx';

/**
 * A player's avatar wherever many of them appear at once — lobby cards, race
 * lanes, the results table.
 *
 * It is an <img> of a pre-rendered 3D portrait, not a live canvas: see
 * `avatar3d/portraits.js` for why. The flat SVG athlete holds the same box
 * until the render resolves, and stays for good if WebGL or the Babylon runtime
 * is missing — so the lobby never shows holes and never shifts layout.
 */
export default function AvatarPortrait({ skin, build, hair, outfit, className = '', title }) {
  const [src, setSrc] = useState(() => cachedPortrait({ skin, build, hair, outfit }));

  useEffect(() => {
    let alive = true;
    const cached = cachedPortrait({ skin, build, hair, outfit });
    if (cached) {
      setSrc(cached);
      return () => {
        alive = false;
      };
    }
    setSrc(null);
    renderPortrait({ skin, build, hair, outfit }).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [skin, build, hair, outfit]);

  if (!src) {
    return <Athlete skin={skin} build={build} hair={hair} outfit={outfit} className={className} title={title} />;
  }
  return (
    <img
      src={src}
      alt={title ?? ''}
      draggable={false}
      className={`select-none object-contain ${className}`}
    />
  );
}
