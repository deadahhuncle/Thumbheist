// Usage: node tests/shot.mjs <url-path> <out.png> [waitMs] [actions-json]
import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const [,, path = '/', out = 'shot.png', wait = '1200'] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto('http://localhost:8123' + path);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
