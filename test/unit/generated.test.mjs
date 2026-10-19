// Generated files must match a fresh run of their generator (run `npm run gen` when this fails), every asset in
// tools/asset-list.mjs must exist on disk, and every manifest path must point at a file. Placeholders are drawn
// in a `before` hook when any are missing, so a fresh checkout passes once assets/ is populated.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, buildAssetList, loadData } from '../../tools/asset-list.mjs';
import { generate as generatePlaceholders, isPlaceholderFile } from '../../tools/placeholders.mjs';
import { generate as generateSounds } from '../../tools/sounds.mjs';
import * as manifest from '../../tools/build-manifest.mjs';
import * as balanceDoc from '../../tools/build-balance-doc.mjs';
import * as rulebook from '../../tools/build-rulebook.mjs';
import * as gmGuide from '../../tools/build-gm-guide.mjs';
import { inspectPNG } from '../../tools/png.mjs';

const abs = (rel) => path.join(ROOT, rel);
const read = (rel) => existsSync(abs(rel)) ? readFileSync(abs(rel), 'utf8') : null;
const firstDiff = (a, b) => { const la = (a || '').split('\n'), lb = (b || '').split('\n'); for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) return `line ${i + 1}:\n  on disk: ${JSON.stringify(la[i])}\n  fresh:   ${JSON.stringify(lb[i])}`; return 'identical'; };
const HINT = 'stale: run `npm run gen` (or the named tool) and commit the result';

let rows;
before(() => {
  rows = buildAssetList(loadData());
  const missing = rows.filter(r => !existsSync(abs(r.path)));
  if (missing.some(r => r.kind !== 'wav')) generatePlaceholders({ quiet: true });
  if (missing.some(r => r.kind === 'wav')) generateSounds({ quiet: true });
});

test('every asset key in asset-list.mjs exists on disk after placeholders.mjs', () => {
  const missing = rows.filter(r => !existsSync(abs(r.path))).map(r => r.key);
  assert.deepEqual(missing, [], `missing assets: ${missing.slice(0, 20).join(', ')}`);
  assert.ok(rows.length >= 420, `the spec promises about 420 images; the list has ${rows.length} rows`);
});

test('asset keys follow the sprite scheme and are unique', () => {
  const keys = rows.map(r => r.key);
  assert.equal(new Set(keys).size, keys.length);
  const pat = /^(body\/[0-2]_[0-3]|face\/[0-7]|hair\/(\d|1[01])|outfit\/[a-z]+|worn\/[a-z0-9_]+|legendary\/[a-z0-9_]+|lantern\/(full|guttering|out|dead)|pets\/[a-z0-9_]+_[1-3]|pets\/egg_[a-z0-9_]+|pets\/attack_[a-z]+|monsters\/[a-z0-9_]+(_token)?|items\/[a-z0-9_]+|gear\/[a-z0-9_]+|consumables\/[a-z0-9_]+|tiles\/[a-z_]+|map\/[a-z_]+|wheels\/[a-z_]+|cards\/([a-z]+(_double)?|back)|dice\/d(4|6|8|10|12|20)(_roll|_outline)?|frames\/(common|rare|epic|legendary)_[12]x[1-4]|ui\/[a-z0-9_]+|tv\/[a-z0-9_]+|crest\/[a-z]+|letters\/[a-z_]+|stages\/[a-z]+|badges\/[a-z_]+|sound\/[a-z0-9_]+)$/;
  const bad = keys.filter(k => !pat.test(k));
  assert.deepEqual(bad, []);
  for (const r of rows) assert.ok(r.path.startsWith('assets/') && r.path.endsWith('.' + r.kind), r.key);
  // The paper-doll contract.
  const body = rows.filter(r => r.group === 'body'); assert.equal(body.length, 12);
  for (const b of body) { assert.equal(b.sprite.frames, 22); assert.deepEqual(b.size, [64 * 22, 96]); }
  for (const r of rows.filter(r => ['worn', 'outfit', 'legendary', 'face', 'hair'].includes(r.group))) { assert.equal(r.sprite.frames, 5, r.key); assert.ok(Number.isInteger(r.sprite.z), r.key); }
  assert.equal(rows.filter(r => r.group === 'frames').length, 24);
});

test('placeholders are marked and sized as the list says; identical reruns write nothing', () => {
  for (const r of rows.filter(r => r.kind === 'png').slice(0, 400)) {
    const buf = readFileSync(abs(r.path)); const info = inspectPNG(buf);
    assert.ok(info.isPNG, r.key);
    if (isPlaceholderFile(buf, 'png')) { const want = r.genSize || r.size; assert.deepEqual([info.width, info.height], want, r.key); }
  }
  for (const r of rows.filter(r => r.kind === 'svg')) assert.ok(readFileSync(abs(r.path), 'utf8').includes('<svg'), r.key);
  const { changed } = generatePlaceholders({ check: true, quiet: true });
  assert.deepEqual(changed, [], 'placeholders.mjs is not idempotent or assets are stale');
  const snd = generateSounds({ check: true, quiet: true });
  assert.deepEqual(snd.changed, [], 'sounds.mjs is not idempotent or sounds are stale');
});

test('assets/manifest.json is fresh and every path exists', () => {
  const fresh = manifest.build({ rows });
  assert.equal(read(manifest.MANIFEST_PATH), fresh, `${manifest.MANIFEST_PATH} ${HINT}\n${firstDiff(read(manifest.MANIFEST_PATH), fresh)}`);
  const m = JSON.parse(fresh);
  assert.deepEqual(m.missing, []);
  for (const [k, a] of Object.entries(m.assets)) assert.ok(existsSync(abs(a.path)), `${k} → ${a.path}`);
  for (const [k, s] of Object.entries(m.sound)) assert.ok(existsSync(abs(s.path)), `${k} → ${s.path}`);
  assert.equal(Object.keys(m.assets).length + Object.keys(m.sound).length, rows.length);
  assert.ok(m.sprite.layerZ.body < m.sprite.layerZ.torso && m.sprite.layerZ.torso < m.sprite.layerZ.helmet);
  assert.equal(m.aliases['item/potion'], 'consumables/potion');
  // Deterministic: a second build is byte-identical.
  assert.equal(manifest.build({ rows }), fresh);
});

test('docs/BALANCE.md is fresh and lists every tunable', () => {
  const fresh = balanceDoc.build();
  assert.equal(read(balanceDoc.DOC_PATH), fresh, `${balanceDoc.DOC_PATH} ${HINT}\n${firstDiff(read(balanceDoc.DOC_PATH), fresh)}`);
  const bal = JSON.parse(readFileSync(abs('data/balance.json'), 'utf8'));
  for (const g of Object.keys(bal)) { if (g.startsWith('_')) continue; for (const k of Object.keys(bal[g])) assert.ok(fresh.includes(`\`${g}.${k}\``), `${g}.${k} missing from BALANCE.md`); }
  assert.ok(fresh.includes('## Tuned from bot runs'));
  assert.equal(balanceDoc.build({ balance: bal, notes: 'hello' }).trimEnd().endsWith('hello'), true);
});

test('docs/RULEBOOK.md and data/rulebook.generated.json are fresh and carry the balance numbers', () => {
  const { md, json, sections } = rulebook.build();
  assert.equal(read(rulebook.MD_PATH), md, `${rulebook.MD_PATH} ${HINT}\n${firstDiff(read(rulebook.MD_PATH), md)}`);
  assert.equal(read(rulebook.JSON_PATH), json, `${rulebook.JSON_PATH} ${HINT}\n${firstDiff(read(rulebook.JSON_PATH), json)}`);
  const ids = sections.map(s => s.id);
  for (const id of ['concept', 'turn', 'classes', 'stats', 'items', 'health', 'challenge', 'end']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  const bal = JSON.parse(readFileSync(abs('data/balance.json'), 'utf8'));
  assert.ok(md.includes(`Common ${bal.items.stakeCommon.v}`)); assert.ok(md.includes(`${bal.bloodPact.max.v} Health`)); assert.ok(md.includes(`Inn heal: ${bal.health.innHeal.v}`));
  const items = sections.find(s => s.id === 'items').blocks.find(b => b.type === 'table'); assert.equal(items.rows.length, 36);
  for (const s of sections) for (const b of s.blocks) if (b.type === 'table') for (const r of b.rows) assert.equal(r.length, b.columns.length, `${s.id} table row width`);
  assert.equal(JSON.parse(json).sections.length, sections.length);
});

test('docs/GM-GUIDE.md is fresh, short and carries the numbers', () => {
  const fresh = gmGuide.build();
  assert.equal(read(gmGuide.DOC_PATH), fresh, `${gmGuide.DOC_PATH} ${HINT}\n${firstDiff(read(gmGuide.DOC_PATH), fresh)}`);
  const words = fresh.split(/\s+/).length; assert.ok(words < 1600, `GM guide is ${words} words; keep it under two pages`);
  const bal = JSON.parse(readFileSync(abs('data/balance.json'), 'utf8'));
  assert.ok(fresh.includes(`${bal.table.proxyAfterSeconds.v} s of silence`)); assert.ok(fresh.includes('/classic')); assert.ok(fresh.includes('Drop Back In'));
  for (const h of ['Before people arrive', 'During play', 'The end', 'The classic fallback', 'Troubleshooting']) assert.ok(fresh.includes(`## ${h}`), h);
});

test('assets/ stays small', () => {
  let bytes = 0; for (const r of rows) bytes += readFileSync(abs(r.path)).length;
  assert.ok(bytes < 6.5 * 1024 * 1024, `assets are ${(bytes / 1024 / 1024).toFixed(2)} MB; keep placeholders under ~6 MB`);
});
