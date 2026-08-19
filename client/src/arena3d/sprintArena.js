import { REST, buildChibi } from '../avatar3d/chibi.js';
import { TRACK_LENGTH, buildStadium, laneZ, lightStadium, puffTexture } from './stadium.js';

// The race, rendered.
//
// This module owns the engine, the venue, one rigged athlete per lane, the
// dust they kick up and the camera watching them. It owns NO rules: it is
// handed {x, v, done} per athlete every frame and draws exactly that. The sim
// stays in `shared/events/sprint_100m.js`, where the server can run it too.
//
// The whole thing is deliberately state-free between frames apart from the
// animation phases, so a late packet or a reconnect cannot leave a runner
// stuck in a pose.

const RUNNER_SCALE = 0.86; // the chibi is 2.1 units tall; this makes him ~1.8m
const MAX_SPEED = 12.4; // matches the sim's ceiling, for normalising the pose
const MARKER_Y = 2.25; // where a rank marker floats, in athlete-local metres

// A sprinter does not stop on the line. The sim pins a finisher at exactly
// 100m — correct, and what every client must agree on — but the eye expects
// them to run it out, so the DRAWN athlete coasts a few metres past while the
// stride winds down into standing. Nothing downstream reads this.
const FINISH_OVERRUN = 6.5; // metres
const FINISH_BLEND_S = 1.35; // seconds from full stride to standing

const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent ease toward a target. */
const approach = (from, to, rate, dt) => lerp(from, to, 1 - Math.exp(-rate * dt));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// The three poses every athlete is mixed from. Angles are radians on the rig
// joints; +x on a hip or a shoulder swings that limb toward the character's
// front, which is also the direction of travel.
//
// A STANDING start, not blocks: feet split, weight forward over the front
// foot, arms already counter-set. A crouch is what a real 100m looks like, but
// on a chibi whose head is half its height it reads as a heap of hair from
// every camera angle worth using — and standing leans into the same forward
// line the running pose carries, so the gun is a continuation rather than a
// change of shape.
const SET = { hipFront: 0.34, hipBack: -0.3, armFront: 0.95, armBack: 0.06, lean: 0.3 };
const IDLE = { hip: 0.07, arm: 0.24, lean: 0.1 };

// How far a sprinter is thrown forward, at rest and at full speed. The head is
// counter-rotated against it (see `poseRunner`) — drive the torso this hard
// without that and the athlete runs face-down at the track.
const LEAN_BASE = 0.16;
const LEAN_SPEED = 0.34;
const HEAD_COUNTER = 0.55; // fraction of the torso lean the neck takes back

function makeDust(B, scene, texture, emitter, capacity, scale) {
  const ps = new B.ParticleSystem(`dust_${emitter.name}`, capacity, scene);
  ps.particleTexture = texture;
  ps.emitter = emitter;
  ps.minEmitBox = new B.Vector3(-0.15, 0, -0.28);
  ps.maxEmitBox = new B.Vector3(0.15, 0.12, 0.28);

  // Warm and pale: this is track dust catching the sun, not exhaust.
  ps.color1 = new B.Color4(1, 0.95, 0.78, 0.85);
  ps.color2 = new B.Color4(0.96, 0.86, 0.62, 0.7);
  ps.colorDead = new B.Color4(0.96, 0.92, 0.84, 0);

  ps.minSize = 0.3 * scale;
  ps.maxSize = 1.0 * scale;
  ps.minLifeTime = 0.28;
  ps.maxLifeTime = 0.7;
  ps.emitRate = 0; // driven by speed, every frame
  ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
  ps.gravity = new B.Vector3(0, 0.8, 0); // puffs rise and thin out
  ps.direction1 = new B.Vector3(-2.4, 0.5, -0.5);
  ps.direction2 = new B.Vector3(-4.2, 1.7, 0.5);
  ps.minAngularSpeed = -2.5;
  ps.maxAngularSpeed = 2.5;
  ps.minEmitPower = 0.5;
  ps.maxEmitPower = 1.7;
  ps.updateSpeed = 0.016;
  ps.start();
  return ps;
}

/**
 * One athlete: the chibi, its rig, a contact shadow and its dust.
 *
 * `pivot` carries the position down the track and nothing else. The character
 * hangs under it turned to face +X, so every joint angle in the rig stays in
 * the character's own frame — the pose code never has to know which way the
 * track points.
 */
function createRunner(B, scene, player, lane, laneCount, opts) {
  const pivot = new B.TransformNode(`runner_${player.id}`, scene);
  pivot.position.set(0, 0, laneZ(lane, laneCount));

  const root = buildChibi(B, scene, player);
  root.parent = pivot;
  root.rotation.y = -Math.PI / 2; // the chibi faces -Z; the track runs +X
  root.scaling.setAll(RUNNER_SCALE);

  // A disc faces +Z when it is built; -90° about X turns its normal to +Y.
  // (+90° turns it to -Y, and the shadow is culled as a backface.)
  const shadow = B.MeshBuilder.CreateDisc(`shadow_${player.id}`, { radius: 0.42, tessellation: 14 }, scene);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.parent = pivot;
  const shadowMat = new B.StandardMaterial(`shadowMat_${player.id}`, scene);
  shadowMat.diffuseColor = new B.Color3(0, 0, 0);
  shadowMat.emissiveColor = new B.Color3(0, 0, 0);
  shadowMat.disableLighting = true;
  shadowMat.backFaceCulling = false;
  shadowMat.alpha = 0.28;
  shadow.material = shadowMat;
  shadow.isPickable = false;

  const heels = new B.TransformNode(`heels_${player.id}`, scene);
  heels.parent = pivot;
  heels.position.set(-0.35, 0.06, 0); // just behind the shoes

  return {
    id: player.id,
    pivot,
    root,
    rig: root.metadata.rig,
    shadow,
    dust: makeDust(B, scene, opts.puff, heels, opts.dustCapacity, opts.dustScale),
    dustGain: opts.dustGain,
    phase: 0,
    setW: 1,
    idleW: 0,
    overrun: 0,
    bodyY: 0,
    finishedAt: 0,
    lean: SET.lean,
  };
}

/**
 * Drive one athlete's pose for this frame.
 *
 * The three poses are MIXED rather than switched between. A hard switch at the
 * gun snaps the legs from the blocks to mid-stride in one frame, and a hard
 * switch at the line leaves a finisher frozen with one leg in the air; a
 * weighted blend gives an explosive start and a stride that winds down into
 * standing, out of the same six lines of arithmetic.
 */
function poseRunner(r, sample, dt, clock, started) {
  const { x, v, done } = sample;
  const speedN = clamp01(v / MAX_SPEED);

  r.setW = started ? approach(r.setW, 0, 9, dt) : 1;
  if (done) {
    if (!r.finishedAt) r.finishedAt = clock;
    r.idleW = clamp01(r.idleW + dt / FINISH_BLEND_S);
    r.overrun = approach(r.overrun, FINISH_OVERRUN, 1.5, dt);
  }
  const runW = clamp01(1 - r.setW - r.idleW);

  r.pivot.position.x = x + r.overrun;

  // --- stride cycle -------------------------------------------------------
  // Cadence rises with speed, and dies away as the finisher blends to idle so
  // the legs coast to a halt instead of stopping dead.
  const cadence = (1.15 + speedN * 2.8) * (1 - r.idleW * 0.9);
  r.phase += cadence * dt * Math.PI * 2;
  const swing = Math.sin(r.phase);
  const swingAmp = 0.3 + speedN * 0.95;

  // --- breathing ----------------------------------------------------------
  // Someone who has just run 100m is not breathing calmly. Start fast and let
  // it settle — that decay is most of what makes the finish read as "spent"
  // rather than "idle animation playing".
  const sinceFinish = r.finishedAt ? clock - r.finishedAt : 0;
  const rate = 5.4 - Math.min(2.6, sinceFinish * 0.22);
  const breath = (Math.sin(sinceFinish * rate) + 1) / 2;

  const { hips, shoulders, upper, neck } = r.rig;

  hips[-1].rotation.x =
    r.setW * SET.hipFront + runW * (swing * swingAmp) + r.idleW * IDLE.hip;
  hips[1].rotation.x =
    r.setW * SET.hipBack + runW * (-swing * swingAmp) + r.idleW * -IDLE.hip;

  // Arms counter the legs — left arm back when the left leg is forward, which
  // is why the set pose is asymmetric too. At rest they hang; running they
  // pump around a raised base.
  const armBase = 0.72;
  const armAmp = 0.32 + speedN * 0.85;
  const armIdle = IDLE.arm + breath * 0.1;
  shoulders[-1].rotation.x =
    r.setW * SET.armBack + runW * (armBase - swing * armAmp) + r.idleW * armIdle;
  shoulders[1].rotation.x =
    r.setW * SET.armFront + runW * (armBase + swing * armAmp) + r.idleW * armIdle;

  // Torso: already tipped forward on the line, thrown further by speed,
  // upright and heaving once it is over.
  const lean =
    r.setW * SET.lean
    + runW * (LEAN_BASE + speedN * LEAN_SPEED)
    + r.idleW * (IDLE.lean + breath * 0.05);
  r.lean = approach(r.lean, lean, 14, dt);

  // NEGATED, and the limbs above are not. The sign of a rotation about X
  // depends on which way the part it turns is POINTING: a positive angle sends
  // the local +Z axis toward -Y, so a limb hanging DOWN from its joint swings
  // to the character's front, while a torso or a head standing UP from its
  // joint tips to the character's BACK. Give the torso the same positive lean
  // the arms and legs use and the athlete sprints leaning backwards, which is
  // exactly what it did.
  upper.rotation.x = -r.lean;
  upper.rotation.z = r.idleW * Math.sin(clock * 0.9 + r.phase * 0.03) * 0.035;

  // The head takes back most of the torso's lean, so the athlete drives
  // forward while still looking down the track — same axis as the torso, so
  // the opposite sign brings the face back up. This is what the neck joint
  // sitting at the base of the skull buys: rotate it and the head turns on its
  // own neck instead of swinging round the character's middle.
  neck.rotation.x = r.lean * HEAD_COUNTER;

  // The chest swells and the head settles into it. Scaling `upper` works
  // because the joint sits at the origin, so the whole torso grows upward off
  // the hips rather than ballooning in place.
  const swell = r.idleW * breath;
  upper.scaling.set(1 + swell * 0.05, 1 + swell * 0.035, 1 + swell * 0.065);
  neck.position.y = REST.neckY - swell * 0.03;

  // Vertical bounce: twice per stride, one for each foot leaving the ground.
  const bounce = Math.abs(Math.cos(r.phase)) * 0.1 * speedN * runW;
  r.bodyY = bounce + r.idleW * breath * 0.02;
  r.root.position.y = r.bodyY;

  // The contact shadow tightens as the athlete leaves the ground — the cheap
  // trick that stops everyone looking like they are skating.
  const lift = clamp01(bounce / 0.1);
  r.shadow.scaling.setAll(1 - lift * 0.22);
  r.shadow.material.alpha = 0.3 - lift * 0.1;

  // --- dust ---------------------------------------------------------------
  // Only while actually driving off the track. A finisher jogging to a halt
  // stops kicking anything up, and a stationary athlete on the blocks must
  // not be standing in a cloud.
  r.dust.emitRate = v > 1.2 && !done ? (16 + v * 9) * r.dustGain : 0;
}

/**
 * Build the arena into `canvas`.
 *
 * @param {object} B      the BABYLON namespace (platform global, passed in)
 * @param {HTMLCanvasElement} canvas
 * @param {{players: Array, lanes: object, myId: string}} opts
 */
export function createSprintArena(B, canvas, { players, lanes, myId }) {
  const engine = new B.Engine(canvas, true, { alpha: false, stencil: false, powerPreference: 'high-performance' }, false);

  // A 3x phone would otherwise render a nine-times-larger buffer than it can
  // push. Cap the ratio rather than the resolution, so a desktop still gets a
  // sharp picture.
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  engine.setHardwareScalingLevel(1 / Math.min(dpr, 2));

  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const lowEnd = cores <= 4;

  const scene = new B.Scene(engine);
  scene.clearColor = B.Color4.FromHexString('#8fb6dbff');
  scene.skipPointerMovePicking = true;
  scene.constantlyUpdateMeshUnderPointer = false;

  lightStadium(B, scene);
  const { crowd } = buildStadium(B, scene, { laneCount: Math.max(players.length, 6), lowEnd });

  const camera = new B.UniversalCamera('broadcast', new B.Vector3(-8, 2.2, -6), scene);
  camera.fov = 0.8;
  camera.minZ = 0.25;
  camera.maxZ = 720;
  scene.activeCamera = camera;

  const puff = puffTexture(B, scene);
  const laneCount = Math.max(players.length, 6);
  const runners = new Map();
  players.forEach((player, index) => {
    runners.set(player.id, createRunner(B, scene, player, lanes?.[player.id] ?? index + 1, laneCount, {
      puff,
      dustCapacity: lowEnd ? 40 : 110,
      dustScale: lowEnd ? 1.15 : 1,
      dustGain: lowEnd ? 0.45 : 1,
    }));
  });

  const camPos = camera.position.clone();
  const camTarget = new B.Vector3(8, 1.2, 0);
  const wantPos = new B.Vector3();
  const wantTarget = new B.Vector3();
  const headPoint = new B.Vector3();
  const identity = B.Matrix.Identity();
  let clock = 0;

  /**
   * Place the camera for this frame.
   *
   * Three shots, eased between rather than cut: the low angle behind the
   * blocks everyone recognises, a tracking shot that rides alongside the pack,
   * and a closer three-quarter view once the leader is home. The tracking shot
   * follows a point BETWEEN the leader and the local player and pulls back as
   * the field strings out — follow the leader alone and a player who is losing
   * cannot see their own athlete, which is the one thing they care about.
   */
  const frameCamera = (dt, { lead, mine, spread, started, leaderHome }) => {
    let rate = 4.5;
    let fov = 0.92;

    if (!started) {
      // Behind and above the blocks, the shot every viewer knows. Far enough
      // back that the lanes fan out instead of stacking the field into one
      // pile of heads.
      wantPos.set(-14, 4.6, laneZ(1, laneCount) - 5);
      wantTarget.set(20, 0.9, 0);
      fov = 0.82;
      rate = 3;
    } else if (leaderHome) {
      wantPos.set(lead + 9, 4, -10.5);
      wantTarget.set(lead - 1, 1.1, 0);
      fov = 0.85;
      rate = 2.2;
    } else {
      const focus = lead * 0.6 + mine * 0.4;
      const back = 13 + Math.min(spread, 34) * 0.34;
      wantPos.set(focus + 2.4, 5 + Math.min(spread, 34) * 0.06, -back);
      wantTarget.set(focus + 1, 1.1, -0.5);
    }

    const k = 1 - Math.exp(-rate * dt);
    B.Vector3.LerpToRef(camPos, wantPos, k, camPos);
    B.Vector3.LerpToRef(camTarget, wantTarget, k, camTarget);
    camera.fov = lerp(camera.fov, fov, k);
    camera.position.copyFrom(camPos);
    camera.setTarget(camTarget);
  };

  return {
    /**
     * @param {number} dt seconds since the last frame
     * @param {{athletes: object, started: boolean, myId: string}} frame
     *   `athletes` maps player id to {x, v, done}.
     */
    render(dt, frame) {
      clock += dt;

      let lead = 0;
      let trail = Infinity;
      let mine = 0;
      let leaderHome = false;

      for (const runner of runners.values()) {
        const sample = frame.athletes[runner.id];
        if (!sample) continue;
        poseRunner(runner, sample, dt, clock, frame.started);
        const drawn = runner.pivot.position.x;
        if (drawn > lead) {
          lead = drawn;
          leaderHome = Boolean(sample.done);
        }
        if (drawn < trail) trail = drawn;
        if (runner.id === (frame.myId ?? myId)) mine = drawn;
      }
      if (!Number.isFinite(trail)) trail = lead;

      frameCamera(dt, { lead, mine, spread: lead - trail, started: frame.started, leaderHome });

      // The crowd. Each section rises and settles on its own phase, so the
      // stand ripples instead of heaving as one slab. Six sine waves a frame
      // buys the whole thing.
      for (const block of crowd) {
        block.node.position.y = block.baseY + (Math.sin(clock * 3.4 + block.phase) * 0.5 + 0.5) * 0.16;
      }

      engine.beginFrame();
      scene.render();
      engine.endFrame();
    },

    /**
     * Where this athlete's rank marker belongs, in CSS pixels over the canvas.
     * Null when they are off-screen or behind the camera — the caller hides
     * the marker rather than parking it in a corner.
     */
    headScreenPos(id) {
      const runner = runners.get(id);
      if (!runner) return null;
      headPoint.set(
        runner.pivot.position.x,
        MARKER_Y * RUNNER_SCALE + runner.bodyY,
        runner.pivot.position.z,
      );
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const projected = B.Vector3.Project(
        headPoint,
        identity,
        scene.getTransformMatrix(),
        camera.viewport.toGlobal(w, h),
      );
      if (projected.z < 0 || projected.z > 1) return null;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      const x = projected.x * (w > 0 ? cw / w : 1);
      const y = projected.y * (h > 0 ? ch / h : 1);
      // A runner can be inside the frustum's depth range and still be off the
      // side of the frame — a badge parked hard against the edge points at
      // nobody, so it is hidden rather than clamped.
      if (x < -40 || x > cw + 40 || y < -40 || y > ch + 40) return null;
      return { x, y };
    },

    resize() {
      engine.resize();
    },

    dispose() {
      for (const runner of runners.values()) runner.dust.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}
