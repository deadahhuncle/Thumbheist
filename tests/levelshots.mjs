// Render planning snapshots along each level's solver route.
// node tests/levelshots.mjs <outdir> [ids...]
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const [,, outDir, ...ids] = process.argv;
const sol = JSON.parse(readFileSync('tools/solutions.json', 'utf8'));
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8123/');
await page.waitForTimeout(600);
for (const id of ids.length ? ids : Object.keys(sol)) {
  const s = sol[id];
  if (!s) { console.log('no solution for', id); continue; }
  await page.evaluate((id) => window.__oth.startLevel(id, { skipIntro: true }), id);
  await page.waitForTimeout(400);
  const T = s.t;
  const times = [0, T * 0.25, T * 0.5, T * 0.75, T];
  for (const [i, t] of times.entries()) {
    await page.evaluate(([pts, t]) => window.__oth.game.debugView(pts, t), [s.all, t]);
    await page.screenshot({ path: `${outDir}/${id}-${i}.png` });
  }
  console.log(id, 'T=', T.toFixed(2));
}
await browser.close();
