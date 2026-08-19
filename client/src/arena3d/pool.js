// The 50m pool, and the hall it sits in.
//
// COORDINATE FRAME — the same convention the stadium uses, so the two arenas
// read the same way:
//
//   +X  down the pool. x=0 is the start wall, x=50 the finish wall.
//   +Y  up. The water surface is y=0 and the deck stands just above it.
//    Z  across the lanes, centred on 0; lane 1 is the most negative.
//
// The camera works from the -Z side, so the gallery the swimmers are seen
// against is the +Z one. Nothing here is fetched: primitives and textures drawn
// on the device, because the platform strips external assets at deploy.

import { buildCrowd } from './crowd.js';

export const LANE_WIDTH = 2.5; // FINA
export const POOL_LENGTH = 50;
export const WATER_Y = 0;
export const DECK_Y = 0.42; // pool edge stands proud of the water
export const POOL_DEPTH = 2.2;

const DECK_TILE = '#d5dee4';
const WALL_TILE = '#eef3f6';
const WATER = '#1f7f92';
const HALL = '#1b2733';

export const laneZ = (lane, laneCount) => (lane - (laneCount + 1) / 2) * LANE_WIDTH;
export const poolHalfWidth = (laneCount) => (laneCount * LANE_WIDTH) / 2;

function flat(B, scene, name, hex, { alpha = 1, emissive = 0, texture = null } = {}) {
  const mat = new B.StandardMaterial(name, scene);
  mat.diffuseColor = B.Color3.FromHexString(hex);
  mat.specularColor = new B.Color3(0.03, 0.03, 0.03);
  if (emissive) mat.emissiveColor = B.Color3.FromHexString(hex).scale(emissive);
  if (alpha < 1) mat.alpha = alpha;
  if (texture) {
    mat.diffuseTexture = texture;
    mat.diffuseColor = new B.Color3(1, 1, 1);
  }
  return mat;
}

function slab(B, scene, name, mat, [x0, x1], [z0, z1], y) {
  const mesh = B.MeshBuilder.CreateGround(name, { width: x1 - x0, height: z1 - z0 }, scene);
  mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  mesh.material = mat;
  return mesh;
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

/** Small square tiles, for the deck and the pool walls. */
function tileTexture(B, scene, name, base, grout) {
  const S = 128;
  const tex = new B.DynamicTexture(name, { width: S, height: S }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = grout;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = base;
  const n = 4;
  const c = S / n;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) ctx.fillRect(i * c + 1.5, j * c + 1.5, c - 3, c - 3);
  }
  tex.update();
  return tex;
}

/**
 * The floor of one lane: the long black guide line with its cross bars, on the
 * pale tile the rest of the pool is made of. Painted rather than built because
 * it is read THROUGH the water, where a mesh a centimetre off the floor
 * z-fights with its own reflection.
 */
function laneFloorTexture(B, scene) {
  const W = 1024;
  const H = 128;
  const tex = new B.DynamicTexture('laneFloor', { width: W, height: H }, scene, true);
  const ctx = tex.getContext();

  ctx.fillStyle = '#cfe3ea';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#b3ccd6';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 16; i += 1) {
    ctx.beginPath();
    ctx.moveTo((i / 16) * W, 0);
    ctx.lineTo((i / 16) * W, H);
    ctx.stroke();
  }

  // The guide line runs the length of the lane; the T at each end is what a
  // swimmer actually navigates by.
  ctx.fillStyle = '#16323d';
  ctx.fillRect(W * 0.04, H / 2 - 7, W * 0.92, 14);
  ctx.fillRect(W * 0.06, H / 2 - 34, 14, 68);
  ctx.fillRect(W * 0.94 - 14, H / 2 - 34, 14, 68);

  tex.update();
  return tex;
}

/**
 * One lane rope: alternating red and white floats, as a band pattern.
 *
 * The bands run along the texture's U, not its V. On a Babylon cylinder it is
 * U that runs along the length once the cylinder is laid down — banding by V
 * wraps the stripes around the circumference instead, and every rope came out
 * a single solid colour down its whole fifty metres.
 */
function ropeTexture(B, scene) {
  const W = 128;
  const H = 16;
  const tex = new B.DynamicTexture('rope', { width: W, height: H }, scene, true);
  const ctx = tex.getContext();
  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = i % 2 ? '#e8e8ea' : '#c8342b';
    ctx.fillRect((i / 8) * W, 0, W / 8, H);
  }
  tex.update();
  return tex;
}

/** A swimmer's name, painted along their lane at the start. */
export function nameTexture(B, scene, name) {
  const W = 512;
  const H = 128;
  const tex = new B.DynamicTexture(`name_${name}`, { width: W, height: H }, scene, true);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 78px sans-serif';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(6,24,32,0.55)';
  ctx.strokeText(name.toUpperCase(), W / 2, H / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name.toUpperCase(), W / 2, H / 2);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** Soft round puff, shared by every swimmer's wake. */
export function foamTexture(B, scene) {
  const S = 64;
  const tex = new B.DynamicTexture('foam', { width: S, height: S }, scene, false);
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** The board on the finish-end deck. */
function finishTexture(B, scene) {
  const W = 512;
  const H = 160;
  const tex = new B.DynamicTexture('poolFinish', { width: W, height: H }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = '#e9eff3';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#16323d';
  ctx.fillRect(10, 10, W - 20, H - 20);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 84px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('ФИНИШ', W / 2, H / 2 + 4);
  tex.update();
  return tex;
}

/** Hoardings along the far side of the deck. */
function adTexture(B, scene) {
  const W = 512;
  const H = 96;
  const tex = new B.DynamicTexture('poolAds', { width: W, height: H }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = '#0e2a38';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#12384a';
  ctx.fillRect(W / 2, 0, W / 2, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('УСИОН', W * 0.25, H / 2);
  ctx.fillStyle = '#5fd0e8';
  ctx.fillText('ОЛИМП', W * 0.75, H / 2);
  tex.update();
  return tex;
}

// ---------------------------------------------------------------------------

/**
 * Build the natatorium into `scene`.
 *
 * @returns {{crowd: Array<{node, baseY: number, phase: number}>}}
 */
export function buildPool(B, scene, { laneCount, lowEnd = false }) {
  const halfW = poolHalfWidth(laneCount);
  const x0 = 0;
  const x1 = POOL_LENGTH;

  scene.clearColor = B.Color4.FromHexString(`${HALL}ff`);
  scene.fogMode = B.Scene.FOGMODE_LINEAR;
  scene.fogColor = B.Color3.FromHexString('#24404f');
  scene.fogStart = 80;
  scene.fogEnd = 240;

  const deckTile = tileTexture(B, scene, 'deckTile', DECK_TILE, '#b9c6cf');
  const wallTile = tileTexture(B, scene, 'wallTile', WALL_TILE, '#c9d6dd');

  // --- pool floor and walls ------------------------------------------------
  // The floor is one plane per lane so each gets its own guide line, tiled
  // along its length.
  // RE-DRAWN per lane, never cloned. `DynamicTexture.clone()` copies the size
  // and the wrap settings but NOT the canvas, so a cloned texture comes back
  // blank — the pool floor rendered as flat teal and the guide lines simply
  // were not there. (The stadium's seating lost the same way.)
  for (let lane = 1; lane <= laneCount; lane += 1) {
    const tex = laneFloorTexture(B, scene);
    const mat = flat(B, scene, `laneFloor${lane}`, '#ffffff', { texture: tex, emissive: 0 });
    mat.emissiveColor = new B.Color3(0.34, 0.4, 0.43);
    tex.anisotropicFilteringLevel = 8;
    const z = laneZ(lane, laneCount);
    slab(B, scene, `floor${lane}`, mat, [x0, x1], [z - LANE_WIDTH / 2, z + LANE_WIDTH / 2], -POOL_DEPTH);
  }

  const wallMat = flat(B, scene, 'poolWall', '#ffffff', { texture: wallTile });
  wallMat.diffuseTexture.uScale = 24;
  wallMat.diffuseTexture.vScale = 2;
  const wallMatEnd = flat(B, scene, 'poolWallEnd', '#ffffff', {
    texture: tileTexture(B, scene, 'wallTileEnd', WALL_TILE, '#c9d6dd'),
  });
  wallMatEnd.diffuseTexture.uScale = 10;
  wallMatEnd.diffuseTexture.vScale = 2;

  for (const side of [-1, 1]) {
    const wall = B.MeshBuilder.CreatePlane(`sideWall${side}`, {
      width: x1 - x0, height: POOL_DEPTH + DECK_Y, sideOrientation: B.Mesh.DOUBLESIDE,
    }, scene);
    wall.rotation.y = side < 0 ? 0 : Math.PI;
    wall.position.set((x0 + x1) / 2, (DECK_Y - POOL_DEPTH) / 2, side * halfW);
    wall.material = wallMat;
  }
  for (const [end, x] of [[-1, x0], [1, x1]]) {
    const wall = B.MeshBuilder.CreatePlane(`endWall${end}`, {
      width: halfW * 2, height: POOL_DEPTH + DECK_Y, sideOrientation: B.Mesh.DOUBLESIDE,
    }, scene);
    wall.rotation.y = end < 0 ? Math.PI / 2 : -Math.PI / 2;
    wall.position.set(x, (DECK_Y - POOL_DEPTH) / 2, 0);
    wall.material = wallMatEnd;
  }

  // --- water ---------------------------------------------------------------
  // Translucent, so the guide lines and the swimmers' bodies read through it.
  // Alpha meshes draw after opaque ones, so the swimmers underneath are
  // already in the buffer when the water tints them.
  const water = slab(
    B, scene, 'water',
    flat(B, scene, 'waterMat', WATER, { alpha: 0.46, emissive: 0.12 }),
    [x0, x1], [-halfW, halfW], WATER_Y,
  );
  water.isPickable = false;

  // --- deck ----------------------------------------------------------------
  const deckMat = flat(B, scene, 'deck', '#ffffff', { texture: deckTile });
  deckMat.diffuseTexture.uScale = 40;
  deckMat.diffuseTexture.vScale = 40;
  const deckOut = 9;
  slab(B, scene, 'deckNear', deckMat, [x0 - deckOut, x1 + deckOut], [-halfW - deckOut, -halfW], DECK_Y);
  slab(B, scene, 'deckFar', deckMat, [x0 - deckOut, x1 + deckOut], [halfW, halfW + deckOut], DECK_Y);
  slab(B, scene, 'deckStart', deckMat, [x0 - deckOut, x0], [-halfW, halfW], DECK_Y);
  slab(B, scene, 'deckFinish', deckMat, [x1, x1 + deckOut], [-halfW, halfW], DECK_Y);

  // --- lane ropes ----------------------------------------------------------
  // A textured cylinder rather than a few hundred merged floats: at this
  // distance the banding is the whole read, and it is one draw call a rope.
  for (let i = 0; i <= laneCount; i += 1) {
    const z = laneZ(1, laneCount) - LANE_WIDTH / 2 + i * LANE_WIDTH;
    const tex = ropeTexture(B, scene); // re-drawn, not cloned — see the floor above
    tex.uScale = (x1 - x0) / 4; // a red/white pair every half metre
    tex.anisotropicFilteringLevel = 8;
    const mat = flat(B, scene, `ropeMat${i}`, '#ffffff', { texture: tex });
    mat.emissiveColor = new B.Color3(0.5, 0.5, 0.5);
    const rope = B.MeshBuilder.CreateCylinder(`rope${i}`, {
      height: x1 - x0, diameter: 0.36, tessellation: 8,
    }, scene);
    rope.rotation.z = Math.PI / 2; // a cylinder is built along Y; lay it along X
    rope.position.set((x0 + x1) / 2, WATER_Y + 0.1, z);
    rope.material = mat;
  }

  // --- starting blocks -----------------------------------------------------
  const blocks = [];
  for (let lane = 1; lane <= laneCount; lane += 1) {
    const z = laneZ(lane, laneCount);
    const base = B.MeshBuilder.CreateBox(`blockBase${lane}`, { width: 0.7, height: 0.5, depth: 0.7 }, scene);
    base.position.set(-0.75, DECK_Y + 0.25, z);
    const top = B.MeshBuilder.CreateBox(`blockTop${lane}`, { width: 0.78, height: 0.1, depth: 0.78 }, scene);
    top.position.set(-0.75, DECK_Y + 0.53, z);
    top.rotation.z = -0.12; // tipped toward the water, the way a block is
    blocks.push(base, top);
  }
  const blockMesh = B.Mesh.MergeMeshes(blocks, true, true, undefined, false, false);
  if (blockMesh) blockMesh.material = flat(B, scene, 'blocks', '#1d3340');

  // --- hall ----------------------------------------------------------------
  const hallMat = flat(B, scene, 'hall', HALL);
  // The room is deliberately bigger than the deck: the start and finish
  // cameras sit back beyond the pool ends, and a wall drawn at the edge of the
  // tiles puts them outside the building looking at its back. (It did — the
  // whole frame came back one flat slab of wall colour.)
  const hallOut = deckOut + 9;
  const hallW = halfW + hallOut;
  // Tall, because the racing camera is a plan view: to fit the lanes across a
  // PORTRAIT phone it has to climb to about twenty metres, and a fourteen
  // metre ceiling puts it in the roof void looking at the underside of the
  // roof. Natatoriums are genuinely this tall.
  const hallH = 26;
  for (const side of [-1, 1]) {
    const wall = B.MeshBuilder.CreatePlane(`hallSide${side}`, {
      width: (x1 - x0) + hallOut * 2, height: hallH, sideOrientation: B.Mesh.DOUBLESIDE,
    }, scene);
    wall.position.set((x0 + x1) / 2, hallH / 2, side * hallW);
    wall.rotation.y = side < 0 ? 0 : Math.PI;
    wall.material = hallMat;
  }
  for (const [end, x] of [[-1, x0 - hallOut], [1, x1 + hallOut]]) {
    const wall = B.MeshBuilder.CreatePlane(`hallEnd${end}`, {
      width: hallW * 2, height: hallH, sideOrientation: B.Mesh.DOUBLESIDE,
    }, scene);
    wall.position.set(x, hallH / 2, 0);
    wall.rotation.y = end < 0 ? Math.PI / 2 : -Math.PI / 2;
    wall.material = hallMat;
  }
  const roof = slab(B, scene, 'roof', flat(B, scene, 'roofMat', '#101a24'),
    [x0 - hallOut, x1 + hallOut], [-hallW, hallW], hallH);
  roof.rotation.x = Math.PI; // face down into the hall

  // Strip lights, the only thing lifting the ceiling off the water.
  const lampMat = flat(B, scene, 'poolLamp', '#f2f7ff', { emissive: 1 });
  for (let i = 0; i < 5; i += 1) {
    const lamp = B.MeshBuilder.CreateBox(`strip${i}`, { width: 8, height: 0.3, depth: 1.2 }, scene);
    lamp.position.set(4 + i * 11, hallH - 0.6, 0);
    lamp.material = lampMat;
  }

  // --- hoardings on the far deck ------------------------------------------
  const ads = adTexture(B, scene);
  ads.uScale = 9;
  const adMat = flat(B, scene, 'poolAdMat', '#ffffff', { texture: ads });
  adMat.emissiveColor = new B.Color3(0.45, 0.45, 0.45);
  const board = B.MeshBuilder.CreateBox('poolBoard', {
    width: (x1 - x0) - 4, height: 1.1, depth: 0.25,
  }, scene);
  board.position.set((x0 + x1) / 2, DECK_Y + 0.55, halfW + 5.5);
  board.material = adMat;

  // --- backstroke flags ----------------------------------------------------
  // Five metres off each wall, which is exactly what they are for: on this
  // stroke you are looking at the ceiling, and the pennants are how you know
  // the wall is coming. Merged by colour, a handful of draw calls for the lot.
  const pennantColours = ['#e0483c', '#f0b429', '#3fa9e0', '#57b25b', '#d95fa0', '#f2f0e6'];
  const pennants = pennantColours.map(() => []);
  for (const atX of [5, x1 - 5]) {
    const wire = B.MeshBuilder.CreateCylinder(`flagWire${atX}`, {
      height: halfW * 2 + 2, diameter: 0.05, tessellation: 6,
    }, scene);
    wire.rotation.x = Math.PI / 2; // a cylinder is built along Y; lay it across Z
    wire.position.set(atX, DECK_Y + 1.9, 0);
    wire.material = flat(B, scene, `flagWireMat${atX}`, '#9aa7b1');

    const count = Math.round((halfW * 2) / 0.55);
    for (let i = 0; i <= count; i += 1) {
      const z = -halfW + (i / count) * halfW * 2;
      const tri = B.MeshBuilder.CreateDisc(`pennant${atX}_${i}`, {
        radius: 0.26, tessellation: 3,
      }, scene);
      tri.rotation.set(0, Math.PI / 2, Math.PI); // face down the pool, point down
      tri.position.set(atX, DECK_Y + 1.68, z);
      pennants[i % pennantColours.length].push(tri);
    }
  }
  pennants.forEach((group, i) => {
    if (group.length === 0) return;
    const merged = B.Mesh.MergeMeshes(group, true, true, undefined, false, false);
    if (!merged) return;
    const mat = flat(B, scene, `pennantMat${i}`, pennantColours[i]);
    mat.backFaceCulling = false;
    mat.emissiveColor = B.Color3.FromHexString(pennantColours[i]).scale(0.3);
    merged.material = mat;
  });

  // --- finish board --------------------------------------------------------
  // Faces back down the pool, because that is where both the swimmers and the
  // celebration camera are looking from.
  const finishTex = finishTexture(B, scene);
  const finishMat = flat(B, scene, 'poolFinishMat', '#ffffff', { texture: finishTex });
  finishMat.emissiveColor = new B.Color3(0.5, 0.5, 0.5);
  const sign = B.MeshBuilder.CreatePlane('finishSign', { width: 4.4, height: 1.4 }, scene);
  sign.rotation.y = -Math.PI / 2; // face -X
  sign.position.set(x1 + 2.5, DECK_Y + 1.5, -halfW + 2);
  sign.material = finishMat;
  for (const side of [-1, 1]) {
    const post = B.MeshBuilder.CreateCylinder(`signPost${side}`, {
      height: 1.5, diameter: 0.14, tessellation: 8,
    }, scene);
    post.position.set(x1 + 2.5, DECK_Y + 0.75, -halfW + 2 + side * 1.9);
    post.material = flat(B, scene, `signPostMat${side}`, '#8e9aa4');
  }

  // --- poolside furniture, from the reference ------------------------------
  const woodMat = flat(B, scene, 'wood', '#a9803f');
  const benches = [];
  for (let i = 0; i < 6; i += 1) {
    const bench = B.MeshBuilder.CreateBox(`bench${i}`, { width: 3.2, height: 0.12, depth: 0.5 }, scene);
    bench.position.set(6 + i * 8, DECK_Y + 0.45, -halfW - 4.5);
    benches.push(bench);
    for (const end of [-1, 1]) {
      const leg = B.MeshBuilder.CreateBox(`benchLeg${i}${end}`, { width: 0.12, height: 0.45, depth: 0.45 }, scene);
      leg.position.set(6 + i * 8 + end * 1.4, DECK_Y + 0.22, -halfW - 4.5);
      benches.push(leg);
    }
  }
  const benchMesh = B.Mesh.MergeMeshes(benches, true, true, undefined, false, false);
  if (benchMesh) benchMesh.material = woodMat;

  // --- gallery -------------------------------------------------------------
  // One raked bank on the far side, where the camera looks. Everything else in
  // the hall is wall.
  const rows = lowEnd ? 4 : 8;
  const rowRise = 0.7;
  const rowRun = 1.1;
  const galleryZ = halfW + 7;
  const deck = B.MeshBuilder.CreateBox('gallery', {
    width: (x1 - x0) + 8,
    height: 0.4,
    depth: Math.hypot(rows * rowRun, rows * rowRise),
  }, scene);
  deck.rotation.x = -Math.atan2(rows * rowRise, rows * rowRun);
  deck.position.set((x0 + x1) / 2, DECK_Y + (rows * rowRise) / 2, galleryZ + (rows * rowRun) / 2);
  deck.material = flat(B, scene, 'gallerySeats', '#26384a');

  const perRow = lowEnd ? 26 : 46;
  const spacing = 1.15;
  const crowd = buildCrowd(B, scene, {
    rows,
    perRow,
    sections: lowEnd ? 3 : 5,
    seed: 11,
    yaw: Math.PI, // face back across the water
    seatAt: (row, i) => new B.Vector3(
      (x0 + x1) / 2 + (i - (perRow - 1) / 2) * spacing,
      DECK_Y + (row + 0.6) * rowRise,
      galleryZ + (row + 0.5) * rowRun,
    ),
  });

  // Everything above is static for the whole race. Water is left unfrozen only
  // because it is alpha — freezing it is safe, but the swimmers are not, and
  // the crowd sections bob.
  for (const mesh of scene.meshes) {
    mesh.isPickable = false;
    if (!mesh.name.startsWith('crowd_')) mesh.freezeWorldMatrix();
    mesh.material?.freeze();
  }

  return { crowd };
}

/** Indoor light: flat and bright, the way a natatorium reads. */
export function lightPool(B, scene) {
  const fill = new B.HemisphericLight('poolFill', new B.Vector3(0, 1, -0.15), scene);
  fill.intensity = 0.95;
  fill.groundColor = new B.Color3(0.22, 0.34, 0.4);
  fill.specular = new B.Color3(0.06, 0.06, 0.06);

  const key = new B.DirectionalLight('poolKey', new B.Vector3(0.3, -0.85, 0.4), scene);
  key.intensity = 0.5;
  key.specular = new B.Color3(0.1, 0.1, 0.1);
  return { fill, key };
}
