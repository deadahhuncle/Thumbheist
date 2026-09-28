// Coverage heatmap: fraction of time each cell centre is watched (0-9, '#' wall).
// node tools/cover.mjs 3-3 [seconds]
import { CHAPTERS } from '../js/levels.js';
import { parseLevel } from '../js/level.js';
import { Sim, DT, camAngle, laserOn, BUMP_R } from '../js/sim.js';
import { Plan } from '../js/plan.js';
import { angDiff, losClear } from '../js/geom.js';
const [,, id, secs = '20'] = process.argv;
let def, meta;
CHAPTERS.forEach((c, ci) => c.levels.forEach((l, li) => { if (l.id === id) { def = l; meta = { chapter: ci, index: li, theme: c.theme }; } }));
const L = parseLevel(def, meta);
const sim = new Sim(L, new Plan(L.start.x, L.start.y), { detect: false, interact: false });
const N = Math.round(+secs / DT);
const cnt = new Float64Array(L.W * L.H);
const block = L.blockers(0).sight;
for (let k = 0; k < N; k++) {
  sim.step();
  const t = sim.t;
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
    const px = x + 0.5, py = y + 0.5;
    let seen = false;
    for (const g of sim.guards) {
      const d = Math.hypot(px - g.x, py - g.y);
      if (d < BUMP_R || (d <= g.d.range && Math.abs(angDiff(g.facing, Math.atan2(py - g.y, px - g.x))) <= g.d.half && losClear(g.x, g.y, px, py, L.W, L.H, block))) { seen = true; break; }
    }
    if (!seen) for (const c of L.cameras) {
      const d = Math.hypot(px - c.x, py - c.y);
      if (d <= c.range && Math.abs(angDiff(camAngle(c, t), Math.atan2(py - c.y, px - c.x))) <= c.half && losClear(c.x, c.y, px, py, L.W, L.H, block)) { seen = true; break; }
    }
    if (!seen) for (const l of L.lasers) {
      if (!laserOn(l, t)) continue;
      const vx = l.bx - l.ax, vy = l.by - l.ay; const l2 = vx * vx + vy * vy;
      let u = ((px - l.ax) * vx + (py - l.ay) * vy) / l2; u = Math.max(0, Math.min(1, u));
      if (Math.hypot(l.ax + vx * u - px, l.ay + vy * u - py) < 0.45) { seen = true; break; }
    }
    if (seen) cnt[y * L.W + x]++;
  }
}
for (let y = 0; y < L.H; y++) {
  let row = '';
  for (let x = 0; x < L.W; x++) {
    const ch = def.map[y][x];
    if ('#B '.includes(ch)) { row += ch === ' ' ? '  ' : ch + ' '; continue; }
    if (ch === 'g' || ch === 'D' || ch === 'Y') { row += ch + ' '; continue; }
    const f = cnt[y * L.W + x] / N;
    row += (f === 0 ? (ch === '.' ? '.' : ch) : f > 0.95 ? 'X' : String(Math.min(9, Math.floor(f * 10)))) + ' ';
  }
  console.log(row);
}
