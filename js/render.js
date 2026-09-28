// Canvas renderer: a moonlit miniature diorama. Static geometry is baked into an
// offscreen layer per level/size; lights, characters, the plan line and effects
// are drawn every frame in tile units.

import { W, H, FLOOR, WALL, PROP, GLASS, DOOR, VOID } from './level.js';
import { rayDist, TAU, DEG, rng, hashStr, clamp, angDiff } from './geom.js';
import { camAngle, laserOn, PATROL, REACT, SEARCH, INVESTIGATE, RETURN } from './sim.js';
import * as S from './sprites.js';

export const FONT_DISPLAY = '"Big Shoulders Display", "Barlow Semi Condensed", "Arial Narrow", sans-serif';
export const FONT_UI = '"Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif';

export const THEMES = {
  gallery: {
    bg: '#0c1020', grid: 'rgba(120,150,255,0.055)',
    floor: ['#3d2c35', '#36272f'], seam: 'rgba(0,0,0,0.26)', pattern: 'parquet',
    wallTop: '#ece3d1', wallSide: '#a3937a', wallEdge: '#fffaf0',
    prop: 'plinth', low: 'case', accent: '#d9b66a',
  },
  bank: {
    bg: '#0b1119', grid: 'rgba(120,200,220,0.05)',
    floor: ['#17343c', '#1c3f48'], seam: 'rgba(0,0,0,0.2)', pattern: 'marble',
    wallTop: '#e3eaec', wallSide: '#8ea1a8', wallEdge: '#ffffff',
    prop: 'plant', low: 'desk', accent: '#9fe0d0',
  },
  vault: {
    bg: '#0d0f16', grid: 'rgba(255,90,100,0.045)',
    floor: ['#272b36', '#23272f'], seam: 'rgba(0,0,0,0.3)', pattern: 'plate',
    wallTop: '#d7dbe3', wallSide: '#848b9a', wallEdge: '#f7f9ff',
    prop: 'crate', low: 'rail', accent: '#ff7b86',
  },
  manor: {
    bg: '#100c14', grid: 'rgba(230,180,110,0.045)',
    floor: ['#4a1d29', '#431a25'], seam: 'rgba(0,0,0,0.25)', pattern: 'carpet',
    wallTop: '#e9e1c6', wallSide: '#9c9270', wallEdge: '#fffbe9',
    prop: 'bookcase', low: 'table', accent: '#e8c27a',
  },
  tower: {
    bg: '#070a18', grid: 'rgba(140,160,255,0.06)',
    floor: ['#161d3b', '#131933'], seam: 'rgba(140,170,255,0.09)', pattern: 'tiles',
    wallTop: '#dfe4f7', wallSide: '#8a91b3', wallEdge: '#ffffff',
    prop: 'planter', low: 'glass', accent: '#9fb4ff',
  },
};

const FH = 0.3; // visible height of a wall's front face, in tiles

function kindAt(level, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return VOID;
  return level.kind[y * W + x];
}
const isTall = (k) => k === WALL || k === DOOR;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.cw = 1; this.ch = 1;
    this.ts = 30; this.ox = 0; this.oy = 0;
    this.level = null;
    this.stat = null;
    this.corners = [];
  }

  resize(cssW, cssH, area) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cw = cssW; this.ch = cssH;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.area = area;
    const ts = Math.min(area.w / W, area.h / H);
    this.ts = Math.max(8, ts);
    this.ox = Math.round(area.x + (area.w - this.ts * W) / 2);
    this.oy = Math.round(area.y + (area.h - this.ts * H) / 2);
    if (this.level) this.buildStatic();
  }

  setLevel(level) {
    this.level = level;
    this.theme = THEMES[level.theme] || THEMES.gallery;
    this.seed = hashStr(level.id);
    // Corners of sight blockers, used to sharpen light cones at wall edges.
    const c = new Set();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = level.kind[y * W + x];
      if (k === WALL || k === PROP || k === DOOR || k === VOID) {
        c.add(`${x},${y}`); c.add(`${x + 1},${y}`); c.add(`${x},${y + 1}`); c.add(`${x + 1},${y + 1}`);
      }
    }
    this.corners = [...c].map((s) => s.split(',').map(Number));
    this.hearReach = Math.max(3, ...level.guards.filter((g) => !g.deaf).map((g) => g.hear), 0);
    this.buildStatic();
  }

  toScreen(x, y) { return [this.ox + x * this.ts, this.oy + y * this.ts]; }
  toWorld(px, py) { return [(px - this.ox) / this.ts, (py - this.oy) / this.ts]; }

  worldTransform(ctx, shake = [0, 0]) {
    const d = this.dpr, t = this.ts;
    ctx.setTransform(d * t, 0, 0, d * t, d * (this.ox + shake[0]), d * (this.oy + shake[1]));
  }
  screenTransform(ctx) { ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }

  // ------------------------------------------------------------------ static layer
  buildStatic() {
    const L = this.level, T = this.theme;
    if (!this.stat) this.stat = document.createElement('canvas');
    const cv = this.stat;
    cv.width = this.canvas.width; cv.height = this.canvas.height;
    const ctx = cv.getContext('2d');
    const R = rng(this.seed);

    // exterior: night ground with a faint blueprint grid aligned to the board
    this.screenTransform(ctx);
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, this.cw, this.ch);
    ctx.strokeStyle = T.grid;
    ctx.lineWidth = 1;
    const ts = this.ts;
    const gx0 = this.ox % ts, gy0 = this.oy % ts;
    ctx.beginPath();
    for (let x = gx0; x < this.cw; x += ts) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, this.ch); }
    for (let y = gy0; y < this.ch; y += ts) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(this.cw, Math.round(y) + 0.5); }
    ctx.stroke();
    // speckle
    const R2 = rng(99);
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let i = 0; i < (this.cw * this.ch) / 900; i++) ctx.fillRect(R2() * this.cw, R2() * this.ch, 1.2, 1.2);
    if (T.pattern === 'tiles') this.drawCityBelow(ctx);

    this.worldTransform(ctx);
    // building footprint drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = ts * 0.6 * this.dpr;
    ctx.shadowOffsetY = ts * 0.18 * this.dpr;
    ctx.fillStyle = T.floor[0];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (kindAt(L, x, y) !== VOID) ctx.fillRect(x, y, 1, 1);
    ctx.restore();

    // floors
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = kindAt(L, x, y);
      if (k === VOID || k === WALL) continue;
      this.drawFloorCell(ctx, x, y, R);
    }
    // soft shadows cast by tall things onto the floor
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = kindAt(L, x, y);
      if (k === WALL || k === DOOR) continue;
      const up = kindAt(L, x, y - 1), left = kindAt(L, x - 1, y);
      if (k !== VOID && (up === WALL || up === PROP)) {
        const g = ctx.createLinearGradient(0, y, 0, y + 0.45);
        g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x, y, 1, 0.45);
      }
      if (k !== VOID && (left === WALL || left === PROP)) {
        const g = ctx.createLinearGradient(x, 0, x + 0.25, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x, y, 0.25, 1);
      }
    }

    // floor features
    for (const nz of L.noise) this.drawCreak(ctx, nz.x, nz.y, R);
    if (L.power) this.drawFuseBox(ctx, L.power.x, L.power.y);
    this.drawEntry(ctx);

    // patrol routes
    ctx.save();
    ctx.setLineDash([0.06, 0.16]);
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.055;
    ctx.strokeStyle = 'rgba(255,214,150,0.22)';
    for (const g of L.guards) {
      if (g.wp.length < 2) continue;
      ctx.beginPath();
      g.wp.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (g.loop) ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
    for (const g of L.guards) {
      if (g.wp.length < 2) continue;
      for (const p of g.wp) {
        ctx.fillStyle = 'rgba(255,214,150,0.22)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 0.07, 0, TAU); ctx.fill();
      }
    }
    // camera sweep arcs
    for (const c of L.cameras) {
      ctx.strokeStyle = 'rgba(170,215,255,0.22)';
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      const s = c.sweep || 0.05;
      ctx.arc(c.x, c.y, 0.62, c.dir - s / 2 - c.half, c.dir + s / 2 + c.half);
      ctx.stroke();
    }

    // low props (see-through) and tall props
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = kindAt(L, x, y);
      if (k === GLASS) this.drawLow(ctx, x, y, R);
    }
    // enclosed outdoor spaces become courtyards
    this.drawCourtyards(ctx, R);
    // walls: one merged top surface, then faces and details
    this.drawWallTops(ctx, R);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = kindAt(L, x, y);
      if (k === WALL) this.drawWall(ctx, x, y, R);
      else if (k === PROP) this.drawProp(ctx, x, y, R);
    }
    // laser emitters
    for (const l of L.lasers) {
      this.drawEmitter(ctx, l.ax, l.ay, Math.atan2(l.by - l.ay, l.bx - l.ax));
      this.drawEmitter(ctx, l.bx, l.by, Math.atan2(l.ay - l.by, l.ax - l.bx));
    }
    // vignette, baked in so it costs nothing per frame
    this.screenTransform(ctx);
    const vig = ctx.createRadialGradient(this.cw / 2, this.ch * 0.48, Math.min(this.cw, this.ch) * 0.45, this.cw / 2, this.ch * 0.48, Math.hypot(this.cw, this.ch) * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, this.cw, this.ch);
  }

  // Tower levels: the street grid glitters far below.
  drawCityBelow(ctx) {
    const R = rng(1234);
    const w = this.cw, h = this.ch;
    ctx.save();
    // avenues with streams of car lights
    for (let i = 0; i < 7; i++) {
      const vertical = i % 2 === 0;
      const p = R() * (vertical ? w : h);
      ctx.strokeStyle = 'rgba(255,190,110,0.06)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      if (vertical) { ctx.moveTo(p, 0); ctx.lineTo(p + (R() - 0.5) * 80, h); }
      else { ctx.moveTo(0, p); ctx.lineTo(w, p + (R() - 0.5) * 80); }
      ctx.stroke();
      for (let k = 0; k < 40; k++) {
        const u = R();
        const x = vertical ? p + (R() - 0.5) * 4 : u * w, y = vertical ? u * h : p + (R() - 0.5) * 4;
        ctx.fillStyle = R() < 0.5 ? 'rgba(255,220,150,0.55)' : 'rgba(255,90,80,0.45)';
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }
    // rooftops and windows
    for (let i = 0; i < (w * h) / 700; i++) {
      const x = R() * w, y = R() * h;
      const c = R();
      ctx.fillStyle = c < 0.7 ? 'rgba(255,214,130,0.35)' : c < 0.9 ? 'rgba(150,190,255,0.35)' : 'rgba(255,255,255,0.5)';
      ctx.fillRect(x, y, 1.3, 1.3);
    }
    ctx.restore();
  }

  // A floor run whose walls have open air beyond them on both sides: a skybridge.
  isBridge(x, y) {
    const L = this.level;
    if (this.theme.pattern !== 'tiles') return false;
    let a = x, b = x;
    while (a > 0 && kindAt(L, a - 1, y) !== WALL && kindAt(L, a - 1, y) !== VOID) a--;
    while (b < W - 1 && kindAt(L, b + 1, y) !== WALL && kindAt(L, b + 1, y) !== VOID) b++;
    if (a - 2 < 0 || b + 2 > W - 1) return false;
    return kindAt(L, a - 1, y) === WALL && kindAt(L, a - 2, y) === VOID && kindAt(L, b + 1, y) === WALL && kindAt(L, b + 2, y) === VOID;
  }

  drawFloorCell(ctx, x, y, R) {
    const T = this.theme;
    const base = (x + y) % 2 ? T.floor[1] : T.floor[0];
    if (this.isBridge(x, y)) {
      // glass: let the city below show through, with a cool sheen and mullions
      ctx.fillStyle = T.bg;
      ctx.fillRect(x, y, 1, 1);
      const Rc = rng(x * 131 + y * 17);
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = Rc() < 0.7 ? 'rgba(255,214,130,0.55)' : 'rgba(150,190,255,0.5)';
        ctx.fillRect(x + Rc(), y + Rc(), 0.035, 0.035);
      }
      ctx.fillStyle = 'rgba(140,180,255,0.12)';
      ctx.fillRect(x, y, 1, 1);
      ctx.strokeStyle = 'rgba(190,210,255,0.28)';
      ctx.lineWidth = 0.03;
      ctx.strokeRect(x + 0.015, y + 0.015, 0.97, 0.97);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath(); ctx.moveTo(x + 0.15, y + 0.85); ctx.lineTo(x + 0.55, y + 0.15); ctx.stroke();
      return;
    }
    ctx.fillStyle = base;
    ctx.fillRect(x, y, 1, 1);
    ctx.strokeStyle = T.seam;
    ctx.lineWidth = 0.02;
    switch (T.pattern) {
      case 'parquet': {
        const vert = (x + y) % 2 === 0;
        for (let i = 0; i < 4; i++) {
          const shade = 0.9 + R() * 0.2;
          ctx.fillStyle = `rgba(${shade > 1 ? '255,220,190' : '0,0,0'},${Math.abs(shade - 1) * 0.35})`;
          if (vert) ctx.fillRect(x + i * 0.25, y, 0.25, 1); else ctx.fillRect(x, y + i * 0.25, 1, 0.25);
        }
        ctx.beginPath();
        for (let i = 1; i < 4; i++) {
          if (vert) { ctx.moveTo(x + i * 0.25, y); ctx.lineTo(x + i * 0.25, y + 1); }
          else { ctx.moveTo(x, y + i * 0.25); ctx.lineTo(x + 1, y + i * 0.25); }
        }
        ctx.stroke();
        ctx.strokeRect(x, y, 1, 1);
        break;
      }
      case 'marble': {
        ctx.strokeRect(x, y, 1, 1);
        if (R() < 0.55) {
          ctx.strokeStyle = 'rgba(210,240,245,0.07)';
          ctx.lineWidth = 0.025;
          ctx.beginPath();
          const sx = x + R(), sy = y;
          ctx.moveTo(sx, sy);
          ctx.bezierCurveTo(x + R(), y + 0.4, x + R(), y + 0.6, x + R(), y + 1);
          ctx.stroke();
        }
        break;
      }
      case 'plate': {
        ctx.strokeRect(x, y, 1, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.045)';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          const cx = x + 0.125 + i * 0.25, cy = y + 0.125 + j * 0.25;
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(((i + j) % 2 ? 1 : -1) * 0.6);
          ctx.fillRect(-0.07, -0.018, 0.14, 0.036); ctx.restore();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (const [dx, dy] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]]) {
          ctx.beginPath(); ctx.arc(x + dx, y + dy, 0.025, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'carpet': {
        ctx.strokeStyle = 'rgba(232,190,110,0.09)';
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 1, y + 0.5); ctx.lineTo(x + 0.5, y + 1); ctx.lineTo(x, y + 0.5); ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = 'rgba(232,190,110,0.1)';
        ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 0.06, 0, TAU); ctx.fill();
        break;
      }
      case 'tiles': {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + 1);
        ctx.moveTo(x, y + 0.5); ctx.lineTo(x + 1, y + 0.5);
        ctx.stroke();
        ctx.strokeRect(x, y, 1, 1);
        if (R() < 0.3) {
          ctx.fillStyle = 'rgba(150,180,255,0.04)';
          ctx.fillRect(x + (R() < 0.5 ? 0 : 0.5), y + (R() < 0.5 ? 0 : 0.5), 0.5, 0.5);
        }
        break;
      }
    }
  }

  // All wall tops as one surface so there are no seams between cells.
  drawWallTops(ctx, R) {
    const L = this.level, T = this.theme;
    const tops = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (kindAt(L, x, y) !== WALL) continue;
      const front = !isTall(kindAt(L, x, y + 1));
      tops.push([x, y, front ? 1 - FH : 1]);
    }
    ctx.save();
    ctx.beginPath();
    for (const [x, y, h] of tops) ctx.rect(x, y, 1, h);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, shade(T.wallTop, 0.08));
    g.addColorStop(1, shade(T.wallTop, -0.06));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    // plaster speckle
    ctx.fillStyle = 'rgba(0,0,0,0.035)';
    for (let i = 0; i < 900; i++) ctx.fillRect(R() * W, R() * H, 0.03, 0.03);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 400; i++) ctx.fillRect(R() * W, R() * H, 0.025, 0.025);
    ctx.restore();
    // cap lines: an inset groove along every edge that faces a room or the outside
    ctx.save();
    ctx.strokeStyle = 'rgba(40,30,20,0.13)';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    const inset = 0.13;
    for (const [x, y, h] of tops) {
      const up = isTall(kindAt(L, x, y - 1)), dn = h < 1;
      const lf = isTall(kindAt(L, x - 1, y)), rt = isTall(kindAt(L, x + 1, y));
      const x0 = x + (lf ? 0 : inset), x1 = x + 1 - (rt ? 0 : inset);
      const y0 = y + (up ? 0 : inset), y1 = y + h - (dn ? inset : 0);
      if (!up) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
      if (dn) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
      if (!lf) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
      if (!rt) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
    }
    ctx.stroke();
    ctx.restore();
  }

  drawCourtyards(ctx, R) {
    const L = this.level, T = this.theme;
    // flood-fill void from the board edge; whatever void is left is enclosed
    const outside = new Uint8Array(W * H);
    const q = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && kindAt(L, x, y) === VOID) { outside[y * W + x] = 1; q.push([x, y]); }
    }
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || outside[ny * W + nx] || kindAt(L, nx, ny) !== VOID) continue;
        outside[ny * W + nx] = 1; q.push([nx, ny]);
      }
    }
    const cells = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (kindAt(L, x, y) === VOID && !outside[y * W + x]) cells.push([x, y]);
    if (!cells.length) return;
    const style = T.pattern === 'tiles' ? 'well' : T.pattern === 'plate' ? 'grate' : 'garden';
    ctx.save();
    for (const [x, y] of cells) {
      if (style === 'garden') {
        ctx.fillStyle = (x + y) % 2 ? '#1a2b20' : '#1c2e22';
        ctx.fillRect(x, y, 1, 1);
        ctx.strokeStyle = 'rgba(120,170,110,0.12)';
        ctx.lineWidth = 0.02;
        ctx.beginPath();
        for (let i = 0; i < 7; i++) { const gx = x + R(), gy = y + R(); ctx.moveTo(gx, gy); ctx.lineTo(gx + (R() - 0.5) * 0.08, gy - 0.1); }
        ctx.stroke();
      } else if (style === 'well') {
        ctx.fillStyle = '#060918';
        ctx.fillRect(x, y, 1, 1);
        ctx.fillStyle = 'rgba(255,214,120,0.5)';
        for (let i = 0; i < 3; i++) ctx.fillRect(x + R(), y + R(), 0.035, 0.05);
      } else {
        ctx.fillStyle = '#11141b';
        ctx.fillRect(x, y, 1, 1);
        ctx.strokeStyle = 'rgba(160,170,190,0.14)';
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        for (let i = 1; i < 5; i++) { ctx.moveTo(x + i / 5, y); ctx.lineTo(x + i / 5, y + 1); }
        ctx.stroke();
      }
    }
    if (style === 'garden') {
      // a few shrubs and a little fountain for charm
      const n = Math.min(6, Math.ceil(cells.length / 2));
      for (let i = 0; i < n; i++) {
        const [x, y] = cells[(R() * cells.length) | 0];
        const cx = x + 0.3 + R() * 0.4, cy = y + 0.3 + R() * 0.4;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(cx + 0.05, cy + 0.1, 0.28, 0.14, 0, 0, TAU); ctx.fill();
        for (const [dx, dy, r, c] of [[0, 0, 0.24, '#23452f'], [-0.08, -0.06, 0.15, '#2d5a3c'], [0.07, -0.08, 0.1, '#3a7049']]) {
          ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx + dx, cy + dy, r, 0, TAU); ctx.fill();
        }
      }
    }
    // inner shadow where the building meets the courtyard
    for (const [x, y] of cells) {
      if (kindAt(L, x, y - 1) !== VOID) {
        const g = ctx.createLinearGradient(0, y, 0, y + 0.4);
        g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x, y, 1, 0.4);
      }
      if (kindAt(L, x - 1, y) !== VOID) {
        const g = ctx.createLinearGradient(x, 0, x + 0.3, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x, y, 0.3, 1);
      }
    }
    ctx.restore();
  }

  drawWall(ctx, x, y, R) {
    const L = this.level, T = this.theme;
    const below = kindAt(L, x, y + 1);
    const front = !isTall(below);
    const topH = front ? 1 - FH : 1;
    // top-face edge lighting
    const up = kindAt(L, x, y - 1), lf = kindAt(L, x - 1, y), rt = kindAt(L, x + 1, y);
    ctx.fillStyle = T.wallEdge;
    if (!isTall(up)) ctx.fillRect(x, y, 1, 0.04);
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    if (!isTall(rt)) ctx.fillRect(x + 1 - 0.035, y, 0.035, topH);
    if (!isTall(lf)) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x, y, 0.03, topH); }
    if (front) {
      const g = ctx.createLinearGradient(0, y + topH, 0, y + 1);
      g.addColorStop(0, T.wallSide);
      g.addColorStop(1, shade(T.wallSide, -0.25));
      ctx.fillStyle = g;
      ctx.fillRect(x - 0.002, y + topH, 1.004, FH);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, y + topH, 1, 0.025);
      this.decorateFront(ctx, x, y + topH, R, below);
    }
  }

  decorateFront(ctx, x, y, R, below) {
    const T = this.theme;
    const faceInside = below !== VOID;
    switch (T.pattern) {
      case 'parquet':
        if (faceInside && R() < 0.45) {
          const w = 0.34 + R() * 0.2, h = FH * 0.62;
          const px = x + 0.5 - w / 2 + (R() - 0.5) * 0.2, py = y + FH * 0.16;
          ctx.fillStyle = '#b8903f';
          ctx.fillRect(px - 0.025, py - 0.025, w + 0.05, h + 0.05);
          const hues = ['#2f4b7c', '#7c2f3e', '#3c6b4f', '#8a6a2a', '#5a3f7a'];
          ctx.fillStyle = hues[(R() * hues.length) | 0];
          ctx.fillRect(px, py, w, h);
          ctx.fillStyle = 'rgba(255,230,180,0.35)';
          ctx.fillRect(px + w * 0.2, py + h * 0.3, w * 0.25, h * 0.35);
        }
        break;
      case 'marble':
        ctx.fillStyle = 'rgba(80,50,30,0.45)';
        ctx.fillRect(x, y + FH * 0.45, 1, FH * 0.55);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x, y + FH * 0.45, 1, 0.012);
        break;
      case 'plate':
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (const dx of [0.2, 0.5, 0.8]) { ctx.beginPath(); ctx.arc(x + dx, y + FH * 0.5, 0.022, 0, TAU); ctx.fill(); }
        break;
      case 'carpet':
        ctx.fillStyle = 'rgba(90,110,70,0.28)';
        for (let i = 0; i < 5; i++) ctx.fillRect(x + i * 0.2 + 0.05, y + 0.02, 0.07, FH - 0.02);
        break;
      case 'tiles':
        if (!faceInside) {
          ctx.fillStyle = 'rgba(120,160,255,0.35)';
          ctx.fillRect(x + 0.1, y + FH * 0.25, 0.8, FH * 0.4);
        } else {
          ctx.fillStyle = 'rgba(160,190,255,0.18)';
          ctx.fillRect(x, y + FH * 0.7, 1, 0.02);
        }
        break;
    }
  }

  drawProp(ctx, x, y, R) {
    const T = this.theme;
    const cx = x + 0.5, cy = y + 0.5;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(cx + 0.06, y + 0.94, 0.46, 0.14, 0, 0, TAU); ctx.fill();
    switch (T.prop) {
      case 'plinth': {
        ctx.fillStyle = '#d9d0bf'; ctx.fillRect(x + 0.1, y + 0.3, 0.8, 0.46);
        ctx.fillStyle = '#9e937e'; ctx.fillRect(x + 0.1, y + 0.76, 0.8, 0.2);
        ctx.fillStyle = '#f5efe3'; ctx.fillRect(x + 0.1, y + 0.3, 0.8, 0.04);
        // bust
        ctx.fillStyle = '#c9c3b6';
        ctx.beginPath(); ctx.ellipse(cx, y + 0.34, 0.22, 0.12, 0, Math.PI, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(cx, y + 0.13, 0.13, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.arc(cx - 0.04, y + 0.09, 0.05, 0, TAU); ctx.fill();
        break;
      }
      case 'plant': {
        ctx.fillStyle = '#6b4a31'; ctx.fillRect(x + 0.26, y + 0.55, 0.48, 0.38);
        ctx.fillStyle = '#8a6242'; ctx.fillRect(x + 0.22, y + 0.52, 0.56, 0.08);
        const leaves = ['#1f5b43', '#2a7556', '#38906a'];
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU + R();
          ctx.fillStyle = leaves[i % 3];
          ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * 0.22, y + 0.34 + Math.sin(a) * 0.16, 0.2, 0.11, a, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#48a57a';
        ctx.beginPath(); ctx.arc(cx, y + 0.3, 0.12, 0, TAU); ctx.fill();
        break;
      }
      case 'crate': {
        ctx.fillStyle = '#8d6b43'; ctx.fillRect(x + 0.06, y + 0.06, 0.88, 0.62);
        ctx.fillStyle = '#6a4e2f'; ctx.fillRect(x + 0.06, y + 0.68, 0.88, 0.26);
        ctx.strokeStyle = '#5a4127'; ctx.lineWidth = 0.035;
        ctx.strokeRect(x + 0.08, y + 0.08, 0.84, 0.58);
        ctx.beginPath(); ctx.moveTo(x + 0.1, y + 0.1); ctx.lineTo(x + 0.9, y + 0.64); ctx.stroke();
        ctx.fillStyle = '#b08a5a'; ctx.fillRect(x + 0.06, y + 0.06, 0.88, 0.03);
        break;
      }
      case 'bookcase': {
        ctx.fillStyle = '#4f3322'; ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.66);
        ctx.fillStyle = '#3a2418'; ctx.fillRect(x + 0.04, y + 0.7, 0.92, 0.26);
        const cols = ['#7a2b35', '#2f5a6b', '#b08a3a', '#3f6b3a', '#6b4a8a', '#c9c1a8'];
        for (let r = 0; r < 2; r++) {
          let bx = x + 0.1;
          while (bx < x + 0.88) {
            const bw = 0.06 + R() * 0.06;
            ctx.fillStyle = cols[(R() * cols.length) | 0];
            ctx.fillRect(bx, y + 0.1 + r * 0.3, Math.min(bw, x + 0.9 - bx), 0.24);
            bx += bw + 0.01;
          }
        }
        ctx.fillStyle = '#6b4630'; ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.04);
        break;
      }
      case 'planter': {
        ctx.fillStyle = '#c9cede'; ctx.fillRect(x + 0.1, y + 0.2, 0.8, 0.56);
        ctx.fillStyle = '#8990b0'; ctx.fillRect(x + 0.1, y + 0.76, 0.8, 0.18);
        ctx.fillStyle = '#23513f';
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + 0.22 + i * 0.11, y + 0.3 + (i % 2) * 0.12, 0.14, 0, TAU); ctx.fill(); }
        ctx.fillStyle = '#3c8a64';
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x + 0.28 + i * 0.15, y + 0.22 + (i % 2) * 0.1, 0.08, 0, TAU); ctx.fill(); }
        break;
      }
    }
    ctx.restore();
  }

  drawLow(ctx, x, y, R) {
    const T = this.theme;
    const cx = x + 0.5;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + 0.1, y + 0.2, 0.86, 0.78);
    switch (T.low) {
      case 'case': {
        ctx.fillStyle = '#2b2026'; ctx.fillRect(x + 0.08, y + 0.62, 0.84, 0.3);
        ctx.fillStyle = '#4a3842'; ctx.fillRect(x + 0.08, y + 0.1, 0.84, 0.52);
        const kinds = ['vase', 'egg', 'watch', 'necklace', 'idol', 'scroll'];
        ctx.save(); ctx.translate(cx, y + 0.4); ctx.scale(0.5, 0.5);
        S.drawLootIcon(ctx, kinds[(R() * kinds.length) | 0]);
        ctx.restore();
        ctx.fillStyle = 'rgba(190,235,255,0.2)'; ctx.fillRect(x + 0.08, y + 0.1, 0.84, 0.52);
        ctx.strokeStyle = 'rgba(220,245,255,0.7)'; ctx.lineWidth = 0.025; ctx.strokeRect(x + 0.08, y + 0.1, 0.84, 0.52);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.03;
        ctx.beginPath(); ctx.moveTo(x + 0.2, y + 0.5); ctx.lineTo(x + 0.4, y + 0.18); ctx.moveTo(x + 0.3, y + 0.55); ctx.lineTo(x + 0.46, y + 0.3); ctx.stroke();
        break;
      }
      case 'desk': {
        ctx.fillStyle = '#5a3d27'; ctx.fillRect(x + 0.04, y + 0.66, 0.92, 0.26);
        ctx.fillStyle = '#7b5536'; ctx.fillRect(x + 0.04, y + 0.12, 0.92, 0.54);
        ctx.fillStyle = '#f1ece0'; ctx.save(); ctx.translate(x + 0.36, y + 0.38); ctx.rotate(R() - 0.5); ctx.fillRect(-0.12, -0.15, 0.24, 0.3); ctx.restore();
        ctx.fillStyle = '#2d6b55'; ctx.beginPath(); ctx.arc(x + 0.74, y + 0.3, 0.09, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e7c46a'; ctx.beginPath(); ctx.arc(x + 0.72, y + 0.52, 0.05, 0, TAU); ctx.fill();
        break;
      }
      case 'rail': {
        ctx.fillStyle = '#8a92a3';
        ctx.fillRect(x + 0.05, y + 0.3, 0.9, 0.08);
        ctx.fillRect(x + 0.05, y + 0.55, 0.9, 0.08);
        ctx.fillStyle = '#ffd24a';
        for (let i = 0; i < 4; i++) ctx.fillRect(x + 0.08 + i * 0.23, y + 0.3, 0.1, 0.08);
        ctx.fillStyle = '#5c6373';
        ctx.fillRect(x + 0.08, y + 0.25, 0.08, 0.66); ctx.fillRect(x + 0.84, y + 0.25, 0.08, 0.66);
        break;
      }
      case 'table': {
        ctx.fillStyle = '#3b2519'; ctx.fillRect(x + 0.1, y + 0.66, 0.8, 0.26);
        ctx.fillStyle = '#f0e6d0'; ctx.fillRect(x + 0.06, y + 0.12, 0.88, 0.54);
        ctx.fillStyle = 'rgba(150,120,80,0.35)'; ctx.fillRect(x + 0.06, y + 0.56, 0.88, 0.1);
        ctx.fillStyle = '#d8c89a'; ctx.fillRect(x + cx - x - 0.03, y + 0.24, 0.06, 0.16);
        ctx.fillStyle = '#ffcf6a'; ctx.beginPath(); ctx.ellipse(cx, y + 0.21, 0.03, 0.05, 0, 0, TAU); ctx.fill();
        break;
      }
      case 'glass': {
        ctx.fillStyle = 'rgba(150,190,255,0.16)'; ctx.fillRect(x + 0.06, y + 0.12, 0.88, 0.8);
        ctx.strokeStyle = 'rgba(190,215,255,0.65)'; ctx.lineWidth = 0.025; ctx.strokeRect(x + 0.06, y + 0.12, 0.88, 0.8);
        ctx.fillStyle = '#e7ebfa'; ctx.beginPath(); ctx.arc(cx, y + 0.5, 0.12, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e9546b'; ctx.beginPath(); ctx.arc(cx + 0.03, y + 0.47, 0.04, 0, TAU); ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  drawCreak(ctx, x, y, R) {
    ctx.save();
    ctx.fillStyle = '#6a4a31';
    ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.92);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i % 2 ? '#7d583a' : '#8a6443';
      ctx.fillRect(x + 0.06, y + 0.07 + i * 0.3, 0.88, 0.26);
    }
    ctx.strokeStyle = 'rgba(30,18,10,0.7)';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(x + 0.2, y + 0.2); ctx.lineTo(x + 0.35, y + 0.28); ctx.lineTo(x + 0.3, y + 0.42); ctx.lineTo(x + 0.46, y + 0.5);
    ctx.moveTo(x + 0.62, y + 0.62); ctx.lineTo(x + 0.75, y + 0.7); ctx.lineTo(x + 0.7, y + 0.84);
    ctx.stroke();
    ctx.fillStyle = 'rgba(20,12,8,0.8)';
    for (const [dx, dy] of [[0.12, 0.2], [0.88, 0.2], [0.12, 0.5], [0.88, 0.5], [0.12, 0.8], [0.88, 0.8]]) {
      ctx.beginPath(); ctx.arc(x + dx, y + dy, 0.02, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawFuseBox(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 0.14, y + 0.18, 0.8, 0.8);
    ctx.fillStyle = '#4b5263'; ctx.fillRect(x + 0.1, y + 0.1, 0.8, 0.8);
    ctx.fillStyle = '#6a7285'; ctx.fillRect(x + 0.1, y + 0.1, 0.8, 0.06);
    ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 0.04;
    ctx.strokeRect(x + 0.16, y + 0.2, 0.68, 0.64);
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.moveTo(x + 0.55, y + 0.26); ctx.lineTo(x + 0.36, y + 0.54); ctx.lineTo(x + 0.5, y + 0.54);
    ctx.lineTo(x + 0.44, y + 0.78); ctx.lineTo(x + 0.65, y + 0.46); ctx.lineTo(x + 0.51, y + 0.46); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  outsideDir(x, y) {
    const L = this.level;
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dx, dy] of dirs) if (kindAt(L, x + dx, y + dy) === VOID) return [dx, dy];
    return [0, 1];
  }

  drawEntry(ctx) {
    const L = this.level;
    const x = Math.floor(L.start.x), y = Math.floor(L.start.y);
    const [dx, dy] = this.outsideDir(x, y);
    ctx.save();
    ctx.translate(x + 0.5, y + 0.5);
    ctx.rotate(Math.atan2(dy, dx));
    // window sill on the outside edge + a dangling rope
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(-0.5, -0.5, 1, 1);
    ctx.fillStyle = '#8b6c4c';
    ctx.fillRect(0.38, -0.46, 0.14, 0.92);
    ctx.strokeStyle = '#d9c7a1'; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(0.9, -0.1); ctx.quadraticCurveTo(0.6, 0.05, 0.42, 0.0); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(241,232,214,0.35)';
    ctx.setLineDash([0.08, 0.08]);
    ctx.lineWidth = 0.04;
    ctx.beginPath(); ctx.arc(L.start.x, L.start.y, 0.36, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }

  drawEmitter(ctx, x, y, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = '#1d212b';
    S.roundRect(ctx, -0.1, -0.13, 0.18, 0.26, 0.04);
    ctx.fill();
    ctx.fillStyle = '#3a4050';
    ctx.fillRect(-0.1, -0.13, 0.18, 0.04);
    ctx.restore();
  }

  // ------------------------------------------------------------------ dynamic layer
  cone(ctx, vx, vy, facing, half, range, block, rgb, alpha = 1) {
    const L = this.level;
    const diffs = [];
    const n = Math.max(8, Math.ceil((2 * half) / (2.5 * DEG)));
    for (let i = 0; i <= n; i++) diffs.push(-half + (2 * half * i) / n);
    for (const [cx, cy] of this.corners) {
      const dx = cx - vx, dy = cy - vy;
      const d = dx * dx + dy * dy;
      if (d > (range + 0.5) ** 2 || d < 1e-4) continue;
      const df = angDiff(facing, Math.atan2(dy, dx));
      if (Math.abs(df) < half) diffs.push(df - 0.002, df + 0.002);
    }
    diffs.sort((a, b) => a - b);
    ctx.beginPath();
    ctx.moveTo(vx, vy);
    for (const df of diffs) {
      if (df < -half || df > half) continue;
      const a = facing + df;
      const ca = Math.cos(a), sa = Math.sin(a);
      const d = rayDist(vx, vy, ca, sa, range, W, H, block);
      ctx.lineTo(vx + ca * d, vy + sa * d);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(vx, vy, 0.1, vx, vy, range);
    g.addColorStop(0, `rgba(${rgb},${0.5 * alpha})`);
    g.addColorStop(0.65, `rgba(${rgb},${0.26 * alpha})`);
    g.addColorStop(1, `rgba(${rgb},${0.13 * alpha})`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = `rgba(${rgb},${0.45 * alpha})`;
    ctx.lineWidth = 0.03;
    ctx.stroke();
  }

  drawDoor(ctx, d, openAmt, time) {
    const T = this.theme;
    const x = d.x, y = d.y;
    const col = S.PAL.keyColors[d.color];
    const vertical = isTall(kindAt(this.level, x, y - 1)) || isTall(kindAt(this.level, x, y + 1));
    ctx.save();
    // frame
    ctx.fillStyle = shade(T.wallSide, -0.3);
    ctx.fillRect(x, y, 1, 1);
    const o = clamp(openAmt, 0, 1);
    ctx.fillStyle = col;
    if (vertical) {
      const h = 0.5 * (1 - o);
      ctx.fillRect(x + 0.22, y, 0.56, h);
      ctx.fillRect(x + 0.22, y + 1 - h, 0.56, h);
    } else {
      const w = 0.5 * (1 - o);
      ctx.fillRect(x, y + 0.22, w, 0.56);
      ctx.fillRect(x + 1 - w, y + 0.22, w, 0.56);
    }
    if (o < 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      if (vertical) ctx.fillRect(x + 0.22, y, 0.06, 1 - o); else ctx.fillRect(x, y + 0.22, 1 - o, 0.06);
    }
    // status light
    ctx.fillStyle = o > 0 ? S.PAL.mint : (Math.sin(time * 4) > 0 ? '#ff5b6a' : '#a3303b');
    ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 0.08, 0, TAU); ctx.fill();
    if (o === 0) {
      ctx.save(); ctx.translate(x + 0.5, y + 0.5); ctx.scale(0.55, 0.55);
      S.drawKey(ctx, d.color, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  drawExit(ctx, open, time) {
    const L = this.level;
    const x = Math.floor(L.exit.x), y = Math.floor(L.exit.y);
    const [dx, dy] = this.outsideDir(x, y);
    ctx.save();
    ctx.translate(x + 0.5, y + 0.5);
    ctx.rotate(Math.atan2(dy, dx));
    if (open) {
      const pulse = 0.5 + Math.sin(time * 4) * 0.2;
      const g = ctx.createRadialGradient(0.2, 0, 0, 0.2, 0, 1.1);
      g.addColorStop(0, `rgba(111,227,193,${0.45 * pulse + 0.2})`);
      g.addColorStop(1, 'rgba(111,227,193,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-0.9, -1, 2.2, 2);
    }
    ctx.fillStyle = open ? 'rgba(111,227,193,0.25)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(-0.44, -0.44, 0.88, 0.88);
    ctx.strokeStyle = open ? S.PAL.mint : 'rgba(241,232,214,0.35)';
    ctx.lineWidth = 0.045;
    ctx.setLineDash(open ? [] : [0.1, 0.08]);
    ctx.strokeRect(-0.44, -0.44, 0.88, 0.88);
    ctx.setLineDash([]);
    // chevrons pointing out
    ctx.lineWidth = 0.07;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < 2; i++) {
      const ph = open ? ((time * 1.4 + i * 0.5) % 1) : 0.25 + i * 0.35;
      const px = -0.2 + ph * 0.45;
      ctx.strokeStyle = open ? `rgba(111,227,193,${Math.sin(ph * Math.PI)})` : 'rgba(241,232,214,0.3)';
      ctx.beginPath(); ctx.moveTo(px - 0.1, -0.16); ctx.lineTo(px + 0.06, 0); ctx.lineTo(px - 0.1, 0.16); ctx.stroke();
    }
    ctx.restore();
    if (!open) {
      // tiny padlock
      ctx.save();
      ctx.translate(L.exit.x, L.exit.y - 0.02);
      ctx.fillStyle = 'rgba(241,232,214,0.55)';
      S.roundRect(ctx, -0.1, -0.02, 0.2, 0.15, 0.03); ctx.fill();
      ctx.strokeStyle = 'rgba(241,232,214,0.55)'; ctx.lineWidth = 0.035;
      ctx.beginPath(); ctx.arc(0, -0.02, 0.065, Math.PI, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  drawLaser(ctx, l, on, time, warn) {
    if (on) {
      const flick = 0.85 + Math.sin(time * 40 + l.ax * 7) * 0.08;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(255,40,70,${0.22 * flick})`;
      ctx.lineWidth = 0.28;
      ctx.beginPath(); ctx.moveTo(l.ax, l.ay); ctx.lineTo(l.bx, l.by); ctx.stroke();
      ctx.strokeStyle = `rgba(255,70,90,${0.55 * flick})`;
      ctx.lineWidth = 0.1;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,220,225,${0.95 * flick})`;
      ctx.lineWidth = 0.035;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.strokeStyle = warn ? 'rgba(255,90,110,0.55)' : 'rgba(255,90,110,0.22)';
      ctx.lineWidth = 0.03;
      ctx.setLineDash([0.06, 0.1]);
      ctx.beginPath(); ctx.moveTo(l.ax, l.ay); ctx.lineTo(l.bx, l.by); ctx.stroke();
      ctx.restore();
    }
    for (const [x, y] of [[l.ax, l.ay], [l.bx, l.by]]) {
      ctx.fillStyle = on ? '#ff4b5c' : '#5a2a33';
      ctx.beginPath(); ctx.arc(x, y, 0.06, 0, TAU); ctx.fill();
    }
  }

  // Smoothed polyline through plan vertices [i0, i1].
  tracePlan(ctx, plan, i0, i1) {
    const xs = plan.xs, ys = plan.ys;
    ctx.moveTo(xs[i0], ys[i0]);
    if (i1 - i0 < 2) { ctx.lineTo(xs[i1], ys[i1]); return; }
    for (let i = i0 + 1; i < i1; i++) {
      ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
    }
    ctx.lineTo(xs[i1], ys[i1]);
  }

  drawPlan(ctx, plan, o) {
    const n = plan.n;
    if (n < 2 && plan.waits[0] < 0.05) return;
    const cut = o.caughtT != null ? Math.min(n - 1, plan.seek(o.caughtT) + 1) : n - 1;
    const doneTo = o.progressT != null ? plan.seek(o.progressT) : -1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const stroke = (i0, i1, color, width, alpha) => {
      if (i1 <= i0) return;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      this.tracePlan(ctx, plan, i0, i1);
      ctx.strokeStyle = 'rgba(6,8,18,0.55)';
      ctx.lineWidth = width + 0.07;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const chalk = '#f4eee2';
    const a = o.alpha ?? 1;
    if (doneTo > 0) {
      stroke(0, Math.min(doneTo + 1, cut), chalk, 0.07, 0.28 * a);
      stroke(Math.min(doneTo, cut), cut, chalk, 0.11, 0.95 * a);
    } else {
      stroke(0, cut, chalk, 0.11, 0.95 * a);
    }
    if (cut < n - 1) stroke(cut, n - 1, '#ff4b5c', 0.1, 0.9 * a);
    ctx.globalAlpha = a;

    // second ticks
    const end = plan.end;
    for (let s = 1; s < end; s += 1) {
      const p = plan.posAt(s);
      const red = o.caughtT != null && s > o.caughtT;
      const big = s % 5 === 0;
      ctx.fillStyle = red ? '#ffb3ba' : '#0d1020';
      ctx.beginPath(); ctx.arc(p.x, p.y, big ? 0.075 : 0.045, 0, TAU); ctx.fill();
      if (big) { ctx.strokeStyle = red ? '#ff4b5c' : chalk; ctx.lineWidth = 0.03; ctx.stroke(); }
    }
    // waits: clock rings
    for (let i = 0; i < n; i++) {
      const w = plan.waits[i];
      if (w < 0.08) continue;
      const x = plan.xs[i], y = plan.ys[i];
      ctx.fillStyle = 'rgba(12,14,28,0.85)';
      ctx.beginPath(); ctx.arc(x, y, 0.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#f4c24f';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.arc(x, y, 0.2, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, w / 5));
      ctx.stroke();
      if (w > 5) { ctx.beginPath(); ctx.arc(x, y, 0.26, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, (w - 5) / 5)); ctx.stroke(); }
    }
    // lock pins
    if (o.locks) {
      for (const lk of o.locks) {
        if (lk.i >= n) continue;
        const x = plan.xs[lk.i], y = plan.ys[lk.i];
        ctx.fillStyle = lk.type === 'noise' ? '#ffb86b' : lk.type === 'power' ? '#ffd24a' : '#f4c24f';
        ctx.beginPath(); ctx.arc(x, y, 0.07, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#0d1020'; ctx.lineWidth = 0.025; ctx.stroke();
      }
    }
    // caught marker
    if (o.caughtT != null && o.showCaughtMark) {
      const p = plan.posAt(o.caughtT);
      ctx.fillStyle = '#ff4b5c';
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(p.x - 0.025, p.y - 0.12, 0.05, 0.14);
      ctx.fillRect(p.x - 0.025, p.y + 0.05, 0.05, 0.05);
    }
    ctx.restore();
  }

  // Tutorial: a ghost thumb tracing a suggested route. Points may carry a hold
  // time ([x, y, seconds]) to demonstrate waiting.
  drawDemo(ctx, pts, t) {
    const P = pts.map(([x, y, h]) => [x + 0.5, y + 0.5, h || 0]);
    const SPD = 3.2, PRESS = 0.5;
    // timeline of segments
    let total = PRESS;
    const segs = [];
    for (let i = 1; i < P.length; i++) {
      const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      segs.push({ i, t0: total, t1: total + d / SPD, hold: P[i][2] });
      total += d / SPD + P[i][2];
    }
    const cycle = total + 1.6;
    const u = t % cycle;
    const fade = u > cycle - 0.7 ? (cycle - u) / 0.7 : 1;
    let hx = P[0][0], hy = P[0][1], holding = 0, holdLen = 0, last = 0;
    for (const sg of segs) {
      if (u < sg.t0) break;
      last = sg.i;
      const a = P[sg.i - 1], b = P[sg.i];
      if (u < sg.t1) {
        const f = (u - sg.t0) / (sg.t1 - sg.t0);
        hx = a[0] + (b[0] - a[0]) * f; hy = a[1] + (b[1] - a[1]) * f;
        last = sg.i - 1;
        break;
      }
      hx = b[0]; hy = b[1];
      if (u < sg.t1 + sg.hold) { holding = u - sg.t1; holdLen = sg.hold; }
    }
    ctx.save();
    ctx.globalAlpha = 0.55 * fade;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([0.12, 0.12]);
    ctx.strokeStyle = '#f4eee2';
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i <= last; i++) ctx.lineTo(P[i][0], P[i][1]);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.85 * fade;
    ctx.fillStyle = 'rgba(244,238,226,0.28)';
    ctx.beginPath(); ctx.arc(hx, hy, u > PRESS * 0.6 ? 0.42 : 0.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f4eee2';
    ctx.lineWidth = 0.05;
    ctx.stroke();
    if (u < PRESS) {
      ctx.globalAlpha = (1 - u / PRESS) * 0.8;
      ctx.beginPath(); ctx.arc(hx, hy, 0.5 + (u / PRESS) * 0.6, 0, TAU); ctx.stroke();
    }
    if (holdLen > 0) {
      ctx.globalAlpha = fade;
      ctx.strokeStyle = '#f4c24f';
      ctx.lineWidth = 0.07;
      ctx.beginPath(); ctx.arc(hx, hy, 0.62, -Math.PI / 2, -Math.PI / 2 + TAU * (holding / holdLen)); ctx.stroke();
    }
    ctx.restore();
  }

  // Previous failed attempt, drawn faintly so the player can iterate.
  drawGhostPlan(ctx, plan, caughtT) {
    if (!plan || plan.n < 2) return;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([0.12, 0.1]);
    ctx.strokeStyle = '#f4eee2';
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    this.tracePlan(ctx, plan, 0, plan.n - 1);
    ctx.stroke();
    ctx.setLineDash([]);
    if (caughtT != null) {
      const p = plan.posAt(caughtT);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#ff4b5c';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(p.x - 0.14, p.y - 0.14); ctx.lineTo(p.x + 0.14, p.y + 0.14);
      ctx.moveTo(p.x + 0.14, p.y - 0.14); ctx.lineTo(p.x - 0.14, p.y + 0.14);
      ctx.stroke();
    }
    ctx.restore();
  }

  bubble(ctx, x, y, kind, time) {
    // "?" / "!" speech bubble above a head, in world units
    const pop = 1;
    ctx.save();
    ctx.translate(x, y - 1.18);
    ctx.scale(pop, pop);
    ctx.fillStyle = kind === '!' ? '#ff4b5c' : '#ffd24a';
    S.roundRect(ctx, -0.17, -0.2, 0.34, 0.36, 0.1);
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(-0.05, 0.15); ctx.lineTo(0.0, 0.25); ctx.lineTo(0.06, 0.15); ctx.fill();
    ctx.fillStyle = '#10121e';
    if (kind === '!') {
      ctx.fillRect(-0.035, -0.14, 0.07, 0.17);
      ctx.fillRect(-0.035, 0.06, 0.07, 0.06);
    } else {
      ctx.lineWidth = 0.06;
      ctx.strokeStyle = '#10121e';
      ctx.beginPath();
      ctx.arc(0, -0.06, 0.07, Math.PI * 1.1, Math.PI * 2.4);
      ctx.lineTo(0, 0.04);
      ctx.stroke();
      ctx.fillRect(-0.03, 0.07, 0.06, 0.055);
    }
    ctx.restore();
  }

  // scene: see game.js for the fields
  draw(scene) {
    const ctx = this.ctx, L = this.level;
    if (!L) return;
    const time = scene.time;
    const fx = scene.fx;
    const shake = fx && fx.shakeAmt > 0 ? [(Math.random() - 0.5) * fx.shakeAmt * this.ts, (Math.random() - 0.5) * fx.shakeAmt * this.ts] : [0, 0];

    this.screenTransform(ctx);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (shake[0] || shake[1]) {
      ctx.fillStyle = this.theme.bg;
      ctx.fillRect(0, 0, this.cw, this.ch);
    }
    ctx.drawImage(this.stat, shake[0], shake[1], this.cw, this.ch);
    this.worldTransform(ctx, shake);

    const fr = scene.frame; // {a,b,f}
    const A = fr.a, B = fr.b, f = fr.f;
    const t = scene.worldT;
    const powerOff = A.pw === 1;
    const openMask = A.o;
    const block = L.blockers(openMask).sight;

    // doors
    for (const d of L.doors) {
      let amt = 0;
      if (openMask & (1 << d.color)) {
        const ev = scene.doorTimes ? scene.doorTimes[d.color] : null;
        amt = ev != null ? clamp((t - ev) / 0.35, 0, 1) : 1;
      }
      this.drawDoor(ctx, d, amt, time);
    }

    // exit
    const lootDone = (scene.planMask ?? A.m) & L.lootMask;
    this.drawExit(ctx, lootDone === L.lootMask, time);

    // power box glow when in use
    if (L.power) {
      const p = L.power;
      const onUntil = scene.powerUntil;
      if (powerOff && onUntil != null) {
        const left = onUntil - t;
        ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, 0.55, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(left / p.duration, 0, 1));
        ctx.stroke();
      }
    }

    // lights
    const alertIdx = scene.caught ? scene.caught : null;
    if (!powerOff) {
      L.cameras.forEach((c, i) => {
        const a = camAngle(c, t);
        const red = alertIdx && alertIdx.by === 'camera' && alertIdx.idx === i;
        this.cone(ctx, c.x, c.y, a, c.half, c.range, block, red ? '255,70,85' : S.PAL.coolLight, scene.coneAlpha ?? 1);
      });
    }
    const gv = [];
    for (let i = 0; i < L.guards.length; i++) {
      const x = lerpN(A.g[i * 4], B.g[i * 4], f), y = lerpN(A.g[i * 4 + 1], B.g[i * 4 + 1], f);
      const face = A.g[i * 4 + 2] + angDiff(A.g[i * 4 + 2], B.g[i * 4 + 2]) * f;
      const mode = A.g[i * 4 + 3];
      const moving = Math.hypot(B.g[i * 4] - A.g[i * 4], B.g[i * 4 + 1] - A.g[i * 4 + 1]) > 1e-5;
      gv.push({ x, y, face, mode, moving, i });
      const red = alertIdx && alertIdx.by === 'guard' && alertIdx.idx === i;
      const g = L.guards[i];
      this.cone(ctx, x, y, face, g.half, g.range, block, red ? '255,70,85' : S.PAL.amberLight, scene.coneAlpha ?? 1);
    }

    // lasers
    L.lasers.forEach((l, i) => {
      const on = !powerOff && laserOn(l, t);
      const soon = !on && !powerOff && laserOn(l, t + 0.5);
      this.drawLaser(ctx, l, on, time, soon);
    });

    // items
    const mask = scene.itemMask ?? A.m;
    for (const it of L.items) {
      if (mask & it.bit) continue;
      ctx.save();
      ctx.translate(it.x, it.y + 0.18);
      if (it.type === 'loot') S.drawLoot(ctx, L.loot.kind, time, it.idx);
      else if (it.type === 'coin') S.drawCoin(ctx, time, it.idx * 1.7);
      else S.drawKey(ctx, it.color, time, it.idx);
      ctx.restore();
    }

    // previous attempt
    if (scene.ghostPlan) this.drawGhostPlan(ctx, scene.ghostPlan, scene.ghostCaughtT);
    if (scene.demo) this.drawDemo(ctx, scene.demo.pts, scene.demo.t);
    // plan line
    if (scene.plan) this.drawPlan(ctx, scene.plan, scene.planStyle || {});

    // noise rings from events
    if (scene.events) {
      for (const e of scene.events) {
        if (e.type !== 'noise') continue;
        const age = t - e.t;
        if (age < 0 || age > 1.4) continue;
        const reach = this.hearReach;
        for (let k = 0; k < 3; k++) {
          const u = (age - k * 0.18) / 0.9;
          if (u < 0 || u > 1) continue;
          ctx.strokeStyle = `rgba(255,190,110,${(1 - u) * 0.8})`;
          ctx.lineWidth = 0.06;
          ctx.beginPath(); ctx.arc(e.x, e.y, 0.3 + u * (reach - 0.3), 0, TAU); ctx.stroke();
        }
      }
    }

    // characters, sorted by y
    const actors = [];
    for (const g of gv) actors.push({ y: g.y, draw: () => {
      ctx.save(); ctx.translate(g.x, g.y + 0.22);
      S.drawGuard(ctx, { facing: g.face, moving: g.moving && g.mode !== REACT, walk: time * 1.3 + g.i, time, seed: g.i, alert: g.mode !== PATROL });
      ctx.restore();
    } });
    if (scene.thief && scene.thief.visible !== false) {
      const th = scene.thief;
      actors.push({ y: th.y, draw: () => {
        ctx.save(); ctx.translate(th.x, th.y + 0.2);
        const sc = th.scale ?? 1;
        ctx.scale(sc, sc);
        S.drawThief(ctx, th);
        ctx.restore();
      } });
    }
    if (scene.ghost) {
      const gh = scene.ghost;
      actors.push({ y: gh.y, draw: () => {
        ctx.save(); ctx.translate(gh.x, gh.y + 0.2);
        S.drawThief(ctx, { ...gh, alpha: gh.alpha ?? 0.6 });
        ctx.restore();
      } });
    }
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) a.draw();

    // camera bodies on top
    L.cameras.forEach((c, i) => {
      const red = alertIdx && alertIdx.by === 'camera' && alertIdx.idx === i;
      S.drawCamera(ctx, c.x, c.y, camAngle(c, t), { off: powerOff, time, alert: red });
    });

    // guard bubbles
    for (const g of gv) {
      const red = alertIdx && alertIdx.by === 'guard' && alertIdx.idx === g.i;
      if (red) this.bubble(ctx, g.x, g.y, '!', time);
      else if (g.mode === REACT || g.mode === INVESTIGATE || g.mode === SEARCH) this.bubble(ctx, g.x, g.y, '?', time);
    }
    if (alertIdx && alertIdx.by !== 'guard' && scene.thief) this.bubble(ctx, scene.thief.x, scene.thief.y, '!', time);

    // head marker while drawing
    if (scene.head) {
      const h = scene.head;
      const pulse = 0.5 + Math.sin(time * 6) * 0.5;
      ctx.strokeStyle = h.danger ? `rgba(255,75,92,${0.6 + pulse * 0.4})` : `rgba(244,238,226,${0.4 + pulse * 0.4})`;
      ctx.lineWidth = 0.05;
      ctx.beginPath(); ctx.arc(h.x, h.y, 0.34 + pulse * 0.05, 0, TAU); ctx.stroke();
    }

    if (fx) fx.draw(ctx);

    // ---------------------------------------------------------- overlays
    this.screenTransform(ctx);
    const [bx, by] = [this.ox, this.oy];
    const bw = W * this.ts, bh = H * this.ts;
    if (powerOff) {
      ctx.fillStyle = 'rgba(2,3,12,0.38)';
      ctx.fillRect(0, 0, this.cw, this.ch);
    }
    if (scene.planning) {
      ctx.fillStyle = 'rgba(70,110,255,0.045)';
      ctx.fillRect(bx, by, bw, bh);
    }
    if (scene.alarm > 0) {
      const a = scene.alarm * (0.55 + Math.sin(time * 9) * 0.25);
      const g = ctx.createRadialGradient(this.cw / 2, this.ch / 2, Math.min(this.cw, this.ch) * 0.25, this.cw / 2, this.ch / 2, Math.max(this.cw, this.ch) * 0.75);
      g.addColorStop(0, 'rgba(255,40,60,0)');
      g.addColorStop(1, `rgba(255,40,60,${a * 0.55})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.cw, this.ch);
    }
    if (fx && fx.flashA > 0) {
      ctx.fillStyle = `rgba(${fx.flashColor},${fx.flashA})`;
      ctx.fillRect(0, 0, this.cw, this.ch);
    }
    if (fx) fx.drawLabels(ctx, (x, y) => this.toScreen(x, y), FONT_DISPLAY);
    if (scene.readout) this.drawReadout(ctx, scene.readout, time);
  }

  // Floating time readout above the thumb while planning.
  drawReadout(ctx, r, time) {
    const [hx, hy] = this.toScreen(r.x, r.y);
    let px = r.fingerX ?? hx, py = (r.fingerY ?? hy) - 78;
    ctx.font = `700 17px ${FONT_UI}`;
    const main = r.text;
    const sub = r.sub || '';
    ctx.font = `800 20px ${FONT_DISPLAY}`;
    const w1 = ctx.measureText(main).width;
    ctx.font = `600 13px ${FONT_UI}`;
    const w2 = sub ? ctx.measureText(sub).width : 0;
    const w = Math.max(w1, w2) + 26;
    const h = sub ? 48 : 32;
    px = clamp(px, w / 2 + 8, this.cw - w / 2 - 8);
    if (py - h / 2 < 8) py = (r.fingerY ?? hy) + 70;
    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = r.danger ? 'rgba(120,14,28,0.92)' : r.good ? 'rgba(10,60,50,0.92)' : 'rgba(12,14,28,0.9)';
    S.roundRect(ctx, -w / 2, -h / 2, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = r.danger ? '#ff4b5c' : r.good ? S.PAL.mint : 'rgba(244,238,226,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 20px ${FONT_DISPLAY}`;
    ctx.fillStyle = r.danger ? '#ffd6da' : '#f4eee2';
    ctx.fillText(main, 0, sub ? -8 : 1);
    if (sub) {
      ctx.font = `600 13px ${FONT_UI}`;
      ctx.fillStyle = r.danger ? '#ffb3ba' : r.good ? S.PAL.mint : 'rgba(244,238,226,0.7)';
      ctx.fillText(sub, 0, 12);
    }
    ctx.restore();
  }
}

function lerpN(a, b, f) { return a + (b - a) * f; }

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return `rgb(${r},${g},${b})`;
}

// Compact blueprint thumbnail for level select.
export function drawThumb(canvas, level, locked) {
  const ctx = canvas.getContext('2d');
  const T = THEMES[level.theme] || THEMES.gallery;
  const cw = canvas.width, ch = canvas.height;
  const ts = Math.min(cw / W, ch / H);
  const ox = (cw - ts * W) / 2, oy = (ch - ts * H) / 2;
  ctx.clearRect(0, 0, cw, ch);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = level.kind[y * W + x];
    if (k === VOID) continue;
    ctx.fillStyle = k === WALL ? (locked ? 'rgba(244,238,226,0.25)' : T.wallTop)
      : k === PROP ? 'rgba(244,238,226,0.35)'
      : k === GLASS ? 'rgba(180,220,255,0.3)'
      : k === DOOR ? S.PAL.keyColors[level.doorColor[y * W + x]]
      : (locked ? 'rgba(255,255,255,0.06)' : T.floor[0]);
    ctx.fillRect(ox + x * ts, oy + y * ts, Math.ceil(ts), Math.ceil(ts));
  }
  if (locked) return;
  for (const it of level.items) {
    ctx.fillStyle = it.type === 'loot' ? S.PAL.gold : it.type === 'coin' ? '#c99a2e' : S.PAL.keyColors[it.color];
    ctx.beginPath(); ctx.arc(ox + it.x * ts, oy + it.y * ts, ts * (it.type === 'loot' ? 0.38 : 0.22), 0, TAU); ctx.fill();
  }
  ctx.fillStyle = S.PAL.mint;
  ctx.fillRect(ox + (level.exit.x - 0.35) * ts, oy + (level.exit.y - 0.35) * ts, ts * 0.7, ts * 0.7);
  ctx.fillStyle = S.PAL.scarf;
  ctx.beginPath(); ctx.arc(ox + level.start.x * ts, oy + level.start.y * ts, ts * 0.3, 0, TAU); ctx.fill();
  for (const g of level.guards) {
    ctx.fillStyle = 'rgba(255,214,150,0.9)';
    ctx.beginPath(); ctx.arc(ox + g.wp[0].x * ts, oy + g.wp[0].y * ts, ts * 0.3, 0, TAU); ctx.fill();
  }
  for (const c of level.cameras) {
    ctx.fillStyle = 'rgba(170,215,255,0.9)';
    ctx.beginPath(); ctx.arc(ox + c.x * ts, oy + c.y * ts, ts * 0.25, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,75,92,0.9)';
  ctx.lineWidth = Math.max(1, ts * 0.12);
  for (const l of level.lasers) {
    ctx.beginPath(); ctx.moveTo(ox + l.ax * ts, oy + l.ay * ts); ctx.lineTo(ox + l.bx * ts, oy + l.by * ts); ctx.stroke();
  }
}
