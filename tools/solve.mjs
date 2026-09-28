// Level solver / validator.
//
//   node tools/solve.mjs            -> solve every level, print a table
//   node tools/solve.mjs 2-3 -v     -> solve one level and draw the route
//
// Searches a time-expanded grid (thief moves cell-centre to cell-centre, or waits)
// against the deterministic world, then replays the best route through the real
// Sim to confirm it. Reports fastest escape, fastest escape with every coin, and
// the suggested par.

import { CHAPTERS } from '../js/levels.js';
import { parseLevel } from '../js/level.js';
import { Sim, DT, camAngle, laserOn, BUMP_R, LASER_R } from '../js/sim.js';
import { Plan, SPEED } from '../js/plan.js';
import { angDiff, losClear, segSegDist } from '../js/geom.js';

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const verbose = args.includes('-v');
const dump = args.includes('--dump');
const only = args.filter((a) => !a.startsWith('-'));
const noArg = args.find((a) => a.startsWith('--no='));
const disabled = new Set(noArg ? noArg.slice(5).split(',') : []);
const noiseArg = args.find((a) => a.startsWith('--noise='));
const noiseCap = noiseArg ? +noiseArg.slice(8) : null;
const quick = args.includes('--quick');
// Robustness margin: inflate every detector so routes keep some slack.
let M = { range: 0, half: 0, bump: 0, laser: 0 };
const MARGIN = { range: 0.3, half: 5 * Math.PI / 180, bump: 0.08, laser: 0.12 };

const WAIT = 0.25;
const BUCKET = 0.1;
const HORIZON = 75;

// World timelines keyed by the sequence of thief-triggered events (noise, power).
// Worlds are simulated lazily and share their history with the world they forked from.
const CP = 30; // checkpoint every half second

function cloneGuard(g) {
  const c = Object.create(Object.getPrototypeOf(g));
  Object.assign(c, g);
  if (g.leave) c.leave = { ...g.leave };
  return c;
}

class World {
  constructor(level, events, parent = null) {
    this.level = level;
    this.events = events;
    this.parent = parent;
    this.forkK = parent ? events[events.length - 1].k : 0;
    this.byStep = new Map();
    for (const e of events) this.byStep.set(e.k, [...(this.byStep.get(e.k) || []), e]);
    this.G = level.guards.length;
    this.frames = [];
    this.cps = new Map();
    if (!parent) {
      this.sim = new Sim(level, new Plan(level.start.x, level.start.y), { detect: false, interact: false });
      this.sim.frames = null;
      this.k = 0;
      this.frames.push(this.snap());
      this.checkpoint();
    } else {
      // start from the parent's nearest checkpoint before the fork and replay
      parent.frame(this.forkK);
      const [ck, cp] = parent.checkpointBefore(this.forkK - 1);
      this.sim = { guards: cp.guards.map(cloneGuard), powerUntil: cp.powerUntil, t: ck * DT, k: ck };
      this.k = ck;
      while (this.k < this.forkK - 1) this.advance(false);
    }
  }
  // Latest saved state at or before step k along this world's history.
  checkpointBefore(k) {
    const ck = Math.floor(k / CP) * CP;
    if (!this.parent || ck >= this.forkK) {
      for (let c = ck; c >= (this.parent ? this.forkK : 0); c -= CP) if (this.cps.has(c)) return [c, this.cps.get(c)];
    }
    return this.parent.checkpointBefore(Math.min(k, this.forkK - 1));
  }
  checkpoint() {
    this.cps.set(this.k, { guards: this.sim.guards.map(cloneGuard), powerUntil: this.sim.powerUntil });
  }
  snap() {
    const f = new Float32Array(this.G * 3 + 1);
    this.sim.guards.forEach((g, i) => { f[i * 3] = g.x; f[i * 3 + 1] = g.y; f[i * 3 + 2] = g.facing; });
    f[this.G * 3] = this.sim.t < this.sim.powerUntil ? 1 : 0;
    return f;
  }
  advance(record) {
    const sim = this.sim;
    this.k++;
    sim.k = this.k;
    sim.t = this.k * DT;
    for (const e of this.byStep.get(this.k) || []) {
      if (e.type === 'noise') { const nz = this.level.noise[e.tile]; sim.guards.forEach((g) => g.hear(nz.cx, nz.cy)); }
      if (e.type === 'power') sim.powerUntil = sim.t + this.level.power.duration;
    }
    for (const g of sim.guards) g.step(DT);
    if (record) {
      this.frames.push(this.snap());
      if (this.k % CP === 0) this.checkpoint();
    }
  }
  frame(i) {
    if (this.parent && i < this.forkK) return this.parent.frame(i);
    const off = this.parent ? this.forkK : 0;
    while (off + this.frames.length <= i) this.advance(true);
    return this.frames[i - off];
  }
  heardAt(k, tile) {
    const f = this.frame(k);
    const nz = this.level.noise[tile];
    return this.level.guards.some((g, i) => !g.deaf && Math.hypot(f[i * 3] - nz.cx, f[i * 3 + 1] - nz.cy) <= g.hear);
  }
}

function seen(level, frame, t, open, px, py, x, y) {
  const block = level.blockers(open).sight;
  const { W, H } = level;
  const g = frame;
  const gs = level.guards;
  for (let i = 0; i < gs.length; i++) {
    const gx = g[i * 3], gy = g[i * 3 + 1];
    const dx = x - gx, dy = y - gy;
    const d = Math.hypot(dx, dy);
    if (d < BUMP_R + M.bump) return true;
    if (d > gs[i].range + M.range) continue;
    if (Math.abs(angDiff(g[i * 3 + 2], Math.atan2(dy, dx))) > gs[i].half + M.half) continue;
    if (losClear(gx, gy, x, y, W, H, block)) return true;
  }
  if (frame[gs.length * 3]) return false;
  for (const c of level.cameras) {
    const dx = x - c.x, dy = y - c.y;
    const d = Math.hypot(dx, dy);
    if (d > c.range + M.range) continue;
    if (Math.abs(angDiff(camAngle(c, t), Math.atan2(dy, dx))) > c.half + M.half) continue;
    if (losClear(c.x, c.y, x, y, W, H, block)) return true;
  }
  for (const l of level.lasers) {
    const on = M.laser ? laserOn(l, t) || laserOn(l, t - 0.15) || laserOn(l, t + 0.15) : laserOn(l, t);
    if (on && segSegDist(l.ax, l.ay, l.bx, l.by, px, py, x, y) < LASER_R + M.laser) return true;
  }
  return false;
}

class Heap {
  constructor() { this.a = []; }
  push(n) {
    const a = this.a; a.push(n);
    let k = a.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (a[p].t <= a[k].t) break; [a[p], a[k]] = [a[k], a[p]]; k = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < a.length && a[l].t < a[m].t) m = l;
        if (r < a.length && a[r].t < a[m].t) m = r;
        if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; k = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

function solve(level, needMask) {
  const { W, H } = level;
  const worlds = new Map();
  const world = (key, events, parentKey) => {
    let w = worlds.get(key);
    if (!w) { w = new World(level, events, events.length ? worlds.get(parentKey) : null); worlds.set(key, w); }
    return w;
  };
  world('', []);
  const itemAt = new Map(level.items.map((it) => [Math.floor(it.y) * W + Math.floor(it.x), it]));
  const noiseAt = new Map(level.noise.map((nz, k) => [nz.y * W + nz.x, k]));
  const powerCell = level.power ? level.power.y * W + level.power.x : -1;
  const exitCell = Math.floor(level.exit.y) * W + Math.floor(level.exit.x);
  const startCell = Math.floor(level.start.y) * W + Math.floor(level.start.x);

  const seenState = new Set();
  const keyIds = new Map();
  const heap = new Heap();
  const start = { cell: startCell, mask: 0, t: 0, events: [], key: '', prev: null, wait: 0 };
  heap.push(start);
  let expanded = 0;

  // Samples a straight move (or a wait) and reports the first unsafe moment.
  const safeMove = (frames, open, ax, ay, bx, by, t0, dur) => {
    const k0 = Math.floor(t0 / DT + 1e-9) + 1;
    const k1 = Math.floor((t0 + dur) / DT + 1e-9);
    let px = ax, py = ay;
    const stride = M.range ? 2 : 1;
    for (let k = k0; k <= k1; k += (k1 - k > stride ? stride : 1)) {
      const t = k * DT;
      const u = dur > 0 ? (t - t0) / dur : 1;
      const x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
      if (k > HORIZON / DT) return false;
      if (seen(level, frames.frame(k), t, open, px, py, x, y)) return false;
      px = x; py = y;
    }
    return true;
  };

  while (heap.size) {
    const n = heap.pop();
    if (n.t > HORIZON) break;
    let kid = keyIds.get(n.key);
    if (kid === undefined) { kid = keyIds.size; keyIds.set(n.key, kid); }
    const sk = ((kid * 4096 + n.mask) * 2048 + Math.round(n.t / BUCKET)) * 256 + n.cell;
    if (seenState.has(sk)) continue;
    seenState.add(sk);
    expanded++;
    if (expanded > 3_000_000) break;

    if (n.cell === exitCell && (n.mask & level.lootMask) === level.lootMask && (n.mask & needMask) === needMask) {
      return { node: n, expanded };
    }
    const frames = world(n.key, n.events);
    const open = level.doorsOpenFor(n.mask);
    const block = level.blockers(open).move;
    const cx = n.cell % W, cy = (n.cell / W) | 0;
    const ax = cx + 0.5, ay = cy + 0.5;

    // wait in place
    if (safeMove(frames, open, ax, ay, ax, ay, n.t, WAIT)) {
      heap.push({ ...n, t: n.t + WAIT, prev: n, wait: WAIT });
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || block(nx, ny)) continue;
        if (dx && dy && (block(cx + dx, cy) || block(cx, cy + dy))) continue;
        const dur = Math.hypot(dx, dy) / SPEED;
        const bx = nx + 0.5, by = ny + 0.5;
        const cell = ny * W + nx;
        // Stepping onto a trigger (creak or fuse): wait a few frames first so the
        // trigger lands on a quantised step. Worlds are then exact and shareable.
        const nzk = noiseAt.get(cell);
        const isPower = cell === powerCell && !n.events.some((e) => e.type === 'power');
        let from = n, t0 = n.t;
        let heard = false, kTrig = 0;
        if (nzk != null || isPower) {
          const kx = Math.ceil((n.t + 0.62 * dur) / DT - 1e-9);
          const kq = Math.ceil(kx / 12) * 12;
          const pre = (kq - kx) * DT;
          kTrig = kq;
          if (pre > 0) {
            if (!safeMove(frames, open, ax, ay, ax, ay, n.t, pre)) continue;
            t0 = n.t + pre;
            from = { ...n, t: t0, prev: n, wait: pre };
          }
          if (nzk != null) heard = frames.heardAt(kq - 1, nzk);
        }
        if (!safeMove(frames, open, ax, ay, bx, by, t0, dur)) continue;
        let mask = n.mask;
        const it = itemAt.get(cell);
        if (it) mask |= it.bit;
        let events = n.events, key = n.key;
        const trig = (type, extra) => {
          const k = kTrig;
          events = [...events, { type, k, ...extra }];
          key = events.map((e) => `${e.type[0]}${e.tile ?? ''}@${e.k}`).join(',');
        };
        if (heard) {
          if (events.filter((e) => e.type === 'noise').length >= (noiseCap ?? level.def.solverNoise ?? 2)) continue;
          trig('noise', { tile: nzk });
        }
        if (isPower) trig('power', {});
        // the new world must also be safe for the remainder of this move
        if (key !== n.key && !safeMove(world(key, events, n.key), open, ax, ay, bx, by, t0, dur)) continue;
        heap.push({ cell, mask, t: t0 + dur, events, key, prev: from, wait: 0 });
      }
    }
  }
  return { node: null, expanded };
}

function route(node) {
  const nodes = [];
  for (let n = node; n; n = n.prev) nodes.push(n);
  nodes.reverse();
  const pts = [];
  for (const n of nodes) {
    const x = (n.cell % 10) + 0.5, y = Math.floor(n.cell / 10) + 0.5;
    const last = pts[pts.length - 1];
    if (last && last[0] === x && last[1] === y) last[2] += n.wait;
    else pts.push([x, y, 0]);
  }
  return pts;
}

function verify(level, pts) {
  const plan = Plan.fromPoints(pts);
  const sim = new Sim(level, plan);
  sim.advanceTo(plan.end + 0.5);
  return sim;
}

function draw(level, pts) {
  const rows = level.def.map.map((r) => r.split(''));
  pts.forEach(([x, y, w], i) => {
    const cx = Math.floor(x), cy = Math.floor(y);
    const ch = rows[cy][cx];
    if ('.'.includes(ch)) rows[cy][cx] = w > 0 ? 'w' : '*';
  });
  return rows.map((r) => '   ' + r.join(' ')).join('\n');
}

export function suggestPar(t) {
  return Math.ceil((t * 1.12 + 1.2) * 2) / 2;
}

const results = [];
const solutions = existsSync('tools/solutions.json') ? JSON.parse(readFileSync('tools/solutions.json', 'utf8')) : {};
for (const [ci, ch] of CHAPTERS.entries()) {
  for (const [li, def] of ch.levels.entries()) {
    if (only.length && !only.includes(def.id)) continue;
    const level = parseLevel(def, { chapter: ci, index: li, theme: ch.theme });
    for (const k of disabled) {
      const m = k.match(/^(guards|cameras|lasers)(\d+)$/);
      if (m) level[m[1]] = level[m[1]].filter((_, i) => i !== +m[2]);
      else level[k] = k === 'power' ? null : [];
    }
    const t0 = performance.now();
    M = { range: 0, half: 0, bump: 0, laser: 0 };
    const any = solve(level, 0);
    const all = quick ? any : level.coinMask ? solve(level, level.coinMask) : any;
    M = MARGIN;
    const safe = quick ? any : solve(level, 0);
    M = { range: 0, half: 0, bump: 0, laser: 0 };
    const ms = performance.now() - t0;
    const row = { id: def.id, title: def.title, ms: Math.round(ms), slack: safe.node ? +safe.node.t.toFixed(1) : 'NONE' };
    if (!any.node) {
      row.status = 'UNSOLVABLE';
    } else {
      const pts = route(any.node);
      const sim = verify(level, pts);
      row.fast = +any.node.t.toFixed(2);
      row.fastOk = sim.status === 'escaped';
      if (all.node) {
        const pts2 = route(all.node);
        const sim2 = verify(level, pts2);
        row.coins = +all.node.t.toFixed(2);
        row.coinsOk = sim2.status === 'escaped' && (sim2.mask & level.coinMask) === level.coinMask;
        row.par = def.par;
        row.suggest = suggestPar(all.node.t);
        solutions[def.id] = { any: pts, all: pts2, t: all.node.t };
        if (verbose) {
          console.log(`\n${def.id} ${def.title} — all coins in ${all.node.t.toFixed(2)}s (${sim2.status}${sim2.caught ? ' by ' + sim2.caught.by : ''})`);
          console.log(draw(level, pts2));
          console.log('   waits:', pts2.filter((p) => p[2] > 0).map((p) => `(${p[0] - 0.5},${p[1] - 0.5}) ${p[2].toFixed(2)}s`).join('  ') || 'none');
        }
      } else row.coins = 'no route';
      if (verbose && all !== any) {
        console.log(`   fastest ignoring coins: ${any.node.t.toFixed(2)}s (${sim.status})`);
        console.log(draw(level, pts));
      }
    }
    results.push(row);
  }
}
console.table(results);
if (dump) writeFileSync('tools/solutions.json', JSON.stringify(solutions));
if (args.includes('--out')) {
  mkdirSync('tools/results', { recursive: true });
  for (const r of results) writeFileSync(`tools/results/${r.id}.json`, JSON.stringify({ row: r, solution: solutions[r.id] || null }));
}
const bad = results.filter((r) => r.status || r.fastOk === false || r.coinsOk === false);
if (bad.length) { console.log('PROBLEMS:', bad.map((r) => r.id).join(', ')); process.exitCode = 1; }
