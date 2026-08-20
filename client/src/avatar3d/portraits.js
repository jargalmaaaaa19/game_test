import { buildChibi, setupStage } from './chibi.js';

// Ten live 3D canvases in a lobby is ten WebGL contexts on a mid-range Android
// (browsers cap out around 8–16 and start evicting). So the cards do not render
// 3D at all: ONE offscreen engine draws each distinct look once, hands back a
// PNG data URL, and the cards are plain <img>. A look repeated across players
// costs nothing the second time.

const CACHE = new Map(); // key -> data URL
const PENDING = new Map(); // key -> Promise, so ten cards asking at once render once
const SIZE = 192;

// ONE look is in the scene at a time, and this is why.
//
// There is a single offscreen scene, and `renderPortrait` is async: it builds a
// character, waits for shaders, renders, and only then disposes it. Eight cards
// asking for eight different looks at once therefore put EIGHT characters in
// that one scene simultaneously, and every `toDataURL` captured the same pile —
// so a gallery of eight distinct characters came back as eight copies of one
// picture. `PENDING` never caught it: it dedupes by key, and these are eight
// different keys. The fix is a queue, not a cache.
let queue = Promise.resolve();
const enqueue = (job) => {
  const run = queue.then(job, job);
  queue = run.then(() => {}, () => {});
  return run;
};

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

/**
 * Wait for the scene to actually be renderable.
 *
 * NOT `executeWhenReady`: with no render loop running — and there is none here,
 * portraits are rendered by hand — Babylon falls back to polling readiness on a
 * timer, and every portrait paid roughly a second of waiting for a scene that
 * was ready almost immediately. Polling it ourselves on the frame clock turns
 * that into a frame or two. The work was never the cost; the wait was.
 */
const whenReady = (sc) =>
  new Promise((resolve) => {
    let tries = 0;
    const tick = () => {
      // A ceiling, so a scene that never reports ready cannot hang the gallery
      // for good — it renders whatever it has instead.
      if (sc.isReady() || (tries += 1) > 400) resolve();
      // A TIMER, not requestAnimationFrame. rAF does not fire in a hidden or
      // backgrounded tab, so a player who switches apps mid-lobby comes back to
      // a gallery that never finished rendering. A timer is throttled there
      // rather than stopped, which is slow instead of broken.
      else setTimeout(tick, 4);
    };
    tick();
  });

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
  const job = enqueue(async () => {
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
  });

  PENDING.set(key, job);
  return job;
}
