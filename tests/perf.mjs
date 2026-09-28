import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await page.goto('http://localhost:8123/?level=5-6&nointro');
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const g = window.__oth.game;
  const N = 120;
  let t0 = performance.now();
  for (let i = 0; i < N; i++) { g.update(1 / 60); g.render(); g.r.ctx.getImageData(0, 0, 1, 1); }
  const idle = (performance.now() - t0) / N;
  // simulate a long drawn plan preview
  const pts = [[1.5, 14.5], [4.5, 13.5], [8.5, 11.5, 1], [3.5, 9.5], [1.5, 8.5, 1], [4.5, 4.5], [4.5, 1.5], [8.5, 1.5]];
  g.debugView(pts, 8);
  g.paused = false;
  t0 = performance.now();
  for (let i = 0; i < N; i++) { g.render(); g.r.ctx.getImageData(0, 0, 1, 1); }
  const drawing = (performance.now() - t0) / N;
  // retrace-heavy: rebuild sim from scratch repeatedly
  t0 = performance.now();
  for (let i = 0; i < 20; i++) { const s = new (g.sim.constructor)(g.level, g.drawer.plan); s.advanceTo(g.drawer.plan.end); }
  const resim = (performance.now() - t0) / 20;
  return { idle, drawing, resim, dpr: devicePixelRatio, w: g.r.canvas.width, h: g.r.canvas.height };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
