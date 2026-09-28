// The thief's plan: a polyline with optional waits at each vertex, walked at a
// constant speed. Plus the Drawer, which turns raw finger positions into a valid
// plan (no walking through walls, retrace-to-undo, pickups lock the line).

import { segPoint, segRect, resolveCircle, lerp } from './geom.js';

export const SPEED = 2.6;          // tiles per second
export const THIEF_R = 0.28;       // collision radius used while drawing
export const SPACING = 0.14;       // distance between plan vertices
export const RETRACE_R = 0.3;      // how close the finger must be to the line to erase it
export const DEADZONE = 0.24;      // the thumb must move this far from the tip to extend the line
export const RETRACE_WINDOW = 1.6; // how far back along the line an undo can reach per move
export const MAX_TIME = 90;        // longest plan we accept (seconds)
const PICK_R_DRAW = 0.44;          // a touch tighter than the sim so the sim always agrees
const EXIT_R_DRAW = 0.42;

export class Plan {
  constructor(x, y, speed = SPEED) {
    this.speed = speed;
    this.xs = [x];
    this.ys = [y];
    this.waits = [0];
    this.arr = [0];   // arrival time at vertex i
    this.len = [0];   // path length up to vertex i
  }

  get n() { return this.xs.length; }
  get end() { const i = this.xs.length - 1; return this.arr[i] + this.waits[i]; }
  get length() { return this.len[this.xs.length - 1]; }
  get totalWait() { return this.waits.reduce((a, b) => a + b, 0); }

  append(x, y) {
    const i = this.xs.length - 1;
    const d = Math.hypot(x - this.xs[i], y - this.ys[i]);
    this.xs.push(x);
    this.ys.push(y);
    this.waits.push(0);
    this.arr.push(this.arr[i] + this.waits[i] + d / this.speed);
    this.len.push(this.len[i] + d);
  }

  addWait(dt) {
    this.waits[this.xs.length - 1] += dt;
  }

  truncate(n) {
    n = Math.max(1, n);
    this.xs.length = n;
    this.ys.length = n;
    this.waits.length = n;
    this.arr.length = n;
    this.len.length = n;
  }

  // Index i such that arr[i] <= t (largest).
  seek(t) {
    let lo = 0, hi = this.xs.length - 1;
    if (t >= this.arr[hi]) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.arr[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // Position at time t. `out` gets x, y, i (segment start) and moving flag.
  posAt(t, out = {}) {
    const i = this.seek(t);
    const n = this.xs.length;
    const leave = this.arr[i] + this.waits[i];
    if (i >= n - 1 || t <= leave) {
      out.x = this.xs[i]; out.y = this.ys[i]; out.i = i; out.moving = false;
      return out;
    }
    const span = this.arr[i + 1] - leave;
    const u = span > 1e-9 ? (t - leave) / span : 1;
    out.x = lerp(this.xs[i], this.xs[i + 1], u);
    out.y = lerp(this.ys[i], this.ys[i + 1], u);
    out.i = i;
    out.moving = true;
    return out;
  }

  // Time at which the thief is at path distance s along the line (first arrival).
  timeAtLength(s) {
    let lo = 0, hi = this.len.length - 1;
    if (s >= this.len[hi]) return this.arr[hi];
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.len[mid] <= s) lo = mid; else hi = mid - 1;
    }
    const segLen = this.len[lo + 1] - this.len[lo];
    const u = segLen > 1e-9 ? (s - this.len[lo]) / segLen : 0;
    return this.arr[lo] + this.waits[lo] + u * (this.arr[lo + 1] - this.arr[lo] - this.waits[lo]);
  }

  clone() {
    const p = new Plan(this.xs[0], this.ys[0], this.speed);
    p.xs = this.xs.slice(); p.ys = this.ys.slice(); p.waits = this.waits.slice();
    p.arr = this.arr.slice(); p.len = this.len.slice();
    return p;
  }

  toJSON() {
    return { xs: this.xs.map((v) => +v.toFixed(3)), ys: this.ys.map((v) => +v.toFixed(3)), waits: this.waits.map((v) => +v.toFixed(3)) };
  }

  static fromPoints(points, speed = SPEED) {
    // points: [[x, y, wait?], ...]
    const p = new Plan(points[0][0], points[0][1], speed);
    p.waits[0] = points[0][2] || 0;
    for (let i = 1; i < points.length; i++) {
      p.append(points[i][0], points[i][1]);
      p.waits[p.n - 1] = points[i][2] || 0;
    }
    // recompute arrivals with waits in place
    for (let i = 1; i < p.n; i++) {
      const d = p.len[i] - p.len[i - 1];
      p.arr[i] = p.arr[i - 1] + p.waits[i - 1] + d / speed;
    }
    return p;
  }
}

export class Drawer {
  constructor(level) {
    this.level = level;
    this.plan = new Plan(level.start.x, level.start.y);
    this.lock = 0;          // vertices up to here can no longer be erased
    this.mask = 0;          // items this line passes over
    this.noiseLocked = [];  // noise tiles triggered by the locked part of the line
    this.powerLocked = false;
    this.escapeAt = -1;     // vertex where the line reaches the open exit
    this.lockEvents = [];   // {i, type} for rendering pins on the line
  }

  get escaped() { return this.escapeAt >= 0; }

  blockFn() {
    return this.level.blockers(this.level.doorsOpenFor(this.mask)).move;
  }

  // Try to erase the tail of the line when the finger slides back over it.
  retrace(fx, fy) {
    const p = this.plan;
    const n = p.n;
    if (n - 1 <= this.lock) return false;
    let best = RETRACE_R * RETRACE_R, bj = -1, bu = 0;
    // Only the recent tail can be erased, so crossing an older part of the
    // line (a loop, a figure eight) never wipes out half the plan.
    const minLen = p.length - RETRACE_WINDOW;
    for (let j = this.lock; j < n - 1; j++) {
      if (p.len[j + 1] < minLen) continue;
      const r = segPoint(p.xs[j], p.ys[j], p.xs[j + 1], p.ys[j + 1], fx, fy);
      if (r.d2 < best) { best = r.d2; bj = j; bu = r.u; }
    }
    if (bj < 0) return false;
    const at = p.len[bj] + bu * (p.len[bj + 1] - p.len[bj]);
    if (p.length - at < 0.24) return false;
    const x = lerp(p.xs[bj], p.xs[bj + 1], bu);
    const y = lerp(p.ys[bj], p.ys[bj + 1], bu);
    p.truncate(bj + 1);
    if (bu > 0.05 && bj + 1 > this.lock) p.append(x, y);
    if (this.escapeAt >= p.n) this.escapeAt = -1;
    return true;
  }

  // Walk the head of the line toward the finger, sliding along walls.
  extend(fx, fy) {
    if (this.escaped) return false;
    const L = this.level;
    const p = this.plan;
    // Ignore small wobbles around the tip so a resting thumb doesn't creep the line.
    if (Math.hypot(fx - p.xs[p.n - 1], fy - p.ys[p.n - 1]) < DEADZONE) return false;
    let block = this.blockFn();
    let changed = false;
    for (let guard = 0; guard < 400; guard++) {
      if (p.end >= MAX_TIME) break;
      const hx = p.xs[p.n - 1], hy = p.ys[p.n - 1];
      const dx = fx - hx, dy = fy - hy;
      const d = Math.hypot(dx, dy);
      if (d < SPACING) break;
      let [nx, ny] = resolveCircle(hx + (dx / d) * SPACING, hy + (dy / d) * SPACING, THIEF_R, L.W, L.H, block);
      const moved = Math.hypot(nx - hx, ny - hy);
      const nd = Math.hypot(fx - nx, fy - ny);
      if (moved < SPACING * 0.25 || nd > d - SPACING * 0.05) break;
      const before = this.mask;
      this.appendPoint(nx, ny);
      if (this.mask !== before) block = this.blockFn();
      changed = true;
      if (this.escaped) break;
    }
    return changed;
  }

  appendPoint(x, y) {
    const L = this.level;
    const p = this.plan;
    const px = p.xs[p.n - 1], py = p.ys[p.n - 1];
    p.append(x, y);
    const i = p.n - 1;
    for (const it of L.items) {
      if (this.mask & it.bit) continue;
      if (segPoint(px, py, x, y, it.x, it.y).d2 < PICK_R_DRAW * PICK_R_DRAW) {
        this.mask |= it.bit;
        this.lock = i;
        this.lockEvents.push({ i, type: it.type });
      }
    }
    for (let k = 0; k < L.noise.length; k++) {
      const nz = L.noise[k];
      const x0 = nz.x + 0.12, y0 = nz.y + 0.12, x1 = nz.x + 0.88, y1 = nz.y + 0.88;
      const wasIn = px >= x0 && px <= x1 && py >= y0 && py <= y1;
      if (!wasIn && segRect(px, py, x, y, x0, y0, x1, y1)) {
        this.lock = i;
        this.lockEvents.push({ i, type: 'noise' });
      }
    }
    if (L.power && !this.powerLocked) {
      const pw = L.power;
      if (segRect(px, py, x, y, pw.x + 0.12, pw.y + 0.12, pw.x + 0.88, pw.y + 0.88)) {
        this.powerLocked = true;
        this.lock = i;
        this.lockEvents.push({ i, type: 'power' });
      }
    }
    if ((this.mask & L.lootMask) === L.lootMask) {
      if (segPoint(px, py, x, y, L.exit.x, L.exit.y).d2 < EXIT_R_DRAW * EXIT_R_DRAW) this.escapeAt = i;
    }
  }

  hold(dt) {
    if (this.escaped) return false;
    if (this.plan.end + dt > MAX_TIME) return false;
    this.plan.addWait(dt);
    return true;
  }
}
