// docs/ASSET-LIST.xlsx → art/notes.json: the per-asset prompt notes and suggested tool, keyed by asset key, so the
// templates can slot {notes} in without pandas on every run. Re-run when the sheet changes.
import { spawnSync } from 'node:child_process';
import { writeJSONFile, PATHS, ROOT } from './lib.mjs';
import { PYTHON } from './png-io.mjs';
import path from 'node:path';

const py = `
import json, sys
import pandas as pd
df = pd.read_excel(sys.argv[1], sheet_name='Assets')
out = {}
for _, r in df.iterrows():
    k = str(r['Key'])
    out[k] = { 'notes': '' if pd.isna(r['What it is (prompt notes)']) else str(r['What it is (prompt notes)']), 'tool': '' if pd.isna(r['Suggested tool']) else str(r['Suggested tool']), 'priority': str(r['Priority']) }
print(json.dumps(out))
`;
const r = spawnSync(PYTHON, ['-c', py, path.join(ROOT, 'docs/ASSET-LIST.xlsx')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const notes = JSON.parse(r.stdout);
writeJSONFile(PATHS.notes, notes);
console.log(`wrote ${path.relative(ROOT, PATHS.notes)} with ${Object.keys(notes).length} rows`);
