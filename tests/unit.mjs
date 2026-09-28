// Headless checks for plan drawing and the simulation. node tests/unit.mjs
import { CHAPTERS } from '../js/levels.js';
import { parseLevel } from '../js/level.js';
import { Drawer, Plan } from '../js/plan.js';
import { Sim } from '../js/sim.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const lv = (id) => { for (const [ci, c] of CHAPTERS.entries()) for (const [li, l] of c.levels.entries()) if (l.id === id) return parseLevel(l, { chapter: ci, index: li, theme: c.theme }); };
const drag = (d, pts, step = 0.05) => {
  let [x, y] = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const [tx, ty] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(tx - x, ty - y) / step));
    for (let k = 1; k <= n; k++) {
      const fx = x + (tx - x) * k / n, fy = y + (ty - y) * k / n;
      if (!d.retrace(fx, fy)) d.extend(fx, fy);
    }
    x = tx; y = ty;
  }
};

// 1. straight drag follows the finger
{
  const L = lv('1-1'); const d = new Drawer(L);
  drag(d, [[1.5, 11.5], [4.5, 11.5]]);
  const p = d.plan;
  ok(Math.abs(p.xs[p.n - 1] - 4.5) < 0.2 && Math.abs(p.ys[p.n - 1] - 11.5) < 0.2, 'head follows a straight drag');
  ok(Math.abs(p.end - p.length / p.speed) < 1e-6, 'plan time = length / speed without waits');
}
// 2. walls stop the line
{
  const L = lv('1-1'); const d = new Drawer(L);
  drag(d, [[1.5, 11.5], [1.5, 8.5]]); // straight up into the wall above row 11
  const p = d.plan;
  ok(p.ys[p.n - 1] > 10.6, 'line cannot enter a wall (' + p.ys[p.n - 1].toFixed(2) + ')');
}
// 3. retrace erases the tail
{
  const L = lv('1-1'); const d = new Drawer(L);
  drag(d, [[1.5, 11.5], [6.5, 11.5]]);
  const before = d.plan.length;
  drag(d, [[6.5, 11.5], [3.5, 11.5]]);
  ok(d.plan.length < before - 2.5, `retracing shortens the line (${before.toFixed(2)} -> ${d.plan.length.toFixed(2)})`);
}
// 4. a pickup locks the line behind it
{
  const L = lv('1-1'); const d = new Drawer(L);
  // coin at (3.5, 8.5) in 1-1
  drag(d, [[1.5, 11.5], [4.5, 11.5], [4.5, 8.4], [4.5, 11.5]]); // coin at (4.5, 8.5)
  ok(d.lock > 0 && d.lockEvents.some((e) => e.type === 'coin'), 'coin pickup locks the line');
  ok(d.plan.length > 7, 'walking back after the pickup draws a new line instead of erasing (' + d.plan.length.toFixed(2) + ')');
}
// 5. crossing an old part of the line does not erase it
{
  const L = lv('1-2'); const d = new Drawer(L);
  // loop in the big room
  drag(d, [[2.5, 13.5], [4.5, 13.5], [4.5, 10.5], [6.5, 10.5], [6.5, 8.5], [3.5, 8.5], [3.5, 11.5], [5.5, 11.5]]);
  ok(d.plan.length > 12, 'figure-eight crossing keeps the line (' + d.plan.length.toFixed(2) + ')');
}
// 6. holding adds waits and the exit stops the line
{
  const L = lv('1-1'); const d = new Drawer(L);
  drag(d, [[1.5, 11.5], [2.5, 11.5]]);
  d.hold(1.5);
  ok(Math.abs(d.plan.totalWait - 1.5) < 1e-9, 'hold adds wait time');
  ok(d.plan.end > d.plan.length / d.plan.speed + 1.49, 'waits extend the plan time');
}
// 7. sim: escape requires loot
{
  const L = lv('1-1');
  const plan = Plan.fromPoints([[1.5, 11.5], [8.5, 11.5]]);
  const sim = new Sim(L, plan); sim.advanceTo(plan.end + 1);
  ok(sim.status === 'active', 'reaching the exit without loot does not escape');
}
// 8. every stored solution escapes in the real sim
{
  const { readFileSync } = await import('node:fs');
  const sol = JSON.parse(readFileSync('tools/solutions.json', 'utf8'));
  for (const c of CHAPTERS) for (const l of c.levels) {
    const s = sol[l.id];
    if (!s) { ok(false, `${l.id} has a stored solution`); continue; }
    const L = lv(l.id);
    const plan = Plan.fromPoints(s.all);
    const sim = new Sim(L, plan); sim.advanceTo(plan.end + 0.5);
    ok(sim.status === 'escaped' && (sim.mask & L.coinMask) === L.coinMask, `${l.id} reference route escapes with every coin (${sim.status}, ${sim.endT.toFixed(2)}s, par ${L.par})`);
    ok(sim.endT <= L.par, `${l.id} par is achievable`);
  }
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exitCode = fails ? 1 : 0;
