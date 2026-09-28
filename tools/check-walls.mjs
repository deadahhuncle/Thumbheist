// Sanity checks on level data: guard legs through walls, items/guards on solid tiles.
import { CHAPTERS } from '../js/levels.js';
import { parseLevel, W, H } from '../js/level.js';
let bad = 0;
for (const [ci, ch] of CHAPTERS.entries()) for (const [li, def] of ch.levels.entries()) {
  const L = parseLevel(def, { chapter: ci, index: li, theme: ch.theme });
  const walk = L.blockers(0).guard;
  L.guards.forEach((g, gi) => {
    const legs = [];
    for (let i = 0; i < g.wp.length - 1; i++) legs.push([g.wp[i], g.wp[i + 1]]);
    if (g.loop && g.wp.length > 2) legs.push([g.wp[g.wp.length - 1], g.wp[0]]);
    for (const [a, b] of legs) {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05);
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
        if (walk(Math.floor(x), Math.floor(y))) { console.log(`${def.id}: guard ${gi} walks through a solid tile near ${x.toFixed(1)},${y.toFixed(1)}`); bad++; break; }
      }
    }
  });
  for (const c of L.cameras) {
    const near = [[-0.05, 0], [0.05, 0], [0, -0.05], [0, 0.05]].some(([dx, dy]) => { const x = Math.floor(c.x + dx), y = Math.floor(c.y + dy); return x < 0 || y < 0 || x >= W || y >= H || L.kind[y * W + x] === 1; });
    if (!near) { console.log(`${def.id}: camera at ${c.x},${c.y} is not mounted on a wall`); bad++; }
  }
}
console.log(bad ? `${bad} problems` : 'level data ok');
