// TV after the run: the recap (SPEC.md › End of the run). Placings, a card per player, Health over the run,
// damage dealt and taken, kills · bosses · pets · Gold, titles, the Hall of Fame row, and the vault reminder.
import { h } from '../../../packages/ui/dom.js';
import { characterOf } from '../../../packages/shared/state.js';
import { placingsOf, healthSeries, lineChart, barChart, tallyRow, ordinal, className, SERIES_COLOURS } from '../../../packages/ui/recap.js';

export function renderEnded({ state, stage, rail, clockEls }) {
  delete clockEls.main; delete clockEls.banked;
  const rows = placingsOf(state);
  const winnerRow = rows.find(r => r.winner) || rows[0];
  const teamWin = state.mode === 'teams' && state.gm.teams?.[state.winner];
  const wrap = h('div', { class: 'recap' });
  wrap.append(h('div', { class: 'recap-head' },
    h('div', { class: 'tag' }, 'THE RUN IS OVER'),
    h('h1', { class: 'recap-title' }, teamWin ? `${teamWin.name} take the night` : winnerRow ? `${winnerRow.charName || winnerRow.name} takes the night` : 'Nobody takes the night'),
    h('div', { class: 'ital muted' }, state.endReason || '', state.runRecord ? ` · ${state.runRecord.rounds} round${state.runRecord.rounds === 1 ? '' : 's'} · ${state.runRecord.kills} kills · ${state.runRecord.bossesBeaten} boss${state.runRecord.bossesBeaten === 1 ? '' : 'es'} beaten` : '')));
  // Placings + player cards.
  const cards = h('div', { class: 'recap-cards' });
  rows.forEach((r, i) => {
    const c = characterOf(state, r.pid), st = state.stats[r.pid] || {}, colour = SERIES_COLOURS[i % SERIES_COLOURS.length];
    cards.append(h('div', { class: `recap-card panel${r.winner ? ' gold winner' : ''}${r.survived ? '' : ' dead'}`, style: { '--series': colour } },
      h('div', { class: 'recap-place display' }, ordinal(r.placing)),
      h('div', { class: 'row recap-id' }, h('span', { class: 'crest' }, c?.crest || state.players[r.pid]?.crest || '🂠'), h('div', {}, h('div', { class: 'display recap-name' }, r.charName || r.name), h('div', { class: 'small muted' }, `${r.name} · the ${className(r.classId)} · Lv ${r.level || 1} · ${r.survived ? 'survived' : `fell${c?.diedTo ? ' to ' + (state.monsters[c.diedTo]?.name || state.characters[c.diedTo]?.name || c.diedTo) : ''}`}`))),
      tallyRow([['kills', r.kills], ['bosses', r.bosses], ['pets', r.petsCaught], ['gold', r.gold], ['score', r.score]]),
      h('div', { class: 'small muted' }, `dealt ${st.damageDealt || 0} · taken ${st.damageTaken || 0} · hits ${st.hits || 0}${st.crits ? ` · crits ${st.crits}` : ''} · turns ${st.turns || 0}`),
      c?.titles?.length ? h('div', { class: 'titles' }, c.titles.map(t => h('span', { class: 'pill gold' }, t))) : null));
  });
  wrap.append(cards);
  // Charts.
  const hs = healthSeries(state);
  const charts = h('div', { class: 'recap-charts' });
  if (hs.series.length) charts.append(lineChart(hs, { title: 'Health over the run' }));
  const dmgRows = rows.map((r, i) => { const st = state.stats[r.pid] || {}; return { label: r.charName || r.name, values: [{ v: st.damageDealt || 0, colour: '#e0c07a', name: 'dealt' }, { v: st.damageTaken || 0, colour: '#c0262e', name: 'taken' }] }; });
  charts.append(barChart(dmgRows, { title: 'Damage dealt and taken', legend: [{ name: 'dealt', colour: '#e0c07a' }, { name: 'taken', colour: '#c0262e' }], height: 50 + rows.length * 44 }));
  wrap.append(charts);
  // Hall of Fame row for this room (falls back to the most recent rows the room knows).
  const hof = (state.hallOfFame || []).filter(x => x.roomId === state.roomId);
  const hofRows = (hof.length ? hof : (state.hallOfFame || []).slice(-6)).slice(0, 8);
  if (hofRows.length) wrap.append(h('div', { class: 'hof' }, h('div', { class: 'tag' }, 'HALL OF FAME'), h('div', { class: 'hof-row' }, hofRows.map(x => h('div', { class: 'hof-cell' }, h('b', {}, x.name), h('span', { class: 'small muted' }, ` ${className(x.classId)} · Lv ${x.level} · ${x.kills} kill${x.kills === 1 ? '' : 's'}${x.bosses ? ` · ${x.bosses} boss${x.bosses === 1 ? '' : 'es'}` : ''}${x.petsCaught ? ` · ${x.petsCaught} pet${x.petsCaught === 1 ? '' : 's'}` : ''}${x.tierCleared ? ` · cleared Tier ${x.tierCleared}` : ''}${x.survived ? '' : ' · †'}`))))));
  if (state.runRecord?.longestLived) wrap.append(h('div', { class: 'small muted ital' }, `Longest-lived: ${state.runRecord.longestLived.characterName}, ${state.runRecord.longestLived.turns} turns.${state.seasonEnded ? ' The season ends tonight: levels and quests reset, pets and titles carry over.' : ''}`));
  stage.append(wrap);
  // Rail.
  const vaulted = rows.filter(r => characterOf(state, r.pid)?.vaulted).length;
  rail.append(h('div', { class: 'panel gold vault-panel' }, h('div', { class: 'tag' }, 'THE VAULT'), h('div', { class: 'display vault-title' }, 'The vault is open on your phones'), h('p', { class: 'small muted' }, 'Survivors bank up to three items, the dead bank one; survivors may save their character as a veteran.'), h('p', { class: 'small' }, `${vaulted} of ${rows.length} have banked.`)));
  if (state.wall?.length) rail.append(h('div', { class: 'panel blood' }, h('div', { class: 'tag' }, 'THE WALL OF NAMES'), h('p', { class: 'small' }, state.wall.slice(-8).join(' · '))));
}
