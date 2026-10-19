// The player rulebook, generated from data so it always matches the game: docs/RULEBOOK.md for people and
// data/rulebook.generated.json (the same sections as structured blocks) for the phone's rules sheet and the
// GM guide to render. Reads whichever data files exist (boots, tiles, challenges, legendaries, sets, pets,
// wheels are optional) and pulls every number from data/balance.json. Deterministic; `build()` returns
// { md, json } and the CLI writes both.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, readJSON } from './asset-list.mjs';

export const MD_PATH = 'docs/RULEBOOK.md';
export const JSON_PATH = 'data/rulebook.generated.json';

const CONCEPT = 'GWF RPG Edition is a grimdark-casino roguelite played in runs of one to two hours: every run rolls a fresh map, monsters and loot, each player makes a new character on their phone, and what survives the run (a few vaulted items, a veteran character, the pets you caught) is the progression between runs. The 36 minigames become attacks and spells: every weapon or spell is one minigame with its own Health stake, win and the target takes the damage, lose and the stake is gone. Monster fights are to the death and player fights are one hit a turn with a chance to run, Health is hidden and hard to heal, and the GM runs the night from the PC while playing from a phone like everyone else.';

const pct = (f) => `${Math.round(Number(f) * 100)}%`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function loadRulebookData() {
  const bal = readJSON('data/balance.json', {});
  const B = {}; for (const [g, keys] of Object.entries(bal)) if (!g.startsWith('_')) { B[g] = {}; for (const [k, d] of Object.entries(keys)) B[g][k] = d.v; }
  return { B, classes: readJSON('data/classes.json'), items: readJSON('data/items36.json'), boots: readJSON('data/boots.json'), tiles: readJSON('data/tiles.json'), challenges: readJSON('data/challenges.json'), legendaries: readJSON('data/legendaries.json'), sets: readJSON('data/sets.json'), pets: readJSON('data/pets.json'), wheels: readJSON('data/wheels.json'), regions: readJSON('data/regions.json') };
}

// ── Sections as blocks ─────────────────────────────────────────────
export function buildSections(d = loadRulebookData()) {
  const { B } = d, S = [];
  const section = (id, title) => {
    const s = { id, title, blocks: [] }; S.push(s);
    const api = { p: (t) => (s.blocks.push({ type: 'p', text: t }), api), list: (items) => (s.blocks.push({ type: 'list', items }), api), table: (columns, rows) => (s.blocks.push({ type: 'table', columns, rows: rows.map(r => r.map(c => String(c ?? ''))) }), api) };
    return api;
  };
  const g = (grp, key, dflt = '?') => B[grp]?.[key] ?? dflt;

  section('concept', 'The game in one paragraph').p(CONCEPT)
    .p(`Everything is a run: the GM creates a room, the TV shows the map, a QR code and a four-letter room code, every phone joins, and you make or pick a character. Up to ${g('table', 'maxPlayers')} players; the map is tuned for ${g('table', 'tunedMin')} to ${g('table', 'tunedMax')} and a Regular run aims at about ${g('table', 'targetRunMinutes')} minutes.`);

  section('turn', 'Your turn')
    .list([
      'Your phone buzzes. Roll, spin or draw as your boots decide, then step hex to hex, up to your roll, choosing a direction each step; you may stop early unless the boots say otherwise.',
      'Only the hex you end on resolves. Walking into a monster stops you; a gated bridge needs its level, key or toll; void hexes (water, chasm, wall) are impassable.',
      'Action phase: one attack and one spell per combat turn, plus shop, bag, trades and letters. Then end your turn.',
      `Chess clock: ${mmss(g('clock', 'perTurnSeconds'))} is added at the start of your turn, unused time banks up to ${mmss(g('clock', 'bankCapSeconds'))}, and at zero the turn ends where it stands. Each Nerve point above ${g('stats', 'neutral')} adds ${g('health', 'nerveClockSeconds', 0)} s. The clock warning sounds with ${g('clock', 'warningSeconds')} s left.`,
      `A phone silent for ${g('table', 'proxyAfterSeconds')} s hands its prompts to the GM console; you pick the turn back up on reconnect.`,
    ]);

  if (d.classes?.classes) {
    const cls = d.classes.classes;
    section('classes', 'Classes')
      .p(`Six classes, each with a passive, an active on a cooldown counted in your own turns, and upgrades at levels 5, 10, 15 and 20. Each class starts with +${g('stats', 'classBonus')} in its stat and its own Common starting weapon on top of the shared starter kit${d.classes.starterKit ? ` (${d.classes.starterKit.map(id => d.items?.items?.find(i => i.id === id)?.name || id).join(', ')} and ${g('items', 'starterPotions', 2)} Potions)` : ''}.`)
      .table(['Class', 'Plays like', 'Stat', 'Passive', 'Active [cooldown]', 'Upgrades 5 / 10 / 15 / 20', 'Starting weapon'],
        cls.map(c => [c.name, c.playsLike, cap(c.stat), c.passive?.text, `${c.active?.name}: ${c.active?.text} [${g('classes', c.active?.cooldownKey, '?')}]`, (c.upgrades || []).map(u => u.text).join(' / '), d.items?.items?.find(i => i.id === c.startWeapon)?.name || c.startWeapon]));
  }

  section('stats', 'Stats, XP and levels')
    .p(`Four stats, ${g('stats', 'min')} to ${g('stats', 'max')}: Luck (reroll odds, loot rarity), Nerve (shot clock seconds, one free re-stake per night), Greed (damage multiplier on win streaks, but Blood Pact interest +${pct(g('bloodPact', 'greedInterestPerPoint'))} a point), Grit (damage taken reduced ${pct(g('health', 'gritReducePerPoint', 0.03))} per point, cheaper revives). Every game has a governing stat: each point above ${g('stats', 'neutral')} improves its odds the way the item table says, each point below worsens them.`)
    .p(`XP: ${g('xp', 'turn')} for a turn, ${g('xp', 'hit')} for a hit, ${g('xp', 'crit')} for a crit, ${g('xp', 'ko')} for a KO, ${g('xp', 'petWin')} for a pet battle, ${g('xp', 'quest')} for a quest, ${g('xp', 'boss')} for a boss. Level cap ${g('xp', 'levelCap', 20)}; every level gives one stat point and +${g('health', 'maxPerLevel')} max Health (${g('health', 'maxAtLevel1')} at level 1). A veteran keeps its level.`)
    .p(`Creation is a gamble: every stat starts at ${g('stats', 'creationStart')}, you hold ${g('creation', 'chips')} Stat Chips, stake ${g('creation', 'minStake')} to ${g('creation', 'maxStake')} on any starter game per stat, and a win pays chips × the multiplier into that stat (cap ${g('stats', 'creationCap')} at creation). Unspent chips become +1 each when you lock in. Once per creation you may stake max Health (${g('creation', 'bloodHealthPerChip')} Health = 1 chip, up to ${g('creation', 'bloodMax', 3)} chips). The creation clock is ${mmss(g('creation', 'clockSeconds'))}; anyone unlocked at zero gets the safe allocation.`);

  if (d.items?.items) {
    const st = (r) => g('items', 'stake' + cap(r)), bn = (r) => g('items', 'bonus' + cap(r));
    section('items', 'The 36 weapons and spells')
      .p(`Every weapon or spell is one minigame. Using it: pick a target, stake its Health cost, play the game on your phone while the TV shows the stage. Win and the target takes stake × the game's payout as damage (spells heal, shield or steal instead); lose and the stake is gone; push, nothing. The game's top multiplier is a critical hit. Stakes by rarity: Common ${st('common')}, Rare ${st('rare')} (+${pct(bn('rare'))} damage), Epic ${st('epic')} (+${pct(bn('epic'))}), Legendary ${st('legendary')} (+${pct(bn('legendary'))}). Items have ${g('items', 'charges')} charges. You cannot use an item whose stake is more than your current Health.`)
      .p(`Kinds: Attack hits one target on your hex or an adjacent one (Long Arm reaches ${g('items', 'reachLongArm', 2)}). Spell targets yourself or an ally. Area makes every player on the hex stake at once in a ${g('items', 'areaWindowSeconds', 20)}-second window. Versus has both players stake; the loser takes the winner's stake as damage.`)
      .table(['Item', 'Minigame', 'Kind', 'Family', 'Stat', 'Lever'], d.items.items.map(i => [i.name, i.gameId, cap(i.kind), cap(i.family), cap(i.stat), i.lever]));
    section('consumables', 'Consumables').p(`Nudge for dice and wheel items, Reroll for card items, Fork for any binary outcome, Potion heals ${g('health', 'potionHeal', 25)}, Smoke Bomb ends an encounter, Phoenix Feather cancels one KO. Consumables stack ${g('grid', 'stack')} to a cell. Shop prices: Potion ${g('shop', 'potion')}, Nudge ${g('shop', 'nudge')}, Reroll ${g('shop', 'reroll')}, Fork ${g('shop', 'fork')}, Smoke Bomb ${g('shop', 'smokeBomb')}, Phoenix Feather ${g('shop', 'phoenixFeather')} Gold; the Shop buys back at ${pct(g('gold', 'shopSellFraction'))}.`);
  }

  section('grid', 'Inventory: the cage and the paper doll')
    .p(`Fifteen worn slots around the crest: main hand, off hand, two spells, helmet, torso, pants, gloves, boots, four rings and a necklace (a cape slot opens only for the Infernal Mantle). Everything else sits in a ${g('grid', 'cols')} × ${g('grid', 'rows')} grid at level 1: items have footprints (rings, necklaces and consumables 1×1; gloves and boots 2×1; helmet and pants 2×2; torso 2×3; one-hand weapons and spells 1×3; two-hand Legendaries 2×4; eggs 2×2), rotate with a tap, and must sit on free cells. +1 row at levels ${(g('grid', 'rowLevels', [])).join(', ')}; Satchels add a column each up to ${g('grid', 'maxCols')}. Loot that does not fit stays on the hex for ${g('death', 'tileLootRounds')} round for anyone to take.`);

  if (d.boots?.bases) {
    const mv = B.movement || {};
    const sec = section('boots', 'Boots and movement')
      .p(`Your boots decide how you move. Barefoot you plod ${mv.barefoot} hexes. Dice boots roll their die for movement points; Wheel boots spin the movement wheel; Card boots draw a colour card and move you to the nearest hex of that colour within ${mv.cardRange} hexes (ties: you choose; a double takes you to the second-nearest; no match in range, step ${mv.cardNoMatchStep}). Only a player wearing Card boots sees the secret hex colours, on their own phone. Swapping boots mid-turn costs the turn's move.`)
      .table(['Boots', 'Mode', 'Die', 'Stopping early', 'Rarity floor'], d.boots.bases.map(b => [b.name, cap(b.mode), b.die ? `d${b.die}` : '—', { any: 'Whenever you like', half: 'After half the roll', never: 'Never: walk it all' }[b.stop] || b.stop, cap(b.rarityFloor || 'common')]));
    if (d.boots.wheel?.segments) sec.p(`Movement wheel: ${d.boots.wheel.segments.map(s => s.stepsKey ? `${s.label} (${mv[s.stepsKey]})` : s.label).join(', ')}.`);
    if (d.boots.uniques) sec.p(`Legendary boots roll one unique: ${Object.values(d.boots.uniques).map(u => u.name).join('; ')}.`);
  }

  if (d.tiles?.tiles) {
    const land = Object.entries(d.tiles.tiles).filter(([, t]) => t.resolves && !t.void);
    section('tiles', 'What each hex does')
      .table(['Hex', 'What happens', 'Who acts on the phone'], land.map(([, t]) => [t.name, t.text, t.acts]))
      .p(`Inn heal: ${g('health', 'innHeal')}, once per visit. Void hexes (${Object.values(d.tiles.tiles).filter(t => t.void).map(t => t.name).join(', ')}) are never entered.`);
  }

  if (d.regions?.regions) section('map', 'Regions').table(['Region', 'Tier', 'Loot leans to', 'Modifier'], d.regions.regions.map(r => [r.name, r.tier, cap(r.family), r.modifier?.text]));

  section('health', 'Health, death and Blood Pacts')
    .p(`Health is what you stake, lose and deal. It starts from the Buy-in Wheel (${g('health', 'buyinMin')} to ${g('health', 'buyinMax')}) or a flat ${g('health', 'flatStart')}, and comes back only through healing: potions, the Mend and Briefcase spells, the Inn. Your exact Health is hidden: the TV and other phones show only your third (over ${pct(g('health', 'tellHigh', 0.66))}, ${pct(g('health', 'tellLow', 0.33))} to ${pct(g('health', 'tellHigh', 0.66))}, under ${pct(g('health', 'tellLow', 0.33))}) through the lantern on your sprite.`)
    .p(`Death: a fight with a monster is to the death. Dying to a monster drops everything in your grid plus ${g('death', 'wornDropsOnMonsterDeath')} random worn item on the hex, you miss ${g('death', 'monsterMissTurns')} turn and wake at the Graveyard at ${pct(g('death', 'wakeFraction'))} Health. Dying to a player or a boss: the same drops, but the winner chooses which worn item to take, you miss ${g('death', 'playerMissTurns')} turns and lose ${g('death', 'playerKillLevelLoss')} level. A Phoenix Feather used before the killing blow cancels death; in PvE and Teams a teammate can revive you early at the Graveyard with one.`)
    .p(`Blood Pact: borrow up to ${g('bloodPact', 'max')} Health at the Blood Bank, repay with ${pct(g('bloodPact', 'interest'))} interest within ${g('bloodPact', 'dueTurns')} of your turns or the Collector takes ${g('bloodPact', 'collectorPerTurn')} Health a turn until it is settled. At most ${g('bloodPact', 'maxPacts')} pacts open at once.`)
    .p(`Gold is never bet: it comes from loot, quests and KOs (${g('gold', 'perKO')} per KO, paid by the bank) and is spent in the Shop. Free-for-all tiebreak score = Gold + ${g('gold', 'scorePerKill')} per kill + Health remaining.`);

  {
    const sec = section('challenge', 'PvP: the Challenge Wheel')
      .p(`Players never roll against each other; they play each other. Attacking a player in reach spins the Challenge Wheel, which lands on a competitive game the two must play, on the phones or at the table. The winner lands one hit worth their weapon (stake × multiplier, no roll; a flawless win is a crit); afterwards either player may simply move out of reach on their own turn. Time caps: hosted ${mmss(g('challenge', 'hostedCapSeconds'))}, external ${mmss(g('challenge', 'externalCapSeconds'))}; if the timer runs out with no result both take ${g('challenge', 'timeoutDamage')}. The same entry cannot come up twice in one fight once the list has ${g('challenge', 'noRepeatMinEntries')} or more enabled entries. The table does not wait: the two players' clocks pause and their turns are held until the game reports or the GM presses Drop Back In.`)
      .table(['Call', 'What is staked', 'If the attacker wins', 'If the attacker loses', "Target's say"], [
        ['Duel', 'Health', "One hit for the attacker's weapon", "One hit for the defender's weapon", 'None; being in reach is enough'],
        ['Wager', "Gold, equal from both (attacker names it, up to the poorer player's Gold)", 'Takes the pot', 'Loses the pot', 'Must accept; a declined Wager costs nothing'],
        ['Robbery', `Gold, attacker names up to ${pct(g('gold', 'robberyMaxFraction'))} of the target's Gold`, 'Takes it', `Pays the target the same amount and is Wanted for ${g('gold', 'wantedTurns')} turns`, 'None; it is a robbery'],
      ]);
    if (d.challenges?.presets) {
      for (const [, p] of Object.entries(d.challenges.presets)) {
        const on = (p.entries || []).filter(e => e.enabled !== false);
        sec.table([`${p.name}: entry`, 'Where', 'Rules', 'Cap', 'Weight'], on.map(e => [e.name, e.hosted ? 'Phones' : 'Table / Discord', e.rules || '', e.capSeconds ? mmss(e.capSeconds) : (e.hosted ? mmss(g('challenge', 'hostedCapSeconds')) : mmss(g('challenge', 'externalCapSeconds'))), e.weight ?? 1]));
      }
    }
  }

  if (d.wheels) {
    const sec = section('wheels', 'Wheels').p('You tap spin on your phone; the TV animates it. Buy-in sets starting Health, Fortune (Wheel hexes) gives Health, Gold or an item, Fate (Event hexes) is a windfall, teleport, swap, free item, lost turn or a bounty on you, Loot (Chest hexes) is weighted by region, Chaos escalates, Boss picks the boss\'s mood.');
    for (const [id, segs] of Object.entries(d.wheels)) {
      if (id.startsWith('_') || !Array.isArray(segs) || !segs.length) continue;
      const total = segs.reduce((n, s) => n + (Number(s.weight) || 0), 0) || 1;
      sec.table([`${cap(id)} wheel`, 'Chance', 'What happens'], segs.map(s => [s.label, pct(((Number(s.weight) || 0) / total).toFixed(3)), (s.text || '').replace(/\b(\w+)\.(\w+)\b/g, (m, grp, key) => B[grp]?.[key] !== undefined ? String(B[grp][key]) : m)]));
    }
    sec.p(`Chaos tiers multiply damage ${(g('chaos', 'tierDamageMult', [])).map(x => `×${x}`).join(', ')}; the tier rises every ${g('chaos', 'tierUpEveryRounds')} rounds up to tier ${g('chaos', 'maxTier')}.`);
  }

  if (d.legendaries?.legendaries) section('legendaries', 'Named Legendaries')
    .p(`Legendaries are never rolled: each is a hand-written item with a unique sprite and a mechanic that winks at another game. They show up at most once per run, from bosses, Citadel chests and the deepest tier (${g('runs', 'legendaryTier')}), and they are what people vault.`)
    .table(['Legendary', 'Slot', 'Nods to', 'What it does'], d.legendaries.legendaries.map(l => [l.name, cap(l.slot) + (l.footprint ? ` ${l.footprint.w}×${l.footprint.h}` : ''), l.nodsTo || '', l.text]));

  if (d.sets?.sets) section('sets', 'Blockcraft armour sets')
    .p('The one set line in the game: five four-piece sets (helmet, torso, pants, boots). Pieces drop singly from Chests; wearing all four gives the bonus.')
    .table(['Set', 'Rarity', 'Per piece', 'Four-piece bonus', 'Flavour'], d.sets.sets.map(s => [s.name, cap(s.rarity), [...(s.perPiece || []).map(p => p.text), s.crumbles?.text, s.note?.text].filter(Boolean).join('; '), s.bonus?.text || '', s.flavour]));

  if (d.pets?.species) section('pets', 'Pets')
    .p(`Every pet has ${g('pets', 'attacks')} attacks, each a minigame roll with its own stake paid from the pet's Power (${g('pets', 'startPower')} at hatch, +${g('pets', 'powerPerStage')} per stage, +${g('pets', 'sessionPowerBonus')} at the start of every run). You carry up to ${g('pets', 'teamMax')} (Beastmaster ${g('pets', 'beastmasterTeamMax')}). Every hatch is the Triple Pet Wheel: common, region and rare pools; keep one of the three. Pets fight first: your active pet takes the hits until it faints, and a fainted pet stays down for the run unless revived. Pets never die for good.`)
    .table(['Species', 'Element', 'Pool', 'Stages', 'Attacks'], d.pets.species.map(p => [p.name, p.element, cap(p.pool || ''), (p.stages || []).map(s => s.name).join(' → '), (p.attacks || []).map(a => `${a.name} (${a.gameId}, ${a.stake})`).join(', ')]));

  section('social', 'Letters, alliances and votes')
    .p(`Letters work like post: as many as you like on your own turn, ${g('social', 'lettersOffTurn')} while it is not, each delivered after ${g('social', 'letterDelayTurns')} of the recipient's turns. A player standing on the courier hex, or wearing a Spyglass, reads a letter in transit first and may pass it, destroy it or (Trickster) forge the reply. Alliances are proposed and accepted by letter; allies are never hit by each other's Area items. The table may vote ${g('social', 'tableVotesPerNight')} time a night to send someone to the Graveyard.`);

  section('end', 'How a run ends')
    .p(`Free-for-all ends when the throne is reached or one player is left; PvP when one player is left; PvE when the final boss dies or every player does; Teams when one team stands or the final boss dies. Then the recap, and the vault: survivors bank ${g('grid', 'vaultSurvivor')} items, the dead ${g('grid', 'vaultDead', 1)}, and survivors may save their character as a veteran. A dead character's name goes on the Wall of Names forever. ${g('runs', 'tiers')} difficulty tiers, each unlocked by clearing the one before; a season is ${g('runs', 'seasonNights')} nights.`);

  return S;
}

// ── Renderers ──────────────────────────────────────────────────────
export function renderMarkdown(sections) {
  const out = ['# Rulebook', '', 'Generated from `data/*.json` and `data/balance.json` by `tools/build-rulebook.mjs`; do not edit by hand. The phone\'s rules sheet renders the same sections from `data/rulebook.generated.json`.', ''];
  out.push('Contents: ' + sections.map(s => `[${s.title}](#${s.id})`).join(' · '), '');
  for (const s of sections) {
    out.push(`## ${s.title} <a id="${s.id}"></a>`, '');
    for (const b of s.blocks) {
      if (b.type === 'p') out.push(b.text, '');
      else if (b.type === 'list') { for (const it of b.items) out.push(`- ${it}`); out.push(''); }
      else if (b.type === 'table') { out.push(`| ${b.columns.map(esc).join(' | ')} |`, `| ${b.columns.map(() => '---').join(' | ')} |`); for (const r of b.rows) out.push(`| ${r.map(esc).join(' | ')} |`); out.push(''); }
    }
  }
  return out.join('\n');
}

export function build(d = loadRulebookData()) {
  const sections = buildSections(d);
  const json = JSON.stringify({ _about: 'Generated by tools/build-rulebook.mjs. Sections of the rulebook as blocks (p | list | table) for the phone rules sheet and the GM guide. Do not edit.', sections }, null, 1) + '\n';
  return { md: renderMarkdown(sections), json, sections };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { md, json } = build();
  for (const [rel, text] of [[MD_PATH, md], [JSON_PATH, json]]) { const abs = path.join(ROOT, rel); if (!existsSync(abs) || readFileSync(abs, 'utf8') !== text) { writeFileSync(abs, text); console.log(`wrote ${rel}`); } else console.log(`${rel} unchanged`); }
}
