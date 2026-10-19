// The paper-doll layer model (SPEC.md › Character sprites and the paper doll). Pure data, no DOM: the sprite
// renderer in packages/ui and the placeholder generator in tools/ both read this. A character is drawn as an
// ordered stack of layers, each a manifest key; worn items add layers in the z-order below.
//
// Key scheme (assets/manifest.json paths are <key>/<pose>.png with `frames` frames side by side):
//   body/<build>_<skin>      three builds (0..2) × four skins (0..3)
//   face/<n>                 eight faces            hair/<n>  twelve hairstyles (tinted by look.coat? no: hair keeps its own palette)
//   outfit/<classId>         the class's base clothing, shown where torso / pants / boots are empty
//   worn/<baseId>            one layer per base item (set pieces: worn/<setId>_<slot>, weapons: worn/<items36 id>)
//   legendary/<id>           a Legendary's own sprite (drawn with a glow)
//   lantern/<third>          the Health tell on the belt: high | mid | low | dead
//   pet/<speciesId>_<stage>  the 48 × 48 pet token (pose idle | faint)
//   crest/<emoji>            the crest on the paper doll's centre and the hex token
import { WORN_SLOTS, LOOK_RANGES } from './character.js';
import { healthThird } from '../health.js';
import { B } from '../balance.js';

export const FRAME = { w: 64, h: 96 };
export const PET_FRAME = { w: 48, h: 48 };
export const TOKEN_CROP = { x: 16, y: 0, w: 32, h: 40 };                       // the hex token: head and shoulders at 1×
export const POSES = { idle: 4, attack: 6, hit: 2, death: 6, step: 4 };     // frame counts for body and weapons
export const ARMOUR_POSES = ['idle', 'attack', 'hit', 'death', 'step'];      // armour is drawn once per pose, offset by code
export const PET_POSES = { idle: 2, faint: 1 };
export const BUILDS = LOOK_RANGES.body, SKINS = LOOK_RANGES.skin, FACES = LOOK_RANGES.face, HAIRS = LOOK_RANGES.hair, PET_STAGES = 3;
export const RARITY_TRIM = { common: null, rare: 'silver', epic: 'gold', legendary: 'glow' };

// z-order, back to front. The slot named is the worn slot that supplies the layer.
export const Z = {
  backWeapon: 0, cape: 1, body: 2, pants: 3, boots: 4, torso: 5, gloves: 6, face: 7, hair: 8, helmet: 9, necklace: 10,
  ringGlints: 11, mainhand: 12, offhand: 13, spellAura: 14, lantern: 15,
};

export const itemSpriteKey = (item) => item?.legendaryId ? `legendary/${item.legendaryId}` : item?.sprite || (item?.baseId ? `worn/${item.baseId}` : null);
export const trimFor = (item) => RARITY_TRIM[item?.rarity] || null;
export const lanternKey = (c, B) => `lantern/${healthThird(c, B)}`;
export const petTokenKey = (pet) => `pet/${pet.speciesId}_${pet.stage || 0}`;
export const crestKey = (c) => `crest/${encodeURIComponent(c?.crest || '🂠')}`;

function layer(slot, key, z, extra = {}) { return { slot, key, z, ...extra }; }

// The ordered layer list for a character. `B` is the health balance group (for the lantern tell).
export function layersFor(c, H = B.health) {
  if (!c) return [];
  const look = c.look || {}; const w = c.worn || {}; const out = [];
  const main = w.mainhand, off = w.offhand;
  // A two-hand weapon or a spell in the off hand rides on the back when the main hand is busy.
  if (main && off && off.slot === 'weapon' && !main.twoHand) out.push(layer('offhand', itemSpriteKey(off), Z.backWeapon, { pose: 'back', trim: trimFor(off) }));
  if (w.cape) out.push(layer('cape', itemSpriteKey(w.cape), Z.cape, { trim: trimFor(w.cape), burning: w.cape.legendaryId === 'infernalmantle' }));
  out.push(layer('body', `body/${look.body ?? 0}_${look.skin ?? 0}`, Z.body));
  for (const slot of ['pants', 'boots', 'torso']) {
    const it = w[slot];
    if (it) out.push(layer(slot, itemSpriteKey(it), Z[slot], { trim: trimFor(it), dye: it.dye || null, setId: it.setId || null }));
    else out.push(layer(slot, `outfit/${c.classId || 'none'}`, Z[slot], { part: slot, coat: slot === 'torso' ? look.coat || null : null }));
  }
  if (w.gloves) out.push(layer('gloves', itemSpriteKey(w.gloves), Z.gloves, { trim: trimFor(w.gloves) }));
  out.push(layer('face', `face/${look.face ?? 0}`, Z.face));
  if (!w.helmet || w.helmet.legendaryId === 'impostorsvisor') out.push(layer('hair', `hair/${look.hair ?? 0}`, Z.hair));
  if (w.helmet) out.push(layer('helmet', itemSpriteKey(w.helmet), Z.helmet, { trim: trimFor(w.helmet) }));
  if (w.necklace) out.push(layer('necklace', itemSpriteKey(w.necklace), Z.necklace, { trim: trimFor(w.necklace) }));
  const rings = ['ring1', 'ring2', 'ring3', 'ring4'].filter(s => w[s]);
  if (rings.length) out.push(layer('rings', 'worn/ring_glints', Z.ringGlints, { count: rings.length, best: rings.map(s => trimFor(w[s])).find(Boolean) || null }));
  if (main) out.push(layer('mainhand', itemSpriteKey(main), Z.mainhand, { trim: trimFor(main), twoHand: !!main.twoHand, gameId: main.gameId || null }));
  if (off && !(main && off.slot === 'weapon' && !main.twoHand)) out.push(layer('offhand', itemSpriteKey(off), Z.offhand, { trim: trimFor(off), gameId: off.gameId || null }));
  const spell = w.spell1 || w.spell2;
  if (spell) out.push(layer('spell', `aura/${spell.family || 'cards'}`, Z.spellAura, { trim: trimFor(spell), spells: [w.spell1, w.spell2].filter(Boolean).length }));
  out.push(layer('lantern', lanternKey(c, H), Z.lantern));
  return out.sort((a, b) => a.z - b.z);
}

// What a creature on the map needs: the token key list (the sprite at 1× cropped), plus flags the TV reads.
export function tokenFor(c, H = B.health) {
  const layers = layersFor(c, H).filter(l => l.z >= Z.body && l.z <= Z.helmet || l.slot === 'cape');
  return { crop: TOKEN_CROP, layers: layers.map(l => l.key), crest: crestKey(c), dead: !!c.dead, hidden: (c.effects || []).some(e => e.id === 'hidden'), disguisedAs: (c.effects || []).find(e => e.id === 'impostor')?.data?.asPlayerId || null };
}
export function petLayers(pet) {
  return [{ key: petTokenKey(pet), pose: pet.fainted ? 'faint' : 'idle', frames: pet.fainted ? PET_POSES.faint : PET_POSES.idle, bodies: pet.bodies || null, heldItem: pet.heldItem ? itemSpriteKey(pet.heldItem) : null }];
}

// Every key a complete asset set needs, for the placeholder generator and the manifest staleness test.
export function allBaseKeys({ classIds = [], baseIds = [], legendaryIds = [], speciesIds = [], setPieces = [] } = {}) {
  const keys = [];
  for (let b = 0; b < BUILDS; b++) for (let s = 0; s < SKINS; s++) keys.push(`body/${b}_${s}`);
  for (let i = 0; i < FACES; i++) keys.push(`face/${i}`);
  for (let i = 0; i < HAIRS; i++) keys.push(`hair/${i}`);
  for (const id of classIds) keys.push(`outfit/${id}`);
  for (const id of baseIds) keys.push(`worn/${id}`);
  for (const p of setPieces) keys.push(`worn/${p}`);
  for (const id of legendaryIds) keys.push(`legendary/${id}`);
  for (const id of speciesIds) for (let st = 0; st < PET_STAGES; st++) keys.push(`pet/${id}_${st}`);
  for (const t of ['high', 'mid', 'low', 'dead']) keys.push(`lantern/${t}`);
  for (const f of ['dice', 'cards', 'wheels', 'nerve', 'picks']) keys.push(`aura/${f}`);
  keys.push('worn/ring_glints');
  return keys;
}
export { WORN_SLOTS };
