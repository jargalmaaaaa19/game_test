import { buildChibi, setupStage } from './chibi.js';

// Ten live 3D canvases in a lobby is ten WebGL contexts on a mid-range Android
// (browsers cap out around 8–16 and start evicting). So the cards do not render
// 3D at all: ONE offscreen engine draws each distinct look once, hands back a
// PNG data URL, and the cards are plain <img>. A look repeated across players
// costs nothing the second time.

const CACHE = new Map(); // key -> data URL
const PENDING = new Map(); // key -> Promise, so ten cards asking at once render once
const SIZE = 192;

let engine = null;
let scene = null;
let failed = false;

export const lookKey = (look) => `${look?.skin}|${look?.build}|${look?.hair}|${look?.outfit}`;

/** The runtime is a platform-hosted global; if it did not load, callers fall back. */
export const babylon = () => (typeof window !== 'undefined' ? window.BABYLON : null);

/** Already-rendered portrait, if any — lets a component paint without a flash. */
export const cachedPortrait = (look) => CACHE.get(lookKey(look)) ?? null;

function ensureEngine() {
  if (engine || failed) return engine;
  const B = babylon();
  if (!B) {
    failed = true;
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    // Explicit size: an engine built against a 0×0 canvas produces a 0×0 buffer
    // that never recovers, and every portrait comes back blank.
    canvas.width = SIZE;
    canvas.height = SIZE;

    engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true }, false);
    // Babylon compiles shaders in parallel by default, so the first frame draws
    // nothing at all. We still wait for `isReady` below, but turning this off
    // means that wait is one tick rather than several.
    engine.getCaps().parallelShaderCompile = null;

    scene = new B.Scene(engine);
    setupStage(B, scene, canvas);
  } catch {
    failed = true;
    engine = null;
  }
  return engine;
}

const whenReady = (sc) => new Promise((resolve) => sc.executeWhenReady(resolve));

/**
 * @returns {Promise<string|null>} a PNG data URL for this look, or null if
 *   WebGL or the Babylon runtime is unavailable — callers then keep showing the
 *   flat SVG athlete.
 *
 * Async because a scene is NOT renderable on the frame it is built: shaders
 * compile first, and rendering early produces a fully transparent image. (It
 * did — every portrait came back blank until this waited for `isReady`.)
 */
export function renderPortrait(look) {
  const key = lookKey(look);
  if (CACHE.has(key)) return Promise.resolve(CACHE.get(key));
  if (PENDING.has(key)) return PENDING.get(key);
  if (!ensureEngine()) return Promise.resolve(null);

  const B = babylon();
  const job = (async () => {
    let root = null;
    try {
      root = buildChibi(B, scene, look);
      await whenReady(scene);

      // `scene.render()` alone is not enough outside a render loop: Babylon's
      // loop wraps each frame in beginFrame/endFrame.
      engine.beginFrame();
      scene.render();
      engine.endFrame();

      const url = engine.getRenderingCanvas().toDataURL('image/png');
      CACHE.set(key, url);
      return url;
    } catch {
      return null;
    } finally {
      // Dispose the whole subtree — leaking one character per card would grow
      // the scene forever as players change kit in the hall.
      root?.dispose(false, true);
      PENDING.delete(key);
    }
  })();

  PENDING.set(key, job);
  return job;
}
