import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CHAPTERS } from '../js/levels.js';
const order = CHAPTERS.flatMap((c) => c.levels.map((l) => l.id));
const sol = existsSync('tools/solutions.json') ? JSON.parse(readFileSync('tools/solutions.json', 'utf8')) : {};
const rows = [];
for (const id of order) {
  const f = `tools/results/${id}.json`;
  if (!existsSync(f)) continue;
  const r = JSON.parse(readFileSync(f, 'utf8'));
  rows.push(r.row);
  if (r.solution) sol[id] = r.solution;
}
writeFileSync('tools/solutions.json', JSON.stringify(sol));
console.table(rows.map(({ id, title, ms, slack, fast, fastOk, coins, coinsOk, par, suggest, status }) => ({ id, title: title.slice(0, 18), s: Math.round(ms / 1000), slack, fast, fastOk, coins, coinsOk, par, suggest, status })));
