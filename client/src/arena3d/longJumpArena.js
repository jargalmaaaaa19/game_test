import { REST, buildChibi } from '../avatar3d/chibi.js';
import { buildStadium, lightStadium, puffTexture } from './stadium.js';
import { RUNWAY_START, SAND_Y, buildJumpPit } from './jumpPit.js';
import { KIND, RUNWAY_M, flightPoint } from '../../../shared/events/long_jump.js';

// The long jump, rendered.
//
// This module owns the engine, the venue, one athlete per approach runway, the
// dust off the runway, the sand they throw up and the camera watching them. It
// owns NO rules: it is handed {x, v, st, flight} per athlete every frame and
// draws exactly that. Every number that decides a result lives in
// `shared/events/long_jump.js`, where the server runs it too.
//
// The flight is the one thing here that is INTERPOLATED rather than sampled:
// the sim measures a jump the instant it is released and hands back an arc plus
// the moment it lands. Drawing that arc is this file's job, and it is drawn
// from the shared clock, so ten phones watching the same jump all show the
// athlete at the same point in the air.

const ATHLETE_SCALE = 0.86; // the chibi is 2.1 units tall; this makes him ~1.8m
const MAX_SPEED = 10.5; // matches the sim's ceiling, for normalising the pose
const MARKER_Y = 2.25; // where a name/dial marker floats, in athlete-local metres

const MARK_FADE_S = 3.4; // how long the mark in the sand stays visible

const lerp = (a, b, t) => a + (b - a) * t;
const approach = (from, to, rate, dt) => lerp(from, to, 1 - Math.exp(-rate * dt));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// The four poses every athlete is mixed from. Angles are radians on the rig
// joints; +x on a hip or a shoulder swings that limb toward the character's
// front, which is also the direction of travel.
//
// GATHER is the two strides before the board compressed into one shape: hips
// under, chest up, arms cocked back ready to throw upward. It is the pose the
// player is holding while the dial sweeps, so it has to read as STORED energy —
// a jumper standing straight there looks like a bug.
const GATHER = { hipFront: 0.55, hipBack: -0.42, armFront: -0.5, armBack: -0.75, lean: 0.22, crouch: -0.16 };
// HANG is the middle of the flight: chest open, arms high, one knee driven up.
const HANG = { hipFront: 1.15, hipBack: -0.15, arm: 2.15, armSpread: 0.42, lean: -0.12 };
// LAND is both legs thrown out front, arms swept forward for balance.
const LAND = { hip: 1.45, arm: 1.25, lean: 0.62, sink: -0.28 };
const IDLE = { hip: 0.07, arm: 0.24, lean: 0.1 };

const LEAN_BASE = 0.16;
const LEAN_SPEED = 0.34;
const HEAD_COUNTER = 0.55; // fraction of the torso lean the neck takes back

function makeDust(B, scene, texture, emitter, capacity, scale) {
  const ps = new B.ParticleSystem(`dust_${emitter.name}`, capacity, scene);
  ps.particleTexture = texture;
  ps.emitter = emitter;
  ps.minEmitBox = new B.Vector3(-0.15, 0, -0.28);
  ps.maxEmitBox = new B.Vector3(0.15, 0.12, 0.28);
  ps.color1 = new B.Color4(1, 0.95, 0.78, 0.85);
  ps.color2 = new B.Color4(0.96, 0.86, 0.62, 0.7);
  ps.colorDead = new B.Color4(0.96, 0.92, 0.84, 0);
  ps.minSize = 0.3 * scale;
  ps.maxSize = 1.0 * scale;
  ps.minLifeTime = 0.28;
  ps.maxLifeTime = 0.7;
  ps.emitRate = 0; // driven by speed, every frame
  ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
  ps.gravity = new B.Vector3(0, 0.8, 0);
  ps.direction1 = new B.Vector3(-2.4, 0.5, -0.5);
  ps.direction2 = new B.Vector3(-4.2, 1.7, 0.5);
  ps.minEmitPower = 0.5;
  ps.maxEmitPower = 1.7;
  ps.updateSpeed = 0.016;
  ps.start();
  return ps;
}

/**
 * The sand thrown up on landing. Heavier and shorter-lived than the runway
 * dust: sand falls back, it does not drift. Emitted as a single burst rather
 * than a rate, because there is exactly one moment it happens.
 */
function makeSplash(B, scene, texture, emitter, capacity, scale) {
  const ps = new B.ParticleSystem(`sand_${emitter.name}`, capacity, scene);
  ps.particleTexture = texture;
  ps.emitter = emitter;
  ps.minEmitBox = new B.Vector3(-0.3, 0, -0.35);
  ps.maxEmitBox = new B.Vector3(0.3, 0.1, 0.35);
  ps.color1 = new B.Color4(0.93, 0.85, 0.63, 1);
  ps.color2 = new B.Color4(0.82, 0.72, 0.48, 0.95);
  ps.colorDead = new B.Color4(0.86, 0.79, 0.6, 0);
  ps.minSize = 0.16 * scale;
  ps.maxSize = 0.6 * scale;
  ps.minLifeTime = 0.35;
  ps.maxLifeTime = 0.85;
  ps.emitRate = 0;
  ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
  ps.gravity = new B.Vector3(0, -9, 0); // it comes back down
  ps.direction1 = new B.Vector3(1.5, 2.6, -1.4);
  ps.direction2 = new B.Vector3(4.5, 5.2, 1.4);
  ps.minEmitPower = 0.6;
  ps.maxEmitPower = 1.8;
  ps.updateSpeed = 0.016;
  ps.start();
  return ps;
}

/** One athlete: the chibi, its rig, a contact shadow, its dust and its mark. */
function createJumper(B, scene, player, lane, pit, opts) {
  const pivot = new B.TransformNode(`jumper_${player.id}`, scene);
  pivot.position.set(0, 0, pit.laneZ(lane));

  const root = buildChibi(B, scene, player);
  root.parent = pivot;
  root.rotation.y = -Math.PI / 2; // the chibi faces -Z; the runway runs +X
  root.scaling.setAll(ATHLETE_SCALE);

  const shadow = B.MeshBuilder.CreateDisc(`ljShadow_${player.id}`, { radius: 0.42, tessellation: 14 }, scene);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.parent = pivot;
  const shadowMat = new B.StandardMaterial(`ljShadowMat_${player.id}`, scene);
  shadowMat.diffuseColor = new B.Color3(0, 0, 0);
  shadowMat.emissiveColor = new B.Color3(0, 0, 0);
  shadowMat.disableLighting = true;
  shadowMat.backFaceCulling = false;
  shadowMat.alpha = 0.28;
  shadow.material = shadowMat;
  shadow.isPickable = false;

  // The mark left in the sand. Parked out of the world until there is one to
  // show — one disc per athlete, moved and faded, rather than a disc per jump
  // piling up in the scene for the whole round.
  const mark = B.MeshBuilder.CreateDisc(`ljMark_${player.id}`, { radius: 0.5, tessellation: 16 }, scene);
  mark.rotation.x = -Math.PI / 2;
  mark.scaling.set(1, 1.3, 1); // stretched down the pit, the way a heel drags
  mark.position.set(0, SAND_Y + 0.006, 0);
  mark.isVisible = false;
  mark.isPickable = false;
  const markMat = new B.StandardMaterial(`ljMarkMat_${player.id}`, scene);
  markMat.diffuseColor = B.Color3.FromHexString('#8d7746');
  markMat.emissiveColor = B.Color3.FromHexString('#6b5a34');
  markMat.disableLighting = true;
  markMat.backFaceCulling = false;
  mark.material = markMat;

  const heels = new B.TransformNode(`ljHeels_${player.id}`, scene);
  heels.parent = pivot;
  heels.position.set(-0.35, 0.06, 0);

  const splashAt = new B.TransformNode(`ljSplash_${player.id}`, scene);
  splashAt.position.set(0, SAND_Y, pit.laneZ(lane));

  return {
    id: player.id,
    lane,
    pivot,
    root,
    rig: root.metadata.rig,
    shadow,
    mark,
    markAge: Infinity,
    splashAt,
    dust: makeDust(B, scene, opts.puff, heels, opts.dustCapacity, opts.dustScale),
    splash: makeSplash(B, scene, opts.puff, splashAt, opts.dustCapacity, opts.dustScale),
    dustGain: opts.dustGain,
    // Pose weights, eased rather than switched — a hard cut from the run into
    // the hang snaps the legs across in one frame.
    w: { run: 0, gather: 0, air: 0, land: 0, idle: 1 },
    phase: 0,
    lean: IDLE.lean,
    bodyY: 0,
    drawnX: 0,
    landedKey: '', // which jump has already thrown sand
  };
}

/**
 * Where an athlete is, and in what shape, this frame.
 *
 * Returns the drawn position so the camera can follow the DRAWN athlete rather
 * than the last packet — they differ by a whole flight arc, and a camera on the
 * packet would sit on the sand while the jumper is still in the air.
 */
function poseJumper(r, sample, dt, clock) {
  const stage = sample.st;
  const flight = sample.f;

  // --- where ---------------------------------------------------------------
  let x = sample.x;
  let y = 0;
  let landedU = 0; // 0 until the feet hit the sand, then 0..1 through the settle

  if (stage === 'flight' && flight) {
    // The arc itself is the sim's, not this file's: `flightPoint` is pure and
    // the flat fallback draws from the very same call.
    const at = flightPoint(flight, clock.serverNow);
    x = at.x;
    y = at.y;
    landedU = at.landed;
  }

  r.drawnX = x;
  r.pivot.position.x = x;

  // --- pose weights --------------------------------------------------------
  const want = {
    run: stage === 'run' && sample.v > 0.35 ? 1 : 0,
    gather: stage === 'takeoff' ? 1 : 0,
    air: stage === 'flight' && landedU === 0 ? 1 : 0,
    land: stage === 'flight' && landedU > 0 ? 1 : 0,
    idle: 0,
  };
  want.idle = stage === 'done' || (stage === 'run' && sample.v <= 0.35) ? 1 : 0;
  // Leaving the board has to be instant or the athlete drags the run cycle into
  // the air; everything else eases.
  const rate = want.air ? 20 : 11;
  for (const key of Object.keys(r.w)) r.w[key] = approach(r.w[key], want[key], rate, dt);

  const { run: runW, gather: gatherW, air: airW, land: landW, idle: idleW } = r.w;
  const speedN = clamp01(sample.v / MAX_SPEED);

  // --- stride cycle --------------------------------------------------------
  const cadence = (1.15 + speedN * 2.8) * runW;
  r.phase += cadence * dt * Math.PI * 2;
  const swing = Math.sin(r.phase);
  const swingAmp = 0.3 + speedN * 0.95;

  const breath = (Math.sin(clock.t * 3.1) + 1) / 2;
  const { hips, shoulders, upper, neck } = r.rig;

  // --- limbs ---------------------------------------------------------------
  hips[-1].rotation.x =
    runW * (swing * swingAmp)
    + gatherW * GATHER.hipFront
    + airW * HANG.hipFront
    + landW * LAND.hip
    + idleW * IDLE.hip;
  hips[1].rotation.x =
    runW * (-swing * swingAmp)
    + gatherW * GATHER.hipBack
    + airW * HANG.hipBack
    + landW * LAND.hip
    + idleW * -IDLE.hip;

  const armBase = 0.72;
  const armAmp = 0.32 + speedN * 0.85;
  shoulders[-1].rotation.x =
    runW * (armBase - swing * armAmp)
    + gatherW * GATHER.armBack
    + airW * HANG.arm
    + landW * LAND.arm
    + idleW * (IDLE.arm + breath * 0.1);
  shoulders[1].rotation.x =
    runW * (armBase + swing * armAmp)
    + gatherW * GATHER.armFront
    + airW * HANG.arm
    + landW * LAND.arm
    + idleW * (IDLE.arm + breath * 0.1);
  // The arms open sideways in the air. A chibi's arm is shorter than its head
  // is wide, so a hand can never actually clear the skull — swinging the arms
  // out in the frontal plane is what reads as "up" on this body.
  shoulders[-1].rotation.z = airW * HANG.armSpread;
  shoulders[1].rotation.z = -airW * HANG.armSpread;

  // --- torso and head ------------------------------------------------------
  const lean =
    runW * (LEAN_BASE + speedN * LEAN_SPEED)
    + gatherW * GATHER.lean
    + airW * HANG.lean
    + landW * LAND.lean
    + idleW * IDLE.lean;
  r.lean = approach(r.lean, lean, 14, dt);

  // NEGATED, and the limbs above are not: a limb hangs DOWN from its joint and
  // a torso stands UP from its, so the same positive angle tips them opposite
  // ways. (Give the torso the limbs' sign and the athlete sprints backwards.)
  upper.rotation.x = -r.lean;
  neck.rotation.x = r.lean * HEAD_COUNTER;
  upper.scaling.setAll(1);
  neck.position.y = REST.neckY;

  // --- height --------------------------------------------------------------
  const bounce = Math.abs(Math.cos(r.phase)) * 0.1 * speedN * runW;
  r.bodyY = y + bounce + gatherW * GATHER.crouch + landW * LAND.sink;
  r.root.position.y = r.bodyY;

  // The shadow stays on the GROUND while the athlete does not: it spreads and
  // fades with height, which is the whole reason a jump reads as a jump rather
  // than a character sliding up the screen.
  const lift = clamp01(y / 2.2);
  r.shadow.position.y = 0.02;
  r.shadow.scaling.setAll(1 + lift * 0.5 - clamp01(bounce / 0.1) * 0.22);
  r.shadow.material.alpha = 0.3 - lift * 0.2;

  // --- dust ----------------------------------------------------------------
  r.dust.emitRate = stage === 'run' && sample.v > 1.2 ? (16 + sample.v * 9) * r.dustGain : 0;

  return { x, y, landedU, stage, flight };
}

/**
 * Build the arena into `canvas`.
 *
 * @param {object} B the BABYLON namespace (platform global, passed in)
 * @param {HTMLCanvasElement} canvas
 * @param {{players: Array, lanes: object, myId: string}} opts
 */
export function createLongJumpArena(B, canvas, { players, lanes, myId }) {
  const engine = new B.Engine(canvas, true, {
    alpha: false, stencil: false, powerPreference: 'high-performance',
  }, false);

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  engine.setHardwareScalingLevel(1 / Math.min(dpr, 2));

  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const lowEnd = cores <= 4;

  const scene = new B.Scene(engine);
  scene.clearColor = B.Color4.FromHexString('#8fb6dbff');
  scene.skipPointerMovePicking = true;
  scene.constantlyUpdateMeshUnderPointer = false;

  lightStadium(B, scene);
  const stadiumLanes = Math.max(players.length, 6);
  const { crowd } = buildStadium(B, scene, { laneCount: stadiumLanes, lowEnd });
  const pit = buildJumpPit(B, scene, { jumpers: Math.max(players.length, 2), stadiumLanes });

  const camera = new B.UniversalCamera('broadcast', new B.Vector3(-8, 3, pit.centerZ - 10), scene);
  camera.fov = 0.85;
  camera.minZ = 0.25;
  camera.maxZ = 720;
  scene.activeCamera = camera;

  const puff = puffTexture(B, scene);
  const jumpers = new Map();
  players.forEach((player, index) => {
    jumpers.set(player.id, createJumper(B, scene, player, lanes?.[player.id] ?? index + 1, pit, {
      puff,
      dustCapacity: lowEnd ? 40 : 110,
      dustScale: lowEnd ? 1.15 : 1,
      dustGain: lowEnd ? 0.45 : 1,
    }));
  });

  const camPos = camera.position.clone();
  const camTarget = new B.Vector3(RUNWAY_M, 1.2, pit.centerZ);
  const wantPos = new B.Vector3();
  const wantTarget = new B.Vector3();
  const headPoint = new B.Vector3();
  const identity = B.Matrix.Identity();
  let clock = 0;
  let lastFocusX = 0;

  /**
   * Place the camera for this frame. It follows the LOCAL athlete throughout —
   * long jump is six people doing six unsynchronised things, and a camera that
   * chased whoever happened to be nearest the board would never be on the one
   * jump the player is actually flying.
   *
   * The shot changes with the stage, because each stage is a different question:
   * "how much runway is left" during the run, "where is my foot" on the board,
   * "how far did it go" in the air.
   */
  const frameCamera = (dt, view) => {
    const z = view.z;
    let rate = 4.5;
    let fov = 0.85;

    if (!view.started) {
      // Down the runway from behind, the whole apparatus in one shot so the
      // player can see what they are about to be asked to do.
      wantPos.set(RUNWAY_START - 9, 5.4, z - 9);
      wantTarget.set(RUNWAY_M * 0.55, 1.2, pit.centerZ);
      fov = 0.9;
      rate = 3;
    } else if (view.stage === 'takeoff') {
      // Low and close on the board — this is the frame the player is reading
      // the dial against, and the foot has to be legible in it.
      wantPos.set(view.x + 4.6, 1.9, z - 6.6);
      wantTarget.set(view.x + 0.4, 1.15, z);
      fov = 0.78;
      rate = 5.5;
    } else if (view.stage === 'flight') {
      if (view.landedU > 0) {
        // The mark in the sand, with the tape beside it.
        wantPos.set(view.x + 6, 2.6, z - 8.5);
        wantTarget.set(view.x - 1.2, 0.8, z + 0.4);
        fov = 0.8;
        rate = 3.2;
      } else {
        wantPos.set(view.x + 3.4, 3.4 + view.y * 0.5, z - 12.5);
        wantTarget.set(view.x + 0.6, 1.2 + view.y * 0.55, z);
        rate = 6;
      }
    } else if (view.stage === 'done') {
      wantPos.set(RUNWAY_M + 9, 4.2, z - 11);
      wantTarget.set(RUNWAY_M + 3, 1, pit.centerZ);
      rate = 2.4;
    } else {
      // The run-up. Biased down the runway so the board is always in frame —
      // a player who cannot see the line cannot time the press, and timing the
      // press is the entire event.
      const toBoard = Math.max(0, RUNWAY_M - view.x);
      const ahead = 5 + Math.min(6, toBoard * 0.35);
      wantPos.set(view.x + ahead, 3.1, z - 11);
      wantTarget.set(view.x + ahead * 0.55, 1.1, z);
      fov = 0.88;
    }

    // A new attempt puts the athlete 38 metres back down the runway. Easing
    // across that is a two-second dolly through the crowd; cut instead.
    if (Math.abs(view.x - lastFocusX) > 12) {
      camPos.copyFrom(wantPos);
      camTarget.copyFrom(wantTarget);
    }
    lastFocusX = view.x;

    const k = 1 - Math.exp(-rate * dt);
    B.Vector3.LerpToRef(camPos, wantPos, k, camPos);
    B.Vector3.LerpToRef(camTarget, wantTarget, k, camTarget);
    camera.fov = lerp(camera.fov, fov, k);
    camera.position.copyFrom(camPos);
    camera.setTarget(camTarget);
  };

  const frameClock = { t: 0, serverNow: 0 };

  return {
    /**
     * @param {number} dt seconds since the last frame
     * @param {{athletes: object, started: boolean, myId: string, serverNow: number}} frame
     *   `athletes` maps player id to {x, v, st, f}.
     */
    render(dt, frame) {
      clock += dt;
      frameClock.t = clock;
      frameClock.serverNow = frame.serverNow;

      const me = frame.myId ?? myId;
      let view = null;

      for (const jumper of jumpers.values()) {
        const sample = frame.athletes[jumper.id];
        if (!sample) continue;
        const drawn = poseJumper(jumper, sample, dt, frameClock);

        // One burst of sand per jump, on the frame the feet arrive. Keyed on
        // the flight's end time, so a re-sent snapshot cannot throw it twice
        // and a second attempt in the same pit always throws it again.
        const key = sample.f ? String(sample.f[0]) : '';
        if (drawn.landedU > 0 && key && jumper.landedKey !== key) {
          jumper.landedKey = key;
          jumper.splashAt.position.x = drawn.x;
          jumper.splash.manualEmitCount = lowEnd ? 26 : 60;
          // The mark is where the TAPE says, not where the feet stopped: for a
          // take-off past the board those are different places, and the number
          // on the scoreboard has to be the one the sand agrees with.
          jumper.mark.position.x = pit.boardX + sample.f[3];
          jumper.mark.position.z = jumper.pivot.position.z;
          jumper.mark.isVisible = sample.f[5] !== KIND.NO_JUMP;
          jumper.markAge = 0;
        }

        if (jumper.markAge < MARK_FADE_S) {
          jumper.markAge += dt;
          jumper.mark.material.alpha = 0.55 * (1 - jumper.markAge / MARK_FADE_S);
        } else if (jumper.mark.isVisible) {
          jumper.mark.isVisible = false;
        }

        if (jumper.id === me) {
          view = {
            ...drawn,
            z: jumper.pivot.position.z,
            started: frame.started,
          };
        }
      }

      if (!view) {
        view = { x: 0, y: 0, landedU: 0, stage: 'run', z: pit.centerZ, started: frame.started };
      }
      frameCamera(dt, view);

      for (const block of crowd) {
        block.node.position.y = block.baseY + (Math.sin(clock * 3.4 + block.phase) * 0.5 + 0.5) * 0.16;
      }

      engine.beginFrame();
      scene.render();
      engine.endFrame();
    },

    /**
     * Where this athlete's marker belongs, in CSS pixels over the canvas. Null
     * when they are off-screen or behind the camera — the caller hides the
     * marker rather than parking it in a corner.
     */
    headScreenPos(id) {
      const jumper = jumpers.get(id);
      if (!jumper) return null;
      headPoint.set(
        jumper.pivot.position.x,
        MARKER_Y * ATHLETE_SCALE + jumper.bodyY,
        jumper.pivot.position.z,
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
      if (x < -40 || x > cw + 40 || y < -40 || y > ch + 40) return null;
      return { x, y };
    },

    resize() {
      engine.resize();
    },

    dispose() {
      for (const jumper of jumpers.values()) {
        jumper.dust.dispose();
        jumper.splash.dispose();
      }
      scene.dispose();
      engine.dispose();
    },
  };
}
