// The art pipeline (tools/art/): every asset group has a prompt template and every row builds a clean prompt;
// routing names a known tool; post.py turns synthetic "model output" into files of exactly the spec size that do
// not carry the placeholder marker (single, strip, layer diff, 9-slice, wheel SVG, SVG wrap, audio). The
// post.py checks need Pillow; they are skipped where python3 + Pillow are not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rows, buildPrompt, toolFor, template, slotsFor, PATHS, ROOT } from '../../tools/art/lib.mjs';
import { isPlaceholderFile } from '../../tools/placeholders.mjs';
import { inspectPNG } from '../../tools/png.mjs';
import { STYLE_SHEET } from '../../tools/art/style-sheet.mjs';

const PY = process.env.ART_PYTHON || 'python3';
const POST = path.join(ROOT, 'tools/art/post.py');
const havePillow = (() => { const r = spawnSync(PY, ['-c', 'import PIL'], { encoding: 'utf8' }); return r.status === 0; })();
const KNOWN_TOOLS = new Set(['pixellab', 'fal', 'gemini', 'elevenlabs', 'midjourney', 'suno']);

test('every asset group has a prompt template and every row builds a clean prompt', () => {
  const list = rows(); const groups = new Set(list.map(r => r.group));
  for (const g of groups) assert.ok(existsSync(path.join(PATHS.prompts, `${g}.md`)), `missing tools/art/prompts/${g}.md`);
  assert.ok(existsSync(path.join(PATHS.prompts, '_style.md')));
  for (const r of list) {
    const { prompt, negative } = buildPrompt(r);
    assert.ok(prompt.length > 40, `${r.key}: prompt too short`);
    assert.ok(!/\{\w+\}/.test(prompt) && !/\{\w+\}/.test(negative), `${r.key}: unfilled slot in ${prompt}`);
    assert.ok(!/\(\)|: \.|  /.test(prompt), `${r.key}: empty slot artefact in ${prompt}`);
    assert.ok(KNOWN_TOOLS.has(toolFor(r)), `${r.key}: unknown tool ${toolFor(r)}`);
  }
  // The routing promised in the prompt's tool table.
  assert.equal(toolFor(list.find(r => r.key === 'monsters/card_shark')), 'midjourney');
  assert.equal(toolFor(list.find(r => r.key === 'monsters/card_shark_token')), 'gemini');
  assert.equal(toolFor(list.find(r => r.key === 'tiles/ground_docks')), 'midjourney');
  assert.equal(toolFor(list.find(r => r.key === 'tiles/encounter')), 'fal');
  assert.equal(toolFor(list.find(r => r.group === 'body')), 'pixellab');
  assert.equal(toolFor(list.find(r => r.key === 'sound/music_docks')), 'suno');
  assert.equal(toolFor(list.find(r => r.key === 'sound/hit')), 'elevenlabs');
  // Slots come from the data files, never from memory.
  const shark = slotsFor(list.find(r => r.key === 'monsters/card_shark'));
  assert.equal(shark.regionName, 'Casino Strip'); assert.ok(shark.flavour.length > 10); assert.equal(shark.accentName, 'magenta');
  const pet = slotsFor(list.find(r => r.key === 'pets/emberfox_2')); assert.equal(pet.stageName, 'Pyrewolf'); assert.equal(pet.element, 'Oxblood');
  // Templates are not empty shells.
  for (const g of groups) { const t = template(g); assert.ok((t.prompt || '').length + (t.variants || '').length > 60, `${g}.md has no body`); }
  assert.equal(STYLE_SHEET.length, 12);
});

test('post.py ops produce files of the spec size without the placeholder marker', { skip: !havePillow && 'python3 with Pillow not available' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gwf-art-'));
  const run = (job) => { const p = path.join(dir, `${job.op}-${Math.random().toString(36).slice(2)}.json`); writeFileSync(p, JSON.stringify(job)); const r = spawnSync(PY, [POST, 'process', p], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.trim().split('\n').pop()); };
  // Synthetic "model output": a chroma-green canvas with a brass figure, made by Pillow so it is a real (non-filter-0) PNG.
  const mk = (p, w, h, { bg = '0,255,0,255', fig = true, frame = false } = {}) => { const r = spawnSync(PY, ['-c', `
from PIL import Image, ImageDraw; import sys
im = Image.new('RGBA', (${w}, ${h}), (${bg})); d = ImageDraw.Draw(im)
if ${fig ? 'True' : 'False'}: d.rectangle((${w}//4, ${h}//5, ${w}*3//4, ${h}*4//5), fill=(140,106,42,255), outline=(18,13,16,255)); d.ellipse((${w}//3, ${h}//10, ${w}*2//3, ${h}//3), fill=(232,223,200,255))
if ${frame ? 'True' : 'False'}: d.rectangle((0,0,${w}-1,${h}-1), outline=(140,106,42,255), width=36)
im.save(sys.argv[1])`, p], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return p; };
  const size = (p) => { const i = inspectPNG(readFileSync(p)); return [i.width, i.height]; };
  const clean = (p, kind) => assert.equal(isPlaceholderFile(readFileSync(p), kind), false, `${p} carries the placeholder marker`);
  try {
    // single: a 256-px icon from a 512 chroma image, pixelated to 128 then ×2 nearest.
    const icon = run({ op: 'single', key: 'items/x', group: 'items', out: path.join(dir, 'icon.png'), size: [256, 256], genSize: [128, 128], mode: 'pixel', inputs: [mk(path.join(dir, 'in1.png'), 512, 512)], cutout: 'chroma', margin: 0.06, pixelate: [128, 128] });
    assert.deepEqual(size(icon.written), [256, 256]); clean(icon.written, 'png');
    // The green is gone: the corner pixel is transparent.
    const r1 = spawnSync(PY, ['-c', `from PIL import Image; im=Image.open('${icon.written}'); print(im.getpixel((0,0))[3], len(im.getcolors(100000)))`], { encoding: 'utf8' }); const [alpha, colours] = r1.stdout.trim().split(' ').map(Number);
    assert.equal(alpha, 0); assert.ok(colours <= 33, `quantised to ≤32 colours (${colours})`);
    // strip: five 64×96 frames → 320×96 with feet on the baseline.
    const frames = [0, 1, 2, 3, 4].map(i => mk(path.join(dir, `f${i}.png`), 64, 96, { bg: '0,0,0,0' }));
    const strip = run({ op: 'strip', key: 'outfit/x', group: 'outfit', out: path.join(dir, 'strip.png'), size: [320, 96], mode: 'pixel', inputs: frames, cutout: 'none', frameW: 64, frameH: 96, baseline: 92 });
    assert.deepEqual(size(strip.written), [320, 96]); clean(strip.written, 'png');
    // layer: diff against a base that already has the body → only the added hat survives.
    const base = mk(path.join(dir, 'base.png'), 64, 96, { bg: '0,0,0,0' });
    const withHat = path.join(dir, 'hat.png'); spawnSync(PY, ['-c', `from PIL import Image, ImageDraw; im=Image.open('${base}').convert('RGBA'); d=ImageDraw.Draw(im); d.rectangle((20,2,44,12), fill=(90,26,26,255)); im.save('${withHat}')`]);
    const layer = run({ op: 'layer', key: 'worn/x', group: 'worn', out: path.join(dir, 'layer.png'), size: [320, 96], mode: 'pixel', inputs: [withHat, withHat, withHat, withHat, withHat], bases: [base, base, base, base, base], frameW: 64, frameH: 96 });
    assert.deepEqual(size(layer.written), [320, 96]);
    const r2 = spawnSync(PY, ['-c', `from PIL import Image; im=Image.open('${layer.written}'); print(im.getpixel((32,7))[3], im.getpixel((32,50))[3])`], { encoding: 'utf8' }); const [hatA, bodyA] = r2.stdout.trim().split(' ').map(Number);
    assert.equal(hatA, 255, 'the hat pixels survive the diff'); assert.equal(bodyA, 0, 'the body pixels are removed by the diff');
    // nineslice: a 192 source → a 2×3 footprint frame of 128×192.
    const src = mk(path.join(dir, 'frame.png'), 192, 192, { bg: '0,0,0,0', fig: false, frame: true });
    const nine = run({ op: 'nineslice', key: 'frames/x', group: 'frames', out: path.join(dir, 'nine.png'), size: [128, 192], mode: 'pixel', inputs: [src], slice: 12, cells: [2, 3] });
    assert.deepEqual(size(nine.written), [128, 192]); clean(nine.written, 'png');
    // wheel-svg: segments and labels groups, one path per label, no odds baked in.
    const wheel = run({ op: 'wheel-svg', key: 'wheels/x', group: 'wheels', out: path.join(dir, 'wheel.svg'), size: [1024, 1024], mode: 'painted', inputs: [mk(path.join(dir, 'rim.png'), 256, 256, { bg: '23,17,26,255' })], labels: ['A', 'B', 'C', 'D', 'E'] });
    const svg = readFileSync(wheel.written, 'utf8'); clean(wheel.written, 'svg');
    assert.ok(svg.includes('<g id="segments"') && svg.includes('<g id="labels"')); assert.equal((svg.match(/<path /g) || []).length, 5); assert.equal((svg.match(/<text /g) || []).length, 5);
    // svg-wrap: a UI piece of the spec size with the image embedded.
    const wrap = run({ op: 'svg-wrap', key: 'ui/x', group: 'ui', out: path.join(dir, 'ui.svg'), size: [120, 120], genSize: [120, 120], mode: 'pixel', inputs: [mk(path.join(dir, 'ui.png'), 240, 240)], cutout: 'chroma', pixelate: [120, 120] });
    const w = readFileSync(wrap.written, 'utf8'); clean(wrap.written, 'svg'); assert.ok(w.includes('width="120" height="120"') && w.includes('data:image/png;base64,'));
    // audio: raw 44.1 kHz PCM → 48 kHz 16-bit mono WAV, normalised, no INFO comment.
    const pcm = path.join(dir, 'cue.pcm'); const n = 44100; const buf = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 20) * 8000), i * 2); writeFileSync(pcm, buf);
    const wav = run({ op: 'audio', key: 'sound/x', group: 'sound', out: path.join(dir, 'cue.wav'), size: null, mode: 'audio', inputs: [pcm], format: 'pcm_s16le_44100_mono', rate: 48000, lufs: -16 });
    const wb = readFileSync(wav.written); clean(wav.written, 'wav'); assert.equal(wb.readUInt32LE(24), 48000); assert.ok(wav.seconds > 0.8 && wav.seconds < 1.1, `${wav.seconds}s`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
