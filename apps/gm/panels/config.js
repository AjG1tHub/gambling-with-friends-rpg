// GM panel: Config. The live source of every tunable: data/balance.json defaults with the room's overrides on
// top. Edits apply to this room at once (GM_CONFIG); "Save as my defaults" keeps them in this browser for the
// next room. The config check lists anything suspicious. A Sheet import button reads a legacy GWF Config export.
import { listTunables, B, checkOverrides } from '../../../packages/shared/balance.js';
import { store, toast } from '../../../packages/ui/dom.js';
import { configCheck } from '../../../packages/shared/config-check.js';
import { importSheet } from '../../../packages/shared/sheet-import.js';

export function panelConfig({ state, h, gm, main }) {
  const rows = listTunables();
  const groups = [...new Set(rows.map(r => r.group))];
  const filter = h('input', { placeholder: 'Filter tunables (name, unit, spec section)…' });
  const pending = {};
  const current = (r) => state.balance?.[r.group]?.[r.key] ?? r.value;
  const table = h('div');
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    table.replaceChildren(...groups.map(g => {
      const rs = rows.filter(r => r.group === g && (!q || `${r.path} ${r.unit} ${r.spec} ${r.note}`.toLowerCase().includes(q)));
      if (!rs.length) return null;
      return h('div', { class: 'panel' }, h('h3', {}, g), h('table', { class: 'gm' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tunable'), h('th', {}, 'Value'), h('th', {}, 'Default'), h('th', {}, 'Unit'), h('th', {}, 'What moving it does'))),
        h('tbody', {}, rs.map(r => {
          const v = current(r), isList = Array.isArray(r.value);
          const input = h('input', { value: isList ? JSON.stringify(v) : String(v), style: { minWidth: '110px', maxWidth: '220px' }, onChange: (e) => { try { pending[r.group] ||= {}; pending[r.group][r.key] = isList ? JSON.parse(e.target.value) : Number(e.target.value); e.target.style.borderColor = ''; } catch { e.target.style.borderColor = 'var(--blood)'; } } });
          return h('tr', {}, h('td', {}, h('b', {}, r.key), h('div', { class: 'muted' }, r.spec)), h('td', {}, input), h('td', { class: v !== r.value ? 'muted' : '' }, isList ? JSON.stringify(r.value) : String(r.value), v !== r.value ? ' (changed)' : ''), h('td', { class: 'muted' }, r.unit), h('td', { class: 'muted' }, r.note));
        }))));
    }).filter(Boolean));
  };
  filter.addEventListener('input', draw); draw();
  const apply = async () => { const bad = checkOverrides(pending); if (bad.length) return toast(bad[0], 'bad'); if (await gm('GM_CONFIG', { balance: pending })) toast('Applied to this room'); };
  const saveDefaults = () => { const merged = structuredClone(state.balance || {}); for (const [g, ks] of Object.entries(pending)) merged[g] = { ...(merged[g] || {}), ...ks }; store.set('gwfrpg:gm:balance', merged); toast('Saved as your defaults for new rooms'); };
  const check = configCheck(state);
  const sheetFile = h('input', { type: 'file', accept: '.json,.csv,.txt' });
  sheetFile.addEventListener('change', async () => { const f = sheetFile.files?.[0]; if (!f) return; try { const res = importSheet(await f.text()); if (res.problems.length) toast(`${res.problems.length} rows skipped — see console`, 'bad'); console.log(res); if (await gm('GM_CONFIG', { balance: res.balance })) toast(`Imported ${res.count} tunables from the Sheet export`); } catch (e) { toast(e.message, 'bad'); } });
  main.append(
    h('div', { class: 'panel' }, h('h2', {}, 'Config'), h('p', { class: 'muted' }, 'Every number in the game, grouped by system. Values apply to this room when you press Apply; docs/BALANCE.md describes each one.'),
      h('div', { class: 'gm-bar' }, filter, h('button', { class: 'primary', onClick: apply }, 'Apply to room'), h('button', { onClick: saveDefaults }, 'Save as my defaults'), h('button', { class: 'danger', onClick: () => { if (confirm('Reset this room to the shipped defaults?')) gm('GM_CONFIG', { reset: true }); } }, 'Reset room'),
        h('label', { class: 'btn ghost' }, 'Import GWF Config Sheet export', sheetFile)),
      h('div', { class: 'row' }, h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: state.gm.duelsEnabled, onChange: (e) => gm('GM_CONFIG', { duelsEnabled: e.target.checked }) }), 'Duels (Health) allowed — off makes a Gold-only night'),
        h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: state.gm.fogOfWar, onChange: (e) => gm('GM_CONFIG', { fogOfWar: e.target.checked }) }), 'Fog of war on the TV'),
        h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: !!(state.balance?.social?.sideBetsOn ?? B.social.sideBetsOn), onChange: (e) => gm('GM_CONFIG', { sideBets: e.target.checked }) }), 'Side bets'))),
    h('div', { class: 'panel' }, h('h3', {}, `Config check — ${check.length ? `${check.length} note${check.length === 1 ? '' : 's'}` : 'all clear'}`), check.length ? h('ul', {}, check.map(c => h('li', { class: c.level === 'error' ? 'log error' : 'muted' }, c.text))) : h('p', { class: 'muted' }, 'Nothing looks wrong.')),
    table);
}
