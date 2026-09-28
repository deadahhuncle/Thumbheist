// Small geometry toolkit shared by the simulation, the path drawer and the renderer.
// All world coordinates are in tile units; y grows downward (screen space).

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);

export function angNorm(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function angDiff(from, to) {
  return angNorm(to - from);
}

export function angLerp(a, b, t) {
  return a + angDiff(a, b) * t;
}

export function approachAngle(cur, target, maxStep) {
  const d = angDiff(cur, target);
  if (Math.abs(d) <= maxStep) return angNorm(target);
  return angNorm(cur + Math.sign(d) * maxStep);
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

// Squared distance from point P to segment AB, plus the projection parameter u in [0,1].
export function segPoint(ax, ay, bx, by, px, py) {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy;
  let u = l2 > 1e-12 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
  u = clamp(u, 0, 1);
  const qx = ax + vx * u - px, qy = ay + vy * u - py;
  return { d2: qx * qx + qy * qy, u };
}

export function segPointDist(ax, ay, bx, by, px, py) {
  return Math.sqrt(segPoint(ax, ay, bx, by, px, py).d2);
}

// Distance between two segments (used for laser vs. thief sweep).
export function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
  if (segsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.sqrt(Math.min(
    segPoint(ax, ay, bx, by, cx, cy).d2,
    segPoint(ax, ay, bx, by, dx, dy).d2,
    segPoint(cx, cy, dx, dy, ax, ay).d2,
    segPoint(cx, cy, dx, dy, bx, by).d2,
  ));
}

function orient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

// Does segment AB touch the axis-aligned rectangle [x0,x1]x[y0,y1]? (Liang–Barsky)
export function segRect(ax, ay, bx, by, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}

// Grid DDA raycast. Direction (dx,dy) must be normalised. Returns the distance
// travelled before entering a blocking cell (or maxDist). Cells outside the grid block.
export function rayDist(ox, oy, dx, dy, maxDist, W, H, block) {
  let cx = Math.floor(ox), cy = Math.floor(oy);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tmx = dx > 0 ? (cx + 1 - ox) * tdx : dx < 0 ? (ox - cx) * tdx : Infinity;
  let tmy = dy > 0 ? (cy + 1 - oy) * tdy : dy < 0 ? (oy - cy) * tdy : Infinity;
  let t = 0;
  for (let guard = 0; guard < 256; guard++) {
    if (tmx < tmy) { t = tmx; tmx += tdx; cx += stepX; }
    else { t = tmy; tmy += tdy; cy += stepY; }
    if (t >= maxDist) return maxDist;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H || block(cx, cy)) return t;
  }
  return maxDist;
}

export function losClear(ax, ay, bx, by, W, H, block) {
  const d = Math.hypot(bx - ax, by - ay);
  if (d < 1e-6) return true;
  return rayDist(ax, ay, (bx - ax) / d, (by - ay) / d, d, W, H, block) >= d - 1e-6;
}

// Push a circle out of blocking cells (and the board edge). Returns [x, y].
export function resolveCircle(x, y, r, W, H, block) {
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const solid = cx < 0 || cy < 0 || cx >= W || cy >= H || block(cx, cy);
        if (!solid) continue;
        const px = clamp(x, cx, cx + 1), py = clamp(y, cy, cy + 1);
        const dx = x - px, dy = y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          x += (dx / d) * (r - d);
          y += (dy / d) * (r - d);
        } else {
          // Centre is inside the cell: leave along the shallowest face.
          const l = x - cx, rr = cx + 1 - x, t = y - cy, b = cy + 1 - y;
          const m = Math.min(l, rr, t, b);
          if (m === l) x = cx - r; else if (m === rr) x = cx + 1 + r;
          else if (m === t) y = cy - r; else y = cy + 1 + r;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return [x, y];
}

// Deterministic PRNG (mulberry32) for decoration.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
