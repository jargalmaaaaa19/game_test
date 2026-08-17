import { useEffect, useRef } from 'react';
import { babylon } from '../avatar3d/portraits.js';
import { buildChibi, setupStage } from '../avatar3d/chibi.js';
import Athlete from './Athlete.jsx';

/**
 * A live, slowly turning athlete. Used in the ONE place a player is studying
 * their character — the avatar studio — and on the champion's card.
 *
 * Everything the engine reference warns about is handled here: the engine is
 * never built against a 0×0 canvas (embedded hosts reveal the iframe after
 * load, and a 0×0 buffer never recovers), scale is driven by a ResizeObserver
 * rather than window resize (WebViews do not reliably fire it), and the render
 * loop stops while the page is hidden.
 */
export default function Avatar3D({
  skin,
  build,
  hair,
  outfit,
  spin = true,
  interactive = false,
  className = '',
  title,
}) {
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const stateRef = useRef({ engine: null, scene: null, root: null, camera: null });

  // Boot once; the look is applied separately so changing kit does not tear
  // down and rebuild the whole engine on every tap in the picker.
  useEffect(() => {
    const B = babylon();
    const canvas = canvasRef.current;
    const holder = holderRef.current;
    if (!B || !canvas || !holder) return undefined;

    let engine = null;
    let disposed = false;

    const boot = () => {
      if (disposed || engine) return;
      if (holder.clientWidth === 0 || holder.clientHeight === 0) return; // still hidden
      try {
        engine = new B.Engine(canvas, true, { alpha: true, adaptToDeviceRatio: true });
        const scene = new B.Scene(engine);
        const camera = setupStage(B, scene, canvas, { interactive });
        stateRef.current = { engine, scene, camera, root: null };

        engine.runRenderLoop(() => {
          if (document.hidden) return; // no point drawing into a hidden tab
          if (spin && !interactive) camera.alpha -= 0.004;
          scene.render();
        });
      } catch {
        engine = null; // the SVG fallback below covers it
      }
    };

    const observer = new ResizeObserver(() => {
      boot();
      stateRef.current.engine?.resize();
    });
    observer.observe(holder);
    boot();

    return () => {
      disposed = true;
      observer.disconnect();
      stateRef.current.scene?.dispose();
      stateRef.current.engine?.dispose();
      stateRef.current = { engine: null, scene: null, root: null, camera: null };
    };
  }, [interactive, spin]);

  // Rebuild just the character when the look changes.
  useEffect(() => {
    const B = babylon();
    const { scene } = stateRef.current;
    if (!B || !scene) return;
    stateRef.current.root?.dispose(false, true);
    stateRef.current.root = buildChibi(B, scene, { skin, build, hair, outfit });
  }, [skin, build, hair, outfit]);

  if (!babylon()) {
    return <Athlete skin={skin} build={build} hair={hair} outfit={outfit} className={className} title={title} />;
  }

  return (
    <div ref={holderRef} className={className} title={title}>
      <canvas ref={canvasRef} className="h-full w-full touch-none outline-none" aria-label={title} />
    </div>
  );
}
