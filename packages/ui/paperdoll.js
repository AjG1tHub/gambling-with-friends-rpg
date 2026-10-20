// The paper doll (SPEC.md › Inventory grid, Character sprites): the crest and the live sprite on a pawn-shop
// stand with the 15 worn slots around it (+ the cape when the Infernal Mantle is about). Every slot is a drop
// target for the grid's drag controller (`data-slot`), a worn item can be long-pressed and dragged back into
// the grid or onto another legal slot, and a tap opens the item's sheet.
import { h } from './dom.js';
import { spriteElement, uiUrl, crestUrl, rarityColour, manifestNow, loadManifest } from './sprite.js';
import { itemIcon, pressable, gridUi, rerenderSoon, SLOT_LABEL } from './grid.js';
import { WORN_SLOTS } from '../shared/characters/character.js';

const LEFT = ['mainhand', 'offhand', 'spell1', 'spell2'], RIGHT = ['helmet', 'torso', 'pants', 'boots'], RINGS = ['ring1', 'ring2', 'ring3', 'ring4'];

function slotEl(c, slot, dispatch, { size = 54, round = false } = {}) {
  const item = c?.worn?.[slot] || null;
  const el = h('div', { class: `doll-slot ${item ? 'full' : 'empty'} ${round ? 'round' : ''} ${gridUi.selected && item?.id === gridUi.selected ? 'selected' : ''}`, 'data-slot': slot, role: 'button', tabindex: 0, 'aria-label': `${SLOT_LABEL[slot] || slot}${item ? `: ${item.name}` : ' (empty)'}`, style: { width: `${size}px`, height: `${size}px` } });
  const sil = uiUrl(`slot_${slot}`); if (sil) el.style.backgroundImage = `url("${sil}")`;
  if (item) {
    el.style.borderColor = rarityColour(item.rarity);
    el.append(itemIcon(item, size - 6));
    pressable(el, { item, from: { kind: 'slot', slot }, c, dispatch, onTap: (it) => { gridUi.held = null; gridUi.selected = gridUi.selected === it.id ? null : it.id; gridUi.confirmDrop = null; gridUi.trade = null; rerenderSoon(); } });
  } else {
    el.append(h('span', { class: 'doll-slot-ab' }, (SLOT_LABEL[slot] || slot).slice(0, 2).toUpperCase()));
    el.addEventListener('click', () => {
      // Tapping an empty slot with a held item equips it there.
      const hd = gridUi.held; if (!hd || gridUi.drag) return; const it = c.items?.[hd.itemId]; if (!it) return;
      gridUi.held = null; dispatch?.('GRID_EQUIP', { itemId: it.id, slot });
    });
  }
  return el;
}
const labelled = (c, slot, dispatch, opts) => h('div', { class: 'doll-cell' }, slotEl(c, slot, dispatch, opts), h('span', { class: 'doll-label' }, SLOT_LABEL[slot] || slot));

export function paperdollElement({ c, state, dispatch, scale = 2 } = {}) {
  if (!c) return h('div', { class: 'doll empty' }, h('p', { class: 'muted ital' }, 'No character yet.'));
  const showCape = !!c.worn?.cape || Object.values(c.items || {}).some(it => it?.legendaryId === 'infernalmantle');
  const crestImg = crestUrl(c.classId);
  const stand = h('div', { class: 'doll-stand' },
    h('div', { class: 'doll-crest' }, crestImg ? h('img', { src: crestImg, alt: '', draggable: false }) : null, h('span', { class: 'doll-crest-emoji' }, c.crest || '🂠')),
    spriteElement(c, { scale, pets: true, className: 'sprite doll-sprite' }),
    h('div', { class: 'doll-class' }, (c.classId || '').toUpperCase()),
    showCape ? h('div', { class: 'doll-cape' }, slotEl(c, 'cape', dispatch, { size: 44 }), h('span', { class: 'doll-label' }, 'Cape')) : null);
  const standBg = uiUrl('doll_stand'); if (standBg) stand.style.backgroundImage = `url("${standBg}")`;
  if (!manifestNow()) loadManifest().then(() => rerenderSoon());
  const col = (slots) => h('div', { class: 'doll-col' }, slots.map(s => labelled(c, s, dispatch)));
  const rings = h('div', { class: 'doll-rings' }, RINGS.map(s => slotEl(c, s, dispatch, { size: 44, round: true })));
  const el = h('div', { class: 'doll' },
    h('div', { class: 'doll-main' }, col(LEFT), stand, col(RIGHT)),
    h('div', { class: 'doll-foot' }, labelled(c, 'gloves', dispatch), h('div', { class: 'doll-cell' }, rings, h('span', { class: 'doll-label' }, 'Rings')), labelled(c, 'necklace', dispatch)),
    h('div', { class: 'doll-note muted ital' }, gridUi.held ? 'tap a slot to wear it' : 'worn items take no cells'));
  // Every slot the engine knows is on the doll, so a new slot never silently vanishes.
  for (const s of WORN_SLOTS) if (!el.querySelector(`[data-slot="${s}"]`) && (s !== 'cape' || showCape)) el.append(labelled(c, s, dispatch));
  return el;
}
