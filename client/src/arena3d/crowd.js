// Spectators, shared by the stadium and the pool.
//
// Merged geometry, not thin instances. Thin instances are the textbook answer
// for a crowd and cost the same handful of draw calls either way — but on this
// runtime the instanced draw silently rendered NOTHING: the meshes were active,
// their bounding boxes were right, their materials reported ready, and the
// stand still came out an empty navy slab. Merged geometry is what the lane
// markings already use here, and it draws. Do not "optimise" this back into
// thin instances without checking a screenshot.

export const SHIRTS = [
  '#e05c4b', '#f0b429', '#4a83d6', '#57b25b', '#d95fa0',
  '#f2f0e6', '#8b5fd0', '#39456b', '#e8834a', '#3fb6b0',
];

/** Fixed sequence, so every phone in the room paints the same crowd. */
export function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Fill a bank of seats with people.
 *
 * @param {object} B
 * @param {object} scene
 * @param {object} opts
 * @param {number} opts.rows        seat rows to fill
 * @param {number} opts.perRow      seats across
 * @param {number} opts.sections    contiguous blocks, each bobbing on its own
 *                                  phase — one node for the lot heaves like a
 *                                  raft, one node per person costs a frame
 * @param {number} opts.seed
 * @param {(row: number, i: number) => object} opts.seatAt  WORLD position of a
 *                                  seat; the caller owns the geometry of the
 *                                  bank, this module only owns the people
 * @param {number} opts.yaw         which way they face, in world radians
 * @param {number} [opts.scale]     body size multiplier
 * @returns {Array<{node, baseY: number, phase: number}>} sections to bob
 */
export function buildCrowd(B, scene, { rows, perRow, sections, seed, seatAt, yaw, scale = 1 }) {
  const rand = lcg(seed);
  // Merges per section, one per shirt colour. Six is the knob: fewer and the
  // bank bands into solid blocks of colour (four looked like a flag), more and
  // it is draw calls for a difference nobody can see at forty metres.
  const shirtCount = 6;
  const buckets = Array.from({ length: sections }, () => Array.from({ length: shirtCount }, () => []));

  for (let row = 0; row < rows; row += 1) {
    for (let i = 0; i < perRow; i += 1) {
      if (rand() < 0.08) continue; // an empty seat here and there
      const pos = seatAt(row, i);
      if (!pos) continue;
      const size = (0.9 + rand() * 0.28) * scale;
      const section = Math.min(sections - 1, Math.floor((i / perRow) * sections));
      const shirt = Math.floor(rand() * shirtCount);

      const body = B.MeshBuilder.CreateBox('sb', { width: 0.44, height: 0.62, depth: 0.36 }, scene);
      body.position.set(pos.x, pos.y + 0.31 * size, pos.z);
      const head = B.MeshBuilder.CreateBox('sh', { size: 0.3 }, scene);
      head.position.set(pos.x, pos.y + 0.79 * size, pos.z);
      for (const part of [body, head]) {
        part.scaling.setAll(size);
        part.rotation.y = yaw + (rand() - 0.5) * 0.5;
      }
      buckets[section][shirt].push(body, head);
    }
  }

  const out = [];
  buckets.forEach((byShirt, section) => {
    const node = new B.TransformNode(`crowd_${seed}_${section}`, scene);
    byShirt.forEach((parts, shirt) => {
      if (parts.length === 0) return;
      const merged = B.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
      if (!merged) return;
      merged.name = `crowd_${seed}_${section}_${shirt}`;
      // Every section wears the SAME palette — index by shirt alone. Fold the
      // section into the colour and each block comes out a different solid
      // colour, which reads as a flag, not a crowd.
      const mat = new B.StandardMaterial(`crowdMat_${seed}_${section}_${shirt}`, scene);
      mat.diffuseColor = B.Color3.FromHexString(SHIRTS[shirt]);
      mat.specularColor = new B.Color3(0.02, 0.02, 0.02);
      merged.material = mat;
      merged.parent = node;
      merged.isPickable = false;
    });
    out.push({ node, baseY: 0, phase: section * 1.7 + seed * 0.31 });
  });

  return out;
}
