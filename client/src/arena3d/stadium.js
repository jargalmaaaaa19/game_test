// The 100m stadium: track, stands, crowd, and the props that make it read as a
// real venue rather than eight coloured strips.
//
// COORDINATE FRAME — fixed here, depended on by everything that draws into it:
//
//   +X  down the track. x=0 is the start line, x=100 the finish.
//   +Y  up.
//    Z  across the lanes, centred on 0; lane 1 is the most negative.
//
// The broadcast camera lives on the -Z side, out over the infield grass, so the
// stand the players actually see behind the runners is the +Z one. That is the
// only stand built from real bodies — the rest are painted, see `populate`.
//
// Nothing here is fetched. Every mesh is a Babylon primitive and every texture
// is drawn into a DynamicTexture on the device: the platform strips external
// assets at deploy, and a race that waits on a texture download starts late.

import { SHIRTS, buildCrowd, lcg } from './crowd.js';

export const LANE_WIDTH = 1.22; // IAAF
export const TRACK_LENGTH = 100;

const RUNOFF_BEFORE = 16; // apron behind the blocks
const RUNOFF_AFTER = 26; // and past the line, where finishers coast to a stop

const TRACK_ORANGE = '#c8562f';
const TRACK_ORANGE_DARK = '#b34a27';
const APRON_BLUE = '#54607f';
const GRASS = '#4f9a3f';
const SKY_TOP = '#2f6fb5';
const SKY_HAZE = '#bcd6ea';

/** Centre of a lane, in metres from the middle of the track. */
export const laneZ = (lane, laneCount) => (lane - (laneCount + 1) / 2) * LANE_WIDTH;

/** Half the width of the racing surface: lanes plus their kerbs. */
export const trackHalfWidth = (laneCount) => (laneCount * LANE_WIDTH) / 2 + 0.6;

const SKINS = ['#f0c9a4', '#c98d5f', '#8a5a37', '#e8b48a'];

function flat(B, scene, name, hex, { alpha = 1, emissive = 0 } = {}) {
  const mat = new B.StandardMaterial(name, scene);
  mat.diffuseColor = B.Color3.FromHexString(hex);
  mat.specularColor = new B.Color3(0.02, 0.02, 0.02);
  if (emissive) mat.emissiveColor = B.Color3.FromHexString(hex).scale(emissive);
  if (alpha < 1) mat.alpha = alpha;
  return mat;
}

/** A ground plane at height `y`, spanning the given x and z ranges. */
function slab(B, scene, name, mat, [x0, x1], [z0, z1], y) {
  const mesh = B.MeshBuilder.CreateGround(name, { width: x1 - x0, height: z1 - z0 }, scene);
  mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  mesh.material = mat;
  return mesh;
}

// ---------------------------------------------------------------------------
// Textures, all drawn on the device
// ---------------------------------------------------------------------------

/** Vertical sky gradient for the dome. */
function skyTexture(B, scene) {
  const tex = new B.DynamicTexture('sky', { width: 4, height: 256 }, scene, false);
  const ctx = tex.getContext();
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, SKY_TOP);
  grad.addColorStop(0.5, '#6fa3d6');
  grad.addColorStop(0.8, SKY_HAZE);
  grad.addColorStop(1, '#dde8f1');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  tex.update();
  return tex;
}

/**
 * Seating: rows of seats with people sitting in them, painted rather than
 * built. A stand 190m long holds thousands of spectators, and thousands of
 * meshes is not something a phone renders while also running a race — so only
 * the near stand gets real bodies (see `populate`) and every other stand wears
 * this. At 40m and beyond the two are indistinguishable.
 */
function seatingTexture(B, scene, seed) {
  const W = 256;
  const H = 256;
  const tex = new B.DynamicTexture('seating', { width: W, height: H }, scene, true);
  const ctx = tex.getContext();
  const rand = lcg(seed);

  ctx.fillStyle = '#243049';
  ctx.fillRect(0, 0, W, H);

  const rows = 8;
  const cols = 16;
  const rh = H / rows;
  const cw = W / cols;

  for (let r = 0; r < rows; r += 1) {
    ctx.fillStyle = r % 2 ? '#2b3a58' : '#334269';
    ctx.fillRect(0, r * rh, W, rh - 2);
    // The lit edge of the step: without it the rows merge into one navy field.
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, r * rh + rh - 3, W, 2);

    for (let c = 0; c < cols; c += 1) {
      if (rand() < 0.12) continue; // an empty seat here and there
      const cx = c * cw + cw / 2 + (rand() - 0.5) * 3;
      const cy = r * rh + rh * 0.64;
      ctx.fillStyle = SHIRTS[Math.floor(rand() * SHIRTS.length)];
      ctx.fillRect(cx - cw * 0.28, cy - rh * 0.22, cw * 0.56, rh * 0.32);
      ctx.fillStyle = SKINS[Math.floor(rand() * SKINS.length)];
      ctx.beginPath();
      ctx.arc(cx, cy - rh * 0.32, Math.min(cw, rh) * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  tex.update();
  return tex;
}

/** Trackside hoardings, repeated along the length of the board. */
function adTexture(B, scene) {
  const W = 512;
  const H = 96;
  const tex = new B.DynamicTexture('ads', { width: W, height: H }, scene, true);
  const ctx = tex.getContext();

  ctx.fillStyle = '#101725';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1b2740';
  ctx.fillRect(W / 2, 0, W / 2, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('УСИОН', W * 0.25, H / 2);
  ctx.fillStyle = '#ffd23f';
  ctx.fillText('ОЛИМП', W * 0.75, H / 2);

  tex.update();
  return tex;
}

/** The banner over the line. */
function finishTexture(B, scene) {
  const W = 512;
  const H = 96;
  const tex = new B.DynamicTexture('finishBanner', { width: W, height: H }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = '#0d1220';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('100 М  ·  ФИНИШ', W / 2, H / 2 + 2);
  tex.update();
  return tex;
}

/** Soft round puff. One texture serves every runner's dust. */
export function puffTexture(B, scene) {
  const S = 64;
  const tex = new B.DynamicTexture('puff', { width: S, height: S }, scene, false);
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Stands
// ---------------------------------------------------------------------------

/**
 * One raked stand, built in local space: it runs along local X and rises
 * toward local +Z. The caller rotates and places the whole thing, which is why
 * the four sides of the bowl are one function and not four.
 *
 * @returns {{node, seatAt: (row: number, x: number) => object, rows: number}}
 *   `seatAt` gives the LOCAL position of a seat, for placing real spectators.
 */
function buildStand(B, scene, name, opts) {
  const { length, rows, rowRise, rowRun, wallHeight, seatMat, wallMat } = opts;
  const node = new B.TransformNode(name, scene);

  const run = rows * rowRun;
  const rise = rows * rowRise;

  const wall = B.MeshBuilder.CreateBox(`${name}_wall`, { width: length, height: wallHeight, depth: 0.8 }, scene);
  wall.position.set(0, wallHeight / 2, 0.4);
  wall.material = wallMat;
  wall.parent = node;

  // The deck is a slab tilted about X. Lifting +Z needs a NEGATIVE angle:
  // rotation about X sends (0,0,1) to (0,-sin,cos).
  const deck = B.MeshBuilder.CreateBox(`${name}_deck`, {
    width: length,
    height: 0.4,
    depth: Math.hypot(run, rise),
  }, scene);
  deck.rotation.x = -Math.atan2(rise, run);
  deck.position.set(0, wallHeight + rise / 2, 0.8 + run / 2);
  deck.material = seatMat;
  deck.parent = node;

  // Back wall, so the stand has a silhouette against the sky instead of a
  // paper edge.
  const back = B.MeshBuilder.CreateBox(`${name}_back`, {
    width: length,
    height: rise + wallHeight,
    depth: 1.2,
  }, scene);
  back.position.set(0, (rise + wallHeight) / 2, 0.8 + run + 0.6);
  back.material = wallMat;
  back.parent = node;

  const seatAt = (row, x) => new B.Vector3(
    x,
    wallHeight + (row + 0.6) * rowRise,
    0.8 + (row + 0.5) * rowRun,
  );

  return { node, seatAt, rows };
}

// ---------------------------------------------------------------------------

/**
 * Build the whole venue into `scene`.
 *
 * @param {object} B the BABYLON namespace (platform global, passed in)
 * @param {object} scene
 * @param {{laneCount: number, lowEnd?: boolean}} opts
 * @returns {{crowd: Array<{node, baseY: number, phase: number}>}} the crowd
 *   sections, for the caller to bob — everything else here never moves again.
 */
export function buildStadium(B, scene, { laneCount, lowEnd = false }) {
  const halfW = trackHalfWidth(laneCount);
  const x0 = -RUNOFF_BEFORE;
  const x1 = TRACK_LENGTH + RUNOFF_AFTER;

  // --- sky ----------------------------------------------------------------
  const sky = B.MeshBuilder.CreateSphere('sky', {
    diameter: 900,
    segments: 12,
    sideOrientation: B.Mesh.BACKSIDE,
  }, scene);
  const skyMat = new B.StandardMaterial('skyMat', scene);
  skyMat.emissiveTexture = skyTexture(B, scene);
  skyMat.disableLighting = true;
  skyMat.diffuseColor = new B.Color3(0, 0, 0);
  sky.material = skyMat;
  sky.position.x = TRACK_LENGTH / 2;
  sky.applyFog = false;
  // Deliberately NOT `infiniteDistance`: that flag rewrites the mesh's world
  // matrix from the camera every frame, which is exactly what the freeze at
  // the bottom of this function takes away. A 450m dome already swallows a
  // 140m track, so parking it over the halfway mark costs nothing.

  scene.fogMode = B.Scene.FOGMODE_LINEAR;
  scene.fogColor = B.Color3.FromHexString(SKY_HAZE);
  scene.fogStart = 120;
  scene.fogEnd = 360;

  // --- ground layers, stacked a centimetre apart to keep them off each other
  const apronMat = flat(B, scene, 'apron', APRON_BLUE);
  const grassMat = flat(B, scene, 'grass', GRASS);
  const trackMat = flat(B, scene, 'track', TRACK_ORANGE);
  const lineMat = flat(B, scene, 'lines', '#f4f6f8', { emissive: 0.1 });

  slab(B, scene, 'apron', apronMat, [x0 - 26, x1 + 26], [-halfW - 34, halfW + 12], -0.03);
  slab(B, scene, 'infield', grassMat, [x0 - 20, x1 + 20], [-halfW - 28, -halfW - 1.4], -0.02);
  slab(B, scene, 'trackSurface', trackMat, [x0, x1], [-halfW, halfW], 0);
  // The outer lane sits on a slightly darker shoulder, the way a real surface
  // weathers — it is what stops the track reading as one flat decal.
  slab(B, scene, 'trackShoulder', flat(B, scene, 'trackDark', TRACK_ORANGE_DARK),
    [x0, x1], [halfW - 0.6, halfW], 0.005);

  // --- lane lines, start, finish and distance ticks, merged into one mesh --
  const marks = [];
  for (let i = 0; i <= laneCount; i += 1) {
    const z = laneZ(1, laneCount) - LANE_WIDTH / 2 + i * LANE_WIDTH;
    marks.push(slab(B, scene, `lane${i}`, lineMat, [x0 + 2, x1 - 2], [z - 0.045, z + 0.045], 0.012));
  }
  const laneSpan = [laneZ(1, laneCount) - LANE_WIDTH / 2, laneZ(laneCount, laneCount) + LANE_WIDTH / 2];
  marks.push(slab(B, scene, 'startLine', lineMat, [-0.07, 0.07], laneSpan, 0.014));
  marks.push(slab(B, scene, 'finishLine', lineMat, [TRACK_LENGTH - 0.14, TRACK_LENGTH + 0.14], laneSpan, 0.014));
  // A tick every ten metres. This is what makes speed legible: with the camera
  // tracking the pack, the runners are nearly stationary in frame and the
  // ground is the only thing that moves.
  for (let m = 10; m < TRACK_LENGTH; m += 10) {
    for (let lane = 1; lane <= laneCount; lane += 1) {
      const z = laneZ(lane, laneCount);
      marks.push(slab(B, scene, `tick${m}_${lane}`, lineMat, [m - 0.06, m + 0.06], [z - 0.24, z + 0.24], 0.013));
    }
  }
  const markings = B.Mesh.MergeMeshes(marks, true, true, undefined, false, false);
  if (markings) markings.material = lineMat;

  // No starting blocks: the athletes take a STANDING start (see the arena's
  // `SET` pose), and blocks on the track with nobody in them just read as
  // litter behind the field.

  // --- trackside hoardings ------------------------------------------------
  const ads = adTexture(B, scene);
  ads.uScale = 16;
  const adMat = new B.StandardMaterial('adMat', scene);
  adMat.diffuseTexture = ads;
  adMat.emissiveTexture = ads;
  adMat.emissiveColor = new B.Color3(0.4, 0.4, 0.4);
  adMat.specularColor = new B.Color3(0, 0, 0);
  const board = B.MeshBuilder.CreateBox('adBoard', { width: x1 - x0 - 8, height: 1.05, depth: 0.3 }, scene);
  board.position.set((x0 + x1) / 2, 0.53, halfW + 1.7);
  board.material = adMat;

  // --- finish gantry ------------------------------------------------------
  const postMat = flat(B, scene, 'post', '#e6ecf2');
  for (const side of [-1, 1]) {
    const post = B.MeshBuilder.CreateCylinder(`gantryPost${side}`, {
      height: 6.4, diameter: 0.3, tessellation: 10,
    }, scene);
    post.position.set(TRACK_LENGTH, 3.2, side * (halfW + 1.2));
    post.material = postMat;
  }
  const bannerTex = finishTexture(B, scene);
  const bannerMat = new B.StandardMaterial('bannerMat', scene);
  bannerMat.diffuseTexture = bannerTex;
  bannerMat.emissiveTexture = bannerTex;
  bannerMat.emissiveColor = new B.Color3(0.45, 0.45, 0.45);
  bannerMat.specularColor = new B.Color3(0, 0, 0);
  // Planes, not a box: a box wraps one copy of the texture onto every face, so
  // the lettering came out smeared across a 16m span and unreadable.
  //
  // And TWO of them, back to back, rather than one double-sided plane: a
  // double-sided plane shows the same texture reversed on its back, so the
  // banner read "ШИНИФ · М 001" to anyone past the line — which is exactly
  // where the camera goes at the finish.
  for (const facing of [-1, 1]) {
    const banner = B.MeshBuilder.CreatePlane(`banner${facing}`, {
      width: (halfW + 1.2) * 2,
      height: 1.5,
    }, scene);
    banner.rotation.y = (facing * Math.PI) / 2; // turn its width across the track
    banner.position.set(TRACK_LENGTH + facing * 0.06, 5.9, 0);
    banner.material = bannerMat;
  }

  // --- floodlights --------------------------------------------------------
  const lampMat = flat(B, scene, 'lamp', '#fdf6df', { emissive: 0.95 });
  const towers = [
    [x0 + 6, halfW + 34], [x1 - 6, halfW + 34],
    [x0 + 6, -halfW - 44], [x1 - 6, -halfW - 44],
  ];
  towers.forEach(([lx, lz], i) => {
    const pole = B.MeshBuilder.CreateCylinder(`floodPole${i}`, {
      height: 26, diameter: 0.6, tessellation: 8,
    }, scene);
    pole.position.set(lx, 13, lz);
    pole.material = postMat;
    const rig = B.MeshBuilder.CreateBox(`floodRig${i}`, { width: 7, height: 2.2, depth: 0.5 }, scene);
    rig.position.set(lx, 26.4, lz);
    rig.material = lampMat;
  });

  // --- the bowl -----------------------------------------------------------
  const wallMat = flat(B, scene, 'standWall', '#2a3450');

  // Each stand needs its OWN texture: uScale lives on the texture, so one
  // shared copy would let the last stand built decide the seat size for every
  // stand. And it has to be re-drawn, not cloned — `DynamicTexture.clone`
  // copies the size and the wrap settings but NOT the canvas, so a cloned
  // seating texture is blank and the stand renders as a flat navy slab.
  // (It did. Every stand in the ground was an empty wall.)
  let seatId = 0;
  const tiled = (u, v) => {
    seatId += 1;
    const mat = new B.StandardMaterial(`seat_${seatId}`, scene);
    const tex = seatingTexture(B, scene, 7);
    tex.uScale = u;
    tex.vScale = v;
    // A raked deck is seen nearly edge-on from a trackside camera, so the rows
    // compress into a couple of pixels and plain mip filtering averages the
    // whole stand into one flat navy field. Anisotropy is what keeps the rows
    // rows.
    tex.anisotropicFilteringLevel = 8;
    mat.diffuseTexture = tex;
    mat.emissiveColor = new B.Color3(0.16, 0.16, 0.18); // stands read too dark otherwise
    mat.specularColor = new B.Color3(0, 0, 0);
    return mat;
  };

  const sideLength = x1 - x0 + 44;
  const endLength = (halfW + 32) * 2;
  // A LOW front wall matters more than it sounds: the broadcast camera sits
  // about four metres up, so anything taller than about two hides the first
  // rows and the crowd starts halfway up the frame instead of just behind the
  // runners' heads.
  const rake = { rowRise: 0.85, rowRun: 1.35, wallHeight: 2.1 };

  // Far side (+Z): the stand the camera looks into all race. Real bodies here.
  const far = buildStand(B, scene, 'standFar', {
    ...rake, length: sideLength, rows: 14, seatMat: tiled(sideLength / 7, 3), wallMat,
  });
  far.node.position.set((x0 + x1) / 2, 0, halfW + 8.5);

  // Near side (-Z, behind the camera) and the two ends. These are only ever
  // seen edge-on at eighty metres or more, where the seating texture stops
  // reading as seats and starts smearing into colour fringes — so they get a
  // plain deck. The one stand the camera actually looks into is the far side,
  // and that one has real bodies on it.
  const distantSeats = flat(B, scene, 'distantSeats', '#303d5e');
  const near = buildStand(B, scene, 'standNear', {
    ...rake, length: sideLength, rows: 12, seatMat: distantSeats, wallMat,
  });
  near.node.position.set((x0 + x1) / 2, 0, -halfW - 34);
  near.node.rotation.y = Math.PI;

  const west = buildStand(B, scene, 'standWest', {
    ...rake, length: endLength, rows: 12, seatMat: distantSeats, wallMat,
  });
  west.node.position.set(x0 - 22, 0, halfW - 11);
  west.node.rotation.y = -Math.PI / 2;

  const east = buildStand(B, scene, 'standEast', {
    ...rake, length: endLength, rows: 12, seatMat: distantSeats, wallMat,
  });
  east.node.position.set(x1 + 22, 0, halfW - 11);
  east.node.rotation.y = Math.PI / 2;

  // The far stand's seats, handed to the shared crowd builder in WORLD space.
  far.node.computeWorldMatrix(true);
  const farWorld = far.node.getWorldMatrix();
  const perRow = lowEnd ? 52 : 104;
  const spacing = lowEnd ? 3.4 : 1.7;
  const crowd = buildCrowd(B, scene, {
    rows: lowEnd ? 5 : 14,
    perRow,
    sections: lowEnd ? 3 : 6,
    seed: 3,
    yaw: far.node.rotation.y + Math.PI, // turn back to face the track
    seatAt: (row, i) => B.Vector3.TransformCoordinates(
      far.seatAt(row, (i - (perRow - 1) / 2) * spacing),
      farWorld,
    ),
  });

  // Everything above is static for the whole race. Tell the engine, so it
  // stops recomputing world matrices for a few hundred meshes every frame.
  for (const mesh of scene.meshes) {
    mesh.isPickable = false;
    if (!mesh.name.startsWith('crowd_')) mesh.freezeWorldMatrix();
    mesh.material?.freeze();
  }

  return { crowd };
}

/**
 * Daylight. Two lights and no shadow maps: a shadow generator covering a 140m
 * track with ten jointed characters on it costs a second full pass, and the
 * blob under each runner (see the arena) grounds them for nothing.
 */
export function lightStadium(B, scene) {
  const fill = new B.HemisphericLight('fill', new B.Vector3(0.1, 1, -0.2), scene);
  fill.intensity = 0.85;
  fill.groundColor = new B.Color3(0.36, 0.4, 0.34);
  fill.specular = new B.Color3(0.05, 0.05, 0.05);

  const sun = new B.DirectionalLight('sun', new B.Vector3(0.4, -0.78, 0.5), scene);
  sun.intensity = 0.75;
  sun.specular = new B.Color3(0.08, 0.08, 0.08);

  return { fill, sun };
}
