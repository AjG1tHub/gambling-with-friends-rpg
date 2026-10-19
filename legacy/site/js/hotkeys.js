// GM hotkeys (Phase 6). One registry drives the keyboard handler, the in-app help
// overlay and the printable card, so the three can never disagree.
// Matching uses KeyboardEvent.code (the physical key), not .key: with Ctrl+Alt held,
// .key turns into "®" / "¡" on a Mac and Shift+1 becomes "!", which broke the old handler.

// mods: 'CA' = Ctrl+Alt, 'CAS' = Ctrl+Alt+Shift, '' = bare key (only when not typing in a field)
export const HOTKEYS = [
  { id: 'primary',     mods: 'CA',  code: 'Space',      keys: 'Space', group: 'Turn',    label: 'Do the highlighted turn action (Begin Turn → Spin → Resolve → End Turn)' },
  { id: 'beginTurn',   mods: 'CA',  code: 'KeyT',       keys: 'T',     group: 'Turn',    label: 'Begin turn' },
  { id: 'endTurn',     mods: 'CA',  code: 'KeyN',       keys: 'N',     group: 'Turn',    label: 'End turn (Next player)' },
  { id: 'spinMethod',  mods: 'CA',  code: 'KeyW',       keys: 'W',     group: 'Turn',    label: 'Spin the Method Wheel' },
  { id: 'resolveTile', mods: 'CA',  code: 'KeyX',       keys: 'X',     group: 'Turn',    label: 'Resolve the tile' },
  { id: 'stepN',       mods: '',    code: 'ArrowUp',    keys: '↑',     group: 'Turn',    label: 'Step up (while a move is in progress)' },
  { id: 'stepS',       mods: '',    code: 'ArrowDown',  keys: '↓',     group: 'Turn',    label: 'Step down' },
  { id: 'stepW',       mods: '',    code: 'ArrowLeft',  keys: '←',     group: 'Turn',    label: 'Step left' },
  { id: 'stepE',       mods: '',    code: 'ArrowRight', keys: '→',     group: 'Turn',    label: 'Step right' },

  { id: 'good',        mods: 'CA',  code: 'KeyG',       keys: 'G',     group: 'Wheels',  label: 'Spin the GOOD wheel' },
  { id: 'bad',         mods: 'CA',  code: 'KeyB',       keys: 'B',     group: 'Wheels',  label: 'Spin the BAD wheel' },
  { id: 'void',        mods: 'CA',  code: 'KeyV',       keys: 'V',     group: 'Wheels',  label: 'Spin the VOID wheel' },
  { id: 'battle',      mods: 'CA',  code: 'KeyK',       keys: 'K',     group: 'Wheels',  label: 'Open a Battle' },
  { id: 'buyIn',       mods: 'CA',  code: 'KeyU',       keys: 'U',     group: 'Wheels',  label: 'Spin the Buy-In wheel' },
  { id: 'jail',        mods: 'CA',  code: 'KeyJ',       keys: 'J',     group: 'Wheels',  label: 'Open the Jail panel for the current player' },
  { id: 'shop',        mods: 'CA',  code: 'KeyE',       keys: 'E',     group: 'Wheels',  label: 'Open the Shop (GM discretion)' },
  { id: 'loans',       mods: 'CA',  code: 'KeyL',       keys: 'L',     group: 'Wheels',  label: 'Open the Loan Shark (lend / repay)' },
  { id: 'pets',        mods: 'CA',  code: 'KeyY',       keys: 'Y',     group: 'Wheels',  label: 'Open Pets + Power Level' },
  { id: 'petBattle',   mods: 'CA',  code: 'KeyF',       keys: 'F',     group: 'Wheels',  label: 'Pet battle (boss Fight or player vs player)' },
  { id: 'game',        mods: 'CA',  code: 'KeyA',       keys: 'A',     group: 'Wheels',  label: 'Start a minigame for any player' },

  ...[1, 2, 3, 4, 5].map(t => ({ id: `chaos${t}`, mods: 'CA', code: `Digit${t}`, keys: String(t), group: 'Chaos', label: `Chaos tier ${t} — LOUD (splash on the shared screen)`, tier: t, loud: true })),
  ...[1, 2, 3, 4, 5].map(t => ({ id: `chaosSilent${t}`, mods: 'CAS', code: `Digit${t}`, keys: String(t), group: 'Chaos', label: `Chaos tier ${t} — silent`, tier: t, loud: false })),
  { id: 'chaosUndo',   mods: 'CA',  code: 'KeyZ',       keys: 'Z',     group: 'Chaos',   label: 'Undo the last shuffle' },

  { id: 'reloadConfig', mods: 'CA', code: 'KeyR',       keys: 'R',     group: 'Session', label: 'Reload config from the Sheet' },
  { id: 'playerView',  mods: 'CA',  code: 'KeyP',       keys: 'P',     group: 'Session', label: 'Open the player view window' },
  { id: 'mute',        mods: 'CA',  code: 'KeyM',       keys: 'M',     group: 'Session', label: 'Mute / unmute sound' },
  { id: 'undo',        mods: 'CA',  code: 'Backspace',  keys: '⌫',     group: 'Session', label: 'Undo the last GM click (up to 30)' },
  { id: 'help',        mods: 'CA',  code: 'KeyH',       keys: 'H',     group: 'Session', label: 'Show this hotkey list' },
  { id: 'closeModal',  mods: '',    code: 'Escape',     keys: 'Esc',   group: 'Session', label: 'Close the open panel' },
];
export const GROUPS = ['Turn', 'Wheels', 'Chaos', 'Session'];

const modsOf = (e) => (e.ctrlKey ? 'C' : '') + (e.altKey ? 'A' : '') + (e.shiftKey ? 'S' : '') + (e.metaKey ? 'M' : '');
const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// Which hotkey (if any) does this keydown mean? Bare keys are ignored while typing in a field.
export function matchHotkey(e, { typing = TYPING.has(e?.target?.tagName) || !!e?.target?.isContentEditable } = {}) {
  if (!e || !e.code) return null;
  const mods = modsOf(e);
  const hit = HOTKEYS.find(h => h.code === e.code && h.mods === mods);
  if (!hit) return null;
  if (hit.mods === '' && typing && hit.id !== 'closeModal') return null;
  return hit;
}

// "Ctrl + Alt + R" (Windows) / "⌃ ⌥ R" (Mac)
export function comboText(h, mac = false) {
  const parts = [];
  if (h.mods.includes('C')) parts.push(mac ? '⌃' : 'Ctrl');
  if (h.mods.includes('A')) parts.push(mac ? '⌥' : 'Alt');
  if (h.mods.includes('S')) parts.push(mac ? '⇧' : 'Shift');
  parts.push(h.keys);
  return parts.join(mac ? ' ' : ' + ');
}
export const isMac = (nav = globalThis.navigator) => /Mac|iPhone|iPad/.test(nav?.platform || nav?.userAgent || '');

// Collapse the ten chaos rows into two readable lines for the card / overlay.
export function cardRows(mac = false) {
  const rows = [];
  for (const group of GROUPS) {
    const items = [];
    for (const h of HOTKEYS.filter(x => x.group === group)) {
      if (h.tier) {
        if (h.tier !== 1) continue;
        items.push({ combo: comboText({ ...h, keys: '1–5' }, mac), label: h.loud ? 'Chaos tier 1–5 — LOUD (splash on the shared screen)' : 'Chaos tier 1–5 — silent' });
      } else if (h.id === 'stepN') items.push({ combo: '↑ ↓ ← →', label: 'Walk the current move one tile' });
      else if (h.id.startsWith('step')) continue;
      else items.push({ combo: comboText(h, mac), label: h.label });
    }
    rows.push({ group, items });
  }
  return rows;
}

// Sanity check used by the tests and at boot: no two hotkeys on the same key combo.
export function hotkeyConflicts() {
  const seen = new Map(); const out = [];
  for (const h of HOTKEYS) { const k = h.mods + '|' + h.code; if (seen.has(k)) out.push([seen.get(k), h.id]); else seen.set(k, h.id); }
  return out;
}

export function cardHtml(mac = false, esc = (x) => x) {
  return cardRows(mac).map(g => `<section class="hk-group"><h2>${esc(g.group)}</h2><table>${g.items.map(i =>
    `<tr><td class="hk-combo">${esc(i.combo)}</td><td>${esc(i.label)}</td></tr>`).join('')}</table></section>`).join('');
}
