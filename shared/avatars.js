// Avatar catalog. Ids are the wire format — never send the label or the colour,
// the client looks those up. Assets are drawn/generated in the renderer; the
// platform strips externally-loaded images at deploy, so nothing here is a URL.
//
// A player picks a CHARACTER and a SKIN TONE. That is the whole picker.
//
// It used to be three pickers — hairstyle, outfit, build — and the result was
// worse than the sum of its parts: every combination is reachable, so nothing
// is designed, and a gallery of eight "presets" reads as one person in eight
// wigs. Characters are drawn as whole people instead. The vocabulary below
// still exists, but it is the palette the characters are DRAWN FROM, not a set
// of axes the player is asked to operate.
//
// Skin tone stays separate on purpose. It is the one axis that is about the
// player rather than the character, and every character has to be available in
// every tone — that is the difference between choosing a look and being sorted
// into one.

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
 * the cast reads as different people rather than one person in eight wigs.
 *
 * Not user-facing: a character names one of these, and the player never sees
 * this list.
 */
export const HAIRSTYLES = [
  { id: 'h_long', label: 'Long', kind: 'long', color: '#2b2320' },
  { id: 'h_bob', label: 'Bob', kind: 'bob', color: '#4a2c1a' },
  { id: 'h_curly', label: 'Curly', kind: 'curly', color: '#3a2a22' },
  { id: 'h_pigtails', label: 'Pigtails', kind: 'pigtails', color: '#5b3418' },
  { id: 'h_ponytail', label: 'Ponytail', kind: 'ponytail', color: '#1f1a18' },
  { id: 'h_short', label: 'Short', kind: 'short', color: '#2e2624' },
  { id: 'h_buzz', label: 'Buzz cut', kind: 'buzz', color: '#241f1d' },
  { id: 'h_quiff', label: 'Quiff', kind: 'quiff', color: '#3b2b20' },
];

/** `kind` drives real geometry — a dress flares, a hoodie has a hood. */
/**
 * Two tones each, and no more. The kit is moulded plastic: a bright body colour
 * and one accent, which is what a toy is actually painted like.
 *
 * The palette is deliberately BRIGHTER than a wardrobe would be. These are lit
 * by one key against a dark card at 40px, and a realistic navy and a muted rose
 * both arrive as the same dark smudge. Saturation is legibility here, not
 * taste - nothing is allowed to go so dark it stops reading as a colour.
 */
export const OUTFITS = [
  { id: 'o_dress', label: 'Dress', kind: 'dress', primary: '#ff5c9d', secondary: '#fff2f7' },
  { id: 'o_skirt', label: 'Top & skirt', kind: 'skirt', primary: '#ffa8bd', secondary: '#33477a' },
  { id: 'o_jeans', label: 'Tee & jeans', kind: 'jeans', primary: '#fbfbfc', secondary: '#3f80ee' },
  { id: 'o_hoodie', label: 'Hoodie', kind: 'hoodie', primary: '#8b45ff', secondary: '#d6c4ff' },
  { id: 'o_blazer', label: 'Blazer', kind: 'blazer', primary: '#37455f', secondary: '#fbfdff' },
  { id: 'o_track', label: 'Tracksuit', kind: 'track', primary: '#ff4f52', secondary: '#ffffff' },
  { id: 'o_overalls', label: 'Overalls', kind: 'overalls', primary: '#4f8ff0', secondary: '#ffd23f' },
  { id: 'o_crop', label: 'Crop & shorts', kind: 'crop', primary: '#2ad9f2', secondary: '#2b3d63' },
];

/**
 * Build drives the silhouette (shoulder width, hem height, how much leg shows)
 * and the face (brow weight, blush, jaw). Part of a character's design, not a
 * dial: "physique" as a two-button row asked every player to categorise their
 * own body before they could play, and answered nothing the character does not
 * already say.
 */
export const BUILDS = [
  { id: 'b_soft', label: 'Soft' },
  { id: 'b_broad', label: 'Broad' },
];

/**
 * The cast.
 *
 * DELIBERATELY UNNAMED. A name on a character is a claim the game cannot back
 * up — it is not the player's character, it is one they were handed, and "Luna"
 * in a Mongolian lobby is a translation problem for no gain. They are told
 * apart by how they look, which is the point of drawing them differently.
 *
 * Between them they use every hairstyle and every outfit exactly once, so no
 * two share a silhouette at portrait size — that is the bar for adding a ninth.
 * `skin` is the tone the character is DRAWN in for the gallery; the player's
 * own choice overrides it everywhere else.
 */
export const CHARACTERS = [
  { id: 'ch_1', hair: 'h_long', outfit: 'o_dress', build: 'b_soft', skin: 'sk_1' },
  { id: 'ch_2', hair: 'h_pigtails', outfit: 'o_skirt', build: 'b_soft', skin: 'sk_3' },
  { id: 'ch_3', hair: 'h_curly', outfit: 'o_crop', build: 'b_soft', skin: 'sk_5' },
  { id: 'ch_4', hair: 'h_bob', outfit: 'o_overalls', build: 'b_soft', skin: 'sk_2' },
  { id: 'ch_5', hair: 'h_short', outfit: 'o_jeans', build: 'b_broad', skin: 'sk_3' },
  { id: 'ch_6', hair: 'h_buzz', outfit: 'o_track', build: 'b_broad', skin: 'sk_4' },
  { id: 'ch_7', hair: 'h_quiff', outfit: 'o_hoodie', build: 'b_broad', skin: 'sk_6' },
  { id: 'ch_8', hair: 'h_ponytail', outfit: 'o_blazer', build: 'b_broad', skin: 'sk_2' },
];

export const DEFAULT_CHARACTER = CHARACTERS[4].id;
export const DEFAULT_SKIN = SKIN_TONES[2].id;

const SKIN_IDS = new Set(SKIN_TONES.map((s) => s.id));
const CHARACTER_IDS = new Set(CHARACTERS.map((c) => c.id));

export const isSkin = (id) => SKIN_IDS.has(id);
export const isCharacter = (id) => CHARACTER_IDS.has(id);

export const getSkin = (id) => SKIN_TONES.find((s) => s.id === id) ?? SKIN_TONES[2];
export const getHair = (id) => HAIRSTYLES.find((h) => h.id === id) ?? HAIRSTYLES[5];
export const getOutfit = (id) => OUTFITS.find((o) => o.id === id) ?? OUTFITS[5];
export const getCharacter = (id) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[4];

/**
 * The three render fields a character resolves to.
 *
 * This is the seam that lets the picker change without touching a renderer. The
 * chibi, the portraits, the arenas and the flat SVG all still take
 * {skin, build, hair, outfit} — they draw a person and have no opinion about
 * how one was chosen. The server resolves this once, when identity is set, so
 * what goes out on the snapshot is still a fully described look.
 */
export const characterDesign = (id) => {
  const c = getCharacter(id);
  return { build: c.build, hair: c.hair, outfit: c.outfit };
};

/** A character as it is drawn in the gallery: its own design, in its own tone. */
export const characterLook = (id) => ({ ...characterDesign(id), skin: getCharacter(id).skin });
