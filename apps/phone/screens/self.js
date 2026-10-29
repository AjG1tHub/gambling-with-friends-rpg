// Phone tab: Self. The sprite large, name / class / level / XP, the four stats and pending points, the class kit,
// effects, pacts, Wanted, quests, the Mirror (look edits between turns), the claim code and recovery, the Wall of
// Names, the rules, and at the end of the run the save-back to the roster with the vault / veteran result.
import { spriteElement } from '../../../packages/ui/sprite.js';
import { ensureRoster, saveBack, claimPanel, wallPanel, rulesDrawer, lookEditor, rosterUi } from '../../../packages/ui/roster.js';
import { onRerender, rerenderSoon, itemIcon } from '../../../packages/ui/grid.js';
import { characterOf, currentPlayerId } from '../../../packages/shared/state.js';
import { group } from '../../../packages/shared/balance.js';
import { STAT_IDS, classDef, xpToNext, effectiveStats } from '../../../packages/shared/characters/character.js';
import { gamesForStat } from '../../../packages/games/lever-view.js';
import { gameById } from '../../../packages/shared/characters/generator.js';
import { openPacts } from '../../../packages/shared/handlers/economy.js';
import { cooldownKeyFor } from '../../../packages/shared/handlers/classes.js';
import { store, toast } from '../../../packages/ui/dom.js';
import { hasHandler } from '../../../packages/shared/reducer.js';

const STAT_TEXT = { luck: 'reroll odds, loot rarity', nerve: 'shot-clock seconds, one free re-stake a night', greed: 'streak damage, dearer pacts', grit: '−3% damage taken a point, cheaper revives' };
const selfUi = { mirror: false, look: null, crest: null, saveResult: null, saving: false, rosterKicked: false };
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

export function tabSelf(args) {
  const { state, session, me, c, myTurn, ctx, h, dispatch, screen } = args;
  onRerender(() => { if (!screen.isConnected) return; screen.replaceChildren(); const s = session?.state || state; tabSelf({ ...args, state: s, c: characterOf(s, me.id) || c, myTurn: s.phase === 'playing' && currentPlayerId(s) === me.id }); });
  // Roster: load / claim / sync on first sight (idempotent; main.js may already have done it at join).
  if (ctx?.backend && !rosterUi.owner && !selfUi.rosterKicked) { selfUi.rosterKicked = true; ensureRoster(session, ctx.backend, me.id).then(() => rerenderSoon()).catch(e => { console.warn(e); rerenderSoon(); }); }
  const X = safeGroup(state, 'xp'), S = safeGroup(state, 'stats');

  if (!c) {
    screen.append(h('div', { class: 'hero' }, h('div', { class: 'crest' }, me.crest || '🂠'), h('h2', {}, me.name), h('p', { class: 'muted ital' }, me.spectator ? 'You are watching tonight.' : state.phase === 'lobby' ? 'Your character is made when creation opens.' : 'No character on this seat yet.')),
      claimPanel({ session, backend: ctx?.backend, playerId: me.id, onChange: () => rerenderSoon() }), wallPanel({ backend: ctx?.backend, state }), rulesDrawer());
    return;
  }
  const def = classDef(c.classId); const eff = safeEffective(state, c);
  const need = xpToNext(c.level, X); const atCap = c.level >= X.levelCap; const xpPct = atCap ? 100 : Math.min(100, Math.round((c.xp / need) * 100));
  const hp = c.maxHealth ? Math.round((c.health / c.maxHealth) * 100) : 0;

  // ── hero ──
  screen.append(h('div', { class: 'self-hero' },
    h('div', { class: 'self-sprite' }, spriteElement(c, { scale: 3, pets: true, className: 'sprite self-canvas' })),
    h('div', { class: 'self-id' },
      h('div', { class: 'self-name' }, h('span', { class: 'self-crest' }, c.crest || '🂠'), ' ', c.name),
      h('div', { class: 'muted' }, `${def?.name || cap(c.classId)} · Level ${c.level}${c.veteran ? ' · Veteran' : ''}${c.dead ? ' · Dead' : ''}`),
      (c.titles || []).length ? h('div', { class: 'cage-titles' }, c.titles.map(t => h('span', { class: 'pill gold' }, t))) : null,
      h('div', { class: 'bar xp', title: 'XP' }, h('div', { class: 'fill', style: { width: `${xpPct}%` } }), h('span', { class: 'bar-text' }, atCap ? 'Level cap' : `${c.xp} / ${need} XP`)),
      h('div', { class: `bar hp ${hp > 66 ? 'high' : hp >= 33 ? 'mid' : 'low'}`, title: 'Health (only you see the number)' }, h('div', { class: 'fill', style: { width: `${Math.max(0, Math.min(100, hp))}%` } }), h('span', { class: 'bar-text' }, `${c.health} / ${c.maxHealth} Health${c.shield ? ` · ${c.shield} shield` : ''}`)),
      h('div', { class: 'muted small' }, `${c.gold ?? 0} Gold · ${c.bank ?? 0} banked${c.kills ? ` · ${c.kills} kill${c.kills === 1 ? '' : 's'}` : ''}${c.region ? ` · ${cap(c.region)}` : ''}`))));

  // ── stats ──
  const pts = c.statPoints || 0; const canSpend = hasHandler('CHAR_STAT_POINT');
  screen.append(h('div', { class: 'panel' }, h('div', { class: 'row between' }, h('h3', {}, 'Stats'), pts ? h('span', { class: 'pill gold' }, `${pts} point${pts === 1 ? '' : 's'} to spend`) : null),
    h('div', { class: 'stats' }, STAT_IDS.map(s => h('div', { class: 'stat' },
      h('div', { class: 'stat-head' }, h('span', { class: 'stat-name' }, cap(s)), h('span', { class: 'stat-val' }, eff[s], eff[s] !== c.stats[s] ? h('span', { class: 'muted small' }, ` (${c.stats[s]})`) : null)),
      h('div', { class: 'pips' }, Array.from({ length: S.max }, (_, i) => h('span', { class: `pip ${i < c.stats[s] ? 'on' : ''} ${i >= c.stats[s] && i < eff[s] ? 'bonus' : ''}` }))),
      h('div', { class: 'muted small ital' }, STAT_TEXT[s]),
      h('details', { class: 'stat-games' }, h('summary', { class: 'muted small' }, `${gamesForStat(s, eff[s]).length} games it bends · your edge`),
        h('div', { class: 'stat-games-list' }, gamesForStat(s, eff[s]).map(({ gameId, view }) => { const def = gameById(gameId); return h('div', { class: 'row between small' }, h('span', {}, def?.name || gameId), h('span', { class: `lever-delta ${view.deltaPts > 0 ? 'up' : view.deltaPts < 0 ? 'down' : ''}` }, `${view.deltaPts > 0 ? '+' : ''}${view.deltaPts}`), h('span', { class: 'muted' }, `${Math.round(view.yours.rtp * 100)}%`)); }))),
      pts && c.stats[s] < S.max && canSpend ? h('button', { class: 'mini primary', onClick: () => dispatch('CHAR_STAT_POINT', { stat: s }) }, `+1 ${cap(s)}`) : null))),
    pts && !canSpend ? h('p', { class: 'muted small ital' }, 'Spending points is not wired in this build yet; they are kept on the character.') : null));

  // ── class kit ──
  if (def) {
    const cdKey = cooldownKeyFor(c.classId); const CL = safeGroup(state, 'classes'); const cdLen = cdKey ? CL[cdKey] : null; const cd = c.cooldowns?.active || 0;
    screen.append(h('div', { class: 'panel' }, h('h3', {}, `${def.name} · ${def.playsLike || ''}`),
      h('div', { class: 'kit' },
        h('div', { class: 'kit-row' }, h('span', { class: 'k' }, 'Passive'), h('span', {}, def.passive?.text)),
        h('div', { class: 'kit-row' }, h('span', { class: 'k' }, 'Active'), h('span', {}, h('b', {}, def.active?.name), ` — ${def.active?.text}`, h('span', { class: `pill ${cd ? 'bad' : 'ok'}` }, cd ? `ready in ${cd} turn${cd === 1 ? '' : 's'}` : 'ready'), cdLen ? h('span', { class: 'muted small' }, ` cooldown ${cdLen}`) : null)),
        h('div', { class: 'kit-row' }, h('span', { class: 'k' }, 'Upgrades'), h('div', { class: 'col', style: { gap: '4px' } }, (def.upgrades || []).map(u => h('div', { class: `upg ${(c.upgrades || []).includes(u.id) ? 'on' : ''}` }, h('span', { class: 'pill' }, `Lv ${u.level}`), ' ', u.text))))),
      h('p', { class: 'muted small ital' }, 'Fire the active from the Play tab on your turn.')));
  }

  // ── status: effects, pacts, wanted ──
  const effects = c.effects || []; const pacts = safePacts(state, c);
  if (effects.length || pacts.length || c.wanted > 0 || c.missTurns > 0) {
    screen.append(h('div', { class: 'panel' }, h('h3', {}, 'Condition'),
      c.wanted > 0 ? h('div', { class: 'cond bad' }, h('b', {}, 'Wanted'), ` — ${c.wanted} turn${c.wanted === 1 ? '' : 's'} left; the bank will not pay you and the Enforcer hunts you.`) : null,
      c.missTurns > 0 ? h('div', { class: 'cond' }, h('b', {}, 'Out cold'), ` — you miss ${c.missTurns} more turn${c.missTurns === 1 ? '' : 's'}.`) : null,
      effects.map(e => h('div', { class: 'cond' }, h('b', {}, cap(e.id)), h('span', { class: 'muted' }, ` ${e.kind || ''}${e.turnsLeft > 0 ? ` · ${e.turnsLeft} turn${e.turnsLeft === 1 ? '' : 's'}` : e.turnsLeft === -1 ? ' · until used' : ''}`))),
      pacts.map(p => h('div', { class: 'cond blood' }, h('b', {}, 'Blood Pact'), ` — ${p.owed - (p.paid || 0)} Health owed of ${p.owed} (${p.principal} borrowed at ${Math.round((p.interest || 0) * 100)}%) · ${p.turnsLeft} turn${p.turnsLeft === 1 ? '' : 's'} to repay at a Blood Bank`))));
  }

  // ── quests ──
  const pub = state.quests?.public || [], mine = state.quests?.personal?.[me.id] || [];
  if (pub.length || mine.length) {
    const q = (x, secret) => h('div', { class: `quest ${x.status === 'done' ? 'done' : ''}` }, h('div', { class: 'row between' }, h('b', {}, x.title), h('span', { class: `pill ${x.status === 'done' ? 'ok' : secret ? 'gold' : ''}` }, x.status === 'done' ? (x.doneBy === me.id ? 'done · yours' : `done · ${state.players[x.doneBy]?.name || 'someone'}`) : x.takenBy ? (x.takenBy === me.id ? 'yours' : `taken · ${state.players[x.takenBy]?.name || ''}`) : secret ? 'secret' : 'open')), h('div', { class: 'muted small' }, x.text));
    screen.append(h('div', { class: 'panel' }, h('h3', {}, 'Quests'),
      mine.length ? h('div', { class: 'col' }, h('div', { class: 'tag' }, 'Yours alone — nobody else sees these'), mine.map(x => q(x, true))) : null,
      pub.length ? h('div', { class: 'col', style: { marginTop: '8px' } }, h('div', { class: 'tag' }, 'On the board'), pub.map(x => q(x, false))) : null));
  }

  // ── the Mirror ──
  const mirrorLocked = state.phase === 'playing' && myTurn;
  const mirrorBox = h('div', { class: 'panel' }, h('div', { class: 'row between' }, h('h3', {}, 'The Mirror'), h('button', { class: `mini ${selfUi.mirror ? '' : 'primary'}`, disabled: mirrorLocked && !selfUi.mirror, onClick: () => { selfUi.mirror = !selfUi.mirror; if (selfUi.mirror) { selfUi.look = { ...c.look }; selfUi.crest = c.crest; } rerenderSoon(); } }, selfUi.mirror ? 'Close' : 'Change my look')),
    mirrorLocked && !selfUi.mirror ? h('p', { class: 'muted small ital' }, 'The mirror is closed during your own turn.') : h('p', { class: 'muted small ital' }, 'Body, skin, face, hair and coat change between turns; your name and class are set.'));
  if (selfUi.mirror) {
    const editor = lookEditor(selfUi.look || c.look, (l) => { selfUi.look = l; }, { classId: c.classId, crest: selfUi.crest || c.crest, name: c.name });
    const crestInput = h('input', { value: selfUi.crest || c.crest || '', maxlength: 8, placeholder: '🂠', 'aria-label': 'crest', style: { width: '90px', textAlign: 'center', fontSize: '1.4rem' } });
    crestInput.addEventListener('input', () => { selfUi.crest = crestInput.value; editor.preview.crest = crestInput.value; });
    mirrorBox.append(editor, h('div', { class: 'row' }, h('span', { class: 'tag' }, 'Crest'), crestInput, h('span', { class: 'muted small ital' }, 'an emoji or a few letters')),
      h('div', { class: 'row' }, h('button', { class: 'primary grow', disabled: mirrorLocked, onClick: async () => { const ok = await dispatch('CHAR_MIRROR', { look: selfUi.look || c.look, crest: (selfUi.crest || c.crest || '').trim() || c.crest }); if (ok !== false) { selfUi.mirror = false; toast('The mirror remembers'); rerenderSoon(); } } }, 'Save my look'), h('button', { class: 'ghost', onClick: () => { selfUi.mirror = false; rerenderSoon(); } }, 'Cancel')));
  }
  screen.append(mirrorBox);

  // ── end of the run: vault, veteran, save-back ──
  if (state.phase === 'ended') screen.append(endPanel({ state, me, c, ctx, h, dispatch, session }));

  // ── roster, wall, rules ──
  screen.append(claimPanel({ session, backend: ctx?.backend, playerId: me.id, onChange: () => rerenderSoon() }), wallPanel({ backend: ctx?.backend, state }), rulesDrawer());
}

function endPanel({ state, me, c, ctx, h, dispatch, session }) {
  const Gb = safeGroup(state, 'grid'); const alive = !c.dead && !(c.deaths > 0);
  const cap_ = (alive ? Gb.vaultSurvivor : Gb.vaultDead) + (c.flags?.extraVault || 0) + (c.vaultBonus || 0);
  const vaulted = c.vaulted || []; const left = Math.max(0, cap_ - vaulted.length);
  const entry = state.roster?.[c.rosterId] || Object.values(state.roster || {}).find(e => e.name === c.name) || null;
  // Persist once the room is settled; re-run when the vault or veteran state changes (saveBack is idempotent per signature).
  if (ctx?.backend && !selfUi.saving) {
    selfUi.saving = true;
    saveBack({ state, playerId: me.id, backend: ctx.backend, session }).then(r => { selfUi.saving = false; if (r && !r.unchanged) { selfUi.saveResult = r; rerenderSoon(); } else if (r?.unchanged && !selfUi.saveResult) { selfUi.saveResult = r; rerenderSoon(); } }).catch(e => { selfUi.saving = false; selfUi.saveResult = { error: e.message }; rerenderSoon(); });
  }
  const r = selfUi.saveResult;
  return h('div', { class: 'panel gold end-panel' }, h('h3', {}, 'The run is over'),
    h('p', {}, alive ? `${c.name} walks out at level ${c.level}.` : `${c.name} did not make it. The name goes on the Wall; the look and class may return under a new name.`),
    h('div', { class: 'tag' }, 'Vault'),
    h('p', { class: 'muted small' }, `${alive ? 'A survivor banks' : 'The dead bank'} up to ${cap_} item${cap_ === 1 ? '' : 's'}. ${left ? `${left} more may still be banked from the Play tab.` : 'All banked.'}`),
    vaulted.length ? h('div', { class: 'row' }, vaulted.map(it => h('div', { class: 'vault-item' }, itemIcon(it, 44), h('span', { class: 'small' }, it.name)))) : h('p', { class: 'muted ital small' }, 'Nothing vaulted yet.'),
    h('div', { class: 'tag' }, 'Veteran'),
    h('p', { class: 'muted small' }, c.veteran ? `${c.name} is saved as a veteran and can enter harder dungeons.` : alive ? 'Not saved as a veteran yet (Play tab).' : 'Only survivors become veterans.'),
    h('div', { class: 'hr' }),
    r?.error ? h('p', { class: 'log error' }, `Could not save to your roster: ${r.error}`) : r ? h('p', { class: 'muted small' }, `Saved to roster ${r.owner?.claimCode || ''} · ${r.entry?.alive ? 'alive' : 'on the Wall'} · ${r.entry?.vault?.length || 0} in the vault · ${r.entry?.pets?.length || 0} pet${(r.entry?.pets?.length || 0) === 1 ? '' : 's'} kept`) : h('p', { class: 'muted small ital' }, ctx?.backend ? 'Saving to your roster…' : 'No roster backend.'),
    entry ? h('p', { class: 'muted small ital' }, `${entry.runs || 1} run${(entry.runs || 1) === 1 ? '' : 's'} on this character's record.`) : null);
}

const safeGroup = (state, g) => { try { return group(state, g); } catch { return {}; } };
const safeEffective = (state, c) => { try { return effectiveStats(state, c); } catch { return { ...c.stats }; } };
const safePacts = (state, c) => { try { return openPacts(state, c); } catch { return []; } };
