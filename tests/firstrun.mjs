import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const [,, out] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:8123/');
await page.waitForTimeout(900);
await page.click('#btn-play');
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/fr-1-brief.png` });
await page.click('#brief-go');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/fr-2-card.png` });
await page.waitForTimeout(2600);
await page.screenshot({ path: `${out}/fr-3-demo.png` });
// draw 1-1 via touch
const L = await page.evaluate(() => { const r = window.__oth.game.r; return { ox: r.ox, oy: r.oy, ts: r.ts }; });
const scr = ([x, y]) => [L.ox + (x + 0.5) * L.ts, L.oy + (y + 0.5) * L.ts];
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
const pts = [[1, 11], [4, 11], [4, 5], [2, 5], [2, 3], [4, 3], [7, 3], [7, 5], [5, 5], [5, 11], [8, 11]];
let [sx, sy] = scr(pts[0]);
await touch('touchStart', sx, sy);
for (let i = 1; i < pts.length; i++) {
  const [tx, ty] = scr(pts[i]);
  const n = Math.max(4, Math.round(Math.hypot(tx - sx, ty - sy) / 6));
  for (let k = 1; k <= n; k++) { await touch('touchMove', sx + (tx - sx) * k / n, sy + (ty - sy) * k / n); await page.waitForTimeout(8); }
  sx = tx; sy = ty;
}
await touch('touchEnd', sx, sy);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/fr-4-run.png` });
await page.waitForFunction(() => !document.querySelector('#sheet-result').hidden, null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/fr-5-result.png` });
await page.click('#btn-next');
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/fr-6-next.png` });
console.log(logs.join('\n') || 'no errors');
await browser.close();
