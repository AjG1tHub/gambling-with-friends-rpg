// The asset inventory of GWF RPG Edition as data (SPEC.md › "Asset list and generation plan").
// Every row is one file at its final path under assets/. tools/placeholders.mjs draws a stand-in for each,
// tools/build-manifest.mjs writes assets/manifest.json from the same rows, test/unit/generated.test.mjs asserts
// every row exists on disk. Real art replaces a placeholder by landing at the same path with the same name.
//
// Keys (manifest keys = sprite keys the renderer asks for):
//   body/<build 0-2>_<skin 0-3>   face/<0-7>   hair/<0-11>   outfit/<classId>   worn/<baseId>   legendary/<id>
//   lantern/<full|guttering|out|dead>   pets/<speciesId>_<stage 1-3>   pets/egg_<speciesId>   pets/attack_<type>
//   monsters/<id>  monsters/<id>_token   items/<itemId>   gear/<baseId>   consumables/<id>
//   tiles/<type>   tiles/ground_<regionId>   tiles/void_<regionId>   map/<name>
//   wheels/<wheelId>   cards/<colour>   cards/<colour>_double   cards/back   dice/d<n>
//   frames/<rarity>_<WxH>   ui/<name>   tv/<name>   crest/<classId>   letters/<name>   stages/<family>   badges/<name>
//   sound/<cue>
// Paths: paper-doll layers (body, face, hair, outfit, worn, legendary, lantern) live under assets/sprites/<key>.png
// (the immutable cache header in netlify.toml covers /sprites/*); everything else is assets/<key>.<ext>.
//
// `size` is the spec size; `genSize` is what the placeholder generator actually writes when smaller (ground and
// void textures, portraits, stages, crests): the CSS scales them, and real art at `size` drops in unchanged.
// The data files other modules own (regions, tiles, boots, bases, legendaries, pets, monsters, wheels, challenges)
// are read when present so the inventory follows the real ids; the FALLBACK lists below are the spec's own lists.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readJSON = (rel, fallback = null) => { const p = path.join(ROOT, rel); if (!existsSync(p)) return fallback; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };

// ── Art direction ─────────────────────────────────────────────────
export const PALETTE = {
  velvet: '#0b080c', velvet2: '#17111a', oxblood: '#5a1a1a', oxblood2: '#7a2424', gold: '#9c7a2e', gold2: '#c9a24a', brass: '#8a6a2a', silver: '#b8b8c4',
  bone: '#e8dfc8', bone2: '#f4efdf', amber: '#f0a830', smoke: '#3a3340', verdigris: '#3f8a73', violet: '#6b3fa0', soot: '#2a2a2e', ink: '#120d10',
};
export const SECRET_COLOURS = { oxblood: '#5a1a1a', bone: '#e8dfc8', brass: '#9c7a2e', verdigris: '#3f8a73', violet: '#6b3fa0', soot: '#2a2a2e' };
export const RARITY_COLOURS = { common: '#8a6a2a', rare: '#b8b8c4', epic: '#d9b345', legendary: '#f4efdf' };
export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const FAMILIES = ['dice', 'cards', 'wheels', 'nerve', 'picks'];
export const FAMILY_COLOURS = { dice: '#e8dfc8', cards: '#7a2424', wheels: '#c9a24a', nerve: '#f0a830', picks: '#3f8a73' };

// ── Sprite contract (SPEC.md › Character sprites and the paper doll) ─
export const FRAME = { w: 64, h: 96 };
export const BODY_POSES = { idle: 4, attack: 6, hit: 2, death: 6, step: 4 };          // 22 frames in a row
export const ARMOUR_POSES = { idle: 1, attack: 1, hit: 1, death: 1, step: 1 };         // one drawing per pose, moved by code
export const POSE_ORDER = ['idle', 'attack', 'hit', 'death', 'step'];
export const frameCount = (poses) => Object.values(poses).reduce((a, b) => a + b, 0);
// Layer order back → front. The renderer sorts worn layers by z.
export const LAYER_Z = { backweapon: 0, cape: 10, body: 20, outfit: 25, pants: 30, boots: 40, torso: 50, lantern: 55, gloves: 60, face: 70, hair: 80, helmet: 90, necklace: 100, ring: 110, mainhand: 120, offhand: 130, spell: 140 };
export const WORN_SLOTS = ['mainhand', 'offhand', 'spell1', 'spell2', 'helmet', 'torso', 'pants', 'gloves', 'boots', 'ring1', 'ring2', 'ring3', 'ring4', 'necklace', 'cape'];
export const FOOTPRINTS = ['1x1', '2x1', '1x3', '2x2', '2x3', '2x4'];
export const FOOTPRINT_BY_SLOT = { ring: '1x1', necklace: '1x1', consumable: '1x1', gloves: '2x1', boots: '2x1', helmet: '2x2', pants: '2x2', egg: '2x2', torso: '2x3', weapon: '1x3', spell: '1x3', offhand: '1x3', twohand: '2x4', cape: '2x3', tool: '1x3' };
export const PHONE_TABS = ['play', 'cage', 'self', 'pets', 'map', 'letters'];

// ── Fallback lists (the spec's own) ────────────────────────────────
export const FALLBACK = {
  regions: [
    { id: 'strip', name: 'Casino Strip', accent: '#ff3fa4', voidFlavour: 'wall', family: 'picks' },
    { id: 'docks', name: 'The Docks', accent: '#7dff5a', voidFlavour: 'water', family: 'dice' },
    { id: 'blackwood', name: 'Blackwood', accent: '#a86bff', voidFlavour: 'wall', family: 'cards' },
    { id: 'caldera', name: 'The Caldera', accent: '#ff7a1f', voidFlavour: 'chasm', family: 'nerve' },
    { id: 'citadel', name: 'Sky Citadel', accent: '#ffd466', voidFlavour: 'chasm', family: 'wheels' },
  ],
  tiles: { encounter: 'E', wheel: 'W', shop: '$', inn: 'I', bloodbank: 'B', graveyard: 'G', arena: 'A', chaos: 'X', chest: 'C', event: 'F', bossgate: 'K', portal: 'O', bounty: '%', start: 'S', throne: 'T', plain: '.', courier: 'P', blocker: '#' },
  classes: [
    { id: 'whale', name: 'Whale', mark: 'split coin' }, { id: 'pitboss', name: 'Pit Boss', mark: 'ledger' }, { id: 'cutpurse', name: 'Cutpurse', mark: 'fox mask' },
    { id: 'enforcer', name: 'Enforcer', mark: 'cracked knuckle' }, { id: 'beastmaster', name: 'Beastmaster', mark: 'leash' }, { id: 'croupier', name: 'Croupier', mark: "dealer's visor" },
  ],
  items: [
    ['coinblade', 'Coin Blade', 'attack', 'wheels'], ['wheelofruin', 'Wheel of Ruin', 'attack', 'wheels'], ['roulettestorm', 'Roulette Storm', 'area', 'wheels'], ['fusebomb', 'Fuse Bomb', 'attack', 'nerve'],
    ['minefield', 'Minefield', 'attack', 'nerve'], ['ward', 'Ward', 'spell', 'cards'], ['twinfang', 'Twin Fang', 'attack', 'cards'], ['rockslide', 'Rockslide', 'attack', 'picks'], ['mend', 'Mend', 'spell', 'cards'],
    ['loadeddice', 'Loaded Dice', 'attack', 'dice'], ['jackpotcannon', 'Jackpot Cannon', 'attack', 'picks'], ['starshower', 'Star Shower', 'attack', 'picks'], ['chainlightning', 'Chain Lightning', 'attack', 'nerve'],
    ['clash', 'Clash', 'versus', 'cards'], ['dragonsbreath', "Dragon's Breath", 'attack', 'cards'], ['houndsnap', 'Hound Snap', 'attack', 'cards'], ['tripledice', 'Triple Dice', 'attack', 'dice'], ['bonecage', 'Bone Cage', 'attack', 'dice'],
    ['luckyseven', 'Lucky Seven', 'attack', 'dice'], ['prismspin', 'Prism Spin', 'attack', 'wheels'], ['scratchcharm', 'Scratch Charm', 'spell', 'picks'], ['limborope', 'Limbo Rope', 'attack', 'nerve'], ['stampede', 'Stampede', 'area', 'picks'],
    ['siegetower', 'Siege Tower', 'attack', 'nerve'], ['roadrun', 'Road Run', 'attack', 'nerve'], ['pachinkohail', 'Pachinko Hail', 'attack', 'picks'], ['briefcase', 'The Briefcase', 'spell', 'picks'], ['diceduel', 'Dice Duel', 'versus', 'dice'],
    ['thebus', 'The Bus', 'attack', 'cards'], ['shellgame', 'Shell Game', 'versus', 'picks'], ['handoffate', 'Hand of Fate', 'attack', 'cards'], ['trident', 'Trident', 'attack', 'cards'], ['letitride', 'Let It Ride', 'attack', 'cards'],
    ['holdemduel', "Hold'em Duel", 'versus', 'cards'], ['bonetoss', 'Bone Toss', 'attack', 'dice'], ['twinward', 'Twin Ward', 'spell', 'cards'],
  ].map(([id, name, kind, family]) => ({ id, name, kind, family })),
  twohand: ['twohand_dice', 'twohand_cards', 'twohand_wheels', 'twohand_nerve', 'twohand_picks', 'twohand_dealer'],
  gear: {
    helmet: ['helm_iron', 'helm_hood', 'helm_visor', 'helm_mask', 'helm_crown'],
    torso: ['coat_heavy', 'vest_dealer', 'cuirass_brass', 'robe_bone', 'mantle_velvet'],
    pants: ['breeches', 'greaves_iron', 'trousers_pinstripe', 'kilt_chain'],
    gloves: ['gloves_leather', 'gauntlet_brass', 'gloves_dealer', 'knuckles_bone'],
    boots: ['cobblers_slippers', 'loaded_boots', 'knucklebone_greaves', 'decahedron_striders', 'dodeca_sabatons', 'fateful_treads', 'croupiers_heels', 'breaking_wheel_boots', 'dyers_boots', 'painted_soles'],
    ring: ['ring_brass', 'ring_silver', 'ring_bone', 'ring_signet', 'ring_skull', 'ring_die', 'ring_chip', 'ring_eye'],
    necklace: ['necklace_chip', 'necklace_tooth', 'necklace_key', 'necklace_locket', 'necklace_rosary'],
  },
  legendaries: [
    ['pedestal_blade', 'Pedestal Blade', 'weapon'], ['gravity_gauntlet', 'Gravity Gauntlet', 'gloves'], ['companion_pendant', 'Weighted Companion Pendant', 'necklace'], ['ember_flask', 'Ember Flask', 'consumable'],
    ['big_fancy_gun', 'Big Fancy Gun', 'weapon'], ['green_cap_toadstool', 'Green-Cap Toadstool', 'consumable'], ['buster_cleaver', 'Oversized Buster Cleaver', 'twohand'], ['pip_buoy', 'Pip-Buoy', 'ring'],
    ['tamers_snare', "Tamer's Snare", 'consumable'], ['the_shout', 'The Shout', 'spell'], ['blockbreaker_pick', 'Blockbreaker Pick', 'offhand'], ['impostors_visor', "Impostor's Visor", 'helmet'],
    ['the_joker', 'The Joker', 'weapon'], ['chicken_dinner', 'Chicken Dinner Platter', 'consumable'], ['rail_lance', 'Rail Lance', 'weapon'], ['corvette_broadside', 'Corvette Broadside', 'twohand'],
    ['octane_treads', 'Octane Treads', 'boots'], ['amulet_of_potency', 'Amulet of Potency', 'necklace'], ['infernal_mantle', 'Infernal Mantle', 'cape'], ['deep_sea_suit', 'Deep-Sea Suit', 'torso'],
    ['skates_of_the_sixth', 'Skates of the Sixth', 'boots'], ['spiny_carapace', 'Spiny Blue Carapace', 'consumable'], ['clay_ocarina', 'Clay Ocarina', 'spell'], ['fairy_in_a_jar', 'Fairy in a Jar', 'consumable'],
    ['pool_ladder', 'Pool Ladder', 'offhand'], ['camera_obscura', 'Camera Obscura', 'offhand'], ['reset_cartridge', 'Reset Cartridge', 'consumable'],
  ].map(([id, name, slot]) => ({ id, name, slot })),
  pets: ['emberfox', 'tidepup', 'sprigbun', 'zapmouse', 'gloomcat', 'dawnowl', 'boulderox', 'stormhawk', 'lavatoad', 'voidling', 'sundrake', 'goldengoose', 'grazing_maw', 'mucklings'],
  petAttackTypes: ['strike', 'element', 'guard', 'mend'],
  monsters: {
    strip: ['drunk_revenant', 'croupier_revenant', 'slot_golem', 'card_shark'], docks: ['loan_shark_eel', 'roulette_wraith', 'pier_ghoul', 'drowned_dealer'],
    blackwood: ['gallows_spirit', 'dice_hangman', 'rope_wraith', 'the_litter_cat'], caldera: ['salamander_dealer', 'molten_chip', 'forge_golem', 'ash_croupier'],
    citadel: ['highroller_angel', 'the_grey', 'gilded_wraith', 'cloud_shark'],
  },
  bosses: ['boss_strip', 'boss_docks', 'boss_blackwood', 'boss_caldera', 'boss_citadel'], raids: ['the_litter', 'high_table'], finalBoss: 'the_dealer',
  consumables: ['nudge', 'reroll', 'fork', 'potion_small', 'potion_medium', 'potion_large', 'smoke_bomb', 'phoenix_feather', 'pet_revive', 'satchel', 'spyglass', 'egg'],
  wheels: {
    buyin: { name: 'Buy-in Wheel', labels: ['80', '90', '100', '110', '120', '130', '140', '150'] },
    chaos: { name: 'Chaos Wheel', labels: ['Reshuffle', 'Double', 'Collector', 'Scramble', 'Swap', 'Blood', 'Region', 'Class'] },
    pet_common: { name: 'Pet Wheel (common)', labels: ['Emberfox', 'Tidepup', 'Sprigbun', 'Zapmouse', 'Gloomcat', 'Dawnowl'] },
    pet_region: { name: 'Pet Wheel (region)', labels: ['Region', 'Region', 'Common', 'Region', 'Rare', 'Common'] },
    pet_rare: { name: 'Pet Wheel (rare)', labels: ['Stormhawk', 'Dud', 'Voidling', 'Dud', 'Sundrake', 'Dud', 'Golden Goose', 'Dud'] },
    fortune: { name: 'Fortune Wheel', labels: ['Health', 'Gold', 'Item', 'Health', 'Gold', 'Nothing'] },
    fate: { name: 'Fate Wheel', labels: ['Windfall', 'Teleport', 'Swap', 'Free item', 'Lose a turn', 'Bounty'] },
    loot: { name: 'Loot Wheel', labels: ['Common', 'Common', 'Rare', 'Gold', 'Epic', 'Egg', 'Legendary', 'Common'] },
    boss: { name: 'Boss Wheel', labels: ['Calm', 'Hungry', 'Furious', 'Cunning'] },
    movement: { name: 'Movement Wheel', labels: ['1', '2', '3', '4', '5', '6', 'Sprint', 'Stumble', 'Teleport', 'Swap'] },
    challenge: { name: 'Challenge Wheel', labels: ['Clash', 'Dice Duel', 'Shell Game', "Hold'em", 'Quick-Draw', 'Speed Math', 'Memory', 'Trivia', 'High Card', 'Table'] },
  },
  badges: ['first_blood', 'undying', 'glass_cannon', 'dragon_slayer', 'high_roller', 'pit_fiend', 'courier', 'spymaster', 'beast_friend', 'full_team', 'tamer', 'deep_diver', 'flawless', 'survivor', 'collector_paid', 'thief', 'bounty_hunter', 'throne', 'veteran', 'hall_of_fame'],
};

// ── Sound cues (SPEC.md › Asset list › Sound + Music) ──────────────
export const SOUND_CUES = [
  'hex_step', 'dice', 'wheel_ratchet', 'wheel_land', 'card_draw', 'hit', 'crit', 'miss', 'death_bell', 'lantern_gutter', 'letter_sent', 'letter_intercepted',
  'loot_common', 'loot_rare', 'loot_epic', 'loot_legendary', 'chaos_stinger', 'boss_roar', 'ui_tap_1', 'ui_tap_2', 'ui_tap_3', 'ui_tap_4', 'ui_tap_5', 'ui_tap_6', 'buzz', 'clock_warning', 'turn_start',
  'game_dice_roll', 'game_dice_land', 'game_cards_flip', 'game_cards_shuffle', 'game_wheels_spin', 'game_wheels_land', 'game_nerve_tick', 'game_nerve_boom', 'game_nerve_cashout', 'game_picks_drop', 'game_picks_peg', 'game_picks_hit',
];
export const MUSIC_LOOPS = ['music_lobby', 'music_strip', 'music_docks', 'music_blackwood', 'music_caldera', 'music_citadel', 'music_fight', 'music_boss', 'music_recap'];

// ── Data readers (tolerant of files that do not exist yet) ─────────
const uniq = (a) => [...new Set(a)];
const idsOf = (x) => Array.isArray(x) ? x.map(e => typeof e === 'string' ? e : e?.id).filter(Boolean) : x && typeof x === 'object' ? Object.keys(x).filter(k => !k.startsWith('_')) : [];

export function loadData() {
  const regionsJ = readJSON('data/regions.json'), tilesJ = readJSON('data/tiles.json'), bootsJ = readJSON('data/boots.json'), classesJ = readJSON('data/classes.json'), itemsJ = readJSON('data/items36.json');
  const basesJ = readJSON('data/bases.json'), legJ = readJSON('data/legendaries.json'), petsJ = readJSON('data/pets.json'), monJ = readJSON('data/monsters.json'), wheelsJ = readJSON('data/wheels.json');
  const regions = (regionsJ?.regions || FALLBACK.regions).map(r => ({ id: r.id, name: r.name, accent: r.accent || '#ff3fa4', voidFlavour: r.voidFlavour || 'wall', family: r.family || 'picks', monsterTable: r.monsterTable || FALLBACK.monsters[r.id] || [], bossId: r.bossId, raidBossId: r.raidBossId }));
  const tileTypes = tilesJ?.tiles ? Object.fromEntries(Object.entries(tilesJ.tiles).filter(([, v]) => !v.void).map(([k, v]) => [k, v.letter || k[0].toUpperCase()])) : FALLBACK.tiles;
  const classes = (classesJ?.classes || FALLBACK.classes).map(c => ({ id: c.id, name: c.name, mark: c.mark || '' }));
  const items = (itemsJ?.items || FALLBACK.items).map(i => ({ id: i.id, name: i.name, kind: i.kind, family: i.family }));
  // Gear bases: data/bases.json may be { bases: [{id, slot}] } or { helmet: [...], torso: [...] }.
  const gear = {};
  const slotsWanted = ['helmet', 'torso', 'pants', 'gloves', 'boots', 'ring', 'necklace'];
  if (basesJ) {
    const rows = Array.isArray(basesJ.bases) ? basesJ.bases : Array.isArray(basesJ) ? basesJ : null;
    if (rows) for (const r of rows) { if (r?.id && slotsWanted.includes(r.slot)) (gear[r.slot] ||= []).push(r.id); }
    else for (const s of slotsWanted) if (basesJ[s]) gear[s] = idsOf(basesJ[s]);
  }
  for (const s of slotsWanted) if (!gear[s]?.length) gear[s] = s === 'boots' && bootsJ?.bases ? bootsJ.bases.map(b => b.id) : FALLBACK.gear[s];
  const legendaries = (legJ?.legendaries || legJ?.items || FALLBACK.legendaries).map(l => ({ id: l.id, name: l.name || l.id, slot: (l.footprint?.w === 2 && l.footprint?.h === 4) ? 'twohand' : (l.slot || 'weapon') })).filter(l => l.id);
  const pets = (petsJ?.species || petsJ?.pets) ? idsOf(petsJ.species || petsJ.pets) : FALLBACK.pets;
  const petAttackTypes = petsJ?.attackTypes ? idsOf(petsJ.attackTypes) : FALLBACK.petAttackTypes;
  // Consumables: the base list when it exists (bases.json › consumable) plus the spec's three potion sizes.
  const consumables = uniq([...(basesJ?.consumable ? idsOf(basesJ.consumable) : FALLBACK.consumables), 'potion_small', 'potion_medium', 'potion_large']);
  let monsters;
  if (monJ?.species && monJ.species.some(s => s.role)) {
    const sp = monJ.species; const by = (role) => sp.filter(s => s.role === role).map(s => s.id);
    monsters = { regular: by('common'), bosses: by('boss'), raids: by('raid'), finalBoss: by('final')[0] || FALLBACK.finalBoss, other: sp.filter(s => !['common', 'boss', 'raid', 'final'].includes(s.role)).map(s => s.id) };
  } else if (monJ) { const all = idsOf(monJ.monsters || monJ.species || monJ); monsters = { regular: all.filter(id => !/^boss_|^the_dealer$/.test(id) && !FALLBACK.raids.includes(id)), bosses: all.filter(id => /^boss_/.test(id)), raids: all.filter(id => FALLBACK.raids.includes(id)), finalBoss: all.find(id => id === 'the_dealer') || FALLBACK.finalBoss, other: [] }; }
  else {
    const regular = uniq(regions.flatMap(r => r.monsterTable.length ? r.monsterTable : FALLBACK.monsters[r.id] || []));
    // The spec promises four distinct species per region; pad from the fallback so the inventory holds 20.
    for (const r of regions) for (const id of FALLBACK.monsters[r.id] || []) if (regular.length < 20 && !regular.includes(id)) regular.push(id);
    monsters = { regular, bosses: uniq(regions.map(r => r.bossId).filter(Boolean)), raids: uniq(regions.map(r => r.raidBossId).filter(Boolean)), finalBoss: FALLBACK.finalBoss, other: [] };
    if (!monsters.bosses.length) monsters.bosses = FALLBACK.bosses; if (!monsters.raids.length) monsters.raids = FALLBACK.raids;
  }
  const wheels = { ...FALLBACK.wheels };
  if (wheelsJ) for (const [id, w] of Object.entries(wheelsJ.wheels || wheelsJ)) { if (id.startsWith('_') || !w) continue; const segs = Array.isArray(w) ? w : w.segments; if (Array.isArray(segs) && segs.length) wheels[id] = { name: w.name || wheels[id]?.name || id, labels: segs.map(s => String(s.label ?? s.name ?? s)) }; }
  if (bootsJ?.wheel?.segments) wheels.movement = { name: 'Movement Wheel', labels: bootsJ.wheel.segments.map(s => s.label) };
  const colours = Object.keys(SECRET_COLOURS);
  return { regions, tileTypes, classes, items, gear, legendaries, pets, petAttackTypes, consumables, monsters, wheels, colours };
}

// ── The inventory ──────────────────────────────────────────────────
const spritePath = (key) => `assets/sprites/${key}.png`;
const assetPath = (key, ext) => `assets/${key}.${ext}`;

export function buildAssetList(data = loadData()) {
  const rows = [];
  const add = (group, key, o) => rows.push({ key, group, kind: o.kind || 'png', path: o.path || (o.kind === 'svg' ? assetPath(key, 'svg') : assetPath(key, 'png')), size: o.size, genSize: o.genSize || null, priority: o.priority || 'P2', name: o.name || key, ...(o.sprite ? { sprite: o.sprite } : {}), ...(o.meta ? { meta: o.meta } : {}) });
  const sheet = (poses) => [FRAME.w * frameCount(poses), FRAME.h];
  const bodySprite = (slot, z, poses = ARMOUR_POSES) => ({ slot, z, poses, frames: frameCount(poses), frameW: FRAME.w, frameH: FRAME.h });

  // Hex tiles
  for (const r of data.regions) {
    add('tiles', `tiles/ground_${r.id}`, { size: [512, 512], genSize: [256, 256], priority: 'P1', name: `${r.name} ground`, meta: { region: r.id, accent: r.accent } });
    add('tiles', `tiles/void_${r.id}`, { size: [512, 512], genSize: [256, 256], priority: 'P1', name: `${r.name} void (${r.voidFlavour})`, meta: { region: r.id, accent: r.accent, flavour: r.voidFlavour } });
  }
  for (const [type, letter] of Object.entries(data.tileTypes)) add('tiles', `tiles/${type}`, { size: [512, 512], genSize: [256, 256], priority: 'P1', name: `${type} glyph`, meta: { letter } });
  for (const [k, letter] of [['bridge', '='], ['bridge_gated', 'K'], ['fog', '?']]) add('tiles', `tiles/${k}`, { size: [512, 512], genSize: [256, 256], priority: 'P1', meta: { letter } });
  // Map dressing
  add('map', 'map/parchment_frame', { size: [1024, 1024], genSize: [256, 256], priority: 'P1' });
  for (const r of data.regions) add('map', `map/cartouche_${r.id}`, { size: [1024, 256], genSize: [256, 64], priority: 'P1', name: `${r.name} cartouche`, meta: { region: r.id, accent: r.accent, label: r.name } });
  add('map', 'map/courier_marker', { size: [1024, 1024], genSize: [128, 128], priority: 'P1' });
  add('map', 'map/path_brush', { size: [1024, 1024], genSize: [128, 128], priority: 'P1' });
  add('map', 'map/reach_ring', { size: [1024, 1024], genSize: [256, 256], priority: 'P1' });
  // Class art: paper doll
  for (let build = 0; build < 3; build++) for (let skin = 0; skin < 4; skin++) add('body', `body/${build}_${skin}`, { path: spritePath(`body/${build}_${skin}`), size: sheet(BODY_POSES), priority: build === 0 ? 'P1' : 'P2', sprite: bodySprite('body', LAYER_Z.body, BODY_POSES), meta: { build, skin } });
  for (let i = 0; i < 8; i++) add('face', `face/${i}`, { path: spritePath(`face/${i}`), size: sheet(ARMOUR_POSES), priority: i < 4 ? 'P1' : 'P2', sprite: bodySprite('face', LAYER_Z.face) });
  for (let i = 0; i < 12; i++) add('hair', `hair/${i}`, { path: spritePath(`hair/${i}`), size: sheet(ARMOUR_POSES), priority: i < 6 ? 'P1' : 'P2', sprite: bodySprite('hair', LAYER_Z.hair) });
  for (const c of data.classes) add('outfit', `outfit/${c.id}`, { path: spritePath(`outfit/${c.id}`), size: sheet(ARMOUR_POSES), priority: 'P1', name: `${c.name} base outfit`, sprite: bodySprite('outfit', LAYER_Z.outfit) });
  // Worn-item layers: one per weapon/spell item, two-hand variant and armour base.
  const wornSlotOf = (kind) => kind === 'spell' ? 'spell' : 'mainhand';
  data.items.forEach((it, i) => add('worn', `worn/${it.id}`, { path: spritePath(`worn/${it.id}`), size: sheet(ARMOUR_POSES), priority: i % 2 ? 'P2' : 'P1', name: `${it.name} (worn)`, sprite: bodySprite(wornSlotOf(it.kind), LAYER_Z[wornSlotOf(it.kind)]), meta: { family: it.family, kind: it.kind } }));
  for (const id of FALLBACK.twohand) add('worn', `worn/${id}`, { path: spritePath(`worn/${id}`), size: sheet(ARMOUR_POSES), priority: 'P2', sprite: bodySprite('mainhand', LAYER_Z.mainhand), meta: { twoHand: true } });
  for (const [slot, ids] of Object.entries(data.gear)) ids.forEach((id, i) => add('worn', `worn/${id}`, { path: spritePath(`worn/${id}`), size: sheet(ARMOUR_POSES), priority: i % 2 ? 'P2' : 'P1', sprite: bodySprite(slot, LAYER_Z[slot]), meta: { slot } }));
  for (const l of data.legendaries) { const slot = { weapon: 'mainhand', twohand: 'mainhand', spell: 'spell', consumable: 'offhand', offhand: 'offhand', tool: 'offhand' }[l.slot] || l.slot; add('legendary', `legendary/${l.id}`, { path: spritePath(`legendary/${l.id}`), size: sheet(ARMOUR_POSES), priority: 'P2', name: l.name, sprite: bodySprite(slot, (LAYER_Z[slot] ?? LAYER_Z.mainhand) + 1), meta: { slot: l.slot, glow: true } }); }
  for (const c of data.classes) add('crest', `crest/${c.id}`, { size: [600, 1000], genSize: [150, 250], priority: 'P1', name: `${c.name} crest`, meta: { mark: c.mark } });
  for (const c of data.classes) add('ui', `ui/active_${c.id}`, { size: [256, 256], genSize: [128, 128], priority: 'P1', name: `${c.name} active icon` });
  // Lantern tell
  for (const s of ['full', 'guttering', 'out', 'dead']) add('lantern', `lantern/${s}`, { path: spritePath(`lantern/${s}`), size: [512, 128], priority: 'P1', sprite: { slot: 'lantern', z: LAYER_Z.lantern, poses: { flicker: 4 }, frames: 4, frameW: 128, frameH: 128 } });
  // Monsters
  const mon = data.monsters;
  const addMonster = (id, pr, meta) => { add('monsters', `monsters/${id}`, { size: [1024, 1024], genSize: [256, 256], priority: pr, meta }); add('monsters', `monsters/${id}_token`, { size: [256, 256], genSize: [128, 128], priority: pr, meta: { ...meta, token: true } }); };
  mon.regular.forEach((id, i) => addMonster(id, i % 2 ? 'P2' : 'P1', { role: 'monster' }));
  mon.bosses.forEach((id, i) => addMonster(id, i ? 'P2' : 'P1', { role: 'boss' }));
  mon.raids.forEach(id => addMonster(id, 'P2', { role: 'raid' }));
  addMonster(mon.finalBoss, 'P2', { role: 'final' });
  (mon.other || []).forEach(id => addMonster(id, 'P3', { role: 'other' }));
  // Weapons and spells, armour and jewelry, consumables
  for (const it of data.items) add('items', `items/${it.id}`, { size: [256, 256], genSize: [128, 128], priority: 'P1', name: it.name, meta: { family: it.family, kind: it.kind, footprint: '1x3' } });
  for (const id of FALLBACK.twohand) add('items', `items/${id}`, { size: [256, 256], genSize: [128, 128], priority: 'P2', meta: { footprint: '2x4', twoHand: true } });
  for (const [slot, ids] of Object.entries(data.gear)) ids.forEach((id, i) => add('gear', `gear/${id}`, { size: [256, 256], genSize: [128, 128], priority: i % 2 ? 'P2' : 'P1', meta: { slot, footprint: FOOTPRINT_BY_SLOT[slot] } }));
  for (const id of data.consumables) add('consumables', `consumables/${id}`, { size: [128, 128], priority: 'P1' });
  // Rarity frames (9-slice, cell = 64 px, inset 12)
  for (const r of RARITIES) for (const fp of FOOTPRINTS) { const [w, h] = fp.split('x').map(Number); add('frames', `frames/${r}_${fp}`, { size: [w * 64, h * 64], priority: 'P1', meta: { rarity: r, footprint: fp, slice: 12 } }); }
  // Pets
  data.pets.forEach((id, i) => { for (let s = 1; s <= 3; s++) add('pets', `pets/${id}_${s}`, { size: [512, 512], genSize: [128, 128], priority: i < 4 ? 'P1' : 'P2', meta: { species: id, stage: s } }); add('pets', `pets/egg_${id}`, { size: [512, 512], genSize: [128, 128], priority: i < 4 ? 'P1' : 'P2', meta: { species: id, egg: true } }); });
  for (const t of data.petAttackTypes) add('pets', `pets/attack_${t}`, { size: [128, 128], priority: 'P2' });
  // Wheels (SVG, segments in their own layer)
  for (const [id, w] of Object.entries(data.wheels)) add('wheels', `wheels/${id}`, { kind: 'svg', size: [1024, 1024], priority: ['buyin', 'chaos', 'loot', 'movement'].includes(id) ? 'P1' : 'P2', name: w.name, meta: { labels: w.labels } });
  add('wheels', 'wheels/pointer', { kind: 'svg', size: [128, 192], priority: 'P1' }); add('wheels', 'wheels/hub', { kind: 'svg', size: [256, 256], priority: 'P1' });
  // Colour cards
  for (const c of data.colours) { add('cards', `cards/${c}`, { kind: 'svg', size: [600, 1000], priority: 'P1', meta: { colour: c, hex: SECRET_COLOURS[c] } }); add('cards', `cards/${c}_double`, { kind: 'svg', size: [600, 1000], priority: 'P1', meta: { colour: c, hex: SECRET_COLOURS[c], double: true } }); }
  add('cards', 'cards/back', { kind: 'svg', size: [600, 1000], priority: 'P1' });
  // Dice: a face sheet (n faces × 64 px), a 4-frame roll blur and a flat outline per die.
  for (const n of [4, 6, 8, 10, 12, 20]) { const pr = n === 6 ? 'P1' : 'P2'; add('dice', `dice/d${n}`, { size: [64 * n, 64], priority: pr, meta: { sides: n, frameW: 64 } }); add('dice', `dice/d${n}_roll`, { size: [256, 64], priority: pr, meta: { sides: n, frames: 4, frameW: 64 } }); add('dice', `dice/d${n}_outline`, { size: [256, 256], genSize: [128, 128], priority: pr, meta: { sides: n } }); }
  // Letters
  for (const k of ['sealed', 'broken', 'delivered', 'forged']) add('letters', `letters/${k}`, { size: [256, 256], genSize: [128, 128], priority: 'P2' });
  add('letters', 'letters/crow', { size: [768, 256], genSize: [384, 128], priority: 'P2', meta: { frames: 3, frameW: 128 } });
  for (const c of data.classes) add('letters', `letters/seal_${c.id}`, { size: [256, 256], genSize: [128, 128], priority: 'P2', name: `${c.name} wax seal` });
  // Phone UI (SVG)
  for (const s of ['idle', 'pressed', 'disabled']) add('ui', `ui/hexbtn_${s}`, { kind: 'svg', size: [120, 120], priority: 'P1' });
  add('ui', 'ui/stop_hub', { kind: 'svg', size: [120, 120], priority: 'P1' }); add('ui', 'ui/cage_cell', { kind: 'svg', size: [64, 64], priority: 'P1' }); add('ui', 'ui/doll_stand', { kind: 'svg', size: [320, 480], priority: 'P1' });
  for (const s of WORN_SLOTS) add('ui', `ui/slot_${s}`, { kind: 'svg', size: [64, 64], priority: 'P1', meta: { slot: s } });
  for (const t of PHONE_TABS) add('ui', `ui/tab_${t}`, { kind: 'svg', size: [48, 48], priority: 'P1' });
  for (const s of ['idle', 'pressed', 'disabled']) add('ui', `ui/btn_${s}`, { kind: 'svg', size: [320, 72], priority: 'P1' });
  for (const s of ['plain', 'ornate', 'alert']) add('ui', `ui/panel_${s}`, { kind: 'svg', size: [360, 240], priority: 'P1' });
  // TV UI (SVG layers at 1920 width)
  for (const k of ['header', 'panel_frame', 'panel_frame_wide', 'clock_face', 'fight_panel', 'ticker', 'recap_frame', 'recap_card', 'offscreen_card']) add('tv', `tv/${k}`, { kind: 'svg', size: k === 'clock_face' ? [320, 320] : k.startsWith('recap_card') ? [600, 800] : k === 'offscreen_card' ? [640, 360] : [1920, 160], priority: 'P1' });
  for (let t = 1; t <= 5; t++) add('tv', `tv/chaos_banner_${t}`, { kind: 'svg', size: [1920, 200], priority: 'P1', meta: { tier: t } });
  // Minigame stages
  for (const f of FAMILIES) add('stages', `stages/${f}`, { size: [1920, 1080], genSize: [480, 270], priority: 'P1', meta: { family: f } });
  add('stages', 'stages/cardback', { size: [600, 1000], genSize: [150, 250], priority: 'P1' }); add('stages', 'stages/chips', { size: [1024, 256], genSize: [512, 128], priority: 'P1', meta: { frames: 4, frameW: 128 } }); add('stages', 'stages/felt', { size: [1920, 1080], genSize: [480, 270], priority: 'P1' });
  // Badges
  for (const b of FALLBACK.badges) add('badges', `badges/${b}`, { size: [128, 128], priority: 'P3' });
  // Sound
  for (const cue of SOUND_CUES) add('sound', `sound/${cue}`, { kind: 'wav', path: `assets/sound/${cue}.wav`, size: null, priority: 'P1', meta: { cue } });
  for (const m of MUSIC_LOOPS) add('sound', `sound/${m}`, { kind: 'wav', path: `assets/sound/${m}.wav`, size: null, priority: ['music_lobby', 'music_fight', 'music_strip'].includes(m) ? 'P1' : 'P2', meta: { cue: m, music: true } });

  const seen = new Set();
  for (const r of rows) { if (seen.has(r.key)) throw new Error(`duplicate asset key ${r.key}`); seen.add(r.key); }
  return rows;
}

export function countByGroup(rows) { const out = {}; for (const r of rows) out[r.group] = (out[r.group] || 0) + 1; return out; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = buildAssetList();
  console.log(countByGroup(rows), 'total', rows.length);
}
