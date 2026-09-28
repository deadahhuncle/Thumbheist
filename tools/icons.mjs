import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage();
const out = [['icon-512.png', 512, 0], ['icon-192.png', 192, 0], ['apple-touch-icon.png', 180, 0], ['icon-maskable-512.png', 512, 1], ['favicon-32.png', 32, 0]];
for (const [name, size, mask] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.goto(`http://localhost:8123/tools/icon.html?size=${size}&mask=${mask}`);
  await page.waitForFunction(() => document.title === 'ready');
  await page.locator('#c').screenshot({ path: `assets/icons/${name}` });
}
await browser.close();
