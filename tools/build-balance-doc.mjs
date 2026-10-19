// Writes docs/BALANCE.md from data/balance.json: one table per group (key, default, unit, spec section, what
// moving it does), an intro on changing values from the GM config screen, and a "Tuned from bot runs" section
// that appends data/balance-notes.md verbatim when that file exists. Deterministic; `build()` returns the text.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, readJSON } from './asset-list.mjs';

export const DOC_PATH = 'docs/BALANCE.md';
const fmt = (v) => Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'number' ? String(v) : JSON.stringify(v);
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function build({ balance = null, notes = null } = {}) {
  balance = balance || readJSON('data/balance.json', {});
  if (notes == null) { const p = path.join(ROOT, 'data/balance-notes.md'); notes = existsSync(p) ? readFileSync(p, 'utf8') : ''; }
  const groups = Object.keys(balance).filter(k => !k.startsWith('_'));
  const total = groups.reduce((n, g) => n + Object.keys(balance[g]).length, 0);
  const out = [];
  out.push('# Balance', '', `Generated from \`data/balance.json\` by \`tools/build-balance-doc.mjs\`; do not edit by hand. ${total} tunables in ${groups.length} groups.`, '');
  out.push('## Changing a value', '',
    '- **For one room, from the GM console:** open the config screen (GM › Config). Every number below is listed under its group with the same key. Edit the field and press Apply; the console appends a `CONFIG_SET` event and every phone and the TV pick the new value up at once. The change lives in `state.balance` and is saved with the room, so a restore point or a reconnect keeps it. Reset a field to go back to the default.',
    '- **For every room, permanently:** edit `data/balance.json` (`v` is the value; keep `unit`, `spec` and `note` honest), run `npm run gen` so this document follows, and commit both. Code never carries these numbers: handlers read them through `ctx.B(\'group\').key` or `bal(state, \'group.key\')`, and `test/unit/balance-literals.test.mjs` fails when a tunable\'s value is typed into a handler.',
    '- **Validation:** the config screen refuses a value of the wrong type (`checkOverrides` in `packages/shared/balance.js`) and shows the spec section each number comes from, so you can read the rule before you bend it.',
    '- **What moving it does** below is the intent of the number; the bot suite (`npm run test:bots`) is the quickest way to see what a change does to run length and death rate before a real night.', '');
  for (const g of groups) {
    const keys = Object.entries(balance[g]);
    out.push(`## ${g}`, '', '| Key | Default | Unit | Spec section | What moving it does |', '| --- | --- | --- | --- | --- |');
    for (const [k, def] of keys) out.push(`| \`${g}.${k}\` | ${cell(fmt(def.v))} | ${cell(def.unit)} | ${cell(def.spec)} | ${cell(def.note)} |`);
    out.push('');
  }
  out.push('## Tuned from bot runs', '', '_Filled by the lead from `npm run test:bots` output: run length by size and player count, deaths per run, Health curve, loot rarity counts. Put the notes in `data/balance-notes.md`; they are appended here verbatim._', '');
  if (notes.trim()) out.push(notes.replace(/\s+$/, ''), '');
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = build(); const abs = path.join(ROOT, DOC_PATH);
  if (!existsSync(abs) || readFileSync(abs, 'utf8') !== text) { writeFileSync(abs, text); console.log(`wrote ${DOC_PATH}`); } else console.log(`${DOC_PATH} unchanged`);
}
