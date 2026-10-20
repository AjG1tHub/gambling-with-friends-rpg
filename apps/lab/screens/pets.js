// Lab screen: a pet species. Its four attacks are minigame rolls staked from the pet's Power (chips mode in the
// adapter, the pet's Power as the pool), with the payoff rules of PET_ATTACK: hits, heals, Gold, eat-a-turn; a
// losing roll costs Power; a winning one earns pets.winPower. Stages and evolution thresholds alongside.
import { speciesDef } from '../../../packages/shared/handlers/pets.js';
import { startRound, gameMeta } from '../../../packages/games/adapter.js';
import { makeRng, hash32 } from '../../../packages/shared/rng.js';
import { B } from '../../../packages/shared/balance.js';
import { mountRound } from '../../../packages/ui/labkit.js';

const pets = {};   // practice pets per species, kept for the session
export function screenPets(ctx) {
  const { lab, h, main, phone, id } = ctx;
  const sid = id.slice('pet:'.length), sp = speciesDef(sid); if (!sp) { main.append(h('p', { class: 'log error' }, `Unknown species ${sid}`)); return; }
  const P = B.pets;
  const pet = pets[sid] ||= { power: P.startPower + P.sessionPowerBonus, maxPower: P.startPower + P.sessionPowerBonus, stage: 0, bodies: sp.swarm ? P.swarmBodies : null, fainted: false };
  const D = lab.state.dummy, T = lab.state.tester;
  const stageName = () => sp.stages?.[pet.stage]?.name || sp.name;
  const bars = h('div', { class: 'panel opponent' });
  const drawBars = () => bars.replaceChildren(
    h('div', { class: 'who' }, h('b', {}, `${stageName()} (${sp.element})`), h('div', { class: 'bar ok' }, h('i', { style: { width: `${Math.round(100 * pet.power / pet.maxPower)}%` } })), h('div', { class: 'muted' }, `${pet.power}/${pet.maxPower} Power · stage ${pet.stage + 1}${pet.bodies != null ? ` · ${pet.bodies} bodies` : ''}${pet.fainted ? ' · FAINTED' : ''}`)),
    h('div', { class: 'vs' }, 'VS'), h('div', { class: 'who' }, h('b', {}, D.name), h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(100 * D.health / D.maxHealth)}%` } })), h('div', { class: 'muted' }, `${D.health}/${D.maxHealth} Health · trainer ${T.health}/${T.maxHealth}`)));
  drawBars();
  const stageEl = h('div', { class: 'gwf-stage' }), controlsEl = h('div', { class: 'gwf-controls' }), result = h('div', { class: 'lab-result' }), log = h('div', { class: 'log log-box' });
  const msg = (t, cls = '') => { log.prepend(h('div', { class: cls }, t)); while (log.children.length > 10) log.lastChild.remove(); };
  let current = null;
  const evolve = () => { const thr = P.evolveAt || []; const want = pet.power >= (thr[1] || Infinity) ? 2 : pet.power >= (thr[0] || Infinity) ? 1 : 0; if (want > pet.stage) { pet.stage = want; pet.maxPower += P.powerPerStage * (sp.stages?.[want]?.powerSteps || 1); msg(`${sp.name} evolves into ${stageName()}!`, 'turn'); } };
  const swing = (i) => {
    const atk = sp.attacks[i]; if (!atk) return;
    let stake = atk.stake; if (atk.perBody && pet.bodies) stake = Math.max(1, Math.round(atk.stake * pet.bodies / P.swarmBodies));
    if (pet.fainted || pet.power < stake) { pet.power = pet.maxPower; pet.fainted = false; if (pet.bodies != null) pet.bodies = P.swarmBodies; msg('Pet revived to full Power.'); }
    lab.mount?.stop?.(); current = i;
    const round = startRound(null, { gameId: atk.gameId, mode: 'chips', stake, attacker: { id: 'pet', name: stageName(), stats: T.stats }, target: D, rng: makeRng(hash32(`${lab.seed}:pet:${sid}:${Date.now()}`)), now: Date.now() });
    result.textContent = ''; result.className = 'lab-result';
    const handle = mountRound({ round, stageEl, controlsEl, phone, autoSettle: lab.autoSettle, onSettle: (o) => {
      const mult = o.mult; let text;
      if (mult > 1) {
        let amount = Math.round(stake * mult); if (atk.doubling) amount *= 2;
        if (atk.effect === 'healTrainer') { const before = T.health; T.health = Math.min(T.maxHealth, T.health + amount); text = `heals the trainer ${T.health - before}`; }
        else if (atk.effect === 'healSelf') { pet.power = Math.min(pet.maxPower, pet.power + amount); text = `restores ${amount} Power`; }
        else if (atk.effect === 'gold') text = `scratches up ${amount} Gold`;
        else { D.health = Math.max(0, D.health - amount); text = `hits ${D.name} for ${amount}${atk.effect === 'eatTurn' ? ' and eats its next turn' : ''}`; if (D.health === 0) { D.health = D.maxHealth; text += ' — the dummy drops and resets'; } }
        pet.power = Math.min(pet.maxPower, pet.power + P.winPower); evolve();
      } else if (mult < 1) { const lost = Math.round(stake * (1 - mult)); pet.power = Math.max(0, pet.power - lost); text = `fails: −${lost} Power`; if (pet.power === 0) { if (pet.bodies != null && pet.bodies > 1) { pet.bodies -= 1; pet.power = Math.round(pet.maxPower / P.swarmBodies); text += ` · a body falls (${pet.bodies} left)`; } else { pet.fainted = true; text += ' · FAINTS'; } } }
      else text = 'a push';
      result.textContent = `${atk.name}: ${o.label} · ${mult}× · ${text}${o.crit ? ' · CRIT' : ''}`; result.className = `lab-result ${mult > 1 ? 'win' : mult < 1 ? 'lose' : ''}`;
      msg(result.textContent, mult > 1 ? 'turn' : ''); drawBars(); lab.record(id, stake, mult, o.crit);
    } });
    handle.auto = () => { if (round.settled) return; round.play(makeRng(hash32(`${lab.seed}:petbot:${Date.now()}`)), true); handle.redraw(); handle.tick(); };
    lab.mount = handle;
  };
  lab.quickStake = (k) => swing(k === 1 ? 0 : sp.attacks.length - 1);
  const attacks = h('div', { class: 'chip-row' }, sp.attacks.map((a, i) => h('button', { class: i === current ? 'primary' : '', onClick: () => swing(i) }, `${a.name} · ${gameMeta(a.gameId).icon} ${a.gameId} · ${a.stake}${a.effect ? ` · ${a.effect}` : ''}`)));
  main.append(bars,
    h('div', { class: 'panel col' }, h('p', { class: 'muted' }, `${sp.flavour || ''} Pool: ${sp.pool}${sp.regionBias ? ` (region bias ${sp.regionBias})` : ''}${sp.onlyRegion ? ` · only from ${sp.onlyRegion} eggs` : ''}${sp.swarm ? ` · swarm of ${P.swarmBodies}` : ''}.`), attacks, stageEl, controlsEl, result,
      h('div', { class: 'row' }, h('button', { onClick: () => lab.mount?.auto?.() }, '🤖 Auto-play'), h('button', { onClick: () => { if (!lab.mount?.settle?.()) ctx.toast('Nothing to settle yet.'); } }, 'Settle'), h('button', { class: 'ghost', onClick: () => { pet.power = pet.maxPower; pet.fainted = false; drawBars(); } }, 'Revive')), log),
    h('div', { class: 'panel' }, h('h3', {}, 'Stages'), h('table', { class: 'lab' }, h('thead', {}, h('tr', {}, h('th', {}, 'Stage'), h('th', {}, 'Name'), h('th', {}, 'Reached at'), h('th', {}, 'Max Power'))), h('tbody', {}, (sp.stages || []).map((s, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, s.name), h('td', {}, i === 0 ? 'hatch' : `${(P.evolveAt || [])[i - 1]} Power`), h('td', {}, P.startPower + P.sessionPowerBonus + P.powerPerStage * (s.powerSteps || 0)))))),
      h('p', { class: 'muted' }, `Hatch: ${P.startPower} Power (+${P.sessionPowerBonus} per run). A winning attack earns ${P.winPower} Power; a losing one costs stake × (1 − mult). The loser's pet takes a Challenge hit first.`)));
  swing(0);
}
