// Replay stored solutions through the real Sim: node tools/verify.mjs [ids]
import { readFileSync, existsSync } from 'node:fs';
import { CHAPTERS } from '../js/levels.js';
import { parseLevel } from '../js/level.js';
import { Sim } from '../js/sim.js';
import { Plan } from '../js/plan.js';
const ids = process.argv.slice(2);
for (const [ci, ch] of CHAPTERS.entries()) for (const [li, def] of ch.levels.entries()) {
  if (ids.length && !ids.includes(def.id)) continue;
  const f = `tools/results/${def.id}.json`;
  const sol = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).solution : JSON.parse(readFileSync('tools/solutions.json', 'utf8'))[def.id];
  if (!sol) { console.log(def.id, 'no solution'); continue; }
  const L = parseLevel(def, { chapter: ci, index: li, theme: ch.theme });
  for (const k of ['any', 'all']) {
    const plan = Plan.fromPoints(sol[k]);
    const sim = new Sim(L, plan);
    sim.advanceTo(plan.end + 0.5);
    const ev = sim.events.filter((e) => e.type !== 'near').map((e) => `${e.type}${e.type === 'caught' ? '(' + e.by + ')' : ''}@${e.t.toFixed(2)}`).join(' ');
    console.log(def.id, k, sim.status, sim.endT.toFixed(2), '|', ev);
  }
}
