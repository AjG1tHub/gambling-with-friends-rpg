import { test } from 'node:test';
import assert from 'node:assert/strict';
import './_helpers.mjs';
const SP = await import('../../site/js/sprites.js');
const PT = await import('../../site/js/pets.js');

const balanced = (svg) => { const open = (svg.match(/<(svg|defs|radialGradient|text)\b/g) || []).length, close = (svg.match(/<\/(svg|defs|radialGradient|text)>/g) || []).length; return open === close; };

test('every element has a colour pair and every rarity a frame', () => {
  for (const el of PT.ELEMENTS) { assert.equal(SP.ELEMENT_COLORS[el].length, 2); for (const c of SP.ELEMENT_COLORS[el]) assert.match(c, /^#[0-9a-f]{6}$/i); }
  for (const r of Object.keys(PT.RARITY_WEIGHT)) assert.match(SP.RARITY_FRAME[r], /^#[0-9a-f]{6}$/i);
});

test('the crest is well-formed SVG carrying the emoji, element colours and rarity frame', () => {
  for (const sp of PT.DEFAULT_SPECIES) {
    const svg = SP.crestSvg({ ...sp, stage: 0 });
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>')); assert.ok(balanced(svg), sp.id);
    assert.ok(svg.includes(sp.emoji)); assert.ok(svg.includes(SP.ELEMENT_COLORS[sp.element][0])); assert.ok(svg.includes(SP.RARITY_FRAME[sp.rarity]));
  }
});

test('evolution stages add pips; epic, legendary and boss crests get rays', () => {
  const pips = (stage) => (SP.crestSvg({ emoji: '🦊', element: 'Fire', rarity: 'common', stage }).match(/<circle/g) || []).length;
  assert.deepEqual([0, 1, 2, 7].map(pips), [0, 1, 2, 2]);
  const rays = (who) => (SP.crestSvg(who).match(/<rect/g) || []).length;
  assert.equal(rays({ emoji: 'x', element: 'Fire', rarity: 'common' }), 0); assert.equal(rays({ emoji: 'x', element: 'Fire', rarity: 'legendary' }), 12);
  assert.equal(rays({ emoji: 'x', element: 'Fire', isBoss: true }), 12); assert.equal(rays({ emoji: 'x', element: 'Fire', isBoss: true, wild: {} }), 0);
});

test('the crest is deterministic and survives unknown elements, missing emoji and hostile names', () => {
  const who = { emoji: '🐉', element: 'Light', rarity: 'epic', stage: 1, name: 'Sunny' };
  assert.equal(SP.crestSvg(who), SP.crestSvg({ ...who }));
  assert.ok(balanced(SP.crestSvg({ element: 'Plasma' }))); assert.ok(SP.crestSvg({ element: 'Plasma' }).includes('❔'));
  const evil = SP.crestSvg({ emoji: '<script>', element: 'Fire', name: '"><img onerror=x>' });
  assert.ok(!evil.includes('<script>') && !evil.includes('<img')); assert.ok(evil.includes('&lt;script&gt;'));
});

test('the size option sets width and height', () => {
  assert.match(SP.crestSvg({ emoji: 'x', element: 'Fire' }, { size: 40 }), /width="40" height="40"/);
});

test('only http(s) and image data URLs count as art', () => {
  assert.equal(SP.safeArtUrl(' https://example.com/fox.png '), 'https://example.com/fox.png');
  assert.ok(SP.safeArtUrl('data:image/png;base64,AAAA'));
  for (const bad of ['javascript:alert(1)', 'data:text/html,<b>', 'fox.png', '', null, 42, 'ftp://x/y.png']) assert.equal(SP.safeArtUrl(bad), null, String(bad));
});

test('species art: one URL, or one per stage with fallback to the nearest earlier stage', () => {
  const cfg = { PetSpecies: [
    { id: 'a', name: 'A', emoji: 'a', element: 'Fire', art: 'https://x/a.png' },
    { id: 'b', name: 'B', emoji: 'b', element: 'Fire', art: ['https://x/b0.png', '', 'https://x/b2.png'] },
    { id: 'c', name: 'C', emoji: 'c', element: 'Fire' },
    { id: 'd', name: 'D', emoji: 'd', element: 'Fire', art: 'javascript:alert(1)' },
  ] };
  assert.equal(SP.artFor(cfg, { speciesId: 'a', stage: 2 }), 'https://x/a.png');
  assert.deepEqual([0, 1, 2, 5].map(stage => SP.artFor(cfg, { speciesId: 'b', stage })), ['https://x/b0.png', 'https://x/b0.png', 'https://x/b2.png', 'https://x/b2.png']);
  assert.equal(SP.artFor(cfg, { speciesId: 'c' }), null); assert.equal(SP.artFor(cfg, { speciesId: 'd' }), null);
  assert.equal(SP.artFor({ PetBosses: [{ id: 'boss1', art: 'https://x/boss.png' }] }, { bossId: 'boss1' }), 'https://x/boss.png');
  assert.equal(SP.artFor({}, { speciesId: 'emberfox' }), null);                                  // built-ins ship without art
});

test('spriteHtml uses real art when present (with a crest fallback if the image fails), else the crest', () => {
  const cfg = { PetSpecies: [{ id: 'a', name: 'A', emoji: '🦊', element: 'Fire', art: 'https://x/a.png?x=1&y=2' }] };
  const img = SP.spriteHtml(cfg, { speciesId: 'a', emoji: '🦊', element: 'Fire', name: 'Foxy' }, 80);
  assert.ok(img.startsWith('<img')); assert.ok(img.includes('src="https://x/a.png?x=1&amp;y=2"')); assert.ok(img.includes('width="80"')); assert.ok(img.includes('data-fallback="&lt;svg'));
  const crest = SP.spriteHtml({}, { speciesId: 'emberfox', emoji: '🦊', element: 'Fire' }, 80);
  assert.ok(crest.startsWith('<svg')); assert.ok(crest.includes('width="80"'));
});
