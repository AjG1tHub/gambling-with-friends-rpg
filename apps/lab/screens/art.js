// Lab screen: the art review page (/lab/?art=1). Every asset as a card — the placeholder on the left, the real
// file on the right at true pixel size and at TV / phone scale, paper-doll layers composited on the reference
// body across the five poses, pets at all three stages, wheels spinning — with Approve / Redo (new seed) / Redo
// with note. Verdicts go to art/review.json through the local review server (`npm run art:review`, which also
// starts Vite); on the deployed site, where no server runs, the page is read-only and the verdicts collected in
// this browser can be downloaded as review.json. The pipeline regenerates every row marked redo.
//   /lab/?art=1[&api=8791]      · #style shows the style-sheet gate · #group:<name> filters to one group
// It only reads assets/manifest.json and the review API; it never opens a room.
import { qs, store } from '../../../packages/ui/dom.js';
import { loadManifest, assetUrl, ARMOUR_OFFSETS, POSE_START } from '../../../packages/ui/sprite.js';
import { download, copyText } from '../../../packages/ui/labkit.js';

const API_PORT = qs('api') || '8791';
const API = `http://127.0.0.1:${API_PORT}`;
const ARMOUR_ORDER = ['idle', 'attack', 'hit', 'death', 'step'];
const TOOL_ICON = { pixellab: '🟩', fal: '🟦', gemini: '🍌', elevenlabs: '🔊', midjourney: '🎨', suno: '🎵' };
const LOCAL_KEY = 'gwfrpg:lab:art-review';

const state = { api: null, rows: [], manifest: null, report: null, style: null, filter: { group: '', priority: '', status: 'all', q: '' }, local: store.get(LOCAL_KEY, {}), online: false };

async function fetchJSON(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }
async function loadState() {
  state.manifest = await loadManifest();
  try { state.api = await fetchJSON(`${API}/api/state`); state.online = true; state.rows = state.api.rows; state.report = state.api.report; state.style = state.api.style; }
  catch { state.online = false; state.rows = manifestRows(state.manifest); }
}
// Without the server: rows from the manifest, verdicts from this browser.
function manifestRows(m) {
  if (!m) return [];
  const out = Object.entries(m.assets || {}).map(([key, a]) => ({ key, group: a.group, path: a.path, kind: a.kind, size: a.size, genSize: a.genSize || null, priority: a.priority, name: a.name || key, sprite: a.sprite || null, meta: a.meta || null, real: a.placeholder === false, tool: null, ledger: null, review: state.local[key] || null }));
  for (const [cue, s] of Object.entries(m.sound || {})) out.push({ key: `sound/${cue}`, group: 'sound', path: s.path, kind: 'wav', size: null, priority: s.priority, name: cue, real: s.placeholder === false, tool: null, ledger: null, review: state.local[`sound/${cue}`] || null, meta: { cue, music: s.music } });
  return out;
}
const verdictOf = (row) => (state.online ? row.review?.verdict : state.local[row.key]?.verdict) || '';
async function setVerdict(row, verdict, note = '') {
  if (state.online) { const r = await fetchJSON(`${API}/api/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: row.key, verdict, note }) }); row.review = r; }
  else { if (verdict === 'clear') delete state.local[row.key]; else state.local[row.key] = { verdict, note, date: new Date().toISOString().slice(0, 10) }; store.set(LOCAL_KEY, state.local); row.review = state.local[row.key] || null; }
}
const fileUrl = (row) => (state.online ? `${API}/api/file/${encodeURIComponent(row.key)}?t=${Date.now() >> 14}` : assetUrl(row.path));
const placeholderUrl = (row) => (state.online ? `${API}/api/placeholder/${encodeURIComponent(row.key)}` : row.real ? null : assetUrl(row.path));

// ── drawing helpers ───────────────────────────────────────────────────────────────────────────
function img(src, { scale = 1, pixel = true, title = '', w = null, h = null, cls = '' } = {}) {
  const el = document.createElement('img'); el.src = src; el.alt = title; el.title = title; el.loading = 'lazy'; el.className = `art-img ${cls}`.trim();
  if (pixel) el.style.imageRendering = 'pixelated';
  if (w) el.style.width = `${w * scale}px`; if (h) el.style.height = `${h * scale}px`;
  if (!w && scale !== 1) el.addEventListener('load', () => { el.style.width = `${el.naturalWidth * scale}px`; el.style.height = `${el.naturalHeight * scale}px`; }, { once: true });
  return el;
}
const loadImg = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
// A paper-doll layer composited on the reference body, five poses side by side at `scale`.
async function composite(h, row, scale = 3) {
  const body = state.rows.find(r => r.key === 'body/1_1') || state.rows.find(r => r.group === 'body');
  const canvas = document.createElement('canvas'); canvas.width = 64 * 5 * scale; canvas.height = 96 * scale; const g = canvas.getContext('2d'); g.imageSmoothingEnabled = false;
  const [bodyImg, layerImg] = await Promise.all([body ? loadImg(fileUrl(body)) : null, loadImg(fileUrl(row))]);
  ARMOUR_ORDER.forEach((pose, i) => {
    const bx = (POSE_START[pose] || 0) * 64;
    if (bodyImg && row.group !== 'body') g.drawImage(bodyImg, bx, 0, 64, 96, i * 64 * scale, 0, 64 * scale, 96 * scale);
    if (layerImg) { const frames = row.sprite?.frames || 5; const sx = frames >= 22 ? bx : i * 64; const [ox, oy] = row.group === 'body' ? [0, 0] : (ARMOUR_OFFSETS[pose]?.[0] || [0, 0]); g.drawImage(layerImg, sx, 0, 64, 96, (i * 64 + ox) * scale, oy * scale, 64 * scale, 96 * scale); }
  });
  return h('div', { class: 'art-composite' }, canvas, h('div', { class: 'muted small' }, `on body/1_1 · ${ARMOUR_ORDER.join(' · ')} · ×${scale}`));
}
function wheelPreview(h, row) {
  const el = img(fileUrl(row), { pixel: false, w: 220, h: 220, title: row.name, cls: 'art-wheel' });
  const ptr = state.rows.find(r => r.key === 'wheels/pointer');
  return h('div', { class: 'art-wheel-wrap', title: 'hover to spin' }, el, ptr ? img(fileUrl(ptr), { pixel: false, w: 24, h: 36, cls: 'art-pointer' }) : null);
}
function soundPreview(h, row) { const a = document.createElement('audio'); a.controls = true; a.preload = 'none'; a.src = fileUrl(row); a.style.width = '260px'; return a; }

// ── one card ──────────────────────────────────────────────────────────────────────────────────
function card(h, row, ctx) {
  const v = verdictOf(row); const led = row.ledger;
  const left = h('div', { class: 'art-side' }, h('div', { class: 'art-label' }, 'placeholder'));
  const right = h('div', { class: 'art-side' }, h('div', { class: 'art-label' }, row.real ? 'real' : h('span', { class: 'muted' }, led?.status === 'queued' ? 'queued — waiting for the inbox' : led?.status === 'failed' ? `failed: ${led.error || ''}` : 'not generated yet')));
  const ph = placeholderUrl(row);
  if (row.kind === 'wav') { if (ph || !row.real) left.append(h('div', { class: 'muted small' }, 'synth cue')); right.append(soundPreview(h, row)); }
  else {
    if (ph) left.append(img(ph, { pixel: row.kind === 'png', w: row.genSize?.[0] || Math.min(row.size?.[0] || 128, 256), h: row.genSize?.[1] || Math.min(row.size?.[1] || 128, 256), cls: 'art-thumb', title: 'placeholder' }));
    if (row.real) {
      const isSprite = ['body', 'face', 'hair', 'outfit', 'worn', 'legendary'].includes(row.group);
      if (isSprite && row.real) { const slot = h('div', { class: 'muted small' }, 'compositing…'); right.append(slot); composite(h, row, 3).then(el => slot.replaceWith(el)); right.append(h('div', { class: 'art-true' }, h('span', { class: 'muted small' }, 'sheet 1×'), img(fileUrl(row), { scale: 1 }))); }
      else if (row.group === 'wheels' && !/pointer|hub/.test(row.key)) right.append(wheelPreview(h, row));
      else if (row.group === 'pets' && row.meta?.species && !row.meta?.egg) {
        const stages = [1, 2, 3].map(s => state.rows.find(r => r.key === `pets/${row.meta.species}_${s}`)).filter(Boolean);
        right.append(h('div', { class: 'art-row' }, stages.map(s => h('div', {}, img(fileUrl(s), { pixel: true, w: 96, h: 96, cls: s.key === row.key ? 'art-current' : '' }), h('div', { class: 'muted small' }, `stage ${s.meta.stage}${s.real ? '' : ' (placeholder)'}`)))));
      } else if (row.group === 'lantern') right.append(h('div', { class: 'art-row' }, [24, 48, 96].map(px => h('div', {}, h('div', { class: 'art-lantern', style: { width: `${px}px`, height: `${px}px`, backgroundImage: `url(${fileUrl(row)})`, backgroundSize: `${px * 4}px ${px}px` } }), h('div', { class: 'muted small' }, `${px} px`)))));
      else {
        const [w, hgt] = row.size || [128, 128]; const big = Math.max(w, hgt) > 300;
        right.append(h('div', { class: 'art-true' }, h('span', { class: 'muted small' }, big ? 'fit' : 'true size'), img(fileUrl(row), { pixel: row.kind === 'png' && row.group !== 'monsters' && row.group !== 'stages' && row.group !== 'map' && row.group !== 'crest', w: big ? Math.round(w * 300 / Math.max(w, hgt)) : w, h: big ? Math.round(hgt * 300 / Math.max(w, hgt)) : hgt })));
        if (!big && Math.max(w, hgt) <= 128) right.append(h('div', { class: 'art-true' }, h('span', { class: 'muted small' }, 'TV ×3 · phone ×2'), img(fileUrl(row), { scale: 3, w, h: hgt }), img(fileUrl(row), { scale: 2, w, h: hgt })));
      }
    }
  }
  const note = h('textarea', { class: 'art-note', placeholder: 'What to change (goes into the prompt on the redo)…', rows: 2, style: { display: v === 'redo-note' ? '' : 'none' } }); note.value = row.review?.note || '';
  const btn = (label, verdict, cls = '') => h('button', { class: `${cls} ${v === verdict ? 'on' : ''}`.trim(), onClick: async () => { if (verdict === 'redo-note') { note.style.display = ''; note.focus(); } try { await setVerdict(row, verdict === 'redo-note' ? 'redo-note' : v === verdict ? 'clear' : verdict, note.value); } catch (e) { ctx.toast(`⚠️ ${e.message}`, 'bad'); } ctx.redraw(); } }, label);
  note.addEventListener('change', async () => { try { await setVerdict(row, 'redo-note', note.value); } catch (e) { ctx.toast(`⚠️ ${e.message}`, 'bad'); } });
  const meta = [row.priority, row.tool ? `${TOOL_ICON[row.tool] || ''} ${row.tool}` : null, row.size ? row.size.join('×') : null, row.sprite ? `${row.sprite.frames} frames · ${row.sprite.slot} z${row.sprite.z}` : null, led?.seed != null ? `seed ${led.seed}${led.attempt ? ` (try ${led.attempt + 1})` : ''}` : null, led?.cost ? `$${led.cost}` : null, led?.model || null].filter(Boolean).join(' · ');
  return h('article', { class: `panel art-card ${v} ${row.real ? 'real' : 'placeholder'}`, dataset: { key: row.key } },
    h('header', { class: 'art-head' }, h('b', {}, row.key), h('span', { class: 'muted small' }, row.name !== row.key ? row.name : ''), h('span', { class: 'grow' }), h('span', { class: 'muted small' }, meta)),
    h('div', { class: 'art-sides' }, left, right),
    led?.prompt ? h('details', { class: 'art-prompt' }, h('summary', { class: 'muted small' }, 'prompt'), h('pre', {}, led.prompt)) : null,
    h('div', { class: 'row art-verdict' }, btn('✅ Approve', 'approve', 'primary'), btn('🎲 Redo (new seed)', 'redo'), btn('✍️ Redo with note', 'redo-note'), v ? h('span', { class: 'muted small' }, `${v}${row.review?.date ? ' · ' + row.review.date : ''}`) : null),
    note);
}

// ── the style-sheet gate ─────────────────────────────────────────────────────────────────────
const STYLE_IDS = ['monster', 'boss', 'item', 'sprite', 'tiles', 'card', 'crest', 'ground', 'stage', 'pet', 'wheel', 'lantern'];
function styleGate(h) {
  const st = state.style || {}; const imgs = st.images || {};
  return h('section', { class: 'panel' }, h('h3', {}, 'Style sheet — approval gate 1'),
    h('p', { class: 'muted' }, st.approved ? `Approved ${st.approvedOn}: ${(st.approvedIds || []).join(', ')}${st.sref?.length ? ` · --sref ${st.sref.join(' ')}` : ''}` : 'Twelve Midjourney references from art/midjourney/queue.md. Run them, drop the PNGs into art/inbox/midjourney/style__<id>.png, then `node tools/art/style-sheet.mjs --import`. When a set looks right: `node tools/art/style-sheet.mjs --approve monster,item,… --sref <ids>`. Nothing else generates before that.'),
    h('div', { class: 'art-grid' }, STYLE_IDS.map(id => h('div', { class: 'art-style' }, imgs[id] ? img(`${API}/api/style/${id}`, { pixel: false, w: 180, h: 180, title: id }) : h('div', { class: 'art-empty' }, 'waiting'), h('div', { class: 'muted small' }, id, st.approvedIds?.includes(id) ? ' ✓' : '')))),
    state.online ? null : h('p', { class: 'muted small' }, 'Start `npm run art:review` on the PC to see the imported style images here.'));
}

// ── the screen ───────────────────────────────────────────────────────────────────────────────
export function screenArt(ctx) {
  const { h, main, lab } = ctx;
  main.append(h('p', { class: 'muted' }, 'Loading the inventory…'));
  loadState().then(() => drawArt(ctx)).catch((e) => { main.replaceChildren(h('p', { class: 'log error' }, e.message)); });
  lab.mount = { stop() {}, keys: {} };
}
function drawArt(ctx) {
  const { h, main } = ctx; main.replaceChildren();
  const f = state.filter; const groups = [...new Set(state.rows.map(r => r.group))].sort();
  const matches = (r) => (!f.group || r.group === f.group) && (!f.priority || r.priority === f.priority) && (f.status === 'all' || (f.status === 'real' && r.real) || (f.status === 'placeholder' && !r.real) || (f.status === 'review' && r.real && !verdictOf(r)) || (f.status === 'redo' && /^redo/.test(verdictOf(r))) || (f.status === 'approved' && verdictOf(r) === 'approve')) && (!f.q || r.key.includes(f.q) || String(r.name).toLowerCase().includes(f.q));
  const list = state.rows.filter(matches);
  const rep = state.report?.totals; const real = state.rows.filter(r => r.real).length;
  const sel = (name, opts, val, onchange) => { const s = h('select', { onChange: (e) => { onchange(e.target.value); drawArt(ctx); } }, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l))); return h('label', { class: 'row' }, name, s); };
  main.append(h('div', { class: 'panel' }, h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '10px' } },
    h('span', { class: state.online ? 'ok' : 'muted' }, state.online ? '● review server connected — verdicts write to art/review.json' : '○ no review server — verdicts stay in this browser (Download review.json below)'),
    h('span', { class: 'grow' }), h('span', { class: 'muted small' }, `${real}/${state.rows.length} real${rep ? ` · P1 ${rep.P1.real}/${rep.P1.total} · spent $${rep.spend}` : ''}`)),
    h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '10px', marginTop: '8px' } },
      sel('group', [['', 'all groups'], ...groups.map(g => [g, g])], f.group, (v) => { f.group = v; }),
      sel('priority', [['', 'P1–P3'], ['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3']], f.priority, (v) => { f.priority = v; }),
      sel('show', [['all', 'everything'], ['real', 'real art'], ['review', 'real, not yet reviewed'], ['approved', 'approved'], ['redo', 'marked redo'], ['placeholder', 'still placeholder']], f.status, (v) => { f.status = v; }),
      h('input', { placeholder: 'search key or name', value: f.q, onInput: (e) => { f.q = e.target.value.toLowerCase(); clearTimeout(drawArt._t); drawArt._t = setTimeout(() => drawArt(ctx), 250); } }),
      h('button', { class: 'ghost', onClick: () => { const entries = state.online ? Object.fromEntries(state.rows.filter(r => r.review).map(r => [r.key, r.review])) : state.local; download('review.json', JSON.stringify({ _about: 'Reviewer verdicts from the Lab art page; merge into art/review.json', entries }, null, 1)); } }, '⬇ Download review.json'),
      h('button', { class: 'ghost', onClick: async () => { const t = state.rows.filter(r => /^redo/.test(verdictOf(r))).map(r => `- ${r.key}${r.review?.note ? ` — ${r.review.note}` : ''}`).join('\n'); ctx.toast((await copyText(t || '(nothing marked redo)')) ? 'Redo list copied' : 'Clipboard blocked'); } }, '📋 Copy redo list'))));
  if (location.hash === '#style' || !f.group) main.append(styleGate(h));
  const byGroup = {}; for (const r of list) (byGroup[r.group] ||= []).push(r);
  main.append(h('p', { class: 'muted small' }, `${list.length} assets shown`));
  for (const [g, rowsOf] of Object.entries(byGroup)) {
    const gr = state.report?.groups?.[g];
    main.append(h('h3', { class: 'art-group' }, g, ' ', h('span', { class: 'muted small' }, `${rowsOf.filter(r => r.real).length}/${rowsOf.length} real${gr ? ` · ${gr.tool} · ${gr.approve} approved · ${gr.redo} redo` : ''}`)));
    const grid = h('div', { class: 'art-cards' }); main.append(grid);
    // Cards render lazily so 629 rows do not hang the page.
    let i = 0; const batch = () => { const slice = rowsOf.slice(i, i + 12); for (const r of slice) grid.append(card(h, r, { ...ctx, redraw: () => { const old = grid.querySelector(`[data-key="${CSS.escape(r.key)}"]`); if (old) old.replaceWith(card(h, r, { ...ctx, redraw: () => drawArt(ctx) })); } })); i += 12; if (i < rowsOf.length) requestAnimationFrame(batch); }; batch();
  }
}
export const ART_CSS = `
.art-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 12px; }
.art-card { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-left: 3px solid var(--line); }
.art-card.approve { border-left-color: var(--ok); } .art-card.redo, .art-card.redo-note { border-left-color: var(--warn); } .art-card.placeholder { opacity: .85; }
.art-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; } .art-head b { font-family: var(--font-mono); font-size: .85rem; }
.art-sides { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 10px; }
.art-side { display: flex; flex-direction: column; gap: 6px; min-width: 0; overflow: auto; } .art-label { font-size: .7rem; letter-spacing: .12em; text-transform: uppercase; color: var(--gold-dim); }
.art-img { background: repeating-conic-gradient(#1c1614 0 25%, #16110f 0 50%) 0 0 / 16px 16px; border: 1px solid var(--line); max-width: 100%; }
.art-true { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; } .art-row { display: flex; gap: 12px; align-items: flex-end; } .art-current img { outline: 2px solid var(--gold); }
.art-composite canvas { background: repeating-conic-gradient(#1c1614 0 25%, #16110f 0 50%) 0 0 / 16px 16px; border: 1px solid var(--line); max-width: 100%; image-rendering: pixelated; }
.art-lantern { background-repeat: no-repeat; image-rendering: pixelated; animation: lanternFlicker 1s steps(4) infinite; }
@keyframes lanternFlicker { to { background-position: -400% 0; } }
.art-wheel-wrap { position: relative; width: 220px; } .art-wheel-wrap:hover .art-wheel { animation: artSpin 6s cubic-bezier(.2,.8,.2,1) infinite; } .art-pointer { position: absolute; left: 98px; top: -6px; }
@keyframes artSpin { to { transform: rotate(1440deg); } }
.art-prompt pre { white-space: pre-wrap; font-size: .78rem; max-height: 160px; overflow: auto; } .art-verdict button.on { outline: 2px solid var(--gold); } .art-note { width: 100%; }
.art-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; } .art-style { text-align: center; } .art-empty { width: 180px; height: 180px; display: grid; place-items: center; border: 1px dashed var(--line); color: var(--muted); margin: 0 auto; }
.art-group { margin-top: 18px; } .small { font-size: .8rem; } .ok { color: var(--ok); }
`;
