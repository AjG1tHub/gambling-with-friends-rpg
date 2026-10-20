// Colour cards for Card boots (SPEC.md › Boots and movement modes, Card). The six secret colours and their doubles
// are drawn from assets/cards/<colour>.svg with a CSS fallback in the colour itself, so a missing placeholder still
// shows a legible card. Colours never leave the mover's phone: only cardView() hands them here.
//
//   COLOURS                      { oxblood: '#5a1a1a', … }   the palette the TV never shows
//   colourHex(name)              '#…' for a colour name in any case
//   cardElement(card, { size })  { colour, double } → a <div class="ccard">
//   cardBackElement({ size })    the face-down card (the deck, the peek before it is turned)
//   cardRow(cards, { peek })     the drawn card(s) plus an optional "top of deck" peek
import { h } from './dom.js';

export const COLOURS = { oxblood: '#5a1a1a', bone: '#e8dfc8', brass: '#9c7a2e', verdigris: '#3f8a73', violet: '#6b3fa0', soot: '#2a2a2e' };
const norm = (c) => String(c || '').trim().toLowerCase();
export const colourHex = (name) => COLOURS[norm(name)] || '#444';
export const colourInk = (name) => (['bone', 'brass'].includes(norm(name)) ? '#1a1412' : '#e9e1cf');
export const cardImageUrl = (colour, double = false) => `/cards/${norm(colour)}${double ? '_double' : ''}.svg`;

export function cardElement(card, { size = 110, label = true } = {}) {
  if (!card) return cardBackElement({ size });
  const name = String(card.colour || '?');
  const el = h('div', { class: `ccard ${card.double ? 'double' : ''}`, style: { width: `${size}px`, height: `${Math.round(size * 1.5)}px`, background: colourHex(name), color: colourInk(name) }, 'aria-label': `${card.double ? 'double ' : ''}${name} card` },
    h('img', { src: cardImageUrl(name, !!card.double), alt: '', draggable: false, onError: (e) => { e.target.remove(); } }),
    label ? h('div', { class: 'ccard-label' }, h('b', {}, name.toUpperCase()), card.double ? h('span', {}, 'DOUBLE · second nearest') : null) : null);
  return el;
}
export function cardBackElement({ size = 110, text = '' } = {}) {
  return h('div', { class: 'ccard back', style: { width: `${size}px`, height: `${Math.round(size * 1.5)}px` } },
    h('img', { src: '/cards/back.svg', alt: '', draggable: false, onError: (e) => { e.target.remove(); } }), text ? h('div', { class: 'ccard-label' }, h('span', {}, text)) : null);
}
// The drawn card(s) with their meaning spelled out; `peek` is the next card when the boots allow a look.
export function cardRow(cards = [], { peek = null, size = 104 } = {}) {
  return h('div', { class: 'ccard-row' },
    cards.map(cd => cardElement(cd, { size })),
    peek ? h('div', { class: 'ccard-peek' }, cardElement(peek, { size: Math.round(size * 0.7) }), h('div', { class: 'tag' }, 'next card')) : null);
}
