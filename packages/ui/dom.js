// Tiny DOM helpers. No framework: h() builds elements, render() swaps children, esc() escapes text for the
// string-HTML paths the legacy stages use.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
// Make a container's append() skip null/false, so screens can write `parent.append(cond ? el : null)`.
export function lenient(el) { el.append = (...xs) => Element.prototype.append.apply(el, xs.flat(Infinity).filter(x => x != null && x !== false)); return el; }
export function render(container, ...children) { container.replaceChildren(); append(container, children); return container; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function toast(text, kind = '', ms = 2600) {
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}
export function banner(text, kind = '') {
  let b = $('#netBanner');
  if (!text) { b?.remove(); return; }
  if (!b) { b = h('div', { id: 'netBanner', class: `banner ${kind}` }); document.body.append(b); }
  b.className = `banner ${kind}`; b.textContent = text;
}
export const buzz = (pattern = 60) => { try { navigator.vibrate?.(pattern); } catch { /* no haptics */ } };
export const fmtTime = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const qs = (name, dflt = null) => new URLSearchParams(location.search).get(name) ?? dflt;
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
// Keep a callback running on animation frames while `active()` is true (clocks, stages that tick).
export function ticker(fn) { let on = true; const loop = () => { if (!on) return; fn(Date.now()); requestAnimationFrame(loop); }; requestAnimationFrame(loop); return () => { on = false; }; }

// Morph a container to new HTML, keeping the nodes that did not change. Stages are redrawn every ~100 ms while a
// round runs; replacing innerHTML wholesale re-created every card and restarted its deal animation each tick
// (the "stuttering cards"). Nodes are matched by position and tag: unchanged subtrees are left alone, changed
// elements have their attributes and children synced, text is updated in place.
let morphTpl = null;
export function morphHtml(container, html) {
  if (container.__lastHtml === html) return;
  container.__lastHtml = html;
  morphTpl ||= document.createElement('template');
  morphTpl.innerHTML = html;
  morphChildren(container, morphTpl.content);
}
function morphChildren(to, from) {
  const a = [...to.childNodes], b = [...from.childNodes];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const cur = a[i], nxt = b[i];
    if (!nxt) { cur.remove(); continue; }
    if (!cur) { to.append(nxt.cloneNode(true)); continue; }
    if (cur.nodeType === 3 && nxt.nodeType === 3) { if (cur.data !== nxt.data) cur.data = nxt.data; continue; }
    if (cur.nodeType !== 1 || nxt.nodeType !== 1 || cur.tagName !== nxt.tagName) { cur.replaceWith(nxt.cloneNode(true)); continue; }
    if (cur.outerHTML === nxt.outerHTML) continue;
    for (const at of [...cur.attributes]) if (!nxt.hasAttribute(at.name)) cur.removeAttribute(at.name);
    for (const at of [...nxt.attributes]) if (cur.getAttribute(at.name) !== at.value) cur.setAttribute(at.name, at.value);
    morphChildren(cur, nxt);
  }
}
