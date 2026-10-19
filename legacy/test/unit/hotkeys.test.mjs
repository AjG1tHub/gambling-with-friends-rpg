import { test } from 'node:test';
import assert from 'node:assert/strict';
import './_helpers.mjs';
const HK = await import('../../site/js/hotkeys.js');

const ev = (code, mods = 'CA', tag = 'BODY') => ({ code, ctrlKey: mods.includes('C'), altKey: mods.includes('A'), shiftKey: mods.includes('S'), metaKey: mods.includes('M'), target: { tagName: tag } });
const id = (e, opts) => HK.matchHotkey(e, opts)?.id ?? null;

test('no two hotkeys share a key combination, and ids are unique', () => {
  assert.deepEqual(HK.hotkeyConflicts(), []);
  assert.equal(new Set(HK.HOTKEYS.map(h => h.id)).size, HK.HOTKEYS.length);
});

test('every hotkey belongs to a known group and has a label', () => {
  for (const h of HK.HOTKEYS) { assert.ok(HK.GROUPS.includes(h.group), h.id); assert.ok(h.label.length > 3, h.id); assert.ok(['', 'CA', 'CAS'].includes(h.mods), h.id); }
});

test('the original hotkeys still work: R reload, J jail, E shop, Z undo', () => {
  assert.equal(id(ev('KeyR')), 'reloadConfig'); assert.equal(id(ev('KeyJ')), 'jail');
  assert.equal(id(ev('KeyE')), 'shop'); assert.equal(id(ev('KeyZ')), 'chaosUndo');
});

test('matching uses the physical key, so Mac Option-combos and Shift-digits work', () => {
  // On a Mac, Ctrl+Option+R reports key "®"; Shift+1 reports key "!". Only `code` is stable.
  assert.equal(id({ ...ev('KeyR'), key: '®' }), 'reloadConfig');
  const silent = HK.matchHotkey({ ...ev('Digit3', 'CAS'), key: '#' });
  assert.deepEqual([silent.id, silent.tier, silent.loud], ['chaosSilent3', 3, false]);
  const loud = HK.matchHotkey(ev('Digit5'));
  assert.deepEqual([loud.tier, loud.loud], [5, true]);
});

test('modifiers must match exactly', () => {
  assert.equal(id(ev('KeyR', '')), null); assert.equal(id(ev('KeyR', 'C')), null);
  assert.equal(id(ev('KeyR', 'CAS')), null); assert.equal(id(ev('KeyR', 'CAM')), null);
  assert.equal(id(ev('Digit1', 'CAS')), 'chaosSilent1');
});

test('arrow keys walk the move, but not while typing in a field', () => {
  assert.equal(id(ev('ArrowUp', '')), 'stepN'); assert.equal(id(ev('ArrowLeft', '')), 'stepW');
  for (const tag of ['INPUT', 'SELECT', 'TEXTAREA']) assert.equal(id(ev('ArrowRight', '', tag)), null, tag);
  assert.equal(id(ev('ArrowRight', '', 'BUTTON')), 'stepE');
});

test('Escape closes panels even from inside a field; modifier hotkeys work while typing too', () => {
  assert.equal(id(ev('Escape', '', 'INPUT')), 'closeModal');
  assert.equal(id(ev('KeyN', 'CA', 'INPUT')), 'endTurn');
});

test('unknown keys and malformed events are ignored', () => {
  assert.equal(id(ev('KeyQ')), null); assert.equal(HK.matchHotkey(null), null); assert.equal(HK.matchHotkey({}), null);
});

test('combo text for Windows and Mac', () => {
  const r = HK.HOTKEYS.find(h => h.id === 'reloadConfig'), s = HK.HOTKEYS.find(h => h.id === 'chaosSilent2'), up = HK.HOTKEYS.find(h => h.id === 'stepN');
  assert.equal(HK.comboText(r), 'Ctrl + Alt + R'); assert.equal(HK.comboText(r, true), '⌃ ⌥ R');
  assert.equal(HK.comboText(s), 'Ctrl + Alt + Shift + 2'); assert.equal(HK.comboText(up), '↑');
});

test('isMac reads the platform', () => {
  assert.equal(HK.isMac({ platform: 'MacIntel' }), true); assert.equal(HK.isMac({ platform: 'Win32' }), false); assert.equal(HK.isMac({}), false);
});

test('the card groups everything, folding chaos tiers and arrows into single lines', () => {
  const rows = HK.cardRows();
  assert.deepEqual(rows.map(r => r.group), HK.GROUPS);
  const chaos = rows.find(r => r.group === 'Chaos').items;
  assert.deepEqual(chaos.map(i => i.combo), ['Ctrl + Alt + 1–5', 'Ctrl + Alt + Shift + 1–5', 'Ctrl + Alt + Z']);
  const turn = rows.find(r => r.group === 'Turn').items;
  assert.equal(turn.filter(i => i.combo.includes('↑')).length, 1);
  const shown = rows.reduce((n, r) => n + r.items.length, 0);
  assert.equal(shown, HK.HOTKEYS.length - 8 - 3);                    // 10 chaos rows → 2, 4 arrows → 1
});

test('card HTML escapes text and lists every group', () => {
  const html = HK.cardHtml(false, (t) => String(t).replace(/</g, '&lt;'));
  for (const g of HK.GROUPS) assert.ok(html.includes(`<h2>${g}</h2>`));
  assert.ok(html.includes('Ctrl + Alt + Space'));
});
