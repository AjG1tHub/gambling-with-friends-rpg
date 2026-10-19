// CLI wrapper: node tools/sheet-import.mjs <legacy-config.json|config.csv> > overrides.json
import { readFileSync } from 'node:fs';
import { importSheet } from '../packages/shared/sheet-import.js';
export { importSheet, MAP } from '../packages/shared/sheet-import.js';
const f = process.argv[2]; if (!f) { console.error('usage: node tools/sheet-import.mjs <legacy-config.json|config.csv>'); process.exit(1); }
const res = importSheet(readFileSync(f, 'utf8'));
console.error(res.problems.join('\n')); console.log(JSON.stringify(res.balance, null, 2));
