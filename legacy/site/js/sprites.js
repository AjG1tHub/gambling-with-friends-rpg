// Pet art pipeline (Phase 7). Two sources, one call site:
//   1. Real art: a species (or boss) row may carry `art` — an image URL, or one URL per evolution
//      stage ([base, stage 1, stage 2]). Drop PNGs anywhere reachable and paste the links in the
//      PetSpecies / PetBosses tab; nothing else changes.
//   2. No art yet: a generated SVG crest — the creature's emoji on an element-coloured shield,
//      framed by rarity, with a pip per evolution stage. Always available, works offline.
import { speciesOf } from './pets.js';

export const ELEMENT_COLORS = {
  Fire: ['#ff8a3d', '#b3261e'], Water: ['#5cc8ff', '#1b4f9c'], Grass: ['#8fd16a', '#2c6e2f'],
  Electric: ['#ffe45c', '#c98a00'], Shadow: ['#9a7bd1', '#2a1b4d'], Light: ['#fff7c2', '#d9a521'],
};
export const RARITY_FRAME = { common: '#9aa0a6', uncommon: '#4caf50', rare: '#3f8cff', epic: '#b266ff', legendary: '#ffb300', boss: '#e53935', wild: '#8d6e63' };
const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Only http(s) and data:image URLs are ever put into an <img> — anything else falls back to the crest.
export const safeArtUrl = (url) => (typeof url === 'string' && /^(https?:\/\/|data:image\/(png|jpeg|jpg|gif|webp|svg\+xml)[;,])/i.test(url.trim()) ? url.trim() : null);

// Which art URL (if any) applies to this creature at this stage.
export function artFor(config, who) {
  const src = who.art ?? speciesOf(config, who.speciesId)?.art ?? (config?.PetBosses || []).find(b => b.id === who.bossId)?.art;
  if (!src) return null;
  if (Array.isArray(src)) { const stage = Math.min(who.stage || 0, src.length - 1); for (let i = stage; i >= 0; i--) { const u = safeArtUrl(src[i]); if (u) return u; } return null; }
  return safeArtUrl(src);
}

// The generated crest. `who` needs { emoji, element, rarity?, stage?, isBoss? }.
export function crestSvg(who, { size = 96 } = {}) {
  const [c1, c2] = ELEMENT_COLORS[who.element] || ['#cfcfcf', '#555'];
  const rarity = who.isBoss ? (who.wild ? 'wild' : 'boss') : (who.rarity || 'common');
  const frame = RARITY_FRAME[rarity] || RARITY_FRAME.common;
  const stage = Math.max(0, Math.min(2, Number(who.stage) || 0));
  const id = 'g' + hash(`${who.emoji}|${who.element}|${rarity}|${stage}`);
  const pips = Array.from({ length: stage }, (_, i) => `<circle cx="${50 + (i - (stage - 1) / 2) * 12}" cy="90" r="4" fill="#fff" stroke="${c2}" stroke-width="1.5"/>`).join('');
  const rays = rarity === 'legendary' || rarity === 'epic' || rarity === 'boss'
    ? Array.from({ length: 12 }, (_, i) => `<rect x="49" y="1" width="2" height="9" fill="${frame}" opacity=".8" transform="rotate(${i * 30} 50 50)"/>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" class="pet-crest" role="img" aria-label="${esc(who.name || 'pet')}">` +
    `<defs><radialGradient id="${id}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient></defs>` +
    rays +
    `<path d="M50 8 L86 22 V52 C86 72 70 86 50 94 C30 86 14 72 14 52 V22 Z" fill="url(#${id})" stroke="${frame}" stroke-width="5" stroke-linejoin="round"/>` +
    `<path d="M50 14 L80 26 V40 C66 34 38 34 20 44 V26 Z" fill="#fff" opacity=".18"/>` +
    `<text x="50" y="52" font-size="44" text-anchor="middle" dominant-baseline="central">${esc(who.emoji || '❔')}</text>` +
    pips + `</svg>`;
}
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

// HTML for a creature at a given pixel size: real art if the config has it, else the crest.
export function spriteHtml(config, who, size = 96) {
  const url = artFor(config, who);
  if (url) return `<img class="pet-art" src="${esc(url)}" width="${size}" height="${size}" alt="${esc(who.name || 'pet')}" referrerpolicy="no-referrer" onerror="this.outerHTML=this.dataset.fallback" data-fallback="${esc(crestSvg(who, { size }))}">`;
  return crestSvg(who, { size });
}
