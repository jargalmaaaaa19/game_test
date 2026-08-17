// Avatar catalog. Ids are the wire format — never send the label or the colour,
// the client looks those up. Assets are drawn/generated in the renderer; the
// platform strips externally-loaded images at deploy, so nothing here is a URL.
//
// Three axes: skin tone, hairstyle, outfit. Outfit carries a `kind` that drives
// real geometry (a dress flares, a hoodie has a hood, jeans colour the legs) —
// a colour swap alone makes eight identical characters in eight paints.

export const SKIN_TONES = [
  { id: 'sk_1', label: 'Porcelain', hex: '#f7d7c4' },
  { id: 'sk_2', label: 'Sand', hex: '#eec2a2' },
  { id: 'sk_3', label: 'Honey', hex: '#d9a06b' },
  { id: 'sk_4', label: 'Bronze', hex: '#b97a4e' },
  { id: 'sk_5', label: 'Umber', hex: '#8d5524' },
  { id: 'sk_6', label: 'Espresso', hex: '#5c3317' },
];

/**
 * `kind` selects the geometry in the renderer. `color` ships with the style so
 * the gallery reads as eight different people rather than one person in eight
 * wigs.
 */
export const HAIRSTYLES = [
  { id: 'h_long', label: 'Long', kind: 'long', color: '#2b2320' },
  { id: 'h_bob', label: 'Bob', kind: 'bob', color: '#4a2c1a' },
  { id: 'h_curly', label: 'Curly', kind: 'curly', color: '#3a2a22' },
  { id: 'h_pigtails', label: 'Pigtails', kind: 'pigtails', color: '#5b3418' },
  { id: 'h_ponytail', label: 'Ponytail', kind: 'ponytail', color: '#1f1a18' },
  { id: 'h_short', label: 'Short', kind: 'short', color: '#2e2624' },
  { id: 'h_buzz', label: 'Buzz cut', kind: 'buzz', color: '#241f1d' },
  { id: 'h_beard', label: 'Beard', kind: 'beard', color: '#3b2b20' },
];

export const OUTFITS = [
  { id: 'o_dress', label: 'Dress', kind: 'dress', primary: '#e8628c', secondary: '#fdf2f6' },
  { id: 'o_skirt', label: 'Top & skirt', kind: 'skirt', primary: '#fda4af', secondary: '#1e293b' },
  { id: 'o_jeans', label: 'Tee & jeans', kind: 'jeans', primary: '#f4f4f5', secondary: '#3b5c8f' },
  { id: 'o_hoodie', label: 'Hoodie', kind: 'hoodie', primary: '#6d28d9', secondary: '#c4b5fd' },
  { id: 'o_blazer', label: 'Blazer', kind: 'blazer', primary: '#232a36', secondary: '#f8fafc' },
  { id: 'o_track', label: 'Tracksuit', kind: 'track', primary: '#e5484d', secondary: '#ffffff' },
  { id: 'o_overalls', label: 'Overalls', kind: 'overalls', primary: '#4a6fa5', secondary: '#fbbf24' },
  { id: 'o_crop', label: 'Crop & shorts', kind: 'crop', primary: '#22d3ee', secondary: '#0f172a' },
];

/**
 * Build: the one axis that carries read-as-masculine / read-as-feminine, and it
 * is deliberately SEPARATE from hair and clothing. Tying a jaw to a haircut
 * would mean a player who wants long hair cannot have a broad face, and a
 * player in a blazer is forced into one. Two options, one row of buttons.
 *
 * It drives the silhouette (shoulder width, hem height, how much leg shows) and
 * the face (brow weight, blush, jaw).
 */
export const BUILDS = [
  { id: 'b_soft', label: 'Soft' },
  { id: 'b_broad', label: 'Broad' },
];

export const DEFAULT_BUILD = BUILDS[0].id;
export const DEFAULT_SKIN = SKIN_TONES[2].id;
export const DEFAULT_HAIR = HAIRSTYLES[5].id;
export const DEFAULT_OUTFIT = OUTFITS[5].id;

/**
 * One-tap starting looks — four read feminine, four masculine, and between them
 * they use every hairstyle and every outfit exactly once. A player who does not
 * want to browse three pickers can still arrive with a character they like,
 * which is what keeps the zero-tap solo launch honest.
 */
export const PRESETS = [
  { id: 'pr_1', label: 'Luna', skin: 'sk_1', hair: 'h_long', outfit: 'o_dress', build: 'b_soft' },
  { id: 'pr_2', label: 'Saara', skin: 'sk_3', hair: 'h_pigtails', outfit: 'o_skirt', build: 'b_soft' },
  { id: 'pr_3', label: 'Nomi', skin: 'sk_5', hair: 'h_curly', outfit: 'o_crop', build: 'b_soft' },
  { id: 'pr_4', label: 'Enkhe', skin: 'sk_2', hair: 'h_bob', outfit: 'o_overalls', build: 'b_soft' },
  { id: 'pr_5', label: 'Bat', skin: 'sk_3', hair: 'h_short', outfit: 'o_jeans', build: 'b_broad' },
  { id: 'pr_6', label: 'Temu', skin: 'sk_4', hair: 'h_buzz', outfit: 'o_track', build: 'b_broad' },
  { id: 'pr_7', label: 'Ganzo', skin: 'sk_6', hair: 'h_beard', outfit: 'o_hoodie', build: 'b_broad' },
  { id: 'pr_8', label: 'Dorj', skin: 'sk_2', hair: 'h_ponytail', outfit: 'o_blazer', build: 'b_broad' },
];

const SKIN_IDS = new Set(SKIN_TONES.map((s) => s.id));
const HAIR_IDS = new Set(HAIRSTYLES.map((h) => h.id));
const OUTFIT_IDS = new Set(OUTFITS.map((o) => o.id));
const BUILD_IDS = new Set(BUILDS.map((b) => b.id));

export const isSkin = (id) => SKIN_IDS.has(id);
export const isHair = (id) => HAIR_IDS.has(id);
export const isOutfit = (id) => OUTFIT_IDS.has(id);
export const isBuild = (id) => BUILD_IDS.has(id);

export const getSkin = (id) => SKIN_TONES.find((s) => s.id === id) ?? SKIN_TONES[2];
export const getHair = (id) => HAIRSTYLES.find((h) => h.id === id) ?? HAIRSTYLES[5];
export const getOutfit = (id) => OUTFITS.find((o) => o.id === id) ?? OUTFITS[5];
