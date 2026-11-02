// npm run art:report — progress by group and priority (real vs placeholder vs queued), reviewer verdicts, total
// spend from art/ledger.json. `--json` prints the same as JSON (the Lab art page uses it through the review server).
import { rows, isReal, toolFor, loadLedger, loadReview, ROOT } from './lib.mjs';

export function report() {
  const list = rows(), ledger = loadLedger(), review = loadReview();
  const groups = {}; let spend = 0;
  for (const r of list) {
    const g = (groups[r.group] ||= { total: 0, real: 0, queued: 0, failed: 0, P1: { total: 0, real: 0 }, P2: { total: 0, real: 0 }, P3: { total: 0, real: 0 }, approve: 0, redo: 0, tool: toolFor(r) });
    const real = isReal(r); const e = ledger.entries[r.key]; const v = review.entries[r.key]?.verdict;
    g.total++; g[r.priority].total++; if (real) { g.real++; g[r.priority].real++; }
    if (e?.status === 'queued' && !real) g.queued++; if (e?.status === 'failed' && !real) g.failed++;
    if (v === 'approve') g.approve++; if (/^redo/.test(v || '')) g.redo++;
  }
  for (const e of Object.values(ledger.entries)) spend += Number(e.cost) || 0;
  const totals = { total: list.length, real: list.filter(isReal).length, spend: +spend.toFixed(2) };
  for (const p of ['P1', 'P2', 'P3']) totals[p] = { total: list.filter(r => r.priority === p).length, real: list.filter(r => r.priority === p && isReal(r)).length };
  return { groups, totals };
}
if (process.argv[1] && process.argv[1].endsWith('report.mjs')) {
  const { groups, totals } = report();
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ groups, totals }, null, 1)); process.exit(0); }
  const pad = (s, n) => String(s).padEnd(n), num = (s, n) => String(s).padStart(n);
  console.log(`${pad('group', 13)}${pad('tool', 12)}${num('real', 5)}/${pad('total', 6)} ${num('P1', 7)} ${num('P2', 7)} ${num('P3', 7)}  queued failed  ✓approve ↻redo`);
  for (const [g, s] of Object.entries(groups).sort()) console.log(`${pad(g, 13)}${pad(s.tool, 12)}${num(s.real, 5)}/${pad(s.total, 6)} ${num(`${s.P1.real}/${s.P1.total}`, 7)} ${num(`${s.P2.real}/${s.P2.total}`, 7)} ${num(`${s.P3.real}/${s.P3.total}`, 7)}  ${num(s.queued, 6)} ${num(s.failed, 6)}  ${num(s.approve, 8)} ${num(s.redo, 5)}`);
  console.log(`\n${totals.real}/${totals.total} real · P1 ${totals.P1.real}/${totals.P1.total} · P2 ${totals.P2.real}/${totals.P2.total} · P3 ${totals.P3.real}/${totals.P3.total} · spent $${totals.spend.toFixed(2)}`);
}
