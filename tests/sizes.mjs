import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const [,, out] = process.argv;
const browser = await chromium.launch();
const confs = [
  ['se', { ...devices['iPhone SE'] }],
  ['pixel', { ...devices['Pixel 7'] }],
  ['desk', { viewport: { width: 1280, height: 800 } }],
];
for (const [name, conf] of confs) {
  const ctx = await browser.newContext(conf);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name, '[pageerror]', e.message));
  await page.goto('http://localhost:8123/');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/size-${name}-title.png` });
  await page.evaluate(() => window.__oth.startLevel('2-6', { skipIntro: true }));
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/size-${name}-game.png` });
  await ctx.close();
}
await browser.close();
