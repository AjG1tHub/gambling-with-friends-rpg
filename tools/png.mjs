// Dependency-free PNG writer and tiny raster helpers for the placeholder generator.
// A canvas is { w, h, data: Uint8Array(w*h*4) } in RGBA. Nothing here is clever: flat fills, ellipses,
// a 1-px outline, a 5×7 bitmap font, nearest-neighbour scaling and a 9-slice stretch. The writer puts a
// tEXt chunk right after IHDR (keyword `gwf-placeholder`) so generated files can be told apart from real art.
import { deflateSync, inflateSync } from 'node:zlib';

export const PLACEHOLDER_KEYWORD = 'gwf-placeholder';

// ── CRC32 ──────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

// ── Canvas ─────────────────────────────────────────────────────────
export function canvas(w, h, fill = null) {
  const c = { w, h, data: new Uint8Array(w * h * 4) };
  if (fill) fillRect(c, 0, 0, w, h, fill);
  return c;
}
export const hex = (s) => { const m = s.replace('#', ''); const n = parseInt(m.length === 3 ? m.split('').map(ch => ch + ch).join('') : m, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; };
export const rgba = (r, g, b, a = 255) => [r, g, b, a];
export function mix(a, b, t) { return [0, 1, 2, 3].map(i => Math.round(a[i] + (b[i] - a[i]) * t)); }
export const darken = (c, t) => mix(c, [0, 0, 0, c[3]], t);
export const lighten = (c, t) => mix(c, [255, 255, 255, c[3]], t);

export function put(c, x, y, col) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4, a = col[3] / 255;
  if (a >= 1) { c.data[i] = col[0]; c.data[i + 1] = col[1]; c.data[i + 2] = col[2]; c.data[i + 3] = 255; return; }
  if (a <= 0) return;
  const da = c.data[i + 3] / 255, oa = a + da * (1 - a);
  for (let k = 0; k < 3; k++) c.data[i + k] = Math.round((col[k] * a + c.data[i + k] * da * (1 - a)) / (oa || 1));
  c.data[i + 3] = Math.round(oa * 255);
}
export function get(c, x, y) { if (x < 0 || y < 0 || x >= c.w || y >= c.h) return [0, 0, 0, 0]; const i = (y * c.w + x) * 4; return [c.data[i], c.data[i + 1], c.data[i + 2], c.data[i + 3]]; }

export function fillRect(c, x, y, w, h, col) {
  const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(c.w, (x + w) | 0), y1 = Math.min(c.h, (y + h) | 0);
  if (col[3] >= 255) {
    for (let yy = y0; yy < y1; yy++) { let i = (yy * c.w + x0) * 4; for (let xx = x0; xx < x1; xx++, i += 4) { c.data[i] = col[0]; c.data[i + 1] = col[1]; c.data[i + 2] = col[2]; c.data[i + 3] = 255; } }
  } else for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) put(c, xx, yy, col);
}
export function strokeRect(c, x, y, w, h, col, t = 1) {
  fillRect(c, x, y, w, t, col); fillRect(c, x, y + h - t, w, t, col); fillRect(c, x, y, t, h, col); fillRect(c, x + w - t, y, t, h, col);
}
export function ellipse(c, cx, cy, rx, ry, col) {
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(c.w - 1, Math.ceil(cx + rx)), y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(c.h - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry; if (dx * dx + dy * dy <= 1) put(c, x, y, col); }
}
export const circle = (c, cx, cy, r, col) => ellipse(c, cx, cy, r, r, col);
export function line(c, x0, y0, x1, y1, col, t = 1) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
  for (;;) {
    if (t <= 1) put(c, x0, y0, col); else fillRect(c, x0 - (t >> 1), y0 - (t >> 1), t, t, col);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
// Polygon fill (even-odd scanline, so concave shapes work): pts = [[x,y],...] in order.
export function polygon(c, pts, col) {
  const ys = pts.map(p => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(c.h - 1, Math.ceil(Math.max(...ys)));
  const n = pts.length;
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5, xs = [];
    for (let i = 0; i < n; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n]; if ((ay <= py && by > py) || (by <= py && ay > py)) xs.push(ax + (py - ay) * (bx - ax) / (by - ay)); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) { const xa = Math.max(0, Math.round(xs[k])), xb = Math.min(c.w, Math.round(xs[k + 1])); for (let x = xa; x < xb; x++) put(c, x, y, col); }
  }
}
export function polyline(c, pts, col, t = 1, close = false) {
  for (let i = 0; i < pts.length - (close ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; line(c, a[0], a[1], b[0], b[1], col, t); }
}
// Pointy-top hex points for a hex inscribed in a size×size square (flat sides left/right).
export function hexPoints(cx, cy, r) {
  const pts = []; for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return pts;
}
export function regularPolygon(cx, cy, r, n, rot = -Math.PI / 2) {
  const pts = []; for (let i = 0; i < n; i++) { const a = rot + 2 * Math.PI * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return pts;
}
// 1-px outline around every opaque pixel (drawn into transparent neighbours).
export function outline(c, col, alphaMin = 128) {
  const src = c.data.slice();
  const solid = (x, y) => x >= 0 && y >= 0 && x < c.w && y < c.h && src[(y * c.w + x) * 4 + 3] >= alphaMin;
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (solid(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) put(c, x, y, col);
  }
}
// Radial vignette: darkens toward the edges. strength 0..1.
export function vignette(c, strength = 0.6, col = [0, 0, 0, 255]) {
  const cx = c.w / 2, cy = c.h / 2, R = Math.hypot(cx, cy);
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R; const a = Math.max(0, Math.min(1, (d - 0.35) / 0.65)) ** 2 * strength;
    if (a > 0.004) put(c, x, y, [col[0], col[1], col[2], Math.round(a * 255)]);
  }
}
// Seeded noise over opaque pixels: ±amp per channel, sparse (one pixel in `every`).
export function noise(c, seed, amp = 10, every = 3) {
  const rnd = mulberry32(hashKey(seed));
  for (let i = 0; i < c.w * c.h; i++) {
    if (rnd() * every >= 1) continue;
    const o = i * 4; if (c.data[o + 3] === 0) continue;
    const d = Math.round((rnd() * 2 - 1) * amp);
    for (let k = 0; k < 3; k++) c.data[o + k] = Math.max(0, Math.min(255, c.data[o + k] + d));
  }
}
export function hashKey(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Blit `src` onto `dst` at (x, y) with alpha.
export function blit(dst, src, x, y) {
  for (let yy = 0; yy < src.h; yy++) for (let xx = 0; xx < src.w; xx++) { const i = (yy * src.w + xx) * 4; if (src.data[i + 3]) put(dst, x + xx, y + yy, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]); }
}
// Nearest-neighbour scale to w×h.
export function scale(src, w, h) {
  const out = canvas(w, h);
  for (let y = 0; y < h; y++) { const sy = Math.min(src.h - 1, Math.floor(y * src.h / h)); for (let x = 0; x < w; x++) { const sx = Math.min(src.w - 1, Math.floor(x * src.w / w)); const si = (sy * src.w + sx) * 4, di = (y * w + x) * 4; out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3]; } }
  return out;
}
export function crop(src, x, y, w, h) { const out = canvas(w, h); for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const [r, g, b, a] = get(src, x + xx, y + yy); const i = (yy * w + xx) * 4; out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = a; } return out; }
// 9-slice: stretch `src` (with `inset` px borders) to w×h, corners kept, edges and centre tiled by nearest sampling.
export function nineSlice(src, inset, w, h) {
  const out = canvas(w, h);
  const map = (v, size, total) => v < inset ? v : v >= total - inset ? size - (total - v) : inset + Math.floor((v - inset) * (size - 2 * inset) / Math.max(1, total - 2 * inset));
  for (let y = 0; y < h; y++) { const sy = map(y, src.h, h); for (let x = 0; x < w; x++) { const sx = map(x, src.w, w); const si = (sy * src.w + sx) * 4, di = (y * w + x) * 4; out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3]; } }
  return out;
}

// ── 5×7 bitmap font (A-Z 0-9 and a little punctuation) ─────────────
const FONT = {
  A: '0E 11 11 1F 11 11 11', B: '1E 11 11 1E 11 11 1E', C: '0E 11 10 10 10 11 0E', D: '1E 11 11 11 11 11 1E', E: '1F 10 10 1E 10 10 1F', F: '1F 10 10 1E 10 10 10', G: '0E 11 10 17 11 11 0F', H: '11 11 11 1F 11 11 11', I: '0E 04 04 04 04 04 0E', J: '07 02 02 02 02 12 0C', K: '11 12 14 18 14 12 11', L: '10 10 10 10 10 10 1F', M: '11 1B 15 15 11 11 11', N: '11 11 19 15 13 11 11', O: '0E 11 11 11 11 11 0E', P: '1E 11 11 1E 10 10 10', Q: '0E 11 11 11 15 12 0D', R: '1E 11 11 1E 14 12 11', S: '0F 10 10 0E 01 01 1E', T: '1F 04 04 04 04 04 04', U: '11 11 11 11 11 11 0E', V: '11 11 11 11 11 0A 04', W: '11 11 11 15 15 15 0A', X: '11 11 0A 04 0A 11 11', Y: '11 11 11 0A 04 04 04', Z: '1F 01 02 04 08 10 1F',
  0: '0E 11 13 15 19 11 0E', 1: '04 0C 04 04 04 04 0E', 2: '0E 11 01 02 04 08 1F', 3: '1F 02 04 02 01 11 0E', 4: '02 06 0A 12 1F 02 02', 5: '1F 10 1E 01 01 11 0E', 6: '06 08 10 1E 11 11 0E', 7: '1F 01 02 04 08 08 08', 8: '0E 11 11 0E 11 11 0E', 9: '0E 11 11 0F 01 02 0C',
  ' ': '00 00 00 00 00 00 00', '-': '00 00 00 1F 00 00 00', '.': '00 00 00 00 00 0C 0C', '?': '0E 11 01 02 04 00 04', '!': '04 04 04 04 04 00 04', '+': '00 04 04 1F 04 04 00', '$': '04 0F 14 0E 05 1E 04', '%': '18 19 02 04 08 13 03', '#': '0A 0A 1F 0A 1F 0A 0A', '/': '01 01 02 04 08 10 10', ':': '00 0C 0C 00 0C 0C 00', '~': '00 00 08 15 02 00 00', '|': '04 04 04 04 04 04 04', '*': '00 0A 04 1F 04 0A 00', "'": '04 04 00 00 00 00 00', ',': '00 00 00 00 0C 04 08', '(': '02 04 08 08 08 04 02', ')': '08 04 02 02 02 04 08', '<': '02 04 08 10 08 04 02', '>': '08 04 02 01 02 04 08', '=': '00 00 1F 00 1F 00 00', 'x': '00 00 11 0A 04 0A 11', 'v': '00 00 11 11 11 0A 04', '&': '0C 12 14 08 15 12 0D',
};
export function glyph(ch) { const rows = FONT[ch] || FONT[String(ch).toUpperCase()] || FONT['?']; return rows.split(' ').map(h => parseInt(h, 16)); }
export function textWidth(s, px = 1, spacing = 1) { return s.length * (5 + spacing) * px - spacing * px; }
// Draw text at (x,y), each font pixel is px×px; returns width drawn.
export function text(c, x, y, s, col, px = 1, spacing = 1) {
  let cx = x;
  for (const ch of String(s)) {
    const rows = glyph(ch);
    for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) if (rows[r] & (16 >> b)) fillRect(c, cx + b * px, y + r * px, px, px, col);
    cx += (5 + spacing) * px;
  }
  return cx - x;
}
export function textCentered(c, cx, cy, s, col, px = 1) { const w = textWidth(s, px); text(c, Math.round(cx - w / 2), Math.round(cy - 3.5 * px), s, col, px); }

// ── Encode / inspect ───────────────────────────────────────────────
export function encodePNG(c, { texts = {} } = {}) {
  const { w, h, data } = c;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  for (const [k, v] of Object.entries(texts)) parts.push(chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(String(v), 'latin1')])));
  parts.push(chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
export const encodePlaceholderPNG = (c, info = '1') => encodePNG(c, { texts: { [PLACEHOLDER_KEYWORD]: info } });

// Walk chunks: returns { width, height, texts: {k: v}, isPNG }.
export function inspectPNG(buf) {
  const out = { isPNG: false, width: 0, height: 0, texts: {} };
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return out;
  out.isPNG = true; let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    if (type === 'IHDR') { out.width = buf.readUInt32BE(p + 8); out.height = buf.readUInt32BE(p + 12); }
    else if (type === 'tEXt') { const d = buf.subarray(p + 8, p + 8 + len); const z = d.indexOf(0); out.texts[d.toString('latin1', 0, z)] = d.toString('latin1', z + 1); }
    else if (type === 'IDAT' || type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}
export const isPlaceholderPNG = (buf) => PLACEHOLDER_KEYWORD in inspectPNG(buf).texts;
// Decode an 8-bit RGBA non-interlaced PNG we wrote ourselves (tests only).
export function decodePNG(buf) {
  const info = inspectPNG(buf); let p = 8; const idat = [];
  while (p + 8 <= buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8); if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len)); p += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)); const { width: w, height: h } = info; const c = canvas(w, h);
  for (let y = 0; y < h; y++) { if (raw[y * (w * 4 + 1)] !== 0) throw new Error('decodePNG: only filter 0 supported'); c.data.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4); }
  return c;
}
