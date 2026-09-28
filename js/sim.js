// Deterministic heist simulation. The same code drives the live preview while the
// player draws, the playback after they lift, and the offline level solver.

import {
  angDiff, approachAngle, segPoint, segRect, segSegDist, losClear, dist, TAU,
} from './geom.js';

export const DT = 1 / 60;

export const PICK_R = 0.5;
export const EXIT_R = 0.45;
export const BUMP_R = 0.62;
export const LASER_R = 0.2;

// Guard modes (also stored in frames for the renderer)
export const PATROL = 0, REACT = 1, INVESTIGATE = 2, SEARCH = 3, RETURN = 4;

export function camAngle(c, t) {
  if (!c.sweep) return c.dir;
  return c.dir - (c.sweep / 2) * Math.cos(TAU * (t / c.period + c.phase));
}

export function laserOn(l, t) {
  if (!(l.off > 0)) return true;
  const cyc = l.on + l.off;
  let u = (t + l.phase) % cyc;
  if (u < 0) u += cyc;
  return u < l.on;
}

// Seconds until the laser changes state (for close-call detection).
function laserFlipIn(l, t) {
  if (!(l.off > 0)) return Infinity;
  const cyc = l.on + l.off;
  let u = (t + l.phase) % cyc;
  if (u < 0) u += cyc;
  return u < l.on ? l.on - u : cyc - u;
}

// ---------------------------------------------------------------- A* for guards
function astar(level, sx, sy, gx, gy) {
  const { W, H } = level;
  const block = level.blockers(0).guard;
  const s = Math.floor(sy) * W + Math.floor(sx);
  const g = Math.floor(gy) * W + Math.floor(gx);
  const open = [];
  const gScore = new Float64Array(W * H).fill(Infinity);
  const came = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  let counter = 0;
  const h = (i) => {
    const dx = Math.abs((i % W) - (g % W)), dy = Math.abs(((i / W) | 0) - ((g / W) | 0));
    return Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy);
  };
  const push = (i, f) => {
    open.push({ i, f, c: counter++ });
    let k = open.length - 1;
    while (k > 0) {
      const pk = (k - 1) >> 1;
      if (open[pk].f < open[k].f || (open[pk].f === open[k].f && open[pk].c < open[k].c)) break;
      [open[pk], open[k]] = [open[k], open[pk]];
      k = pk;
    }
  };
  const pop = () => {
    const top = open[0];
    const last = open.pop();
    if (open.length) {
      open[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        const less = (a, b) => open[a].f < open[b].f || (open[a].f === open[b].f && open[a].c < open[b].c);
        if (l < open.length && less(l, m)) m = l;
        if (r < open.length && less(r, m)) m = r;
        if (m === k) break;
        [open[m], open[k]] = [open[k], open[m]];
        k = m;
      }
    }
    return top;
  };
  gScore[s] = 0;
  push(s, h(s));
  while (open.length) {
    const { i } = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === g) break;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || block(nx, ny)) continue;
        if (dx && dy && (block(x + dx, y) || block(x, y + dy))) continue;
        const ni = ny * W + nx;
        const cost = gScore[i] + (dx && dy ? Math.SQRT2 : 1);
        if (cost < gScore[ni]) {
          gScore[ni] = cost;
          came[ni] = i;
          push(ni, cost + h(ni));
        }
      }
    }
  }
  if (s !== g && came[g] < 0) return null;
  const cells = [];
  for (let i = g; i !== s && i >= 0; i = came[i]) cells.push(i);
  cells.reverse();
  const pts = cells.map((i) => ({ x: (i % W) + 0.5, y: ((i / W) | 0) + 0.5 }));
  if (pts.length) pts[pts.length - 1] = { x: gx, y: gy }; else pts.push({ x: gx, y: gy });
  // String-pull: skip vertices when the straight walk is clear.
  const clear = (ax, ay, bx, by) => {
    const d = Math.hypot(bx - ax, by - ay);
    const n = Math.ceil(d / 0.1);
    for (let k = 0; k <= n; k++) {
      const px = ax + ((bx - ax) * k) / n, py = ay + ((by - ay) * k) / n;
      for (const [ox, oy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
        const cx = Math.floor(px + ox), cy = Math.floor(py + oy);
        if (cx < 0 || cy < 0 || cx >= W || cy >= H || block(cx, cy)) return false;
      }
    }
    return true;
  };
  const out = [];
  let ax = sx, ay = sy, k = 0;
  while (k < pts.length) {
    let far = k;
    for (let j = pts.length - 1; j > k; j--) {
      if (clear(ax, ay, pts[j].x, pts[j].y)) { far = j; break; }
    }
    out.push(pts[far]);
    ax = pts[far].x; ay = pts[far].y;
    k = far + 1;
  }
  return out;
}

// ---------------------------------------------------------------- Guards
class Guard {
  constructor(def, level) {
    this.d = def;
    this.level = level;
    const wp = def.wp;
    this.x = wp[0].x;
    this.y = wp[0].y;
    this.i = wp.length > 1 ? 1 : 0;
    this.dir = 1;
    this.lastWp = 0;
    this.pause = def.waits[0] || 0;
    if (def.face != null) this.facing = def.face;
    else if (def.lookCycle) this.facing = def.lookCycle[0];
    else if (def.looks[0] != null && this.pause > 0) this.facing = def.looks[0];
    else if (wp.length > 1) this.facing = Math.atan2(wp[1].y - wp[0].y, wp[1].x - wp[0].x);
    else this.facing = 0;
    this.lookK = 0;
    this.lookT = 0;
    this.mode = PATROL;
    this.timer = 0;
    this.path = null;
    this.pi = 0;
    this.leave = null;
    this.tx = 0; this.ty = 0;
    this.searchBase = 0;
    this.searchT = 0;
    const pre = Math.round(def.offset / DT);
    for (let s = 0; s < pre; s++) this.step(DT);
  }

  // Walk toward (tx,ty); turns on the spot first if facing far away.
  walk(tx, ty, speed, dt) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    const heading = Math.atan2(dy, dx);
    const off = Math.abs(angDiff(this.facing, heading));
    this.facing = approachAngle(this.facing, heading, this.d.turn * dt);
    if (off > 0.8) return false;
    const step = speed * dt;
    if (d <= step) { this.x = tx; this.y = ty; return true; }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    return false;
  }

  patrol(dt) {
    const d = this.d;
    const wp = d.wp;
    if (wp.length === 1) {
      if (d.lookCycle) {
        this.lookT += dt;
        if (this.lookT >= d.lookTime) {
          this.lookT -= d.lookTime;
          this.lookK = (this.lookK + 1) % d.lookCycle.length;
        }
        this.facing = approachAngle(this.facing, d.lookCycle[this.lookK], d.turn * dt);
      } else if (d.face != null) {
        this.facing = approachAngle(this.facing, d.face, d.turn * dt);
      }
      return;
    }
    if (this.pause > 0) {
      this.pause -= dt;
      const look = d.looks[this.lastWp];
      if (look != null) this.facing = approachAngle(this.facing, look, d.turn * dt);
      return;
    }
    const tgt = wp[this.i];
    if (this.walk(tgt.x, tgt.y, d.speed, dt)) {
      this.lastWp = this.i;
      this.pause = d.waits[this.i] || 0;
      if (d.loop) this.i = (this.i + 1) % wp.length;
      else {
        if (this.i + this.dir >= wp.length || this.i + this.dir < 0) this.dir = -this.dir;
        this.i += this.dir;
      }
    }
  }

  hear(nx, ny) {
    if (this.d.deaf) return false;
    if (dist(this.x, this.y, nx, ny) > this.d.hear) return false;
    if (this.mode === PATROL) {
      this.leave = {
        x: this.x, y: this.y, i: this.i, dir: this.dir, lastWp: this.lastWp,
        pause: this.pause, lookK: this.lookK, lookT: this.lookT,
      };
    }
    this.mode = REACT;
    this.timer = 0.55;
    this.tx = nx;
    this.ty = ny;
    return true;
  }

  followPath(speed, dt) {
    if (!this.path || this.pi >= this.path.length) return true;
    const p = this.path[this.pi];
    if (this.walk(p.x, p.y, speed, dt)) this.pi++;
    return this.pi >= this.path.length;
  }

  step(dt) {
    const d = this.d;
    switch (this.mode) {
      case PATROL:
        this.patrol(dt);
        break;
      case REACT: {
        const a = Math.atan2(this.ty - this.y, this.tx - this.x);
        this.facing = approachAngle(this.facing, a, d.turn * dt);
        this.timer -= dt;
        if (this.timer <= 0) {
          this.path = astar(this.level, this.x, this.y, this.tx, this.ty);
          this.pi = 0;
          this.mode = this.path ? INVESTIGATE : SEARCH;
          if (!this.path) { this.searchBase = this.facing; this.searchT = 0; this.timer = 2.4; }
        }
        break;
      }
      case INVESTIGATE:
        if (this.followPath(Math.max(1.5, d.speed * 1.35), dt)) {
          this.mode = SEARCH;
          this.timer = 2.4;
          this.searchBase = this.facing;
          this.searchT = 0;
        }
        break;
      case SEARCH: {
        this.searchT += dt;
        const want = this.searchBase + Math.sin(this.searchT * 2.4) * 1.25;
        this.facing = approachAngle(this.facing, want, d.turn * 1.2 * dt);
        this.timer -= dt;
        if (this.timer <= 0) {
          const lv = this.leave;
          this.path = astar(this.level, this.x, this.y, lv.x, lv.y) || [{ x: lv.x, y: lv.y }];
          this.pi = 0;
          this.mode = RETURN;
        }
        break;
      }
      case RETURN:
        if (this.followPath(d.speed, dt)) {
          const lv = this.leave;
          this.x = lv.x; this.y = lv.y;
          this.i = lv.i; this.dir = lv.dir; this.lastWp = lv.lastWp;
          this.pause = lv.pause; this.lookK = lv.lookK; this.lookT = lv.lookT;
          this.mode = PATROL;
          this.leave = null;
        }
        break;
    }
  }
}

// ---------------------------------------------------------------- Simulation
export class Sim {
  // opts.detect: can the thief be caught; opts.interact: pickups/noise/exit
  constructor(level, plan, opts = {}) {
    this.level = level;
    this.plan = plan;
    this.detect = opts.detect !== false;
    this.interact = opts.interact !== false;
    this.t = 0;
    this.k = 0;
    this._p = {};
    const p = plan.posAt(0, this._p);
    this.tx = p.x;
    this.ty = p.y;
    this.mask = 0;
    this.open = 0;
    this.powerUntil = -1;
    this.powerUsed = false;
    this.status = 'active';
    this.endT = Infinity;
    this.caught = null;
    this.events = [];
    this.lastNear = {};
    this.noiseIn = level.noise.map((nz) => this.inRect(p.x, p.y, nz));
    this.guards = level.guards.map((g) => new Guard(g, level));
    this.frames = [];
    this.record();
  }

  inRect(x, y, cell) {
    return x >= cell.x + 0.12 && x <= cell.x + 0.88 && y >= cell.y + 0.12 && y <= cell.y + 0.88;
  }

  powerOff(t = this.t) {
    return t < this.powerUntil;
  }

  record() {
    const g = new Array(this.guards.length * 4);
    for (let i = 0; i < this.guards.length; i++) {
      const gd = this.guards[i];
      g[i * 4] = gd.x; g[i * 4 + 1] = gd.y; g[i * 4 + 2] = gd.facing; g[i * 4 + 3] = gd.mode;
    }
    this.frames.push({
      tx: this.tx, ty: this.ty, m: this.mask, o: this.open,
      pw: this.powerOff() ? 1 : 0,
      st: this.status === 'active' ? 0 : this.status === 'caught' ? 1 : 2,
      g,
    });
  }

  advanceTo(T) {
    while (this.t + DT <= T + 1e-9) this.step();
  }

  step() {
    const L = this.level;
    const px = this.tx, py = this.ty;
    this.k++;
    this.t = this.k * DT;
    const t = this.t;
    if (this.status !== 'escaped') {
      const p = this.plan.posAt(t, this._p);
      this.tx = p.x;
      this.ty = p.y;
    }
    if (this.interact && this.status === 'active') this.interactions(px, py);
    for (const g of this.guards) g.step(DT);
    if (this.detect && this.status === 'active') this.detection(px, py);
    this.record();
  }

  interactions(px, py) {
    const L = this.level;
    const x = this.tx, y = this.ty, t = this.t;
    for (const it of L.items) {
      if (this.mask & it.bit) continue;
      if (segPoint(px, py, x, y, it.x, it.y).d2 < PICK_R * PICK_R) {
        this.mask |= it.bit;
        this.events.push({ t, type: 'pickup', item: it.idx, kind: it.type });
        if (it.type === 'key') {
          const open = L.doorsOpenFor(this.mask);
          if (open !== this.open) {
            this.open = open;
            this.events.push({ t, type: 'door', color: it.color });
          }
        }
      }
    }
    for (let k = 0; k < L.noise.length; k++) {
      const nz = L.noise[k];
      const inside = this.inRect(x, y, nz);
      const hit = inside || segRect(px, py, x, y, nz.x + 0.12, nz.y + 0.12, nz.x + 0.88, nz.y + 0.88);
      if (hit && !this.noiseIn[k]) {
        const heard = [];
        this.guards.forEach((g, gi) => { if (g.hear(nz.cx, nz.cy)) heard.push(gi); });
        this.events.push({ t, type: 'noise', tile: k, x: nz.cx, y: nz.cy, heard });
      }
      this.noiseIn[k] = inside;
    }
    if (L.power && !this.powerUsed) {
      const pw = L.power;
      if (segRect(px, py, x, y, pw.x + 0.12, pw.y + 0.12, pw.x + 0.88, pw.y + 0.88)) {
        this.powerUsed = true;
        this.powerUntil = t + pw.duration;
        this.events.push({ t, type: 'power', until: this.powerUntil });
      }
    }
    if ((this.mask & L.lootMask) === L.lootMask) {
      if (segPoint(px, py, x, y, L.exit.x, L.exit.y).d2 < EXIT_R * EXIT_R) {
        this.status = 'escaped';
        this.endT = t;
        this.tx = L.exit.x;
        this.ty = L.exit.y;
        this.events.push({ t, type: 'escape' });
      }
    }
  }

  catch(by, idx, x, y) {
    this.status = 'caught';
    this.endT = this.t;
    this.caught = { by, idx, x, y, t: this.t, tx: this.tx, ty: this.ty };
    this.events.push({ t: this.t, type: 'caught', by, idx, x, y });
  }

  near(key, by, idx) {
    const last = this.lastNear[key];
    if (last != null && this.t - last < 2) { this.lastNear[key] = this.t; return; }
    this.lastNear[key] = this.t;
    this.events.push({ t: this.t, type: 'near', by, idx });
  }

  // Cone test with near-miss reporting. Returns 2 = seen, 1 = close call, 0 = clear.
  coneCheck(vx, vy, facing, range, half, block) {
    const dx = this.tx - vx, dy = this.ty - vy;
    const d = Math.hypot(dx, dy);
    if (d > range + 0.6) return 0;
    const off = Math.abs(angDiff(facing, Math.atan2(dy, dx)));
    const inside = d <= range && off <= half;
    if (!inside) {
      const lateral = off > half ? d * Math.sin(Math.min(off - half, Math.PI / 2)) : 0;
      const beyond = d - range;
      if (lateral < 0.5 && beyond < 0.5 && off < half + 0.6) {
        return losClear(vx, vy, this.tx, this.ty, this.level.W, this.level.H, block) ? 1 : 0;
      }
      return 0;
    }
    return losClear(vx, vy, this.tx, this.ty, this.level.W, this.level.H, block) ? 2 : 0;
  }

  detection(px, py) {
    const L = this.level;
    const block = L.blockers(this.open).sight;
    const t = this.t;
    for (let i = 0; i < this.guards.length; i++) {
      const g = this.guards[i];
      if (dist(g.x, g.y, this.tx, this.ty) < BUMP_R) { this.catch('guard', i, g.x, g.y); return; }
      const r = this.coneCheck(g.x, g.y, g.facing, g.d.range, g.d.half, block);
      if (r === 2) { this.catch('guard', i, g.x, g.y); return; }
      if (r === 1) this.near('g' + i, 'guard', i);
    }
    if (this.powerOff(t)) return;
    for (let i = 0; i < L.cameras.length; i++) {
      const c = L.cameras[i];
      const r = this.coneCheck(c.x, c.y, camAngle(c, t), c.range, c.half, block);
      if (r === 2) { this.catch('camera', i, c.x, c.y); return; }
      if (r === 1) this.near('c' + i, 'camera', i);
    }
    for (let i = 0; i < L.lasers.length; i++) {
      const l = L.lasers[i];
      const dd = segSegDist(l.ax, l.ay, l.bx, l.by, px, py, this.tx, this.ty);
      if (laserOn(l, t)) {
        if (dd < LASER_R) {
          const s = segPoint(l.ax, l.ay, l.bx, l.by, this.tx, this.ty);
          this.catch('laser', i, l.ax + (l.bx - l.ax) * s.u, l.ay + (l.by - l.ay) * s.u);
          return;
        }
        if (dd < 0.5) this.near('l' + i, 'laser', i);
      } else if (dd < 0.35 && laserFlipIn(l, t) < 0.45) {
        this.near('l' + i, 'laser', i);
      }
    }
  }

  firstEvent(type) {
    return this.events.find((e) => e.type === type) || null;
  }
}

// Interpolated view of recorded frames at time t (for rendering).
export function frameAt(frames, t) {
  const k = t / DT;
  const k0 = Math.max(0, Math.min(frames.length - 1, Math.floor(k)));
  const k1 = Math.min(frames.length - 1, k0 + 1);
  const f = Math.max(0, Math.min(1, k - k0));
  return { a: frames[k0], b: frames[k1], f, k: k0 };
}
