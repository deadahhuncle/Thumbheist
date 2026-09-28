// Menu backdrop (a night skyline swept by searchlights) and the thumbprint emblem.

import { rng, TAU } from './geom.js';

export class MenuBackdrop {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.active = true;
    this.w = 1; this.h = 1;
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width = Math.round(w * this.dpr);
    this.cv.height = Math.round(h * this.dpr);
    const R = rng(7);
    this.stars = Array.from({ length: Math.round((w * h) / 5200) }, () => ({
      x: R() * w, y: R() * h * 0.62, r: 0.4 + R() * 1.1, p: R() * TAU, s: 0.6 + R() * 2,
    }));
    this.back = this.layer((ctx) => this.sky(ctx, R));
    this.front = this.layer((ctx) => this.city(ctx, R));
    this.windows = [];
    const R2 = rng(11);
    for (let i = 0; i < 26; i++) this.windows.push({ x: R2() * w, y: h * (0.66 + R2() * 0.26), p: R2() * 20, d: 3 + R2() * 9 });
  }

  layer(fn) {
    const c = document.createElement('canvas');
    c.width = this.cv.width; c.height = this.cv.height;
    const ctx = c.getContext('2d');
    ctx.scale(this.dpr, this.dpr);
    fn(ctx);
    return c;
  }

  sky(ctx) {
    const { w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#060813');
    g.addColorStop(0.55, '#10142c');
    g.addColorStop(0.8, '#1b2044');
    g.addColorStop(1, '#0b0d1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // moon
    const mx = w * 0.8, my = h * 0.13, mr = Math.min(w, h) * 0.07;
    const halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 5);
    halo.addColorStop(0, 'rgba(255,240,210,0.18)');
    halo.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h * 0.6);
    ctx.fillStyle = '#f3ead6';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(180,170,150,0.35)';
    ctx.beginPath(); ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.22, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + mr * 0.25, my + mr * 0.3, mr * 0.15, 0, TAU); ctx.fill();
    // far skyline
    const R = rng(3);
    this.skyline(ctx, R, h * 0.7, h * 0.2, '#161b3a', 'rgba(140,150,220,0.16)', 0.18);
  }

  city(ctx) {
    const { w, h } = this;
    const R = rng(5);
    this.skyline(ctx, R, h * 0.76, h * 0.26, '#0e1228', 'rgba(255,207,106,0.55)', 0.14);
    this.skyline(ctx, R, h * 0.86, h * 0.2, '#080a17', 'rgba(255,207,106,0.75)', 0.08, true);
    const fog = ctx.createLinearGradient(0, h * 0.7, 0, h);
    fog.addColorStop(0, 'rgba(11,13,26,0)');
    fog.addColorStop(1, 'rgba(11,13,26,0.95)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
  }

  skyline(ctx, R, base, var_, color, win, lit, tanks) {
    const { w, h } = this;
    let x = -10;
    while (x < w + 10) {
      const bw = 26 + R() * 64;
      const bh = var_ * (0.35 + R() * 0.9);
      const top = base - bh;
      ctx.fillStyle = color;
      ctx.fillRect(x, top, bw, h - top);
      if (R() < 0.3) ctx.fillRect(x + bw * 0.4, top - 14 - R() * 20, 2, 30);
      if (tanks && R() < 0.35) {
        ctx.fillRect(x + bw * 0.2, top - 12, 14, 12);
        ctx.fillRect(x + bw * 0.2 + 2, top - 16, 10, 4);
      }
      ctx.fillStyle = win;
      for (let wy = top + 8; wy < h; wy += 11) {
        for (let wx = x + 6; wx < x + bw - 6; wx += 9) {
          if (R() < lit) ctx.fillRect(wx, wy, 4, 6);
        }
      }
      x += bw + R() * 4;
    }
  }

  frame(dt) {
    if (!this.active) return;
    this.t += dt;
    const ctx = this.ctx, { w, h, t } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.back, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const s of this.stars) {
      const a = 0.35 + Math.sin(t * s.s + s.p) * 0.3;
      ctx.fillStyle = `rgba(255,248,230,${a})`;
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    // searchlights
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beam = (bx, ang, len, wid) => {
      const ex = bx + Math.cos(ang) * len, ey = h * 0.82 + Math.sin(ang) * len;
      const g = ctx.createLinearGradient(bx, h * 0.82, ex, ey);
      g.addColorStop(0, 'rgba(200,220,255,0.16)');
      g.addColorStop(1, 'rgba(200,220,255,0)');
      ctx.fillStyle = g;
      const px = Math.cos(ang + Math.PI / 2), py = Math.sin(ang + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(bx - px * 3, h * 0.82 - py * 3);
      ctx.lineTo(ex - px * wid, ey - py * wid);
      ctx.lineTo(ex + px * wid, ey + py * wid);
      ctx.lineTo(bx + px * 3, h * 0.82 + py * 3);
      ctx.closePath();
      ctx.fill();
    };
    beam(w * 0.22, -Math.PI / 2 + Math.sin(t * 0.35) * 0.55, h * 0.9, w * 0.09);
    beam(w * 0.74, -Math.PI / 2 + Math.sin(t * 0.27 + 2) * 0.6, h * 0.95, w * 0.08);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.front, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // a few windows switching on and off
    for (const wn of this.windows) {
      const on = Math.sin(t / wn.d + wn.p) > 0.2;
      ctx.fillStyle = on ? 'rgba(255,214,120,0.8)' : 'rgba(8,10,23,1)';
      ctx.fillRect(wn.x, wn.y, 4, 6);
    }
  }
}

// A stylised thumbprint whorl, drawn once as the logo emblem.
export function drawFingerprint(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = 220;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cx = size / 2, cy = size / 2 + 6;
  const R = rng(42);
  ctx.lineCap = 'round';
  for (let k = 0; k < 15; k++) {
    const r = 7 + k * 6.4;
    const a = 0.5 - k * 0.022;
    ctx.strokeStyle = `rgba(244,194,79,${Math.max(0.08, a)})`;
    ctx.lineWidth = 2.4;
    const gapAt = R() * TAU, gapLen = 0.25 + R() * 0.5;
    const gap2 = R() * TAU;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= 160; i++) {
      const th = (i / 160) * TAU;
      const inGap = angIn(th, gapAt, gapLen) || (k > 6 && angIn(th, gap2, 0.18));
      const wob = 1 + 0.05 * Math.sin(th * 3 + k * 0.7) + 0.03 * Math.sin(th * 5 - k);
      const x = cx + Math.cos(th) * r * 0.82 * wob;
      const y = cy + Math.sin(th) * r * 1.05 * wob - (1 - Math.cos(th)) * k * 0.3;
      if (inGap) { pen = false; continue; }
      if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  function angIn(th, a, len) {
    let d = (th - a) % TAU;
    if (d < 0) d += TAU;
    return d < len;
  }
}
