// Drive a level through real pointer input: node tests/play.mjs <level> <outprefix> '<json [[x,y,hold],...]>'
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const [,, level = '1-1', out = 'play', ptsJson = '[]', touchFlag] = process.argv;
const pts = JSON.parse(ptsJson);
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:8123/?level=${level}&nointro`);
await page.waitForTimeout(1300);
const L = await page.evaluate(() => { const r = window.__oth.game.r; return { ox: r.ox, oy: r.oy, ts: r.ts }; });
const scr = ([x, y]) => [L.ox + (x + 0.5) * L.ts, L.oy + (y + 0.5) * L.ts];
const cdp = await ctx.newCDPSession(page);
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
const useTouch = touchFlag === 'touch';
let [sx, sy] = scr(pts[0]);
if (useTouch) await touch('touchStart', sx, sy); else { await page.mouse.move(sx, sy); await page.mouse.down(); }
for (let i = 1; i < pts.length; i++) {
  const [tx, ty] = scr(pts[i]);
  const steps = Math.max(4, Math.round(Math.hypot(tx - sx, ty - sy) / 6));
  for (let k = 1; k <= steps; k++) {
    const x = sx + (tx - sx) * k / steps, y = sy + (ty - sy) * k / steps;
    if (useTouch) await touch('touchMove', x, y); else await page.mouse.move(x, y);
    await page.waitForTimeout(8);
  }
  sx = tx; sy = ty;
  if (pts[i][2]) await page.waitForTimeout(pts[i][2] * 1000);
}
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}-drawing.png` });
const st = await page.evaluate(() => { const g = window.__oth.game; return { state: g.state, end: g.drawer?.plan.end, n: g.drawer?.plan.n, status: g.sim?.status, caught: g.sim?.caught }; });
console.log('before lift', JSON.stringify(st));
if (useTouch) await touch('touchEnd', sx, sy); else await page.mouse.up();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-running.png` });
for (let i = 0; i < 60; i++) {
  const s = await page.evaluate(() => window.__oth.game.state);
  if (s !== 'running' && s !== 'rewind') break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(2200);
const st2 = await page.evaluate(() => { const g = window.__oth.game; return { state: g.state, t: g.playT, status: g.sim?.status, endT: g.sim?.endT, mask: g.sim?.mask }; });
console.log('after', JSON.stringify(st2));
await page.screenshot({ path: `${out}-result.png` });
console.log(logs.join('\n'));
await browser.close();
