import { REST, buildChibi } from '../avatar3d/chibi.js';
import {
  DECK_Y,
  LANE_WIDTH,
  POOL_LENGTH,
  WATER_Y,
  buildPool,
  foamTexture,
  laneZ,
  lightPool,
  nameTexture,
  poolHalfWidth,
} from './pool.js';

// The 50m freestyle, rendered.
//
// Like the sprint arena, this owns the engine, the venue, one athlete per lane
// and the camera — and owns NO rules. It is handed {x, v, done} per swimmer
// every frame and draws exactly that; the beat, the judgement and the
// placings stay in `shared/events/freestyle_swim.js`, where the server runs
// them too.

const SWIMMER_SCALE = 0.8;
const MAX_SPEED = 2.8; // the sim's ceiling, for normalising the stroke rate
// Where a rank marker floats above a swimmer. Higher than it looks like it
// needs to be: from a plan view a vertical offset barely projects at all, so
// the badge has to stand well off the head to clear it on screen.
const MARKER_Y = 2.2;

// How far the racing camera is tipped off the horizontal. Not a full ninety
// degrees on purpose — straight down projects the badge onto the very head it
// is pointing at, and flattens the swimmers into pucks.
const PLAN_PITCH = 1.15; // ~66 degrees

// The block-to-water transition. A swimmer does not appear in the water; they
// leave the block, fly, and enter — and the dive is most of what sells the
// start, because it is the only moment the whole field moves as one.
const DIVE_S = 0.75;
const BLOCK_X = -0.75;
const BLOCK_TOP = DECK_Y + 0.58;

// How deep the body floats. Shoulders and back clear the surface, the rest is
// read through the water. Riding this even a little lower sinks the arms out
// of sight and the swimmers become six bobbing heads.
const FLOAT_Y = WATER_Y + 0.06;

// Laid flat, the chibi runs from its origin at the feet to its head 1.5 body
// units ahead — so anchoring the pivot at the origin puts the HEAD a metre and
// a half past wherever the sim says the swimmer is, and a finisher's head ends
// up out of the water on the deck. The race is measured at the hand touching
// the wall, so the head is what has to sit on the mark.
const HEAD_AHEAD = 1.52 * SWIMMER_SCALE;

// The finish. The athlete comes upright, turns back to face the crowd and
// waves — and to be SEEN doing it has to get away from the wall: any camera
// beyond the pool edge is looking over a deck that cuts the body off at the
// chest, and one hard against the tiles is a row of scalps. So they back well
// off the wall and ride high, and the camera comes round in front of them.
const CELEBRATE_Y = WATER_Y - 0.2; // waterline at mid-thigh, so the body reads whole
const WALL_BACKOFF = 5.5; // metres back down the pool, clear of the deck lip

// Arms up in a V, not straight overhead.
//
// The wave is almost entirely in the shoulder's Z, which swings the arm out
// through the character's frontal plane — the plane the celebration camera is
// looking straight at. Raising them by pitch instead puts the hands directly
// beside the head, and this chibi's arm (0.4 units) is SHORTER than its head
// radius (0.58), so a straight-up arm ends up inside the skull and invisible.
// At about 55 degrees out the hand clears the head with room to spare.
// Up, out, and FORWARD. Forward is what buys the clearance: at this build the
// shoulder sits only 0.61 from the centre of the head, so an arm swung up in
// the body's own plane grazes the skull whatever the angle — swinging it in
// front of the face instead puts the hand where the camera can see it. The
// reach is stretched a little for the same reason; a 0.4 arm simply cannot
// make a legible V next to a 0.58 head.
const ARM_UP = -0.8;
const ARM_SPREAD = 2.5;
// Stretched well past its resting length. This is the only lever that makes
// the V read: a 0.4 arm on a 0.58-radius head cannot get a hand anywhere near
// above the crown at any angle, so the choice is a long cartoon arm or a
// shrug. Cartoon arm.
const ARM_REACH = 1.75;

const TWO_PI = Math.PI * 2;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Ease an angle toward a target the SHORT way round.
 *
 * A plain lerp between two angles takes whatever path the numbers describe,
 * which for a wrapped stroke phase can be almost a full turn in the wrong
 * direction — visibly, the arm spins backwards to get somewhere it was
 * already next to.
 */
function approachAngle(from, to, rate, dt) {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return from + delta * (1 - Math.exp(-rate * dt));
}

/**
 * Confetti over the finish end. Three systems rather than one, because a
 * Babylon particle system blends between two colours and confetti is not a
 * gradient — it is a scatter.
 */
function makeConfetti(B, scene, at, lowEnd) {
  const chip = new B.DynamicTexture('chip', { width: 8, height: 8 }, scene, false);
  const cx = chip.getContext();
  cx.fillStyle = '#ffffff';
  cx.fillRect(0, 0, 8, 8);
  chip.update();

  const palette = [
    ['#ffd23f', '#ff8a3d'],
    ['#4ad6ff', '#5f7bff'],
    ['#ff6ec7', '#8bff6e'],
  ];
  return palette.map(([a, b], i) => {
    const ps = new B.ParticleSystem(`confetti${i}`, lowEnd ? 40 : 90, scene);
    ps.particleTexture = chip;
    ps.emitter = at;
    ps.minEmitBox = new B.Vector3(-7, 0, -9);
    ps.maxEmitBox = new B.Vector3(7, 0, 9);
    ps.color1 = B.Color4.FromHexString(`${a}ff`);
    ps.color2 = B.Color4.FromHexString(`${b}ff`);
    ps.colorDead = B.Color4.FromHexString(`${b}00`);
    ps.minSize = 0.1;
    ps.maxSize = 0.22;
    ps.minLifeTime = 2.6;
    ps.maxLifeTime = 4.5;
    ps.emitRate = 0;
    ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
    ps.gravity = new B.Vector3(0, -1.6, 0);
    ps.direction1 = new B.Vector3(-0.5, -0.2, -0.5);
    ps.direction2 = new B.Vector3(0.5, 0.1, 0.5);
    ps.minAngularSpeed = -6;
    ps.maxAngularSpeed = 6; // tumbling is most of what makes a chip read as paper
    ps.minEmitPower = 0.2;
    ps.maxEmitPower = 0.8;
    ps.updateSpeed = 0.016;
    ps.start();
    return ps;
  });
}

function makeWake(B, scene, texture, emitter, capacity, gain) {
  const ps = new B.ParticleSystem(`wake_${emitter.name}`, capacity, scene);
  ps.particleTexture = texture;
  ps.emitter = emitter;
  ps.minEmitBox = new B.Vector3(-0.25, 0, -0.35);
  ps.maxEmitBox = new B.Vector3(0.25, 0.06, 0.35);

  ps.color1 = new B.Color4(1, 1, 1, 0.9);
  ps.color2 = new B.Color4(0.86, 0.96, 1, 0.75);
  ps.colorDead = new B.Color4(0.9, 0.97, 1, 0);

  ps.minSize = 0.35 * gain;
  ps.maxSize = 1.1 * gain;
  ps.minLifeTime = 0.5;
  ps.maxLifeTime = 1.2; // foam sits on the water far longer than dust hangs
  ps.emitRate = 0;
  ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
  ps.gravity = new B.Vector3(0, -0.05, 0); // it settles, it does not rise
  ps.direction1 = new B.Vector3(-1.4, 0.05, -0.5);
  ps.direction2 = new B.Vector3(-2.6, 0.35, 0.5);
  ps.minAngularSpeed = -1.5;
  ps.maxAngularSpeed = 1.5;
  ps.minEmitPower = 0.3;
  ps.maxEmitPower = 0.9;
  ps.updateSpeed = 0.016;
  ps.start();
  return ps;
}

/**
 * One swimmer.
 *
 * The chibi is turned to lie ON ITS BACK along the pool: its local +Y (head)
 * onto world +X, its local +Z (back) onto world -Y — so the back is in the
 * water and the face is to the ceiling. That one re-orientation is what lets
 * the running rig drive a swimming stroke unchanged: a shoulder still rotates
 * about its own X, only now that sweeps the arm through the vertical plane the
 * pool runs along, which is a backstroke windmill; and a hip still swings its
 * leg the same way, which is a flutter kick.
 *
 * Swimming on the back also fixes the stand-up for free. `supine` and `cheer`
 * differ by a rotation about the LATERAL axis alone — a single clean pitch —
 * so coming upright is the legs dropping underneath while the head stays put.
 * From face-down the same move was a pitch tangled with a roll, and the slerp
 * took whatever path the quaternions described, which swung the head forward
 * into the wall on the way up.
 */
function createSwimmer(B, scene, player, lane, laneCount, opts) {
  const pivot = new B.TransformNode(`swimmer_${player.id}`, scene);
  pivot.position.set(0, 0, laneZ(lane, laneCount));

  const root = buildChibi(B, scene, player);
  root.parent = pivot;
  root.scaling.setAll(SWIMMER_SCALE);
  root.rotationQuaternion = B.Quaternion.Identity();

  const stand = B.Quaternion.FromEulerAngles(0, -Math.PI / 2, 0); // upright, facing +X
  const cheer = B.Quaternion.FromEulerAngles(0, Math.PI / 2, 0); // upright, facing the crowd
  const supine = B.Quaternion.FromEulerVector(
    B.Vector3.RotationFromAxis(
      new B.Vector3(0, 0, -1), // local X -> world -Z
      new B.Vector3(1, 0, 0), //  local Y -> world  X  (head down the pool)
      new B.Vector3(0, -1, 0), // local Z -> world -Y  (back in the water, face up)
    ),
  );

  const wakeAt = new B.TransformNode(`wakeAt_${player.id}`, scene);
  wakeAt.parent = pivot;
  wakeAt.position.set(-0.6, WATER_Y + 0.04, 0);

  return {
    id: player.id,
    pivot,
    root,
    rig: root.metadata.rig,
    stand,
    supine,
    cheer,
    turn: B.Quaternion.Identity(), // reused every frame; never allocate in a pose
    wakeAt,
    wake: makeWake(B, scene, opts.foam, wakeAt, opts.wakeCapacity, opts.wakeGain),
    wakeGain: opts.wakeGain,
    wavePhase: laneZ(lane, laneCount), // so six swimmers do not wave in lockstep
    stroke: 0, // arm phase, radians
    kick: 0,
    dive: 0, // 0 on the block, 1 in the water
    idleW: 0,
    finishedAt: 0,
  };
}

/**
 * Pose one swimmer for this frame.
 *
 * Three states again — on the block, swimming, and hanging off the wall — but
 * the first transition is a real arc rather than a blend: the athlete leaves
 * the block, turns over in the air and enters the water.
 */
function poseSwimmer(B, s, sample, dt, clock, started) {
  const { x, v, done } = sample;
  const speedN = clamp01(v / MAX_SPEED);
  const { hips, shoulders, upper, neck } = s.rig;

  if (started) s.dive = clamp01(s.dive + dt / DIVE_S);
  if (done && !s.finishedAt) s.finishedAt = clock;
  if (done) s.idleW = clamp01(s.idleW + dt / 0.8);

  // --- where the body is ---------------------------------------------------
  const t = s.dive;
  const ease = t * t * (3 - 2 * t);
  // A flat parabola off the block: up a little, then in.
  const arc = Math.sin(t * Math.PI) * 0.45;

  // On the touch the swimmer comes upright against the wall and treads there,
  // so the last stretch of travel is backwards off it — nobody finishes a
  // fifty by pressing their face into the tiles.
  const up = s.idleW;
  s.pivot.position.x = lerp(BLOCK_X, x, ease) - WALL_BACKOFF * up;
  s.pivot.position.y = lerp(BLOCK_TOP, lerp(FLOAT_Y, CELEBRATE_Y, up), ease) + arc * (1 - ease * 0.4);
  // Ramped in with the dive: standing on the block the body hangs off its feet
  // and belongs where it is, swimming it hangs off its head — and on the wall
  // it is back on its feet again.
  s.root.position.x = -HEAD_AHEAD * ease * (1 - up);

  // Standing to swimming is a turn through the air, so it has to be a slerp —
  // lerping Euler angles through ninety degrees of pitch goes the long way
  // round and the swimmer cartwheels off the block. The dive rolls them onto
  // their back on the way in; the touch pitches them straight back up.
  //
  // The head stays put through the stand-up: the body pivots about its FEET,
  // which swings the head back by its own length, and the offset below runs
  // forward by exactly that much over the same interval. Legs drop, head
  // holds — which is what pushing up off the bottom looks like.
  B.Quaternion.SlerpToRef(s.stand, s.supine, ease, s.turn);
  if (up > 0) B.Quaternion.SlerpToRef(s.turn, s.cheer, up, s.turn);
  s.root.rotationQuaternion.copyFrom(s.turn);

  // Keep the foam ON the surface however deep the body is riding.
  s.wakeAt.position.y = WATER_Y + 0.05 - s.pivot.position.y;

  // --- stroke --------------------------------------------------------------
  // The arm cycle is driven by speed, not by the beat: the beat is a control
  // input at ~2 Hz and the arms have to keep turning between presses or the
  // swimmer freezes mid-reach every time the player is a fraction late.
  //
  // The phase is WRAPPED. It used to accumulate, and the finish faded the arms
  // out by scaling that accumulated angle toward zero — which spun them
  // backwards through every revolution they had made, so a swimmer who had
  // touched the wall carried on windmilling into it. Wrapping keeps the joint
  // within one turn of its rest pose, and the finish eases to that pose along
  // the shortest way round instead of unwinding the whole race.
  if (!done) {
    const rate = 1.1 + speedN * 2.2;
    s.stroke = (s.stroke + rate * dt * TWO_PI) % TWO_PI;
    s.kick = (s.kick + rate * dt * TWO_PI * 3) % TWO_PI; // three kicks to the stroke
  }

  // Recovery breathing, hard at first and settling — the same curve the
  // sprinter uses, because it is the same lungs.
  const sinceTouch = s.finishedAt ? clock - s.finishedAt : 0;
  const breathRate = 5.4 - Math.min(2.6, sinceTouch * 0.22);
  const breath = (Math.sin(sinceTouch * breathRate) + 1) / 2;

  if (done) {
    // Both arms up, waving. Angles take the SHORT way round; a plain lerp from
    // a wrapped stroke phase can still travel most of a circle to get
    // somewhere it was already next to.
    const k = 1 - Math.exp(-5 * dt);
    const wave = Math.sin(clock * 6.5 + s.wavePhase);
    shoulders[-1].rotation.x = approachAngle(shoulders[-1].rotation.x, ARM_UP, 4.5, dt);
    shoulders[1].rotation.x = approachAngle(shoulders[1].rotation.x, ARM_UP, 4.5, dt);
    // The wave itself is in Z: the arm swings across the body and back, which
    // is what a wave is. Mirrored, or they semaphore instead of greeting.
    shoulders[-1].rotation.z = lerp(shoulders[-1].rotation.z, -ARM_SPREAD - wave * 0.22, k);
    shoulders[1].rotation.z = lerp(shoulders[1].rotation.z, ARM_SPREAD + wave * 0.3, k);
    const reach = lerp(1, ARM_REACH, up);
    shoulders[-1].scaling.setAll(reach);
    shoulders[1].scaling.setAll(reach);

    // Legs scissoring gently: they are treading, not standing on anything.
    const tread = Math.sin(clock * 1.9 + s.wavePhase) * 0.14;
    hips[-1].rotation.x = approachAngle(hips[-1].rotation.x, 0.06 + tread, 5, dt);
    hips[1].rotation.x = approachAngle(hips[1].rotation.x, -0.06 - tread, 5, dt);
    upper.rotation.y = approachAngle(upper.rotation.y, 0, 5, dt);

    // Still out of breath under the celebration.
    upper.rotation.x = -up * 0.05;
    upper.scaling.set(1 + up * breath * 0.05, 1 + up * breath * 0.035, 1 + up * breath * 0.065);
    neck.rotation.x = lerp(neck.rotation.x, 0, k);
    neck.position.y = REST.neckY - up * breath * 0.03;
  } else {
    // POSITIVE, where face-down was negative: the cycle a backstroker turns —
    // overhead entry, pull down and back under the body, exit at the hip,
    // recover up and over — is the same loop relative to the body, but the
    // body is now flipped, so the same loop is the opposite sign in the rig.
    shoulders[-1].rotation.x = s.stroke;
    shoulders[1].rotation.x = s.stroke + Math.PI;

    const kickAmp = 0.1 + speedN * 0.26;
    hips[-1].rotation.x = Math.sin(s.kick) * kickAmp;
    hips[1].rotation.x = -Math.sin(s.kick) * kickAmp;

    // Roll along the body's own axis, the way a freestyle swimmer rotates into
    // each catch. Small: on a chibi any more and it reads as capsizing.
    upper.rotation.y = Math.sin(s.stroke) * 0.18;

    // Chin tucked toward the chest, which is where a backstroker's head sits.
    // The face is already clear of the water on this stroke — no lifting
    // needed, and the overhead camera gets six faces rather than six scalps.
    neck.rotation.x = lerp(0, 0.3, s.dive);
    neck.position.y = REST.neckY;
    upper.rotation.x = 0;
    upper.scaling.setAll(1);
    shoulders[-1].rotation.z = 0;
    shoulders[1].rotation.z = 0;
    shoulders[-1].scaling.setAll(1);
    shoulders[1].scaling.setAll(1);
  }

  // --- wake ----------------------------------------------------------------
  s.wake.emitRate = s.dive > 0.6 && v > 0.15 && !done ? (45 + v * 70) * s.wakeGain : 0;
}

/**
 * Build the arena into `canvas`.
 *
 * @param {object} B the BABYLON namespace (platform global, passed in)
 * @param {HTMLCanvasElement} canvas
 * @param {{players: Array, lanes: object, myId: string}} opts
 */
export function createSwimArena(B, canvas, { players, lanes, myId }) {
  const engine = new B.Engine(canvas, true, { alpha: false, stencil: false, powerPreference: 'high-performance' }, false);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  engine.setHardwareScalingLevel(1 / Math.min(dpr, 2));

  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const lowEnd = cores <= 4;

  const scene = new B.Scene(engine);
  scene.skipPointerMovePicking = true;
  scene.constantlyUpdateMeshUnderPointer = false;

  const laneCount = Math.max(players.length, 6);
  lightPool(B, scene);
  const { crowd } = buildPool(B, scene, { laneCount, lowEnd });

  // Names painted along each lane, as in the start shot. Built after the pool
  // so the venue's freeze pass does not lock them — they have to fade, because
  // the swimmers swim straight over the top of them.
  const plates = [];
  players.forEach((player, index) => {
    const lane = lanes?.[player.id] ?? index + 1;
    const plate = B.MeshBuilder.CreatePlane(`nameplate_${player.id}`, { width: 9, height: 2.2 }, scene);
    plate.rotation.x = -Math.PI / 2; // lie flat, facing the ceiling
    plate.position.set(11, WATER_Y + 0.04, laneZ(lane, laneCount));
    const mat = new B.StandardMaterial(`nameplateMat_${player.id}`, scene);
    const tex = nameTexture(B, scene, player.name || '—');
    tex.uScale = -1;
    tex.uOffset = 1;
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new B.Color3(0.7, 0.7, 0.7);
    mat.opacityTexture = tex;
    mat.specularColor = new B.Color3(0, 0, 0);
    mat.backFaceCulling = false;
    plate.material = mat;
    plate.isPickable = false;
    plates.push(mat);
  });

  const camera = new B.UniversalCamera('poolcam', new B.Vector3(-14, 7, 0), scene);
  camera.fov = 0.9;
  camera.minZ = 0.2;
  camera.maxZ = 400;
  scene.activeCamera = camera;

  const confettiAt = new B.TransformNode('confettiAt', scene);
  confettiAt.position.set(POOL_LENGTH - WALL_BACKOFF, 9, 0);
  const confetti = makeConfetti(B, scene, confettiAt, lowEnd);

  const foam = foamTexture(B, scene);
  const swimmers = new Map();
  players.forEach((player, index) => {
    swimmers.set(player.id, createSwimmer(B, scene, player, lanes?.[player.id] ?? index + 1, laneCount, {
      foam,
      wakeCapacity: lowEnd ? 50 : 130,
      wakeGain: lowEnd ? 0.55 : 1,
    }));
  });
  const camPos = camera.position.clone();
  const camTarget = new B.Vector3(12, 0, 0);
  const wantPos = new B.Vector3();
  const wantTarget = new B.Vector3();
  const headPoint = new B.Vector3();
  const identity = B.Matrix.Identity();
  const halfW = poolHalfWidth(laneCount);

  // Frame the lanes that are actually OCCUPIED, not the whole pool. With four
  // players in a six-lane pool, two empty lanes off to one side would push the
  // camera higher and shove the field off-centre for no reason.
  const usedZ = players.map((p, i) => laneZ(lanes?.[p.id] ?? i + 1, laneCount));
  const laneCentreZ = (Math.min(...usedZ) + Math.max(...usedZ)) / 2;
  const laneHalfSpan = (Math.max(...usedZ) - Math.min(...usedZ)) / 2 + LANE_WIDTH * 0.8;

  let clock = 0;
  let plateFade = 1;

  /**
   * Three shots, eased between: down the pool from behind the blocks, a high
   * tracking shot that rides over the pack, and a low angle at the finish wall
   * looking back at whoever is still coming in.
   */
  const frameCamera = (dt, { lead, mine, spread, started, mineDone }) => {
    let rate = 3.2;
    let fov = 1.15;

    if (!started) {
      wantPos.set(-12, 5.2, laneCentreZ);
      wantTarget.set(16, -0.1, laneCentreZ);
      fov = 0.85;
      rate = 2.4;
    } else if (mineDone) {
      // Round in FRONT of the finishers, out over the water and low. Any
      // camera beyond the pool edge shoots across a deck that cuts them off at
      // the chest; from here the whole body reads and they are waving at the
      // lens. Keyed on the LOCAL player being home, not the leader's — a
      // player still swimming needs the tracking shot, not somebody else's
      // victory lap.
      const at = POOL_LENGTH - WALL_BACKOFF;
      wantPos.set(at - 7.5, 2.2, laneCentreZ);
      wantTarget.set(at + 0.5, 0.95, laneCentreZ);
      fov = 0.95;
      rate = 1.8;
    } else {
      // A plan view over the pack, the way a pool is filmed.
      //
      // The distance is SOLVED rather than picked: the lanes have to fit
      // across the frame, and on a portrait phone that is the narrow axis, so
      // the height that needs is a function of the screen shape and of how
      // many lanes are in use. Guessing a number gives a shot that is right on
      // one handset and crops the outside lanes on the next.
      const focus = lead * 0.55 + mine * 0.45;
      const aspect = engine.getAspectRatio(camera) || 1;
      const halfAcross = Math.atan(Math.tan(camera.fov / 2) * aspect);
      const dist = clamp(laneHalfSpan / Math.max(0.12, Math.tan(halfAcross)), 12, 24);
      wantPos.set(focus - dist * Math.cos(PLAN_PITCH), dist * Math.sin(PLAN_PITCH), laneCentreZ);
      wantTarget.set(focus, 0, laneCentreZ);
      rate = 2.6;
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
     */
    render(dt, frame) {
      clock += dt;

      let lead = 0;
      let trail = Infinity;
      let mine = 0;
      let mineDone = false;
      let anyDone = false;

      for (const swimmer of swimmers.values()) {
        const sample = frame.athletes[swimmer.id];
        if (!sample) continue;
        poseSwimmer(B, swimmer, sample, dt, clock, frame.started);
        const drawn = swimmer.pivot.position.x;
        if (drawn > lead) lead = drawn;
        if (drawn < trail) trail = drawn;
        if (sample.done) anyDone = true;
        if (swimmer.id === (frame.myId ?? myId)) {
          mine = drawn;
          mineDone = Boolean(sample.done);
        }
      }
      if (!Number.isFinite(trail)) trail = lead;

      frameCamera(dt, { lead, mine, spread: lead - trail, started: frame.started, mineDone });

      // Confetti from the first touch, not the last: the winner is celebrated
      // while the field is still coming in, which is what a pool looks like.
      for (const ps of confetti) ps.emitRate = anyDone ? (lowEnd ? 25 : 55) : 0;

      // The painted names belong to the start. Once the field is moving the
      // swimmers pass straight over them, so they wash off the water.
      if (frame.started) {
        plateFade = Math.max(0, plateFade - dt / 1.2);
        for (const mat of plates) mat.alpha = plateFade;
      }

      for (const block of crowd) {
        block.node.position.y = block.baseY + (Math.sin(clock * 3.1 + block.phase) * 0.5 + 0.5) * 0.14;
      }

      engine.beginFrame();
      scene.render();
      engine.endFrame();
    },

    /** Where this swimmer's rank marker belongs, in CSS pixels over the canvas. */
    headScreenPos(id) {
      const swimmer = swimmers.get(id);
      if (!swimmer) return null;
      headPoint.set(
        swimmer.pivot.position.x,
        swimmer.pivot.position.y + MARKER_Y,
        swimmer.pivot.position.z,
      );
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const projected = B.Vector3.Project(
        headPoint, identity, scene.getTransformMatrix(), camera.viewport.toGlobal(w, h),
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
      for (const swimmer of swimmers.values()) swimmer.wake.dispose();
      for (const ps of confetti) ps.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}
