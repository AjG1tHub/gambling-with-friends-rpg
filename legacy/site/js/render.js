// Shared render helpers: board + leaderboard (used by both windows).
import { esc } from './wheel-ui.js';
import { goldValue, netWorth, currentPlayer } from './state.js';
import { loanTags } from './loans.js';
import { powerOf, activePet, rankOf } from './pets.js';
import { rankMap, rankMovement } from './stats.js';

const TYPE_LABEL = { GAME: '🎰', GOOD: '😇 GOOD', BAD: '😈 BAD', JAIL: '🔒 JAIL', SHOP: '🛒 SHOP', START: '🏁 START' };

export function renderBoard(el, config, state, { clickable = false, onTileClick = null } = {}) {
  if (!state.board.length) { el.innerHTML = '<div class="subtle" style="grid-column:1/-1;align-self:center;text-align:center">No board yet — GM starts the session</div>'; return; }
  const cur = currentPlayer(state);
  el.innerHTML = state.board.map(t => {
    const players = state.players.filter(p => p.pos === t.idx);
    const tokens = players.map(p => token(p, cur)).join('');
    const isCur = cur && cur.pos === t.idx;
    const game = t.type === 'GAME' ? (config.Games || []).find(g => g.id === t.gameId) : null;
    const face = t.type === 'GAME'
      ? `${game?.icon || '🎰'}<span class="gname">${esc(game?.name || '')}</span>`
      : TYPE_LABEL[t.type];
    return `<div class="tile type-${t.type} color-${t.color.toLowerCase()} ${isCur ? 'current' : ''} ${clickable ? 'clickable' : ''}" data-idx="${t.idx}" style="--tc:var(--tile-${t.color.toLowerCase()})" title="${esc(game?.name || t.type)} · ${esc(t.color)}">
      <span class="num">${t.number}</span>
      <span class="cdot" style="background:var(--tile-${t.color.toLowerCase()})" title="${t.color}"></span>
      <span class="ttype">${face}</span>
      <div class="tokens">${tokens}</div>
    </div>`;
  }).join('');
  if (clickable && onTileClick) {
    el.querySelectorAll('.tile').forEach(tileEl =>
      tileEl.addEventListener('click', () => onTileClick(Number(tileEl.dataset.idx))));
  }
}

function token(p, cur) {
  const initials = esc(p.name.slice(0, 2).toUpperCase());
  // no-referrer defeats hotlink blocking (why icons often "didn't show");
  // on error the img swaps to initials instead of leaving a blank circle.
  const inner = p.iconUrl
    ? `<img src="${esc(p.iconUrl)}" referrerpolicy="no-referrer" alt="" onerror="this.replaceWith(this.parentElement.dataset.ini)">`
    : initials;
  const cls = ['token', p.jailTier > 0 ? 'jailed' : '', cur && cur.id === p.id ? 'current-turn' : ''].join(' ');
  return `<span class="${cls}" data-ini="${initials}" title="${esc(p.name)}${p.jailTier ? ' — JAIL ' + p.jailTier : ''}">${inner}</span>`;
}

export function renderLeaderboard(el, config, state) {
  if (!state.players.length) { el.innerHTML = '<div class="subtle">No players yet</div>'; return; }
  const rates = Object.fromEntries(config.Currencies.map(c => [c.name, c]));
  const sorted = [...state.players].sort((a, b) => netWorth(config, b) - netWorth(config, a));
  const moved = rankMovement(state.rankSnapshot, rankMap(config, state));
  const arrow = (id) => { const m = moved[id] || 0; return m > 0 ? `<span class="lb-move up" title="up ${m} since the round began">▲${m}</span>` : m < 0 ? `<span class="lb-move down" title="down ${-m} since the round began">▼${-m}</span>` : ''; };
  el.innerHTML = sorted.map(p => {
    const total = Math.round(netWorth(config, p));
    const curs = Object.entries(p.balances)
      .filter(([, amt]) => amt !== 0)
      .sort(([a], [b]) => (a === 'Gold' ? -1 : b === 'Gold' ? 1 : 0))
      .map(([cur, amt]) => `<span class="lb-cur">${rates[cur]?.emoji || ''} <b>${fmtNum(amt)}</b> ${esc(cur)}</span>`)
      .join('');
    const tags = [
      state.phase === 'playing' && !state.turnOrder.includes(p.id) ? `<span class="tag">SITTING OUT</span>` : '',
      p.jailTier > 0 ? `<span class="tag jail">JAIL ${p.jailTier}</span>` : '',
      p.pardons > 0 ? `<span class="tag buff">PARDON ×${p.pardons}</span>` : '',
      p.winMult ? `<span class="tag ${p.winMult.mult >= 1 ? 'buff' : 'debuff'}">next win ${p.winMult.mult}×</span>` : '',
      p.collector ? `<span class="tag debuff">Collector ${p.collector.turnsLeft}</span>` : '',
      p.skipTurns > 0 ? `<span class="tag debuff">skips ${p.skipTurns}</span>` : '',
      ...loanTags(p).map(t => `<span class="tag ${t.bad ? 'debuff' : ''}">🦈 ${esc(t.text)}</span>`),
      ...p.heldPowerUps.map(pu => `<span class="tag buff">${esc(pu.name)}</span>`),
      ...p.debuffs.map(d => `<span class="tag debuff">${esc(d.tag)}</span>`),
    ].join('');
    return `<div class="lb-player">
      <div class="lb-head">${token(p, currentPlayer(state))}<span class="lb-name">${esc(p.name)} ${arrow(p.id)}</span>${petChip(p)}<span class="lb-total">${fmtNum(total)}g</span></div>
      <div>${curs}</div><div class="lb-tags">${tags}</div>
    </div>`;
  }).join('');
}

// Side-game chip: active pet + Power Level (never part of the Gold total)
function petChip(p) {
  const pet = activePet(p), pw = powerOf(p);
  if (!pet && !pw) return '';
  return `<span class="lb-pet" title="${pet ? esc(pet.name) + ' — level ' + pet.level + ' ' + esc(pet.element) : 'No pet yet'} · Power Level ${pw} · ${rankOf(p).name}">${pet ? `${pet.emoji}<small>L${pet.level}</small>` : ''}<span class="lb-power">⚡${pw}</span></span>`;
}

export function fmtNum(n) {
  return (Math.round(n * 100) / 100).toLocaleString('en-US');
}
