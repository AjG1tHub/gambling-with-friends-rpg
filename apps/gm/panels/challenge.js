// GM panel: the Challenge Wheel (SPEC.md › PvP: the Challenge Wheel, GM controls). The live card first: what the
// wheel landed on while the GM window is open (reroll / force), the two phones' reports and the timer for an
// external entry, and the big Drop Back In button (CHALLENGE_GM_DECIDE). Then the held seats, the list editor
// for the active preset (add / remove rows, save, save as a new preset), presets, JSON export / import in the
// data file's shape, and the trivia bank editor. Receives { state, session, ctx, h, gm, main }.
import { activeList, exportLists, validateEntries, challengeView, VERSUS_GAMES } from '../../../packages/shared/handlers/challenge.js';
import { PURPOSE_BUILT, tvView } from '../../../packages/shared/challenge/hosted.js';
import { characterOf } from '../../../packages/shared/state.js';
import { group } from '../../../packages/shared/balance.js';
import { toast, ticker, fmtTime } from '../../../packages/ui/dom.js';
import { download, copyText } from '../../../packages/ui/labkit.js';
import presetsData from '../../../data/challenges.json' with { type: 'json' };
import triviaData from '../../../data/trivia.json' with { type: 'json' };

const HOSTED_GAMES = [...PURPOSE_BUILT, ...VERSUS_GAMES];
const GAME_NAMES = { quickdraw: 'Quick-Draw', speedmath: 'Speed Math', memorymatch: 'Memory Match', trivia: 'Trivia', highestcard: 'Highest Card', typingrace: 'Typing Race', emojimemory: 'Emoji Memory', clash: 'Clash (War)', diceduel: 'Dice Duel', shellgame: 'Shell Game', holdemduel: "Hold'em Duel" };
// Editor draft survives re-renders (the console redraws on every event).
const draft = { presetId: null, name: '', entries: null, dirty: false };
let stopTick = null;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'custom';
const nameOf = (state, pid) => state.players[pid]?.name || pid || '—';

export function panelChallenge({ state, session, h, gm, main }) {
  stopTick?.(); stopTick = null;
  const lists = exportLists(state);
  const activeId = state.gm.challengePreset || 'inperson';
  if (!draft.entries || (!draft.dirty && draft.presetId !== activeId)) loadDraft(lists, activeId);
  else if (!draft.dirty && lists.presets[draft.presetId]) draft.entries = structuredClone(lists.presets[draft.presetId].entries);
  main.append(liveCard({ state, h, gm }), heldCard({ state, h, gm }), presetsCard({ state, h, gm, lists, activeId }), editorCard({ state, h, gm, lists, activeId }), jsonCard({ state, h, gm, lists }), triviaCard({ state, h, gm }));
}
function loadDraft(lists, id) { const p = lists.presets[id] || lists.presets.inperson; draft.presetId = id; draft.name = p.name; draft.entries = structuredClone(p.entries); draft.dirty = false; }

// ── the live challenge ───────────────────────────────────────────────────────────────────────────
function liveCard({ state, h, gm }) {
  const ch = state.challenge;
  const last = state.lastChallenge;
  if (!ch) return h('div', { class: 'panel' }, h('h2', {}, 'Live challenge'), h('p', { class: 'muted' }, 'No challenge is running.'), last ? h('p', { class: 'muted' }, `Last: ${last.entry?.name || 'a call'} between ${nameOf(state, last.attackerId)} and ${nameOf(state, last.defenderId)} — ${last.winnerId ? `${nameOf(state, last.winnerId)} won (${last.how})` : `no winner (${last.how})`}${last.hit ? `, hit for ${last.hit.dmg}${last.hit.killed ? ', a kill' : ''}` : ''}`) : null);
  const now = Date.now(), v = challengeView(state, null, now);
  const a = nameOf(state, ch.attackerId), d = nameOf(state, ch.defenderId);
  const what = ch.call === 'duel' ? 'Duel (Health)' : ch.call === 'wager' ? `Wager · ${ch.amount} Gold` : `Robbery · ${ch.amount} Gold`;
  const head = h('div', { class: 'row between' }, h('h2', {}, 'Live challenge'), h('span', { class: `pill ${v.phase === 'playing' ? 'gold' : ''}` }, v.phase));
  const who = h('p', {}, h('b', {}, a), ' calls ', h('b', {}, d), ` to a ${what}${ch.arena ? ' in the Arena' : ''}${ch.calledOut ? ' (Called Out)' : ''}`, ch.entry ? h('span', {}, ' — ', h('b', {}, ch.entry.name), ch.entry.hosted ? ' (hosted on the phones)' : ' (off-screen)') : null);
  const box = h('div', { class: 'panel gold col' }, head, who);
  const list = activeList(state).filter(e => e.enabled);
  // Before the spin: the defender's answer, then the spin (the GM may spin for a stuck phone).
  if (!ch.spun) {
    box.append(h('p', { class: 'muted' }, ch.call === 'wager' && !ch.accepted ? `${d} has not accepted the wager yet.` : ch.defenderItemId || ch.defenderAnswered ? `${d} has picked a weapon. Waiting on ${a} to spin.` : `${d} is picking a weapon.`),
      h('div', { class: 'gm-bar' }, h('button', { class: 'primary', onClick: () => gm('CHALLENGE_SPIN', {}) }, '🎡 Spin the wheel now'), h('button', { class: 'danger', onClick: () => { if (confirm('Cancel this call? Nothing is staked.')) gm('CHALLENGE_GM_DECIDE', { winnerId: null }); } }, 'Cancel the call')));
    return box;
  }
  // The GM window: the wheel has landed but the TV has not animated yet.
  const windowLeft = (ch.gmWindowUntil || 0) - now;
  if (windowLeft > 0 && !Object.keys(ch.reports || {}).length && !ch.hostedGame?.acted) {
    const sel = h('select', {}, list.map(e => h('option', { value: e.id, selected: e.id === ch.entryId }, e.name)));
    const left = h('span', { class: 'pill gold' }, `${Math.ceil(windowLeft / 1000)}s`);
    box.append(h('div', { class: 'panel blood' }, h('h3', {}, 'GM window — the TV has not spun yet'), h('p', {}, 'The wheel landed on ', h('b', {}, ch.entry.name), '. ', left),
      h('div', { class: 'gm-bar' }, h('button', { class: 'primary', onClick: () => gm('CHALLENGE_GM_SET', { reroll: true }) }, '🎲 Reroll'), sel, h('button', { onClick: () => gm('CHALLENGE_GM_SET', { entryId: sel.value }) }, 'Force this entry'))));
    stopTick = ticker((t) => { const ms = (ch.gmWindowUntil || 0) - t; left.textContent = `${Math.max(0, Math.ceil(ms / 1000))}s`; if (ms <= 0) left.textContent = 'closed'; });
  }
  // Play: hosted status or the external card with both reports and the timer.
  const timer = h('span', { class: 'pill' }, fmtTime((ch.deadline || now) - now));
  if (!(windowLeft > 0)) stopTick = ticker((t) => { timer.textContent = fmtTime((ch.deadline || t) - t); if ((ch.deadline || 0) - t <= 0) timer.className = 'pill bad'; });
  if (ch.entry.hosted) {
    const tv = ch.hostedGame ? tvView(ch.hostedGame, now) : null;
    box.append(h('p', {}, h('b', {}, ch.entry.game ? GAME_NAMES[ch.entry.game] || ch.entry.game : 'hosted'), ' on both phones · cap ', timer, ch.series ? ` · best of ${ch.series.maxRounds}, round ${ch.series.round}: ${ch.series.wins[ch.attackerId] || 0}–${ch.series.wins[ch.defenderId] || 0}` : ''),
      tv ? h('p', { class: 'mono muted' }, summarizeTv(tv, state)) : h('p', { class: 'muted' }, 'A Versus item: the two phones play it and report the winner.'));
  } else {
    const rep = (pid) => { const r = ch.reports?.[pid]; return r === undefined ? h('span', { class: 'pill' }, 'no report yet') : h('span', { class: 'pill gold' }, r === 'draw' ? 'says draw' : `says ${nameOf(state, r)} won`); };
    box.append(h('p', {}, 'Played away from the system · ', ch.entry.link ? h('a', { href: ch.entry.link, target: '_blank' }, ch.entry.link) : 'at the table', ' · time cap ', timer),
      ch.entry.rules ? h('p', { class: 'ital muted' }, ch.entry.rules) : null,
      h('div', { class: 'row' }, h('span', {}, h('b', {}, a), ' ', rep(ch.attackerId)), h('span', {}, h('b', {}, d), ' ', rep(ch.defenderId)), ch.gmPending ? h('span', { class: 'pill bad' }, 'they disagree — you decide') : null));
  }
  // Drop Back In.
  const winner = h('select', { style: { maxWidth: '260px' } }, h('option', { value: ch.attackerId }, `${a} won`), h('option', { value: ch.defenderId }, `${d} won`), h('option', { value: 'draw' }, 'Draw — nobody hits'));
  const pre = ch.reports?.[ch.attackerId] ?? ch.reports?.[ch.defenderId]; if (pre) winner.value = pre;
  const flawless = h('input', { type: 'checkbox' });
  box.append(h('div', { class: 'hr' }), h('h3', {}, 'Drop Back In'), h('p', { class: 'muted' }, 'Ends the challenge now, applies the hit or the Gold for the winner you pick, and puts both players back in their spots in the turn order.'),
    h('div', { class: 'gm-bar' }, winner, h('label', { class: 'row' }, flawless, ' flawless (crit)'), h('button', { class: 'primary big', style: { width: 'auto', minWidth: '260px' }, onClick: () => gm('CHALLENGE_GM_DECIDE', { winnerId: winner.value, flawless: flawless.checked }) }, '⏎ Drop Back In'),
      h('button', { class: 'ghost', title: 'Both take the time-out damage; only allowed once the cap has passed', onClick: () => gm('CHALLENGE_TIMEOUT', {}) }, 'Call time')));
  return box;
}
function summarizeTv(tv, state) {
  const n = (id) => nameOf(state, id);
  switch (tv.game) {
    case 'quickdraw': return `flash ${tv.flash ? 'shown' : 'pending'} · taps: ${Object.keys(tv.taps).map(n).join(', ') || 'none'}`;
    case 'speedmath': return `scores ${Object.entries(tv.scores).map(([k, v]) => `${n(k)} ${v}/${tv.total}`).join(' · ')}`;
    case 'trivia': return `answered ${Object.entries(tv.answered).map(([k, v]) => `${n(k)} ${v}/${tv.total}`).join(' · ')}`;
    case 'memorymatch': return `turn ${n(tv.turn)} · pairs ${Object.entries(tv.score).map(([k, v]) => `${n(k)} ${v}`).join(' · ')}`;
    case 'highestcard': return tv.cards ? Object.entries(tv.cards).map(([k, v]) => `${n(k)} ${v}`).join(' vs ') : `drawn: ${Object.keys(tv.drawn).map(n).join(', ') || 'nobody yet'}`;
    case 'typingrace': return `attempts ${Object.entries(tv.attempts).map(([k, v]) => `${n(k)} ${v}`).join(' · ')}`;
    case 'emojimemory': return `recalled ${Object.entries(tv.round).map(([k, v]) => `${n(k)} ${v}${tv.out[k] ? ' (out)' : ''}`).join(' · ')} of ${tv.length}`;
    default: return JSON.stringify(tv).slice(0, 160);
  }
}

// ── held seats ───────────────────────────────────────────────────────────────────────────────────
function heldCard({ state, h, gm }) {
  const held = Object.entries(state.held || {}).filter(([, v]) => !v.owedWait);
  const owed = state.owedTurns || [];
  return h('div', { class: 'panel' }, h('h3', {}, 'Held seats and owed turns'),
    held.length ? h('table', { class: 'gm' }, h('thead', {}, h('tr', {}, h('th', {}, 'Seat'), h('th', {}, 'Held since'), h('th', {}, 'Slots missed'), h('th', {}, ''))),
      h('tbody', {}, held.map(([pid, v]) => h('tr', {}, h('td', {}, h('b', {}, nameOf(state, pid))), h('td', {}, new Date(v.since).toLocaleTimeString()), h('td', {}, (v.misses || []).length), h('td', {}, h('span', { class: 'muted' }, 'released by Drop Back In')))))) : h('p', { class: 'muted' }, 'Nobody is away in a challenge.'),
    owed.length ? h('p', {}, h('b', {}, 'Owed turns: '), owed.map(o => `${nameOf(state, o.playerId)} (slot ${o.at})`).join(' · ')) : null,
    state.tableIdle ? h('p', { class: 'log error' }, 'The table is idle: every seat is away. Drop Back In resumes it.') : null);
}

// ── presets ──────────────────────────────────────────────────────────────────────────────────────
function presetsCard({ state, h, gm, lists, activeId }) {
  const ids = Object.keys(lists.presets);
  const custom = (id) => !presetsData.presets[id];
  return h('div', { class: 'panel' }, h('h3', {}, 'Presets'), h('p', { class: 'muted' }, 'Switch the active list for this run. Shipped: In Person, Discord, Quick. Saved lists live on this room (export them to keep them).'),
    h('div', { class: 'row' }, ids.map(id => h('button', { class: id === activeId ? 'primary' : '', onClick: () => { gm('CHALLENGE_LIST', { preset: id, activate: true }); loadDraft(lists, id); } }, lists.presets[id].name, h('span', { class: 'muted' }, ` ${lists.presets[id].entries.length}`), custom(id) && state.gm.challengeLists?.[id] ? h('span', { class: 'muted' }, ' ·room') : null))),
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'ghost', onClick: () => { loadDraft(lists, draft.presetId === activeId ? activeId : draft.presetId); } }, 'Edit active list below'),
      draft.presetId && state.gm.challengeLists?.[draft.presetId] ? h('button', { class: 'danger', onClick: () => { if (confirm(`Remove the room's copy of "${lists.presets[draft.presetId].name}"?`)) { gm('CHALLENGE_LIST', { preset: draft.presetId, remove: true }); draft.entries = null; } } }, 'Remove room copy of the edited list') : null));
}

// ── the editor ───────────────────────────────────────────────────────────────────────────────────
function editorCard({ state, h, gm, lists, activeId }) {
  const CH = group(state, 'challenge');
  const touch = () => { draft.dirty = true; status.textContent = 'unsaved changes'; };
  const row = (e, i) => {
    const hosted = h('input', { type: 'checkbox', checked: e.hosted, onChange: (ev) => { e.hosted = ev.target.checked; if (e.hosted && !e.game) e.game = HOSTED_GAMES[0]; touch(); redrawRow(); } });
    const game = h('select', { onChange: (ev) => { e.game = ev.target.value; touch(); } }, HOSTED_GAMES.map(g => h('option', { value: g, selected: e.game === g }, GAME_NAMES[g] || g)));
    const link = h('input', { value: e.link || '', placeholder: 'link (optional)', onInput: (ev) => { e.link = ev.target.value || null; touch(); } });
    const gameCell = h('td', {});
    const redrawRow = () => gameCell.replaceChildren(e.hosted ? game : link);
    redrawRow();
    return h('tr', {},
      h('td', {}, h('input', { value: e.name, style: { minWidth: '140px' }, onInput: (ev) => { e.name = ev.target.value; touch(); } }), h('div', { class: 'muted mono' }, e.id)),
      h('td', {}, h('label', { class: 'row' }, hosted, e.hosted ? 'hosted' : 'external')),
      gameCell,
      h('td', {}, h('input', { value: e.rules || '', placeholder: 'rules shown on the phones', style: { minWidth: '220px' }, onInput: (ev) => { e.rules = ev.target.value; touch(); } })),
      h('td', {}, h('input', { type: 'number', min: 10, step: 10, value: e.capSeconds ?? '', placeholder: String(e.hosted ? CH.hostedCapSeconds : CH.externalCapSeconds), style: { maxWidth: '90px' }, onInput: (ev) => { e.capSeconds = ev.target.value === '' ? null : Number(ev.target.value); touch(); } })),
      h('td', {}, h('select', { onChange: (ev) => { e.players = ev.target.value; touch(); } }, ['1v1', 'team'].map(p => h('option', { value: p, selected: (e.players || '1v1') === p }, p)))),
      h('td', {}, h('input', { type: 'number', min: 0, step: 1, value: e.weight, style: { maxWidth: '70px' }, onInput: (ev) => { e.weight = Number(ev.target.value); touch(); } })),
      h('td', {}, h('input', { type: 'checkbox', checked: e.enabled !== false, onChange: (ev) => { e.enabled = ev.target.checked; touch(); } })),
      h('td', {}, h('button', { class: 'danger', title: 'Remove row', onClick: () => { draft.entries.splice(i, 1); touch(); drawRows(); } }, '✕')));
  };
  const tbody = h('tbody');
  const drawRows = () => tbody.replaceChildren(...draft.entries.map(row));
  drawRows();
  const status = h('span', { class: 'muted' }, draft.dirty ? 'unsaved changes' : '');
  const nameIn = h('input', { value: draft.name, placeholder: 'List name', style: { maxWidth: '220px' }, onInput: (ev) => { draft.name = ev.target.value; touch(); } });
  const addRow = () => { const n = draft.entries.length + 1; draft.entries.push({ id: `custom${Date.now().toString(36)}${n}`, name: `New entry ${n}`, hosted: false, game: null, link: null, rules: '', capSeconds: null, players: '1v1', weight: 1, enabled: true }); touch(); drawRows(); };
  const save = async (asNew = false) => {
    let id = draft.presetId;
    if (asNew) { const nm = prompt('Name for the new preset:', draft.name + ' copy'); if (!nm) return; id = slug(nm); if (lists.presets[id] && !confirm(`"${id}" exists — overwrite?`)) return; draft.name = nm; }
    const bad = validateEntries(draft.entries); if (bad) return toast(bad, 'bad');
    if (await gm('CHALLENGE_LIST', { preset: id, name: draft.name, entries: draft.entries, activate: asNew || id === activeId })) { draft.presetId = id; draft.dirty = false; toast(`Saved "${draft.name}"`); }
  };
  const weightTotal = draft.entries.filter(e => e.enabled !== false).reduce((s, e) => s + (Number(e.weight) || 0), 0);
  return h('div', { class: 'panel' }, h('div', { class: 'row between' }, h('h3', {}, `Editing: ${lists.presets[draft.presetId]?.name || draft.name}${draft.presetId === activeId ? ' (active)' : ''}`), status),
    h('p', { class: 'muted' }, `Edit mid-run; the next spin uses the saved list. ${draft.entries.filter(e => e.enabled !== false).length} enabled entries, total weight ${weightTotal}; an entry with weight w lands w/${weightTotal || 1} of the time. Hosted caps default to ${CH.hostedCapSeconds}s, external to ${CH.externalCapSeconds}s. Fewer than ${CH.noRepeatMinEntries} enabled entries lets the same entry repeat in one fight.`),
    h('div', { class: 'gm-bar' }, nameIn, h('button', { onClick: addRow }, '+ Add row'), h('button', { class: 'primary', onClick: () => save(false) }, 'Save list'), h('button', { onClick: () => save(true) }, 'Save as new preset…'), h('button', { class: 'ghost', onClick: () => { loadDraft(lists, draft.presetId); drawRows(); status.textContent = ''; } }, 'Discard changes')),
    h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'gm' }, h('thead', {}, h('tr', {}, ['Name', 'Hosted?', 'Game / link', 'Rules', 'Cap (s)', 'Players', 'Weight', 'On', ''].map(x => h('th', {}, x)))), tbody)));
}

// ── JSON in and out ──────────────────────────────────────────────────────────────────────────────
function jsonCard({ state, h, gm, lists }) {
  const out = h('textarea', { class: 'json', readonly: true }); out.value = JSON.stringify(lists, null, 2);
  const inp = h('textarea', { class: 'json', placeholder: '{ "presets": { "id": { "name": "…", "entries": [ … ] } }, "active": "id" } — the shape of data/challenges.json' });
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  const doImport = async (text) => {
    try {
      const blob = JSON.parse(text); const presets = blob.presets || (blob.entries ? { [blob.id || 'imported']: { name: blob.name || 'Imported', entries: blob.entries } } : null);
      if (!presets) throw new Error('expected { presets: { id: { name, entries } } }');
      for (const [id, p] of Object.entries(presets)) { const bad = validateEntries(p?.entries); if (bad) throw new Error(`${id}: ${bad}`); }
      if (!(await gm('CHALLENGE_LIST', { presets }))) return;
      if (blob.active && presets[blob.active]) await gm('CHALLENGE_LIST', { preset: blob.active, activate: true });
      toast(`Imported ${Object.keys(presets).length} list(s)`); draft.entries = null;
    } catch (e) { toast(e.message, 'bad'); }
  };
  file.addEventListener('change', async () => { const f = file.files?.[0]; if (f) doImport(await f.text()); });
  return h('div', { class: 'grid2' },
    h('div', { class: 'panel' }, h('h3', {}, 'Export lists (JSON)'), h('p', { class: 'muted' }, 'Every preset, shipped and saved, in the data file\'s shape.'), h('div', { class: 'gm-bar' }, h('button', { class: 'primary', onClick: () => download(`gwf-challenge-lists-${state.code}.json`, out.value) }, 'Download'), h('button', { onClick: async () => toast((await copyText(out.value)) ? 'Copied' : 'Clipboard blocked — select the box', 'ok') }, 'Copy')), out),
    h('div', { class: 'panel' }, h('h3', {}, 'Import lists (JSON)'), h('p', { class: 'muted' }, 'A file or a paste. Lists with the same id replace the room\'s copy; the shipped presets stay as fallbacks.'), h('div', { class: 'gm-bar' }, h('label', { class: 'btn ghost' }, 'Choose file', file), h('button', { class: 'primary', onClick: () => doImport(inp.value) }, 'Import pasted JSON')), inp));
}

// ── trivia bank ──────────────────────────────────────────────────────────────────────────────────
function triviaCard({ state, h, gm }) {
  const bank = state.gm.triviaBank?.length ? state.gm.triviaBank : triviaData.questions;
  const isRoom = !!state.gm.triviaBank?.length;
  const ta = h('textarea', { class: 'json' }); ta.value = JSON.stringify(bank, null, 1);
  const q = h('input', { placeholder: 'Question' }), opts = [0, 1, 2, 3].map(i => h('input', { placeholder: `Option ${i + 1}`, style: { minWidth: '120px' } })), ans = h('select', {}, [0, 1, 2, 3].map(i => h('option', { value: i }, `Answer: option ${i + 1}`)));
  const saveBank = async (rows) => { if (await gm('CHALLENGE_LIST', { trivia: rows })) toast(`Trivia bank: ${rows.length} questions`); };
  const addOne = () => {
    const options = opts.map(o => o.value.trim()).filter(Boolean); if (!q.value.trim() || options.length < 2) return toast('A question and at least two options', 'bad');
    const rows = [...bank.map(x => ({ id: x.id, q: x.q, options: x.options, answer: x.answer })), { id: `gm${Date.now().toString(36)}`, q: q.value.trim(), options, answer: Math.min(Number(ans.value), options.length - 1) }];
    saveBank(rows); q.value = ''; opts.forEach(o => { o.value = ''; });
  };
  const saveJson = () => { try { const rows = JSON.parse(ta.value); if (!Array.isArray(rows)) throw new Error('expected a list'); saveBank(rows); } catch (e) { toast(e.message, 'bad'); } };
  const CH = group(state, 'challenge');
  return h('div', { class: 'panel' }, h('h3', {}, `Trivia bank — ${bank.length} questions${isRoom ? ' (this room)' : ' (shipped)'}`), h('p', { class: 'muted' }, `The hosted Trivia duel asks ${CH.triviaQuestions} of these per fight. Saving replaces the room's bank; the shipped questions are included below so you can add to them.`),
    h('div', { class: 'row' }, q, ...opts, ans, h('button', { class: 'primary', onClick: addOne }, '+ Add question')),
    h('details', {}, h('summary', { class: 'muted' }, 'Edit the whole bank as JSON'), ta, h('div', { class: 'gm-bar' }, h('button', { class: 'primary', onClick: saveJson }, 'Save bank'), h('button', { class: 'ghost', onClick: () => download('gwf-trivia.json', ta.value) }, 'Download'), isRoom ? h('button', { class: 'danger', onClick: () => saveBank([]) }, 'Back to the shipped bank') : null)));
}
export { HOSTED_GAMES, GAME_NAMES };
