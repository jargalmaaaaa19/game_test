import { DEFAULT_BUILD, getHair, getOutfit, getSkin } from '../../../shared/avatars.js';

// The chibi athlete, built from primitives.
//
// Nothing is loaded: no GLB, no textures, no fonts. The platform strips
// externally-fetched assets at deploy, and a party game that waits on model
// downloads over a phone connection starts late. Every shape below is a sphere,
// a capsule, a cylinder or a torus that Babylon generates on the device.
//
// Proportions are the point of the look: the head is ~55% of total height and
// the legs are barely there. Realistic proportions on a 40px lobby card read as
// a stick; a big head reads as a face.

export const PROPORTIONS = {
  totalHeight: 2.1,
  headRadius: 0.58,
  headY: 1.52,
  cameraTargetY: 1.14,
};

// The torso block. Every hem, collar and shoulder is derived from these, so
// they can never drift apart when one outfit changes shape.
const BODY = { height: 0.78, centerY: 0.72, top: 1.11, bottom: 0.33 };

// Where a leg swings from, where the head turns on, and where the arms hang in
// the neutral pose the portraits use. An animator eases back to these rather
// than to zero, or a character that stops moving snaps into a T-pose.
const HIP_Y = 0.5;
const NECK_Y = 1.05; // the base of the skull, just above the collar
export const REST = { hipY: HIP_Y, neckY: NECK_Y, shoulderX: 0.92 };

// The camera sits on -Z, so "front" is negative Z. Every feature is placed
// against this constant rather than a hardcoded sign.
const FRONT = -1;

const hexToColor3 = (B, hex) => B.Color3.FromHexString(hex);

/** Matte, low-spec material — the soft toy look, not plastic. */
function matte(B, scene, hex, { alpha = 1, emissive = 0 } = {}) {
  const mat = new B.StandardMaterial(`m_${hex}_${alpha}_${emissive}`, scene);
  mat.diffuseColor = hexToColor3(B, hex);
  mat.specularColor = new B.Color3(0.06, 0.06, 0.06);
  mat.specularPower = 8;
  if (emissive) mat.emissiveColor = hexToColor3(B, hex).scale(emissive);
  if (alpha < 1) mat.alpha = alpha;
  return mat;
}

const shade = (B, hex, amount = 0.72) => {
  const c = hexToColor3(B, hex).scale(amount);
  return `#${[c.r, c.g, c.b]
    .map((v) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
};

/**
 * Build one athlete under a fresh TransformNode.
 *
 * @param {object} B      the BABYLON namespace (passed in, never imported —
 *                        the runtime is a platform-hosted global)
 * @param {object} scene
 * @param {{skin: string, hair: string, outfit: string}} look catalog ids
 * @returns {object} root node; dispose it to remove the whole character
 */
export function buildChibi(B, scene, look) {
  const root = new B.TransformNode('athlete', scene);

  const skinTone = getSkin(look.skin);
  const hairStyle = getHair(look.hair ?? look.face); // `face` is the pre-rename id
  const outfitStyle = getOutfit(look.outfit);

  const mats = {
    skin: matte(B, scene, skinTone.hex),
    hair: matte(B, scene, hairStyle.color),
    primary: matte(B, scene, outfitStyle.primary),
    secondary: matte(B, scene, outfitStyle.secondary),
    primaryDark: matte(B, scene, shade(B, outfitStyle.primary, 0.7)),
    ink: matte(B, scene, '#241f1e'),
    white: matte(B, scene, '#ffffff', { emissive: 0.35 }),
    shoe: matte(B, scene, '#eceff3'),
    blush: matte(B, scene, '#f2758a', { alpha: 0.62 }),
    mouth: matte(B, scene, '#7a2530'),
  };

  const add = (mesh, material, { pos, scale, rot, parent } = {}) => {
    mesh.material = material;
    mesh.parent = parent ?? root;
    if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
    if (scale) mesh.scaling.set(scale[0], scale[1], scale[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    return mesh;
  };

  // The rig. Every joint starts untransformed, so the character below renders
  // exactly as it always has whether or not anything drives it — a portrait is
  // byte-identical. The joints that carry a position (hip, neck) carry it
  // because the limb has to PIVOT there: rotate a leg about the character's
  // feet or a head about its navel and you get a puppet, not a runner. Their
  // children are written relative to the joint; everything else keeps the
  // absolute coordinates the proportions at the top of this file are in.
  const upper = new B.TransformNode('upper', scene);
  upper.parent = root;
  const neck = new B.TransformNode('neck', scene);
  neck.parent = upper;
  neck.position.y = NECK_Y;

  /** `add`, but hung off a joint instead of the root. */
  const under = (parent) => (mesh, material, opts = {}) => add(mesh, material, { parent, ...opts });

  /** `add`, hung off the neck and rebased onto it, so callers keep writing absolute Y. */
  const atNeck = (mesh, material, opts = {}) => add(mesh, material, {
    ...opts,
    parent: neck,
    pos: opts.pos ? [opts.pos[0], opts.pos[1] - NECK_Y, opts.pos[2]] : undefined,
  });

  // A broad build widens the shoulders, straightens the taper, lifts the hem
  // and shows more leg — the same outfit cut for a different frame. Without it
  // every character is the same rounded tube and menswear reads as a tunic.
  const broad = (look.build ?? DEFAULT_BUILD) === 'b_broad';

  const legs = buildOutfit(B, scene, under(upper), mats, outfitStyle, broad);
  const hips = buildLegsAndShoes(B, scene, add, mats, legs, broad, root);
  const shoulders = buildArms(B, scene, upper, mats, outfitStyle, broad);
  buildHead(B, scene, atNeck, mats, broad, hairStyle.color);
  buildHair(B, scene, atNeck, mats, hairStyle, broad);

  // Handed over on the node rather than in the return value: `buildChibi`'s
  // contract is "one disposable root", and half a dozen callers rely on it.
  root.metadata = { ...(root.metadata ?? {}), rig: { upper, neck, hips, shoulders } };

  return root;
}

// ---------------------------------------------------------------------------
// Outfits — each `kind` is a different silhouette, not a repaint
// ---------------------------------------------------------------------------

/** @returns {{color: 'skin'|'secondary', hemY: number}} how the legs read */
function buildOutfit(B, scene, add, mats, outfit, broad) {
  // Broad: shoulders out, hips in, hem up, so the same garment reads as
  // menswear. Written out per piece rather than as a blanket modifier —
  // scaling every cylinder uniformly opens gaps between the stacked pieces of
  // a multi-part outfit.
  const pick = (soft, hard) => (broad ? hard : soft);

  const cyl = (name, opts, material, pos, scale) =>
    add(B.MeshBuilder.CreateCylinder(name, { tessellation: 28, ...opts }, scene), material, {
      pos,
      scale: scale ?? [1, 1, 0.92],
    });

  switch (outfit.kind) {
    case 'dress': {
      // Flared from the waist down; the hem is what makes it a dress.
      cyl('dress', pick(
        { height: 0.9, diameterTop: 0.6, diameterBottom: 1.0 },
        { height: 0.8, diameterTop: 0.78, diameterBottom: 0.9 },
      ), mats.primary, [0, pick(0.76, 0.81), 0]);
      add(
        B.MeshBuilder.CreateTorus('collar', { diameter: 0.54, thickness: 0.075, tessellation: 20 }, scene),
        mats.secondary,
        { pos: [0, BODY.top - 0.01, 0], scale: [1, 1, 0.92] },
      );
      return { color: 'skin', hemY: pick(0.31, 0.41) };
    }

    case 'skirt': {
      cyl('top', pick(
        { height: 0.46, diameterTop: 0.6, diameterBottom: 0.68 },
        { height: 0.46, diameterTop: 0.8, diameterBottom: 0.7 },
      ), mats.primary, [0, pick(0.9, 0.93), 0]);
      cyl('skirt', pick(
        { height: 0.36, diameterTop: 0.7, diameterBottom: 0.96 },
        { height: 0.3, diameterTop: 0.7, diameterBottom: 0.84 },
      ), mats.secondary, [0, pick(0.52, 0.58), 0]);
      return { color: 'skin', hemY: pick(0.34, 0.43) };
    }

    case 'jeans': {
      cyl('tee', pick(
        { height: 0.62, diameterTop: 0.62, diameterBottom: 0.7 },
        { height: 0.56, diameterTop: 0.84, diameterBottom: 0.7 },
      ), mats.primary, [0, pick(0.8, 0.86), 0]);
      // Denim runs all the way down, so the legs are part of the outfit.
      return { color: 'secondary', hemY: pick(0.49, 0.58), long: true };
    }

    case 'hoodie': {
      cyl('hoodie', pick(
        { height: 0.82, diameterTop: 0.66, diameterBottom: 0.76 },
        { height: 0.7, diameterTop: 0.88, diameterBottom: 0.8 },
      ), mats.primary, [0, pick(0.73, 0.8), 0]);
      // The hood is the whole point of a hoodie: a bulge behind the neck.
      add(B.MeshBuilder.CreateSphere('hood', { diameter: 0.5, segments: 16 }, scene), mats.primaryDark, {
        pos: [0, 1.06, FRONT * -0.22],
        scale: [1.15, 0.85, 0.8],
      });
      // Kangaroo pocket + drawstrings.
      add(B.MeshBuilder.CreateSphere('pocket', { diameter: 0.44, segments: 14 }, scene), mats.primaryDark, {
        pos: [0, 0.5, FRONT * 0.3],
        scale: [1, 0.55, 0.2],
      });
      for (const side of [-1, 1]) {
        add(B.MeshBuilder.CreateCapsule(`string${side}`, { height: 0.22, radius: 0.022 }, scene), mats.secondary, {
          pos: [side * 0.1, 0.93, FRONT * 0.31],
        });
      }
      return { color: 'secondary', hemY: pick(0.32, 0.45), long: true };
    }

    case 'blazer': {
      cyl('shirt', pick(
        { height: 0.66, diameterTop: 0.58, diameterBottom: 0.62 },
        { height: 0.62, diameterTop: 0.7, diameterBottom: 0.6 },
      ), mats.secondary, [0, pick(0.79, 0.83), 0]);
      cyl('blazer', pick(
        { height: 0.74, diameterTop: 0.68, diameterBottom: 0.76 },
        { height: 0.66, diameterTop: 0.9, diameterBottom: 0.74 },
      ), mats.primary, [0, pick(0.75, 0.81), 0]);
      // Cut a V of shirt back into the front so the jacket reads as open.
      add(B.MeshBuilder.CreateCylinder('placket', { height: 0.44, diameter: 0.34, tessellation: 16 }, scene), mats.secondary, {
        pos: [0, pick(0.95, 0.99), FRONT * 0.34],
        scale: [1, 1, 0.3],
      });
      for (const side of [-1, 1]) {
        add(B.MeshBuilder.CreateCapsule(`lapel${side}`, { height: 0.34, radius: 0.055 }, scene), mats.primaryDark, {
          pos: [side * 0.14, 0.94, FRONT * 0.33],
          rot: [0, 0, side * 0.32],
          scale: [1, 1, 0.5],
        });
      }
      return { color: 'ink', hemY: pick(0.38, 0.48), long: true };
    }

    case 'overalls': {
      cyl('shirt', pick(
        { height: 0.5, diameterTop: 0.6, diameterBottom: 0.66 },
        { height: 0.46, diameterTop: 0.82, diameterBottom: 0.68 },
      ), mats.secondary, [0, pick(0.9, 0.94), 0]);
      cyl('denim', pick(
        { height: 0.5, diameterTop: 0.68, diameterBottom: 0.74 },
        { height: 0.44, diameterTop: 0.68, diameterBottom: 0.7 },
      ), mats.primary, [0, pick(0.55, 0.61), 0]);
      // Bib + straps: without them it is just a two-tone tube.
      add(B.MeshBuilder.CreateSphere('bib', { diameter: 0.46, segments: 14 }, scene), mats.primary, {
        pos: [0, 0.85, FRONT * 0.28],
        scale: [1, 0.9, 0.2],
      });
      for (const side of [-1, 1]) {
        add(B.MeshBuilder.CreateCapsule(`strap${side}`, { height: 0.34, radius: 0.045 }, scene), mats.primary, {
          pos: [side * 0.19, 1.0, FRONT * 0.26],
          rot: [0, 0, side * 0.12],
          scale: [1, 1, 0.6],
        });
      }
      return { color: 'secondary', hemY: pick(0.32, 0.39), long: true };
    }

    case 'crop': {
      cyl('crop', pick(
        { height: 0.34, diameterTop: 0.62, diameterBottom: 0.66 },
        { height: 0.36, diameterTop: 0.84, diameterBottom: 0.68 },
      ), mats.primary, [0, pick(0.95, 0.96), 0]);
      cyl('midriff', pick(
        { height: 0.22, diameterTop: 0.58, diameterBottom: 0.6 },
        { height: 0.2, diameterTop: 0.64, diameterBottom: 0.62 },
      ), mats.skin, [0, pick(0.71, 0.72), 0]);
      cyl('shorts', pick(
        { height: 0.3, diameterTop: 0.66, diameterBottom: 0.74 },
        { height: 0.28, diameterTop: 0.68, diameterBottom: 0.72 },
      ), mats.secondary, [0, pick(0.5, 0.55), 0]);
      return { color: 'skin', hemY: pick(0.36, 0.41) };
    }

    case 'track':
    default: {
      cyl('body', pick(
        { height: 0.78, diameterTop: 0.62, diameterBottom: 0.72 },
        { height: 0.68, diameterTop: 0.84, diameterBottom: 0.72 },
      ), mats.primary, [0, pick(BODY.centerY, 0.79), 0]);
      for (const side of [-1, 1]) {
        add(B.MeshBuilder.CreateCapsule(`stripe${side}`, { height: 0.66, radius: 0.028 }, scene), mats.secondary, {
          pos: [side * 0.33, 0.72, 0],
          scale: [1, 1, 0.6],
        });
      }
      add(
        B.MeshBuilder.CreateTorus('collar', { diameter: 0.56, thickness: 0.07, tessellation: 20 }, scene),
        mats.secondary,
        { pos: [0, BODY.top - 0.02, 0], scale: [1, 1, 0.92] },
      );
      return { color: 'skin', hemY: pick(0.33, 0.45) };
    }
  }
}

// ---------------------------------------------------------------------------

function buildLegsAndShoes(B, scene, add, mats, legs, broad, root) {
  const legMat = mats[legs.color] ?? mats.skin;
  // Trousers reach the shoe; bare legs are a short band under the hem. Either
  // way the leg is stubby — any more and the silhouette stops being a toy. A
  // broad build wears a higher hem, so its legs are a touch thicker to match.
  const height = legs.long ? 0.44 : 0.32;
  const centerY = legs.long ? 0.3 : 0.26;
  const radius = broad ? 0.15 : 0.135;
  const hips = {};

  for (const side of [-1, 1]) {
    // The hip joint, at the top of the leg. Leg and shoe are positioned
    // relative to it, so rotating it swings the whole limb from the hip —
    // rotate the leg mesh instead and it pivots about its own middle, which
    // reads as a leg snapping in half.
    const hip = new B.TransformNode(`hip${side}`, scene);
    hip.parent = root;
    hip.position.set(side * (broad ? 0.17 : 0.16), HIP_Y, 0);
    hips[side] = hip;

    add(B.MeshBuilder.CreateCapsule(`leg${side}`, { height, radius }, scene), legMat, {
      parent: hip,
      pos: [0, centerY - HIP_Y, 0],
    });
    // White trainers: the UI behind these characters is near-black, and a dark
    // shoe on a dark card amputates the feet.
    add(B.MeshBuilder.CreateSphere(`shoe${side}`, { diameter: broad ? 0.38 : 0.35, segments: 14 }, scene), mats.shoe, {
      parent: hip,
      pos: [0, 0.1 - HIP_Y, FRONT * 0.06],
      scale: [1, 0.58, 1.45],
    });
  }

  return hips;
}

function buildArms(B, scene, root, mats, outfit, broad) {
  const shoulders = {};
  // Sleeveless kits leave the shoulder bare; a blazer or hoodie has a sleeve
  // running most of the way down the arm.
  const sleeved = ['hoodie', 'blazer', 'overalls', 'track'].includes(outfit.kind);

  for (const side of [-1, 1]) {
    const shoulder = new B.TransformNode(`shoulder${side}`, scene);
    shoulder.parent = root;
    shoulders[side] = shoulder;
    // Set out further on a broad build so the arms hang off the wider shoulder
    // line instead of disappearing into it.
    shoulder.position.set(side * (broad ? 0.38 : 0.31), broad ? 1.0 : 0.99, 0);
    // +x rotation swings the limb toward -Z, the camera side. Swung far enough
    // that the hand clears the belly and reads as held out front, rather than
    // hanging at the hip where it just looks like a stump.
    shoulder.rotation.set(0.92, 0, side * -0.05);

    const arm = B.MeshBuilder.CreateCapsule(`arm${side}`, { height: 0.42, radius: broad ? 0.11 : 0.095 }, scene);
    arm.material = mats.skin;
    arm.parent = shoulder;
    arm.position.set(0, -0.2, 0);

    if (sleeved) {
      const sleeve = B.MeshBuilder.CreateCapsule(`sleeve${side}`, { height: 0.3, radius: 0.11 }, scene);
      sleeve.material = outfit.kind === 'blazer' ? mats.primary : mats.primaryDark;
      sleeve.parent = shoulder;
      sleeve.position.set(0, -0.13, 0);
    } else {
      // Bare shoulder still needs a cap, or the arm and body show a seam.
      const cap = B.MeshBuilder.CreateSphere(`shoulderCap${side}`, { diameter: 0.26, segments: 14 }, scene);
      cap.material = mats.skin;
      cap.parent = shoulder;
      cap.position.set(0, -0.03, 0);
    }

    // The hand sits AT the arm's tip, still wide enough to swallow the wrist —
    // shrink it much past the arm's own radius and the joint reappears.
    const hand = B.MeshBuilder.CreateSphere(`hand${side}`, { diameter: 0.215, segments: 14 }, scene);
    hand.material = mats.skin;
    hand.parent = shoulder;
    hand.position.set(0, -0.4, 0);
  }

  return shoulders;
}

function buildHead(B, scene, add, mats, broad, hairColor) {
  const headY = PROPORTIONS.headY;
  const faceZ = FRONT * 0.53;
  const eyeY = headY + 0.03;
  const brow = matte(B, scene, hairColor);

  // A broad face is a fraction wider and shorter — the squarer skull does more
  // work than any single feature.
  add(
    B.MeshBuilder.CreateSphere('head', { diameter: PROPORTIONS.headRadius * 2, segments: 28 }, scene),
    mats.skin,
    { pos: [0, headY, 0], scale: broad ? [1.04, 0.92, 0.94] : [1, 0.96, 0.94] },
  );

  if (broad) {
    // Squarer jaw: a flattened block under the cheeks, in skin, so the chin
    // stops being a ball.
    add(B.MeshBuilder.CreateSphere('jaw', { diameter: 0.86, segments: 18 }, scene), mats.skin, {
      pos: [0, headY - 0.24, FRONT * 0.04],
      scale: [1.02, 0.52, 0.94],
    });
  }

  for (const side of [-1, 1]) {
    // Big and well separated: on a 40px lobby card the eyes ARE the character.
    // A broad build narrows them slightly — round and tall reads young/soft.
    add(B.MeshBuilder.CreateSphere(`eye${side}`, { diameter: 0.23, segments: 16 }, scene), mats.ink, {
      pos: [side * 0.22, eyeY, faceZ],
      scale: broad ? [0.8, 0.86, 0.4] : [0.82, 1.05, 0.4],
    });
    add(B.MeshBuilder.CreateSphere(`glint${side}`, { diameter: 0.085, segments: 10 }, scene), mats.white, {
      pos: [side * 0.255, eyeY + 0.045, faceZ - 0.02],
      scale: [1, 1, 0.35],
    });

    // Brows in the hair colour. Thick, low and level for broad; thin, high and
    // arched for soft. This is the cheapest, strongest gender read on a face
    // with no nose.
    add(
      B.MeshBuilder.CreateCapsule(`brow${side}`, {
        height: broad ? 0.24 : 0.19,
        radius: broad ? 0.036 : 0.022,
      }, scene),
      brow,
      {
        pos: [side * 0.22, eyeY + (broad ? 0.15 : 0.19), faceZ - 0.01],
        rot: [0, 0, Math.PI / 2 + side * (broad ? 0.08 : -0.16)],
        scale: [1, 1, 0.5],
      },
    );

    // Blush — the single biggest "cute" lever, and it costs two spheres. A
    // broad build gets none: rosy cheeks undo everything above.
    if (!broad) {
      add(B.MeshBuilder.CreateSphere(`blush${side}`, { diameter: 0.2, segments: 10 }, scene), mats.blush, {
        pos: [side * 0.37, headY - 0.11, FRONT * 0.43],
        scale: [1.15, 0.7, 0.3],
      });
    }
  }

  add(B.MeshBuilder.CreateSphere('mouth', { diameter: 0.2, segments: 12 }, scene), mats.mouth, {
    pos: [0, headY - (broad ? 0.22 : 0.2), faceZ + FRONT * 0.01],
    scale: broad ? [1.0, 0.42, 0.3] : [1.15, 0.8, 0.32],
  });
}

// ---------------------------------------------------------------------------
// Hair — the cap must stop ABOVE the eyes
// ---------------------------------------------------------------------------

function buildHair(B, scene, add, mats, style, broad) {
  const headY = PROPORTIONS.headY;
  const R = PROPORTIONS.headRadius;

  // `slice` measures down from the north pole, so anything past ~0.4 reaches
  // the equator — where the eyes are — and the head renders as a dark helmet
  // with the face hidden under it. (It did.)
  // The cap has to follow the SKULL, and a broad build scales the head wider
  // and flatter. Leave the cap on the soft head's scale and it sits narrow and
  // high on a broad one, leaving bare skin at the temples. (It did.)
  const headScale = broad ? [1.04, 0.92, 0.94] : [1, 0.96, 0.94];
  const cap = (boost = 0.07, slice = 0.34, y = headY + 0.02) =>
    add(
      B.MeshBuilder.CreateSphere('hairCap', { diameter: R * 2 + boost, segments: 28, slice }, scene),
      mats.hair,
      {
        pos: [0, y, FRONT * -0.03],
        scale: [headScale[0], headScale[1] * 1.06, headScale[2] * 1.02],
      },
    );

  const blob = (name, diameter, pos, scale) =>
    add(B.MeshBuilder.CreateSphere(name, { diameter, segments: 14 }, scene), mats.hair, { pos, scale });

  switch (style.kind) {
    case 'long':
      cap(0.09, 0.4);
      // The mass hangs BEHIND the head and down past the shoulders; anything in
      // front of z=0 would cover the face.
      blob('fall', 0.98, [0, headY - 0.34, FRONT * -0.14], [1.02, 1.15, 0.85]);
      for (const side of [-1, 1]) blob(`strand${side}`, 0.34, [side * 0.48, headY - 0.3, FRONT * 0.1], [0.75, 1.7, 0.8]);
      break;

    case 'bob':
      cap(0.1, 0.42);
      blob('bobMass', 0.92, [0, headY - 0.16, FRONT * -0.08], [1.05, 0.95, 0.95]);
      for (const side of [-1, 1]) blob(`bobSide${side}`, 0.4, [side * 0.46, headY - 0.16, FRONT * 0.08], [0.8, 1.15, 0.9]);
      break;

    case 'curly':
      cap(0.05, 0.3);
      // A ring of overlapping spheres reads as volume far more cheaply than any
      // attempt at strands. The ring sits at a CONSTANT height well above the
      // eyes and is biased backwards — tie its height to the angle and the front
      // curls dip onto the forehead, where they read as a visor. (They did.)
      for (let i = 0; i < 9; i += 1) {
        const a = (i / 9) * Math.PI * 2;
        blob(`curl${i}`, 0.36, [
          Math.cos(a) * 0.44,
          headY + 0.34 + Math.cos(a * 3) * 0.05,
          Math.sin(a) * 0.32 + 0.1,
        ]);
      }
      blob('curlTop', 0.5, [0, headY + 0.46, FRONT * -0.02]);
      break;

    case 'pigtails':
      cap(0.08, 0.36);
      for (const side of [-1, 1]) {
        blob(`tie${side}`, 0.22, [side * 0.56, headY + 0.02, FRONT * -0.02]);
        blob(`tail${side}`, 0.34, [side * 0.66, headY - 0.26, FRONT * -0.04], [0.9, 1.5, 0.9]);
      }
      break;

    case 'ponytail':
      cap(0.08, 0.38);
      blob('tieBack', 0.26, [0, headY + 0.04, FRONT * -0.52]);
      blob('tail', 0.34, [0, headY - 0.24, FRONT * -0.6], [0.85, 1.7, 0.85]);
      break;

    case 'short':
      cap(0.08, 0.36);
      for (const side of [-1, 1]) blob(`sideburn${side}`, 0.2, [side * 0.5, headY + 0.05, FRONT * -0.06], [0.7, 1.1, 1]);
      break;

    case 'buzz':
      // Tight to the skull and cut higher than `short`, or the two styles are
      // indistinguishable at card size.
      cap(-0.01, 0.28);
      break;

    case 'beard':
    default:
      cap(0.07, 0.34);
      // Wide enough to wrap the (broader) jaw block underneath it — a beard
      // tucked inside the jaw is a beard nobody can see.
      blob('beard', broad ? 0.95 : 0.78, [0, headY - 0.26, FRONT * 0.12], [1.04, 0.66, 0.96]);
      break;
  }
}

/**
 * Camera + lights shared by every view of the character.
 *
 * Two lights only: a hemispheric fill that lifts the underside so nothing goes
 * muddy on a small card, and one soft key from the front-left for shape. No
 * shadows — they cost a render pass and read as dirt at 40px.
 */
export function setupStage(B, scene, canvas, { interactive = false } = {}) {
  scene.clearColor = new B.Color4(0, 0, 0, 0); // transparent: the page owns the background

  const camera = new B.ArcRotateCamera(
    'cam',
    -Math.PI / 2,
    Math.PI / 2.35,
    3.75,
    new B.Vector3(0, PROPORTIONS.cameraTargetY, 0),
    scene,
  );
  camera.fov = 0.62;
  if (interactive) {
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 2.8;
    camera.upperRadiusLimit = 5.5;
    camera.lowerBetaLimit = 0.9;
    camera.upperBetaLimit = Math.PI / 2 + 0.15;
    camera.panningSensibility = 0; // dragging must orbit, never pan the athlete off-screen
  }

  const fill = new B.HemisphericLight('fill', new B.Vector3(0.1, 1, -0.2), scene);
  fill.intensity = 0.92;
  fill.groundColor = new B.Color3(0.42, 0.4, 0.46);

  const key = new B.DirectionalLight('key', new B.Vector3(0.45, -0.7, 0.6), scene);
  key.intensity = 0.85;

  return camera;
}
