import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4190/lab/?phone=1#minefield'); await page.waitForTimeout(1200);
console.log(await page.evaluate(() => { const out = []; for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.right > 392 && r.width > 40) out.push(`${el.tagName}.${el.className} w=${Math.round(r.width)} right=${Math.round(r.right)}`); } return out.slice(0, 25); }));
console.log(await page.evaluate(() => [document.documentElement.scrollWidth, document.body.scrollWidth]));
await browser.close();
