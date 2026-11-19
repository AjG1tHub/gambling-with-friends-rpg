// Runs every test suite listed in unittests.md, one after another, and writes a report with a screenshot:
//   test/reports/<stamp>/report.json · report.html · report.png · <suite>.log
// `node tools/test-report.mjs [--quick]` (`npm run build` first). --quick skips the slow browser gates.
// Exit code 0 when everything passed, 1 otherwise. Used by the hourly test agent (see unittests.md).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';

const quick = process.argv.includes('--quick');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = new URL(`../test/reports/${stamp}/`, import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const SUITES = [
  { id: 'unit', cmd: 'node --test test/unit/*.test.mjs', timeout: 300, pass: /^# fail 0$/m, count: /^# pass (\d+)$/m },
  { id: 'bots', cmd: 'node tools/bots.mjs --suite', timeout: 900, slow: true },
  { id: 'gate', cmd: 'node test/browser/run.mjs', timeout: 420, pass: /BROWSER GATE PASSED/ },
  { id: 'qa', cmd: 'node test/browser/qa.mjs', timeout: 240, pass: /PASSED/ },
  { id: 'tutorial', cmd: 'node test/browser/tutorial.mjs', timeout: 300, pass: /PASSED/, slow: true },
  { id: 'lab', cmd: 'node test/browser/lab.mjs', timeout: 420, pass: /PASSED/, slow: true },
  { id: 'small-phone', cmd: 'node test/browser/small-phone.mjs', timeout: 300, pass: /PASSED/ },
  { id: 'tv-layout', cmd: 'node test/browser/tv-layout.mjs', timeout: 300, pass: /PASSED/, slow: true },
  { id: 'reconnect', cmd: 'node test/browser/reconnect.mjs', timeout: 360, pass: /PASSED/ },
  { id: 'offline', cmd: 'node test/browser/offline.mjs', timeout: 420, pass: /PASSED/, slow: true },
  { id: 'sidebet', cmd: 'node test/browser/sidebet.mjs', timeout: 300, pass: /PASSED/ },
  { id: 'modes', cmd: 'node test/browser/modes.mjs', timeout: 600, pass: /PASSED/, slow: true },
  { id: 'gm-layout', cmd: 'node test/browser/gm-layout.mjs', timeout: 300, pass: /PASSED/ },
  { id: 'clock', cmd: 'node test/browser/clock.mjs', timeout: 300, pass: /PASSED/ },
  { id: 'table-business', cmd: 'node test/browser/table-business.mjs', timeout: 300, pass: /PASSED/ },
  { id: 'ramp', cmd: 'node test/browser/ramp.mjs', timeout: 540, pass: /PASSED/, slow: true },
].filter(s => !(quick && s.slow));

const run = (s) => new Promise((resolve) => {
  const t0 = Date.now(); let out = '';
  const p = spawn('bash', ['-c', s.cmd], { cwd: new URL('..', import.meta.url).pathname, env: process.env });
  const kill = setTimeout(() => { out += `\n[test-report] killed after ${s.timeout}s`; p.kill('SIGKILL'); }, s.timeout * 1000);
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('close', (code) => {
    clearTimeout(kill); writeFileSync(`${dir}${s.id}.log`, out);
    const ok = code === 0 && (!s.pass || s.pass.test(out));
    const fails = out.split('\n').filter(l => /^not ok|FAIL:|TIMEOUT:|Error:|✗/.test(l.trim())).slice(0, 6).map(l => l.trim().slice(0, 220));
    resolve({ id: s.id, ok, code, seconds: Math.round((Date.now() - t0) / 1000), count: s.count ? Number((out.match(s.count) || [])[1] || 0) : (out.match(/✓/g) || []).length, fails });
  });
});

let commit = ''; try { commit = execSync('git log --oneline -1', { cwd: new URL('..', import.meta.url).pathname }).toString().trim(); } catch { /* not a repo */ }
const results = [];
for (const s of SUITES) { process.stdout.write(`▶ ${s.id} … `); const r = await run(s); results.push(r); console.log(`${r.ok ? 'pass' : 'FAIL'} (${r.seconds}s, ${r.count} checks)`); }
const report = { stamp, commit, quick, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
writeFileSync(`${dir}report.json`, JSON.stringify(report, null, 1));
const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
writeFileSync(`${dir}report.html`, `<!doctype html><meta charset="utf-8"><title>GWF test report ${stamp}</title><style>
body{font:15px/1.4 system-ui,sans-serif;background:#14110f;color:#eadfce;margin:24px;width:1040px}h1{font-size:22px;margin:0 0 4px}.sub{color:#a89880;margin-bottom:16px}
table{border-collapse:collapse;width:100%}td,th{padding:7px 10px;border-bottom:1px solid #3a322a;text-align:left;vertical-align:top}th{color:#a89880;font-weight:600}
.ok{color:#7fd28a;font-weight:700}.bad{color:#ff6b6b;font-weight:700}.f{color:#ffb4a8;font:12px ui-monospace,monospace;white-space:pre-wrap}.big{font-size:28px;font-weight:800}</style>
<h1>Gambling With Friends: RPG — test report</h1><div class="sub">${esc(stamp)} UTC · ${esc(commit)}${quick ? ' · quick run' : ''}</div>
<div class="big ${report.failed ? 'bad' : 'ok'}">${report.failed ? `${report.failed} of ${results.length} suites FAILED` : `All ${results.length} suites passed`}</div>
<table><tr><th>Suite</th><th>Result</th><th>Checks</th><th>Time</th><th>First failures</th></tr>${results.map(r => `<tr><td>${r.id}</td><td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? 'PASS' : 'FAIL'}</td><td>${r.count}</td><td>${r.seconds}s</td><td class="f">${esc(r.fails.join('\n'))}</td></tr>`).join('')}</table>`);
try {
  const { chromium } = await import('playwright');
  const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
  const pre = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => existsSync(p) && isFile(p));
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || pre || undefined });
  const pg = await (await b.newContext({ viewport: { width: 1090, height: 700 }, deviceScaleFactor: 2 })).newPage();
  await pg.goto(`file://${dir}report.html`); await pg.screenshot({ path: `${dir}report.png`, fullPage: true }); await b.close();
} catch (e) { console.error('screenshot failed:', e.message); }
console.log(`\n${report.failed ? 'FAILED' : 'ALL PASSED'} — ${dir}report.png`);
process.exit(report.failed ? 1 : 0);
