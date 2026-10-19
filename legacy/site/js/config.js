// Config loader (Phase 1). Defaults are always available; a Google Apps Script
// endpoint (deployed under the Sheet owner's account) can override any tab.
// Endpoint contract: GET → { ok: true, tabs: { Config: {...}, Currencies: [...], ... } }
import { DEFAULT_CONFIG } from './config-default.js';

const ENDPOINT_KEY = 'gwf_sheets_endpoint';

export function getEndpoint() {
  return localStorage.getItem(ENDPOINT_KEY) || '';
}
export function setEndpoint(url) {
  if (url) localStorage.setItem(ENDPOINT_KEY, url.trim());
  else localStorage.removeItem(ENDPOINT_KEY);
}

// Deep-ish merge: Sheets tabs replace default tabs wholesale (a tab is the unit
// of truth — matching how "add a row in Sheets = it exists" should behave).
export function mergeConfig(remoteTabs) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  if (remoteTabs && typeof remoteTabs === 'object') {
    for (const [tab, value] of Object.entries(remoteTabs)) {
      if (value != null) cfg[tab] = value;
    }
  }
  return cfg;
}

export async function loadConfig() {
  const url = getEndpoint();
  if (!url) return { config: structuredClone(DEFAULT_CONFIG), source: 'defaults' };
  try {
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (data && data.ok && data.tabs) {
      return { config: mergeConfig(data.tabs), source: 'sheets', remote: data.tabs };
    }
    return { config: structuredClone(DEFAULT_CONFIG), source: 'defaults (bad payload)' };
  } catch (e) {
    console.warn('Config fetch failed, using defaults:', e);
    return { config: structuredClone(DEFAULT_CONFIG), source: 'defaults (fetch failed)' };
  }
}

// Append a ledger row to Sheets (fire-and-forget; no-op without endpoint).
// The game lab switches this off so practice rounds never land in the real Ledger tab.
let ledgerPush = true;
export function setLedgerPush(on) { ledgerPush = !!on; }
export function pushLedgerRow(row) {
  if (!ledgerPush) return;
  const url = getEndpoint();
  if (!url) return;
  try {
    fetch(url, {
      method: 'POST',
      // text/plain avoids the CORS preflight that Apps Script can't answer
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ledger', row }),
    }).catch(() => {});
  } catch (_) {}
}
