import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:8123/');
await page.waitForTimeout(500);
await page.mouse.click(200, 700);
const res = await page.evaluate(async () => {
  const a = window.__oth.audio;
  a.unlock();
  const names = Object.getOwnPropertyNames(Object.getPrototypeOf(a)).filter((n) => n.startsWith('sfx_')).map((n) => n.slice(4));
  const errs = [];
  for (const n of names) { try { a.play(n, 1); } catch (e) { errs.push(n + ': ' + e.message); } }
  for (const m of ['menu', 'plan', 'run', 'result', 'silent', 'menu']) a.setMood(m);
  await new Promise((r) => setTimeout(r, 2500));
  return { names: names.length, errs, state: a.ctx.state, step: a.step };
});
console.log(JSON.stringify(res));
console.log(logs.join('\n'));
await browser.close();
