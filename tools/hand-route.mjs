// Grid-search the wait times of a hand-drawn route through the real sim.
// node tools/hand-route.mjs <level> '<json points with "w0".."w3" placeholders for waits>' [--save]
import { CHAPTERS } from '../js/levels.js';
import { parseLevel } from '../js/level.js';
import { Sim } from '../js/sim.js';
import { Plan } from '../js/plan.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const [,, id, routeJson] = process.argv;
const save = process.argv.includes('--save');
let L, def;
CHAPTERS.forEach((c, ci) => c.levels.forEach((l, li) => { if (l.id === id) { def = l; L = parseLevel(l, { chapter: ci, index: li, theme: c.theme }); } }));
const tpl = JSON.parse(routeJson);
const slots = [...new Set(JSON.stringify(tpl).match(/"w\d"/g) || [])].map((s) => s.slice(1, -1)).sort();
const steps = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4];
const ok = [];
let fail = null;
const rec = (k, vals) => {
  if (k === slots.length) {
    const pts = tpl.map((p) => p.map((v) => (typeof v === 'string' ? vals[v] : v)).map((v, i) => (i < 2 ? v + 0.5 : v)));
    const plan = Plan.fromPoints(pts);
    const sim = new Sim(L, plan); sim.advanceTo(plan.end + 0.5);
    if (sim.status === 'escaped' && (sim.mask & L.coinMask) === L.coinMask) ok.push({ t: sim.endT, vals: { ...vals }, pts });
    else if (!fail || (sim.caught && sim.caught.t > fail.t)) fail = { t: sim.caught?.t ?? sim.endT, by: sim.caught?.by, at: sim.caught ? [sim.caught.tx.toFixed(1), sim.caught.ty.toFixed(1)] : null, status: sim.status, vals: { ...vals } };
    return;
  }
  for (const v of steps) { vals[slots[k]] = v; rec(k + 1, vals); }
};
rec(0, {});
ok.sort((a, b) => a.t - b.t);
const total = steps.length ** slots.length;
console.log(`${id}: ${ok.length}/${total} wait combinations escape with every coin`);
if (ok.length) console.log('best', ok[0].t.toFixed(2), JSON.stringify(ok[0].vals));
else console.log('furthest failure', JSON.stringify(fail));
if (save && ok.length) {
  mkdirSync('tools/results', { recursive: true });
  const b = ok[0];
  writeFileSync(`tools/results/${id}.json`, JSON.stringify({ row: { id, title: def.title, ms: 0, slack: `hand ${ok.length}/${total}`, fast: +b.t.toFixed(2), fastOk: true, coins: +b.t.toFixed(2), coinsOk: true }, solution: { any: b.pts, all: b.pts, t: b.t } }));
  console.log('saved');
}
