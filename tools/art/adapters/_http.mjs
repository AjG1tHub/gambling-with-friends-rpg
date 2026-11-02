// HTTP helpers shared by the adapters: JSON requests with retries and backoff, polling, and a running spend
// counter that stops the run at ART_BUDGET_USD instead of overspending.
import { budgetUSD } from '../lib.mjs';

export class BudgetExceeded extends Error { constructor(spent, cap) { super(`art budget reached: $${spent.toFixed(2)} of $${cap.toFixed(2)} (raise ART_BUDGET_USD to continue)`); this.spent = spent; this.cap = cap; } }
export const spend = { usd: 0, calls: 0 };
export function charge(usd) { spend.usd += usd; spend.calls++; const cap = budgetUSD(); if (spend.usd > cap) throw new BudgetExceeded(spend.usd, cap); }
export function assertBudget(nextUsd = 0) { const cap = budgetUSD(); if (spend.usd + nextUsd > cap) throw new BudgetExceeded(spend.usd + nextUsd, cap); }

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// fetch with retries on network errors and 429/5xx; `expect` is 'json' | 'buffer' | 'text'.
export async function request(url, { method = 'GET', headers = {}, body = null, expect = 'json', retries = 4, timeoutMs = 120000, label = url } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, headers: body && !(body instanceof Uint8Array) && typeof body !== 'string' ? { 'content-type': 'application/json', ...headers } : headers, body: body && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof FormData) ? JSON.stringify(body) : body, signal: ctl.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) { const ra = Number(res.headers.get('retry-after')) || 0; lastErr = new Error(`${label}: HTTP ${res.status} ${await safeText(res)}`); await sleep(ra ? ra * 1000 : 1500 * 2 ** attempt); continue; }
      if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${await safeText(res)}`);
      if (expect === 'buffer') return Buffer.from(await res.arrayBuffer());
      if (expect === 'text') return await res.text();
      if (expect === 'response') return res;
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') lastErr = new Error(`${label}: timed out after ${timeoutMs} ms`);
      else if (/HTTP \d{3}/.test(e.message) && !/HTTP (429|5\d\d)/.test(e.message)) throw e;   // a 4xx other than 429 is final
      else lastErr = e;
      if (attempt < retries) await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastErr || new Error(`${label}: failed`);
}
async function safeText(res) { try { return (await res.text()).slice(0, 400); } catch { return ''; } }

// Poll `fn` until it returns a non-null value or the deadline passes.
export async function poll(fn, { everyMs = 4000, maxMs = 15 * 60 * 1000, label = 'job' } = {}) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v != null) return v; if (Date.now() - t0 > maxMs) throw new Error(`${label}: still not finished after ${Math.round(maxMs / 1000)} s`); await sleep(everyMs); }
}

export const dataUriToBuffer = (s) => Buffer.from(String(s).replace(/^data:[^;]+;base64,/, ''), 'base64');
export const bufferToDataUri = (buf, mime = 'image/png') => `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
export async function download(url, label = url) { return request(url, { expect: 'buffer', label, timeoutMs: 180000 }); }
