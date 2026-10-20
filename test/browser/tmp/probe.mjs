import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on('response', async r => { const ct = r.headers()['content-type']; const rt = r.request().resourceType(); if (rt === 'script' || ct?.includes('json')) console.log(rt, r.status(), ct, r.url()); });
await p.goto('http://127.0.0.1:4180/phone/?backend=local');
await new Promise(r => setTimeout(r, 2000));
await browser.close();
