// GM panel: Monsters. Every monster on the map (region, hex, Health, items, boss / raid / final, dead), Take over
// (GM_TAKEOVER), and the open fight: when the GM controls the monster whose turn it is, the console plays its
// item like a phone would (startRound with the monster as attacker, the adapter's controls and stage) and appends
// MONSTER_ACT with gmPick; "Let it fight itself" plays the turn headlessly through playMonsterTurn. Spawn (GM_SPAWN)
// and teleport helpers at the bottom. Receives { state, session, ctx, h, gm, main }.
import { playMonsterTurn } from '../../../packages/shared/handlers/fight.js';
import { startRound } from '../../../packages/games/adapter.js';
import { makeRng, hash32 } from '../../../packages/shared/rng.js';
import { group } from '../../../packages/shared/balance.js';
import { characterOf, currentPlayerId } from '../../../packages/shared/state.js';
import { mountRound, ensureStageCss } from '../../../packages/ui/labkit.js';
import { toast } from '../../../packages/ui/dom.js';
import monstersData from '../../../data/monsters.json' with { type: 'json' };

// The round the GM is playing survives re-renders (the console redraws on every event).
let live = null;   // { fightId, exchange, round, stageEl, controlsEl, handle }
let rerender = () => {};
const roleOf = (m) => (m.final ? 'FINAL' : m.raid ? 'RAID' : m.boss ? 'BOSS' : m.blocker ? 'blocker' : m.dummy ? 'dummy' : 'common');
const regionName = (state, id) => state.map?.regions?.[id]?.name || id || '—';

export function panelMonsters(args) {
  const { state, h, gm, main } = args;
  ensureStageCss();
  rerender = () => { main.replaceChildren(); panelMonsters({ ...args, state: args.session?.state || state }); };
  main.append(fightCard({ state, h, gm }), monsterTable({ state, h, gm }), spawnCard({ state, h, gm }));
}

// ── the open fight ───────────────────────────────────────────────────────────────────────────────
function fightCard({ state, h, gm }) {
  const f = state.fight;
  if (!f || f.done) { if (live) { live.handle?.stop(); live = null; } return h('div', { class: 'panel' }, h('h2', {}, 'Open fight'), h('p', { class: 'muted' }, f ? `The last fight is over (${f.result}). The phone ends it.` : 'No fight is open. Monsters run themselves from the TV; take one over below to play its turns from here.')); }
  const m = state.monsters[f.monsterId], c = characterOf(state, f.playerId), pname = state.players[f.playerId]?.name || f.playerId;
  const box = h('div', { class: `panel ${m?.gmControlled ? 'gold' : ''} col` },
    h('div', { class: 'row between' }, h('h2', {}, `Open fight — ${f.kind}`), h('span', { class: `pill ${f.turn === 'monster' ? 'gold' : ''}` }, f.turn === 'monster' ? "monster's turn" : `${pname}'s turn`)),
    h('p', {}, h('b', {}, c?.name || pname), ` (${c?.health ?? '?'}/${c?.maxHealth ?? '?'} HP) vs `, h('b', {}, m?.name || f.monsterId), ` (${m?.health ?? '?'}/${m?.maxHealth ?? '?'} HP${m?.mood ? `, ${m.mood.name}` : ''})`, ` · exchanges ${f.exchanges || 0}${f.passed ? ' · the player has ended their turn' : ''}${f.calledOut ? ' · Called Out' : ''}`),
    f.log?.length ? h('div', { class: 'log log-box', style: { maxHeight: '120px' } }, f.log.slice(-6).reverse().map(l => h('div', {}, `${l.by === m?.id ? m.name : c?.name || 'player'}: ${l.gameId} ${l.mult}× ${l.label}${l.damage ? ` → ${l.damage} dmg` : ''}${l.loss ? ` (loses ${l.loss})` : ''}${l.crit ? ' CRIT' : ''}${l.gmPick ? ' · GM played' : ''}`))) : null);
  if (!m || m.dead) { box.append(h('p', { class: 'muted' }, 'The monster is gone.')); return box; }
  if (f.turn !== 'monster') {
    if (live) { live.handle?.stop(); live = null; }
    box.append(h('p', { class: 'muted' }, `Waiting on ${pname}'s phone. ${m.gmControlled ? 'You control this monster: its next turn is played from here.' : 'The TV plays this monster; take it over to play its next turn yourself.'}`),
      h('div', { class: 'gm-bar' }, h('button', { class: m.gmControlled ? 'primary' : '', onClick: () => gm('GM_TAKEOVER', { monsterId: m.id, on: !m.gmControlled }) }, m.gmControlled ? 'Release the monster' : 'Take over'), h('button', { class: 'danger', onClick: () => { if (confirm('End this fight now? Nobody wins it.')) gm('FIGHT_END', { reason: 'gm' }); } }, 'End fight')));
    return box;
  }
  // The monster's turn.
  const items = (m.items || []).filter(it => it && it.gameId && it.kind !== 'spell' && it.kind !== 'area');
  const I = group(state, 'items');
  const headless = async () => {
    const seed = hash32(`${state.seed}:${f.id}:${f.exchanges || 0}:${Date.now()}`);
    const res = playMonsterTurn(state, { now: Date.now(), B: (g) => group(state, g) }, makeRng(seed), { now: Date.now() });
    if (!res) return toast('The monster has nothing to fight with', 'bad');
    if (await gm('MONSTER_ACT', { itemId: res.itemId, mult: res.mult, label: res.label, crit: !!res.crit, stake: res.stake, snapshot: res.snapshot || null, rigUsed: res.rigUsed, gmPick: false })) toast(`${m.name}: ${res.label}`);
  };
  box.append(h('div', { class: 'gm-bar' },
    h('button', { class: m.gmControlled ? 'primary' : '', onClick: () => gm('GM_TAKEOVER', { monsterId: m.id, on: !m.gmControlled }) }, m.gmControlled ? 'You control it — release' : 'Take over'),
    h('button', { onClick: headless }, '🎲 Let it fight itself'),
    h('button', { class: 'danger', onClick: () => { if (confirm('End this fight now?')) gm('FIGHT_END', { reason: 'gm' }); } }, 'End fight')));
  if (!m.gmControlled) { box.append(h('p', { class: 'muted' }, 'Take over to pick its item and play the round from the console. Until then the TV plays it.')); return box; }
  if (live && (live.fightId !== f.id || live.exchange !== (f.exchanges || 0))) { live.handle?.stop(); live = null; }
  if (!live) {
    box.append(h('h3', {}, `${m.name}'s items — pick one`), h('div', { class: 'row' }, items.length ? items.map(it => h('button', { class: 'primary', onClick: () => startMonsterRound(state, f, m, c, it, I, gm) }, `${it.name}`, h('span', { class: 'muted' }, ` · ${it.gameId} · stake ${Math.max(1, Math.min(m.health, Math.round(it.stake * I.monsterStakeFraction)))}`))) : h('span', { class: 'muted' }, 'No usable items')));
    return box;
  }
  box.append(h('p', {}, h('b', {}, live.round.item.name), ` · stake ${live.round.stake} · ${live.round.gameId}`, h('span', { class: 'muted' }, ' — the result is sent as MONSTER_ACT when the round settles')),
    live.stageEl, live.controlsEl,
    h('div', { class: 'gm-bar' }, h('button', { class: 'ghost', onClick: () => { live.handle?.stop(); live = null; gm('GM_TAKEOVER', { monsterId: m.id, on: true }); } }, 'Abandon this round')));
  return box;
}
function startMonsterRound(state, f, m, c, item, I, gm) {
  const now = Date.now();
  const stake = Math.max(1, Math.min(m.health, Math.round(item.stake * I.monsterStakeFraction)));
  const rng = makeRng(hash32(`${state.seed}:${f.id}:${f.exchanges || 0}:${item.id}:${now}`));
  const round = startRound({ B: (g) => group(state, g) }, { item, mode: 'health', stake, attacker: { id: m.id, name: m.name, stats: m.stats || {} }, target: { id: c.id, name: c.name, stats: c.stats || {} }, rng, now, rig: f.rig && f.rig.forId === m.id ? f.rig : null });
  const stageEl = document.createElement('div'), controlsEl = document.createElement('div');
  live = { fightId: f.id, exchange: f.exchanges || 0, round, stageEl, controlsEl, handle: null };
  live.handle = mountRound({ round, stageEl, controlsEl, autoSettle: true, onSettle: async (o) => {
    const ok = await gm('MONSTER_ACT', { itemId: item.id, mult: o.mult, label: o.label, crit: !!o.crit, stake, snapshot: round.snapshot(), rigUsed: round.rigUsed, gmPick: true });
    if (ok) toast(`${m.name}: ${o.label}`); live = null;
  } });
  rerender();   // the stage lands in the fight card
}

// ── every monster ────────────────────────────────────────────────────────────────────────────────
function monsterTable({ state, h, gm }) {
  const all = Object.values(state.monsters || {});
  const seats = state.seats.map(id => state.players[id]).filter(p => p && !p.kicked && !p.spectator);
  const order = (m) => (m.dead ? 3 : m.final ? 0 : m.raid || m.boss ? 1 : 2);
  const rows = all.sort((a, b) => order(a) - order(b) || String(a.regionId).localeCompare(String(b.regionId))).map(m => {
    const who = h('select', { style: { maxWidth: '140px', minHeight: '36px', padding: '4px' } }, seats.map(p => h('option', { value: p.id, selected: p.id === currentPlayerId(state) }, p.name)));
    return h('tr', { style: m.dead ? { opacity: .45 } : m.gmControlled ? { background: 'rgba(201,164,92,.08)' } : null },
      h('td', {}, h('b', {}, m.name), h('div', { class: 'muted' }, `${m.speciesId}${m.mood ? ` · ${m.mood.name}` : ''}${m.special ? ` · ${m.special}` : ''}`)),
      h('td', {}, h('span', { class: `pill ${m.final || m.raid || m.boss ? 'gold' : ''}` }, roleOf(m))),
      h('td', {}, regionName(state, m.regionId), h('div', { class: 'mono muted' }, m.pos || '—')),
      h('td', {}, m.dead ? 'dead' : `${m.health}/${m.maxHealth}`, m.parts ? h('div', { class: 'muted' }, m.parts.map(p => `${p.name || p.id}: ${p.dead ? '✕' : p.health}`).join(' · ')) : null),
      h('td', { class: 'muted' }, (m.items || []).map(it => `${it.name} (${it.rarity[0].toUpperCase()}, ${it.stake})`).join(', ') || '—'),
      h('td', { class: 'row' },
        m.dead ? null : h('button', { class: m.gmControlled ? 'primary' : '', onClick: () => gm('GM_TAKEOVER', { monsterId: m.id, on: !m.gmControlled }) }, m.gmControlled ? 'Taken over' : 'Take over'),
        m.dead || !m.pos ? null : who, m.dead || !m.pos ? null : h('button', { title: 'Teleport that player onto this monster\'s hex', onClick: () => gm('GM_TELEPORT', { playerId: who.value, hex: m.pos }) }, 'Bring player here'),
        m.boss && !m.dead && !m.mood ? h('button', { title: 'Spin the Boss Wheel for its mood', onClick: () => gm('WHEEL_SPIN', { wheel: 'boss', monsterId: m.id, playerId: currentPlayerId(state) }) }, 'Mood') : null));
  });
  const alive = all.filter(m => !m.dead).length;
  return h('div', { class: 'panel' }, h('h2', {}, `Monsters — ${alive} standing of ${all.length}`), h('p', { class: 'muted' }, 'Taking a monster over only changes who plays its turns (you, from the fight card above); its Health, items and loot stay as rolled.'),
    all.length ? h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'gm' }, h('thead', {}, h('tr', {}, ['Monster', 'Role', 'Region · hex', 'Health', 'Items', ''].map(x => h('th', {}, x)))), h('tbody', {}, rows))) : h('p', { class: 'muted' }, 'Monsters are rolled when the run starts.'));
}

// ── spawn and teleport helpers ───────────────────────────────────────────────────────────────────
function spawnCard({ state, h, gm }) {
  const species = monstersData.species;
  const sel = h('select', {}, species.map(s => h('option', { value: s.id }, `${s.name} — ${s.role}, ${s.regionId || 'anywhere'}, tier ${s.tier}`)));
  const mover = characterOf(state, currentPlayerId(state));
  const hex = h('input', { placeholder: 'hex key q,r', value: mover?.pos || '', style: { maxWidth: '140px' } });
  const name = h('input', { placeholder: 'name (optional)', style: { maxWidth: '200px' } });
  const ctl = h('input', { type: 'checkbox' });
  const seats = state.seats.map(id => state.players[id]).filter(p => p && !p.kicked && !p.spectator);
  const who = h('select', {}, seats.map(p => h('option', { value: p.id }, p.name)));
  const toHex = h('input', { placeholder: 'hex key q,r', style: { maxWidth: '140px' } });
  const hexes = Object.values(state.map?.hexes || {}).filter(x => !x.void);
  const quick = h('select', { onChange: (e) => { toHex.value = e.target.value; } }, h('option', { value: '' }, 'landmarks…'), hexes.filter(x => ['start', 'throne', 'inn', 'shop', 'arena', 'bossgate', 'portal', 'courier', 'chaos'].includes(x.type)).slice(0, 60).map(x => h('option', { value: x.key }, `${x.type} ${x.key} (${regionName(state, x.regionId)})`)));
  return h('div', { class: 'grid2' },
    h('div', { class: 'panel' }, h('h3', {}, 'Spawn a monster'), h('p', { class: 'muted' }, 'Any species on any standable hex; a boss species comes with its moods table. Tick "GM-controlled" to play it yourself from the start.'),
      h('div', { class: 'col' }, sel, h('div', { class: 'row' }, hex, name, h('label', { class: 'row' }, ctl, ' GM-controlled')), h('button', { class: 'primary', onClick: () => { if (!hex.value.trim()) return toast('Name a hex', 'bad'); gm('GM_SPAWN', { speciesId: sel.value, hex: hex.value.trim(), name: name.value.trim() || undefined, gmControlled: ctl.checked }); } }, 'Spawn'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Teleport a player'), h('p', { class: 'muted' }, 'Drop a player on any standable hex: next to a monster to force an encounter, back to the Inn, onto the throne. The hex does not resolve until they move.'),
      h('div', { class: 'col' }, h('div', { class: 'row' }, who, toHex, quick), h('button', { class: 'primary', onClick: () => { if (!toHex.value.trim()) return toast('Name a hex', 'bad'); gm('GM_TELEPORT', { playerId: who.value, hex: toHex.value.trim() }); } }, 'Teleport'))));
}
