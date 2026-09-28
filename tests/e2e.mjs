// Play every level's reference route through the real game in Chromium.
// node tests/e2e.mjs [ids...]
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const sol = JSON.parse(readFileSync('tools/solutions.json', 'utf8'));
const ids = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8123/');
await page.waitForTimeout(600);
let failed = 0;
const all = await page.evaluate(() => window.__oth.LEVELS.map((l) => l.id));
for (const id of ids.length ? ids : all) {
  if (!sol[id]) { console.log(id, 'NO SOLUTION'); failed++; continue; }
  await page.evaluate((id) => window.__oth.startLevel(id, { skipIntro: true }), id);
  await page.waitForTimeout(300);
  const res = await page.evaluate(async (pts) => {
    const g = window.__oth.game;
    let result = null;
    const orig = g.hooks.result;
    g.hooks.result = (r) => { result = r; orig(r); };
    g.runScripted(pts);
    g.fast = true;
    const t0 = performance.now();
    while (!result && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
    g.hooks.result = orig;
    return result && { success: result.success, stars: result.stars, time: result.time, coins: result.coins, reason: result.reason };
  }, sol[id].all);
  const ok = res && res.success && res.stars === 3;
  if (!ok) failed++;
  console.log(ok ? 'ok  ' : 'FAIL', id, JSON.stringify(res));
  await page.evaluate(() => { document.querySelector('#btn-retry').click(); });
}
console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no page errors');
console.log(failed ? `${failed} FAILED` : 'all levels passed');
await browser.close();
process.exitCode = failed ? 1 : 0;
