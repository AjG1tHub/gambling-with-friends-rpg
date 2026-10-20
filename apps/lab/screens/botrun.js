// Lab screen: a bot run in the browser. tools/bots.mjs' loop (runGame, ported to packages/ui/labkit.js) plays a
// whole run with the shared bot policy against the deployed code and shows the report: turns, simulated minutes,
// deaths, kills, monsters, items, levels, stalls, refusals, and the Health / Gold curves as small SVGs.
//   /lab/?botrun=ffa&bots=4&seed=1&size=regular&tier=1
import { runGame, curveSvg, download, copyText } from '../../../packages/ui/labkit.js';
import { MODES, SIZES } from '../../../packages/shared/state.js';
import { qs } from '../../../packages/ui/dom.js';

let running = false, last = null;
export function screenBotrun(ctx) {
  const { h, main, lab } = ctx;
  const f = { mode: h('select', {}, MODES.map(m => h('option', { value: m, selected: (qs('botrun') || 'ffa') === m }, m))), bots: h('input', { type: 'number', min: 2, max: 10, value: Number(qs('bots') || 4), style: { maxWidth: '90px' } }), seed: h('input', { type: 'number', min: 1, value: Number(qs('seed') || 1), style: { maxWidth: '110px' } }), size: h('select', {}, SIZES.map(s => h('option', { value: s, selected: (qs('size') || 'regular') === s }, s))), tier: h('select', {}, [1, 2, 3].map(t => h('option', { value: t, selected: Number(qs('tier') || 1) === t }, `tier ${t}`))), aggression: h('input', { type: 'number', min: 0, max: 1, step: 0.1, value: 0.5, style: { maxWidth: '90px' } }) };
  const status = h('p', { class: 'muted' }, running ? 'Running…' : 'Ready. A run is 10–60 s in the browser.');
  const out = h('div', { class: 'col' });
  const go = h('button', { class: 'primary big', style: { width: 'auto' }, onClick: start }, '▶ Run');
  async function start() {
    if (running) return; running = true; go.disabled = true; out.replaceChildren();
    const opts = { mode: f.mode.value, bots: Number(f.bots.value), seed: Number(f.seed.value), size: f.size.value, tier: Number(f.tier.value), aggression: Number(f.aggression.value) };
    history.replaceState(null, '', `?botrun=${opts.mode}&bots=${opts.bots}&seed=${opts.seed}&size=${opts.size}&tier=${opts.tier}`);
    const t = Date.now();
    try {
      const r = await runGame(opts, ({ guard, state, now, t0 }) => { status.textContent = `Running… ${guard} loops · phase ${state.phase} · turn ${state.turnIdx} · ${Math.round((now - t0) / 60000)} sim-min · ${((Date.now() - t) / 1000).toFixed(1)} s`; });
      r.wallMs = Date.now() - t; last = r; window.__botrun = r;
      status.textContent = `Done in ${(r.wallMs / 1000).toFixed(1)} s.`;
      out.append(report(h, r));
    } catch (e) { console.error(e); status.textContent = `Failed: ${e.message}`; out.append(h('pre', { class: 'log error wrap' }, e.stack || e.message)); }
    running = false; go.disabled = false;
  }
  main.append(h('div', { class: 'panel col' }, h('p', { class: 'muted' }, 'The same loop as `node tools/bots.mjs`, in this browser: the runner acts as the TV (monster turns, deadlines) and every seat is the shared bot. Nothing touches a room or the backend.'),
    h('div', { class: 'row' }, h('label', { class: 'row' }, 'Mode ', f.mode), h('label', { class: 'row' }, 'Bots ', f.bots), h('label', { class: 'row' }, 'Seed ', f.seed), h('label', { class: 'row' }, 'Map ', f.size), f.tier, h('label', { class: 'row' }, 'Aggression ', f.aggression), go), status), out);
  if (last) out.append(report(h, last));
  if (qs('botrun') && !last && !running) start();
  lab.mount = null;
}
function report(h, r) {
  const stat = (v, label) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, label));
  const refusals = Object.entries(r.refusals).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const counts = Object.entries(r.counts).sort((a, b) => b[1] - a[1]);
  const text = JSON.stringify({ ...r, state: undefined, log: undefined }, null, 2);
  const bad = r.stalls > 0 || (r.ended || '').includes('runner cap');
  return h('div', { class: 'col' },
    h('div', { class: `panel ${bad ? 'blood' : 'gold'}` }, h('h3', {}, `${bad ? '✗' : '✓'} ${r.mode} × ${r.bots} · seed ${r.seed} · ended: ${r.ended || '—'} · winner ${r.winner || '—'}`),
      h('div', { class: 'report' }, stat(r.turns, 'turns'), stat(r.rounds, 'rounds'), stat(r.simMinutes, 'simulated minutes'), stat(r.events, 'events'), stat(r.deaths, 'deaths'), stat(r.kills, 'kills'), stat(`${r.monstersDead}/${r.monstersTotal}`, 'monsters killed'), stat(r.challenges, 'challenge pairs'), stat(r.legendaries, 'legendaries'), stat(r.letters, 'letters'), stat(r.stalls, 'stalls'), stat(`${(r.wallMs / 1000).toFixed(1)} s`, 'wall time')),
      h('p', { class: 'muted' }, `Items per bot ${r.items.join(' / ')} · levels ${r.levels.join(' / ')} · ${r.names.join(', ')}`),
      r.stallWitness ? h('p', { class: 'log error wrap' }, r.stallWitness) : null),
    h('div', { class: 'grid2', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' } },
      h('div', { class: 'panel' }, h('h3', {}, 'Health curve'), curveSvg(r.curve, { key: 'health' })), h('div', { class: 'panel' }, h('h3', {}, 'Gold curve'), curveSvg(r.curve, { key: 'gold' }))),
    h('div', { class: 'grid2', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' } },
      h('div', { class: 'panel' }, h('h3', {}, 'Refusals'), refusals.length ? h('ul', { class: 'muted' }, refusals.map(([k, v]) => h('li', {}, `${v}× ${k}`))) : h('p', { class: 'muted' }, 'None.')),
      h('div', { class: 'panel' }, h('h3', {}, 'Event counts'), h('p', { class: 'muted wrap' }, counts.map(([k, v]) => `${k} ${v}`).join(' · ')))),
    h('div', { class: 'panel' }, h('h3', {}, 'Last log lines'), h('div', { class: 'log log-box' }, r.log.map(l => h('div', { class: l.kind }, l.text))),
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { onClick: () => download(`gwf-botrun-${r.mode}-${r.bots}-${r.seed}.json`, text) }, 'Download report JSON'), h('button', { onClick: async () => copyText(text) }, 'Copy JSON'))));
}
