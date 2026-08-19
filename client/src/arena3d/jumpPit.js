import { RUNWAY_M, RUNOUT_M } from '../../../shared/events/long_jump.js';
import { trackHalfWidth } from './stadium.js';

// The long jump apparatus, built into the infield of the stadium the sprint
// already owns.
//
// COORDINATE FRAME — inherited from `stadium.js` and depended on by the arena:
//
//   +X  down the runway. x=0 is where the athletes start, x=RUNWAY_M the board.
//   +Y  up.
//    Z  across the lanes. The whole apparatus sits on the infield grass, on the
//       camera's side of the track, so the far stand and its crowd end up
//       BEHIND the jumpers in every shot.
//
// Nothing here is fetched — every mesh is a Babylon primitive and the measuring
// tape is drawn into a DynamicTexture on the device. Same reason as the rest of
// the venue: the platform strips external assets at deploy.

export const LANE_W = 2.2; // wider than a running lane: these are approach runs
export const RUNWAY_START = -3; // a little tarmac behind the athletes
export const PIT_LENGTH = 11.5; // metres of sand past the board
export const PIT_MARGIN = 1.3; // sand to either side of the outside lanes
export const BOARD_DEPTH = 0.2; // the white board itself
export const SAND_Y = 0.015;

const RUNWAY_RED = '#b8462a';
const RUNWAY_EDGE = '#f2f4f7';
const SAND = '#e4cf9d';
const SAND_DARK = '#cbb47f';
const KERB = '#dde3ea';

/** How far off the middle of the track the whole apparatus sits. */
export const pitCenterZ = (laneCount) => -trackHalfWidth(laneCount) - 14.5;

/**
 * Centre of one approach runway. `laneCount` here is the ROSTER, not the six
 * lanes the stadium is built for — the runways fan out from the pit's middle so
 * a duel and a full field of ten are both centred on the same sand.
 */
export const jumpLaneZ = (lane, jumpers, stadiumLanes) =>
  pitCenterZ(stadiumLanes) + (lane - (jumpers + 1) / 2) * LANE_W;

function flat(B, scene, name, hex, { emissive = 0 } = {}) {
  const mat = new B.StandardMaterial(name, scene);
  mat.diffuseColor = B.Color3.FromHexString(hex);
  mat.specularColor = new B.Color3(0.02, 0.02, 0.02);
  if (emissive) mat.emissiveColor = B.Color3.FromHexString(hex).scale(emissive);
  return mat;
}

function slab(B, scene, name, mat, [x0, x1], [z0, z1], y) {
  // Sorted, not taken as given: a ground built with a negative extent comes out
  // wound inside-out and is culled as a backface — an invisible mesh that
  // reports itself as present. (The near sand rim was exactly this.)
  const [xa, xb] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [za, zb] = z0 <= z1 ? [z0, z1] : [z1, z0];
  const mesh = B.MeshBuilder.CreateGround(name, { width: xb - xa, height: zb - za }, scene);
  mesh.position.set((xa + xb) / 2, y, (za + zb) / 2);
  mesh.material = mat;
  return mesh;
}

/**
 * The measuring tape down the side of the pit: the one thing on the field that
 * tells a player what a jump was WORTH while it is still in the air. Metre
 * bands run warm to cool the further out they go, exactly like the tape on a
 * real pit, so "one band further" is legible at a glance and from any camera.
 */
function tapeTexture(B, scene, metres) {
  const perM = 96;
  const W = perM * metres;
  const H = 96;
  const tex = new B.DynamicTexture('ljTape', { width: W, height: H }, scene, true);
  const ctx = tex.getContext();

  ctx.fillStyle = '#f4f7fa';
  ctx.fillRect(0, 0, W, H);

  // Cool at the near end of the pit, hot out where a big jump lands.
  const bands = ['#5aa9e6', '#4fbf9f', '#7ec850', '#c8d64a', '#f2c14e', '#ef8354', '#e5533d'];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let m = 0; m < metres; m += 1) {
    const x = m * perM;
    ctx.fillStyle = bands[Math.min(bands.length - 1, Math.floor((m / metres) * bands.length))];
    ctx.fillRect(x + 2, 6, perM - 4, H - 12);

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let d = 1; d < 10; d += 1) {
      // Decimetre ticks, the long one at the half.
      const tick = x + (d / 10) * perM;
      const len = d === 5 ? 26 : 15;
      ctx.fillRect(tick - 1.5, H - 8 - len, 3, len);
    }

    ctx.fillStyle = '#10141c';
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText(String(m + 1), x + perM / 2, H / 2 - 6);
  }

  tex.update();
  return tex;
}

/**
 * Build the runway, the board and the pit into an existing stadium scene.
 *
 * @param {object} B the BABYLON namespace (platform global, passed in)
 * @param {object} scene
 * @param {{jumpers: number, stadiumLanes: number}} opts
 * @returns {{boardX: number, centerZ: number, halfWidth: number, sandX0: number,
 *            sandX1: number, laneZ: (lane: number) => number}}
 */
export function buildJumpPit(B, scene, { jumpers, stadiumLanes }) {
  const centerZ = pitCenterZ(stadiumLanes);
  const halfWidth = (jumpers * LANE_W) / 2 + PIT_MARGIN;
  const boardX = RUNWAY_M;
  const sandX0 = boardX + BOARD_DEPTH + 0.15;
  const sandX1 = boardX + PIT_LENGTH;

  const laneZ = (lane) => jumpLaneZ(lane, jumpers, stadiumLanes);

  const runwayMat = flat(B, scene, 'ljRunway', RUNWAY_RED);
  const edgeMat = flat(B, scene, 'ljEdge', RUNWAY_EDGE, { emissive: 0.1 });
  const sandMat = flat(B, scene, 'ljSand', SAND, { emissive: 0.08 });
  const sandRimMat = flat(B, scene, 'ljSandRim', SAND_DARK);
  const kerbMat = flat(B, scene, 'ljKerb', KERB);
  const boardMat = flat(B, scene, 'ljBoard', '#ffffff', { emissive: 0.25 });
  const plasticineMat = flat(B, scene, 'ljPlasticine', '#e03a2f', { emissive: 0.2 });

  const built = [];

  // --- one approach runway per jumper -------------------------------------
  for (let lane = 1; lane <= jumpers; lane += 1) {
    const z = laneZ(lane);
    const halfLane = LANE_W / 2 - 0.15;
    built.push(slab(B, scene, `ljRun${lane}`, runwayMat,
      [RUNWAY_START, sandX0], [z - halfLane, z + halfLane], 0));
    // The white edge lines are what make speed legible: with the camera riding
    // alongside, the athlete is nearly still in frame and the ground is the
    // only thing that moves.
    for (const side of [-1, 1]) {
      built.push(slab(B, scene, `ljEdge${lane}_${side}`, edgeMat,
        [RUNWAY_START, boardX], [z + side * halfLane - 0.05, z + side * halfLane + 0.05], 0.008));
    }
    // A stride marker every five metres, and the last one at the point where a
    // player should already be thinking about the board.
    for (const m of [10, 20, 28, 33]) {
      built.push(slab(B, scene, `ljMark${lane}_${m}`, edgeMat,
        [m - 0.05, m + 0.05], [z - 0.32, z + 0.32], 0.009));
    }

    // The board, and the plasticine strip just past it — the line the whole
    // event is timed against, given its real dimensions so that "on the line"
    // is a target the eye can actually find at speed.
    built.push(slab(B, scene, `ljBoard${lane}`, boardMat,
      [boardX - BOARD_DEPTH, boardX], [z - halfLane, z + halfLane], 0.012));
    built.push(slab(B, scene, `ljPlast${lane}`, plasticineMat,
      [boardX, boardX + 0.12], [z - halfLane, z + halfLane], 0.012));
  }

  // --- the pit ------------------------------------------------------------
  built.push(slab(B, scene, 'ljSand', sandMat,
    [sandX0, sandX1], [centerZ - halfWidth, centerZ + halfWidth], SAND_Y));
  // Raked sand reads as sand rather than a beige card: two darker bands along
  // the rim where the rake piles it up.
  for (const side of [-1, 1]) {
    built.push(slab(B, scene, `ljSandRim${side}`, sandRimMat,
      [sandX0, sandX1],
      [centerZ + side * halfWidth - side * 0.5, centerZ + side * halfWidth],
      SAND_Y + 0.002));
  }

  const kerb = (name, [x0, x1], [z0, z1]) => {
    const box = B.MeshBuilder.CreateBox(name, {
      width: x1 - x0, height: 0.12, depth: z1 - z0,
    }, scene);
    box.position.set((x0 + x1) / 2, 0.06, (z0 + z1) / 2);
    box.material = kerbMat;
    built.push(box);
  };
  kerb('ljKerbFar', [sandX0 - 0.2, sandX1 + 0.2], [centerZ + halfWidth, centerZ + halfWidth + 0.2]);
  kerb('ljKerbNear', [sandX0 - 0.2, sandX1 + 0.2], [centerZ - halfWidth - 0.2, centerZ - halfWidth]);
  kerb('ljKerbEnd', [sandX1, sandX1 + 0.2], [centerZ - halfWidth, centerZ + halfWidth]);

  // --- the measuring tape -------------------------------------------------
  // Laid from the BOARD, not from the edge of the sand: it reads the same
  // number the scoreboard does, so a player never has to be told that the tape
  // and the tape measure disagree.
  const tapeM = Math.ceil(PIT_LENGTH);
  const tapeTex = tapeTexture(B, scene, tapeM);
  const tapeMat = new B.StandardMaterial('ljTapeMat', scene);
  tapeMat.diffuseTexture = tapeTex;
  tapeMat.emissiveTexture = tapeTex;
  tapeMat.emissiveColor = new B.Color3(0.4, 0.4, 0.4);
  tapeMat.specularColor = new B.Color3(0, 0, 0);
  const tape = slab(B, scene, 'ljTape', tapeMat,
    [boardX, boardX + tapeM], [centerZ - halfWidth - 1.1, centerZ - halfWidth - 0.25], 0.01);
  built.push(tape);

  // --- run-out for anyone who never commits -------------------------------
  // The sim spends an attempt RUNOUT_M past the board; the sand has to reach at
  // least that far or an athlete would be stopped by arithmetic over bare
  // grass.
  if (sandX1 < boardX + RUNOUT_M) {
    built.push(slab(B, scene, 'ljSandExtra', sandMat,
      [sandX1, boardX + RUNOUT_M + 0.5], [centerZ - halfWidth, centerZ + halfWidth], SAND_Y));
  }

  // None of this ever moves again. The stadium froze everything that existed
  // when IT was built; this was built afterwards, so it freezes its own.
  for (const mesh of built) {
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.material?.freeze();
  }

  return { boardX, centerZ, halfWidth, sandX0, sandX1, laneZ };
}
