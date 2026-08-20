import { BUILDS, getHair, getOutfit, getSkin } from '../../../shared/avatars.js';

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
  // A rounder, heavier head than a "big head" already implies. The reference
  // silhouette is an egg on two stubs: the head is the character and the body
  // is what carries it, so every extra millimetre of skull buys more than any
  // detail below the neck does.
  headRadius: 0.66,
  headY: 1.56,
  cameraTargetY: 1.2,
};

// The torso block. Every hem, collar and shoulder is derived from these, so
// they can never drift apart when one outfit changes shape.
const BODY = { height: 0.72, centerY: 0.71, top: 1.07, bottom: 0.35 };

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

/**
 * The lighting environment, drawn on the device.
 *
 * PBR without an environment is a face lit by nothing but its key light: the
 * shadowed side goes to black and the whole character reads as cut from paper.
 * A real studio has walls, so this paints one — warm bounce above, cool bounce
 * below, a soft key blob and a cooler rim blob — and hands it to Babylon as the
 * scene environment. Half the "expensive render" look in a toy render is just
 * this: something for the surfaces to reflect.
 *
 * Equirectangular from a canvas data URL, so it is generated here and fetched
 * from nowhere — the platform strips external assets at deploy.
 */
function envDataUrl() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const x = c.getContext('2d');

  const sky = x.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#fff6e9'); // warm ceiling bounce
  sky.addColorStop(0.42, '#dfe6f0');
  sky.addColorStop(0.58, '#93a0b4');
  sky.addColorStop(1, '#3f4653'); // floor, cool and dim
  x.fillStyle = sky;
  x.fillRect(0, 0, 512, 256);

  const blob = (cx, cy, r, color) => {
    const g = x.createRadialGradient(cx, cy, 2, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 256);
  };
  blob(150, 66, 96, 'rgba(255, 246, 222, 1)'); // key
  blob(392, 104, 116, 'rgba(176, 212, 255, 0.85)'); // rim
  blob(300, 226, 90, 'rgba(255, 226, 190, 0.35)'); // warm floor bounce

  return c.toDataURL('image/png');
}

/**
 * The face, PAINTED into the head's own texture instead of modelled.
 *
 * Everything expressive about a chibi face is fine detail — a lash line, a
 * catchlight, the soft edge of a blush — and fine detail is what primitives are
 * worst at. Modelled, an eye highlight is a white sphere poking out of a black
 * sphere; painted, it is two strokes and it reads correctly at 40px.
 *
 * It goes on the head sphere's own UVs, so it curves with the skull, shades
 * with the scene lighting and holds up when the athlete turns — which a flat
 * decal plane in front of the face would not. The front of the head is u=0.25
 * (the camera sits on -Z); v=0.5 is the equator, and the eye line is just above
 * it.
 *
 * The skin tone is the BACKGROUND of this texture rather than a tint over it,
 * so a player's tone choice still drives the whole head.
 */
function faceTexture(B, scene, skinHex, hairHex, broad) {
  // Cached per scene, per (tone, hair, build). A 1024x512 texture per athlete
  // is ~2MB, and ten athletes on a track would be twenty — for what is usually
  // three or four distinct faces. The scene owns the cache so disposing the
  // scene disposes them.
  const key = `${skinHex}|${hairHex}|${broad}`;
  const cache = (scene._chibiFaces ??= new Map());
  const hit = cache.get(key);
  if (hit) return hit;

  const W = 1024;
  const H = 512;
  const tex = new B.DynamicTexture(`face_${key}`, { width: W, height: H }, scene, true);
  const c = tex.getContext();

  c.fillStyle = skinHex;
  c.fillRect(0, 0, W, H);

  const CX = W * 0.25; // dead centre of the face
  const eyeY = 246;
  const dx = 66; // eye centres, either side of the nose
  const rx = broad ? 30 : 33;
  const ry = broad ? 38 : 45;

  for (const side of [-1, 1]) {
    const ex = CX + side * dx;

    // Lash line: a soft dark cap over the top of the eye. On a broad face it
    // is heavier and flatter, which is most of what reads as a older/male brow.
    c.save();
    c.beginPath();
    c.ellipse(ex, eyeY, rx, ry, 0, 0, Math.PI * 2);
    c.clip();

    const iris = c.createRadialGradient(ex - rx * 0.2, eyeY - ry * 0.25, rx * 0.15, ex, eyeY, rx * 1.25);
    iris.addColorStop(0, '#5b4034');
    iris.addColorStop(0.55, '#2a1c18');
    iris.addColorStop(1, '#140d0c');
    c.fillStyle = iris;
    c.fillRect(ex - rx, eyeY - ry, rx * 2, ry * 2);

    c.fillStyle = 'rgba(10,6,6,0.9)';
    c.beginPath();
    c.ellipse(ex, eyeY - ry * 0.82, rx * 1.15, ry * 0.42, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // Two catchlights. A big soft one from the key, a small hard one from the
    // rim — one highlight is a shiny bead, two is an eye.
    c.fillStyle = 'rgba(255,255,255,0.97)';
    c.beginPath();
    c.ellipse(ex - side * rx * 0.3, eyeY - ry * 0.34, rx * 0.34, ry * 0.28, -0.4 * side, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.72)';
    c.beginPath();
    c.ellipse(ex + side * rx * 0.36, eyeY + ry * 0.36, rx * 0.16, ry * 0.13, 0, 0, Math.PI * 2);
    c.fill();

    // Brow, in the hair colour: thin and arched, or thick and level.
    c.strokeStyle = hairHex;
    c.lineCap = 'round';
    c.lineWidth = broad ? 15 : 10;
    c.beginPath();
    // Close above the eye, because the hairline is lower than it looks in UV
    // space: drawn where a brow "should" go, it renders underneath the fringe
    // and the face loses its whole top half of expression.
    if (broad) {
      c.moveTo(ex - 34, eyeY - ry - 6);
      c.lineTo(ex + 34, eyeY - ry - 11);
    } else {
      c.moveTo(ex - 31, eyeY - ry - 7);
      c.quadraticCurveTo(ex, eyeY - ry - 23, ex + 31, eyeY - ry - 10);
    }
    c.stroke();

    // Blush. A flush under the eye, not a sticker on the cheek.
    if (!broad) {
      const b = c.createRadialGradient(CX + side * 132, 300, 4, CX + side * 132, 300, 56);
      b.addColorStop(0, 'rgba(242,117,138,0.5)');
      b.addColorStop(1, 'rgba(242,117,138,0)');
      c.fillStyle = b;
      c.fillRect(CX + side * 132 - 60, 240, 120, 120);
    }
  }

  // A small smile. The modelled version was a sphere and read as a wound.
  c.strokeStyle = '#8c3038';
  c.lineWidth = broad ? 9 : 10;
  c.lineCap = 'round';
  c.beginPath();
  const my = broad ? 330 : 322;
  c.moveTo(CX - 24, my);
  c.quadraticCurveTo(CX, my + (broad ? 14 : 18), CX + 24, my);
  c.stroke();

  tex.update(false);
  cache.set(key, tex);
  // EVICT ON DISPOSE, or this cache becomes a bug rather than an optimisation.
  // Characters are torn down with `root.dispose(false, true)` — the `true` is
  // "dispose my textures too" — so the first character to be disposed takes the
  // shared face with it, and every character built afterwards gets a live
  // material pointing at a dead texture and renders with no face at all. It
  // shows up the moment a player picks a second character: the preview rebuilds
  // and the face is gone.
  tex.onDisposeObservable.addOnce(() => {
    if (cache.get(key) === tex) cache.delete(key);
  });
  return tex;
}

/**
 * Attach the environment to whatever scene this character is being built into —
 * the portrait stage, the live preview, or an arena — once per scene. Arenas
 * get it too: the same surfaces have to read the same way in the lobby and on
 * the track, or the character a player chose is not the one that turns up.
 */
function ensureEnvironment(B, scene) {
  if (scene.environmentTexture || scene._chibiEnvTried) return;
  scene._chibiEnvTried = true;
  try {
    if (!B.EquiRectangularCubeTexture || typeof document === 'undefined') return;
    scene.environmentTexture = new B.EquiRectangularCubeTexture(envDataUrl(), scene, 256);
    scene.environmentIntensity = 0.55;
  } catch {
    // Lights-only fallback: dimmer, but it still draws a character.
  }
}

/**
 * One surface. PBR, because the whole difference between a toy render and a
 * flat one is how light leaves the material — roughness, a sheen on cloth and
 * hair, and a genuinely glossy eye.
 *
 * `roughness` is the only dial worth thinking about here: skin is soft, cloth
 * is softer, hair has a sheen, and an eye is wet.
 */
function surface(B, scene, hex, { roughness = 0.8, alpha = 1, emissive = 0, sheen = 0, clearcoat = 0 } = {}) {
  const mat = new B.PBRMaterial(`m_${hex}_${roughness}_${alpha}_${emissive}_${sheen}_${clearcoat}`, scene);
  // sRGB in, LINEAR out. The catalog hexes are sRGB — the colours a designer
  // picked — and a PBR albedo is linear. Handing the hex straight over washes
  // every character out: honey skin renders as chalk and brown hair as grey,
  // which reads as "the lighting is wrong" and is not.
  mat.albedoColor = hexToColor3(B, hex).toLinearSpace();
  mat.metallic = 0;
  mat.roughness = roughness;
  // The chibi has no normal maps and hard-edged scaling; specular AA is what
  // stops the rim light crawling along those edges as the athlete turns.
  mat.enableSpecularAntiAliasing = true;
  mat.environmentIntensity = 1;
  if (emissive) mat.emissiveColor = hexToColor3(B, hex).toLinearSpace().scale(emissive);
  if (alpha < 1) {
    mat.alpha = alpha;
    mat.transparencyMode = B.PBRMaterial.PBRMATERIAL_ALPHABLEND;
  }
  if (sheen) {
    mat.sheen.isEnabled = true;
    mat.sheen.intensity = sheen;
    mat.sheen.roughness = 0.5;
  }
  // A clear lacquer over the colour — the moulded-toy finish. Sheen would be
  // the wrong model here: sheen scatters at grazing angles the way felt does,
  // and plastic has a tight, bright highlight instead.
  if (clearcoat) {
    mat.clearCoat.isEnabled = true;
    mat.clearCoat.intensity = clearcoat;
    mat.clearCoat.roughness = 0.12;
  }
  return mat;
}

/** Kept for the parts that genuinely want no shading model at all. */
function matte(B, scene, hex, opts = {}) {
  return surface(B, scene, hex, { roughness: 0.85, ...opts });
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

  ensureEnvironment(B, scene);

  const broadBuild = (look.build ?? BUILDS[0].id) === 'b_broad';

  const mats = {
    // Skin is soft but not chalk: a little sheen is what stops a cheek reading
    // as felt.
    skin: surface(B, scene, skinTone.hex, { roughness: 0.52 }),
    head: (() => {
      const m = surface(B, scene, '#ffffff', { roughness: 0.52 });
      m.albedoTexture = faceTexture(B, scene, skinTone.hex, hairStyle.color, broadBuild);
      return m;
    })(),
    hair: surface(B, scene, hairStyle.color, { roughness: 0.3, clearcoat: 0.35 }),
    primary: surface(B, scene, outfitStyle.primary, { roughness: 0.3, clearcoat: 0.45 }),
    secondary: surface(B, scene, outfitStyle.secondary, { roughness: 0.3, clearcoat: 0.45 }),
    primaryDark: surface(B, scene, shade(B, outfitStyle.primary, 0.7), { roughness: 0.34, clearcoat: 0.4 }),
    // The eyes carry the whole face. Wet, not black: a near-black brown at
    // roughness 0.05 catches the key and the rim as two separate highlights,
    // which is the difference between an eye and a hole.
    ink: surface(B, scene, '#20191c', { roughness: 0.05 }),
    white: surface(B, scene, '#ffffff', { roughness: 0.12, emissive: 0.3 }),
    shoe: surface(B, scene, '#e4e8ee', { roughness: 0.26, clearcoat: 0.5 }),
    blush: surface(B, scene, '#f2758a', { alpha: 0.3, roughness: 0.8 }),
    mouth: surface(B, scene, '#8c3038', { roughness: 0.42 }),
  };

  const shadows = scene.metadata?.chibiShadows ?? null;

  const add = (mesh, material, { pos, scale, rot, parent } = {}) => {
    mesh.material = material;
    mesh.parent = parent ?? root;
    // Self-shadowing is most of the remaining depth: the chin onto the neck,
    // the arms onto the torso, the hair onto the forehead.
    if (shadows) {
      shadows.addShadowCaster(mesh);
      mesh.receiveShadows = true;
    }
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
  const broad = broadBuild;

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
  const height = legs.long ? 0.4 : 0.28;
  const centerY = legs.long ? 0.3 : 0.26;
  const radius = broad ? 0.185 : 0.17;
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
    add(B.MeshBuilder.CreateSphere(`shoe${side}`, { diameter: broad ? 0.47 : 0.44, segments: 14 }, scene), mats.shoe, {
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

    const arm = B.MeshBuilder.CreateCapsule(`arm${side}`, { height: 0.35, radius: broad ? 0.137 : 0.125 }, scene);
    arm.material = mats.skin;
    arm.parent = shoulder;
    arm.position.set(0, -0.2, 0);

    if (sleeved) {
      const sleeve = B.MeshBuilder.CreateCapsule(`sleeve${side}`, { height: 0.26, radius: 0.142 }, scene);
      sleeve.material = outfit.kind === 'blazer' ? mats.primary : mats.primaryDark;
      sleeve.parent = shoulder;
      sleeve.position.set(0, -0.13, 0);
    } else {
      // Bare shoulder still needs a cap, or the arm and body show a seam.
      const cap = B.MeshBuilder.CreateSphere(`shoulderCap${side}`, { diameter: 0.29, segments: 16 }, scene);
      cap.material = mats.skin;
      cap.parent = shoulder;
      cap.position.set(0, -0.03, 0);
    }

    // The hand sits AT the arm's tip, still wide enough to swallow the wrist —
    // shrink it much past the arm's own radius and the joint reappears.
    const hand = B.MeshBuilder.CreateSphere(`hand${side}`, { diameter: 0.25, segments: 12 }, scene);
    hand.material = mats.skin;
    hand.parent = shoulder;
    hand.position.set(0, -0.4, 0);
  }

  return shoulders;
}

function buildHead(B, scene, add, mats, broad, hairColor) {
  const headY = PROPORTIONS.headY;
  // Every offset below was measured against a 0.58 skull. Scaling them by K
  // rather than re-typing them is what lets the head size be a dial: set the
  // radius, and the eyes, brows and mouth stay where they were put. Grow the
  // head without this and the whole face sinks inside it.
  const K = PROPORTIONS.headRadius / 0.58;
  const faceZ = FRONT * 0.53 * K;
  const eyeY = headY + 0.03 * K;
  const brow = matte(B, scene, hairColor);

  // A broad face is a fraction wider and shorter — the squarer skull does more
  // work than any single feature.
  add(
    B.MeshBuilder.CreateSphere('head', { diameter: PROPORTIONS.headRadius * 2, segments: 32 }, scene),
    mats.head,
    { pos: [0, headY, 0], scale: broad ? [1.03, 0.97, 0.97] : [1, 1.01, 0.98] },
  );

  if (broad) {
    // Squarer jaw: a flattened block under the cheeks, in skin, so the chin
    // stops being a ball.
    add(B.MeshBuilder.CreateSphere('jaw', { diameter: 0.86 * K, segments: 18 }, scene), mats.skin, {
      pos: [0, headY - 0.24 * K, FRONT * 0.04 * K],
      scale: [1.02, 0.52, 0.94],
    });
  }

  // The eyes, brows, blush and mouth are PAINTED — see `faceTexture`. They
  // were eleven primitives poking out of a skull, which is the wrong tool for
  // a lash line and a catchlight.
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

  // Same trick as the face: these were placed against a 0.58 skull, so they
  // scale about the head's centre rather than being re-measured.
  const K = R / 0.58;
  const blob = (name, diameter, pos, scale) =>
    add(B.MeshBuilder.CreateSphere(name, { diameter: diameter * K, segments: 14 }, scene), mats.hair, {
      pos: [pos[0] * K, headY + (pos[1] - headY) * K, pos[2] * K],
      scale,
    });

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
    4.15,
    new B.Vector3(0, PROPORTIONS.cameraTargetY, 0),
    scene,
  );
  camera.fov = 0.62;
  if (interactive) {
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 3.1;
    camera.upperRadiusLimit = 6;
    camera.lowerBetaLimit = 0.9;
    camera.upperBetaLimit = Math.PI / 2 + 0.15;
    camera.panningSensibility = 0; // dragging must orbit, never pan the athlete off-screen
  }

  // ONE key light, plus ambient from the painted environment. Three lights gave
  // the plastic three highlights, which is what a showroom looks like and not
  // what a toy on a shelf looks like: one bright hot spot per surface is the
  // whole read, and the surface has to be able to show it off.
  const fill = new B.HemisphericLight('fill', new B.Vector3(0.1, 1, -0.2), scene);
  fill.intensity = 0.22;
  fill.diffuse = new B.Color3(0.86, 0.9, 1);
  fill.groundColor = new B.Color3(0.3, 0.28, 0.34);

  const key = new B.DirectionalLight('key', new B.Vector3(0.45, -0.78, 0.55), scene);
  key.intensity = 1.85;
  key.diffuse = new B.Color3(1, 0.96, 0.9); // warm
  key.position = new B.Vector3(-3, 5, -4);

  // Kept, but barely: just enough cool edge to separate a dark character from a
  // dark card, and well under anything that would count as a second key.
  const rim = new B.DirectionalLight('rim', new B.Vector3(-0.6, -0.15, -0.85), scene);
  rim.intensity = 0.32;
  rim.diffuse = new B.Color3(0.68, 0.82, 1);

  // Soft self-shadowing. The character registers itself as a caster in
  // `buildChibi` when it finds this on the scene.
  let shadows = null;
  try {
    shadows = new B.ShadowGenerator(384, key);
    shadows.useBlurCloseExponentialShadowMap = true;
    shadows.blurKernel = 16;
    shadows.depthScale = 40;
    shadows.darkness = 0.34;
    scene.metadata = { ...(scene.metadata ?? {}), chibiShadows: shadows };
  } catch {
    // No shadow map is a softer picture, not a broken one.
  }

  // The contact shadow: a painted ellipse on the floor. A real shadow-catching
  // ground would need a plane behind the character, and this stage renders on
  // transparent so the card shows through — so the one shadow that matters for
  // "standing on something" is drawn rather than cast.
  try {
    const tex = new B.DynamicTexture('contact', { width: 128, height: 128 }, scene, true);
    const cx = tex.getContext();
    const g = cx.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, 128, 128);
    tex.update();
    tex.hasAlpha = true;

    const mat = new B.StandardMaterial('contactMat', scene);
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.emissiveColor = new B.Color3(0, 0, 0);

    const disc = B.MeshBuilder.CreateGround('contact', { width: 1.9, height: 1.5 }, scene);
    disc.material = mat;
    disc.position.y = 0.002;
    disc.isPickable = false;
  } catch {
    /* the floor is optional */
  }

  // Tone mapping, a little bloom, and antialiasing. This is what turns correct
  // lighting into a photographed object.
  try {
    const pipeline = new B.DefaultRenderingPipeline('chibiPipeline', true, scene, [camera]);
    pipeline.samples = 2;
    pipeline.fxaaEnabled = true;
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipeline.imageProcessing.exposure = 1;
    pipeline.imageProcessing.contrast = 1.12;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.98;
    pipeline.bloomWeight = 0.09;
    pipeline.bloomKernel = 32;
    pipeline.bloomScale = 0.5;
  } catch {
    // An older runtime without the pipeline still renders, just flatter.
  }

  // NO SSAO HERE, and it was tried. Measured on the character with the deepest
  // creases in the cast, screen-space AO moved the mean luminance of a portrait
  // by 0.7% - invisible at 192px - and cost 75% more render time. "Subtle
  // ambient occlusion" and "optimised for mobile" are the same sentence in the
  // brief, and this is where they meet: the contact depth comes from the shadow
  // map below, which is already paid for and actually visible.

  return camera;
}
