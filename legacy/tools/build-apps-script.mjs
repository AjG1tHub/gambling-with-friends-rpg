// Builds sheet/Code.gs from sheet/Code.template.gs by embedding the game's built-in defaults,
// so the Sheet's “GWF → Add missing tabs & rows” menu always matches the code.   node tools/build-apps-script.mjs
import fs from 'node:fs';
const { DEFAULT_CONFIG } = await import('../site/js/config-default.js');
const root = new URL('..', import.meta.url);
// Headers for tabs whose built-in list is empty (so the tab is created with the right columns).
export const EMPTY_HEADERS = {
  PetSpecies: ['Id', 'Name', 'Emoji', 'Element', 'Rarity', 'Base', 'Grow', 'Evolves', 'Art'],
  PetBosses: ['Id', 'Name', 'Emoji', 'Element', 'Level', 'Stats', 'RewardGold', 'Art'],
  RaidBosses: ['Id', 'Name', 'Emoji', 'Element', 'Level', 'Stats', 'RewardGold', 'Art'],
  PetShop: ['Id', 'Name', 'Icon', 'Price', 'Desc', 'Gear'],
  SoundPacks: ['ThemeId', 'Wave', 'Root', 'Tempo'],
  Stakes: ['Ts', 'Players', 'Description', 'Settled'],
};
export function build() {
  const tpl = fs.readFileSync(new URL('sheet/Code.template.gs', root), 'utf8');
  const defaults = structuredClone(DEFAULT_CONFIG);
  return tpl.replace('/*__DEFAULTS__*/{}', JSON.stringify(defaults)).replace('/*__EMPTY_HEADERS__*/{}', JSON.stringify(EMPTY_HEADERS));
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  fs.writeFileSync(new URL('sheet/Code.gs', root), build());
  console.log('wrote sheet/Code.gs');
}
