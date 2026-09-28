// Lightweight particles, rings, floating labels, screen shake and flashes.
// Positions are in tile units; times in seconds of real time.

import { TAU } from './geom.js';

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class FX {
  constructor() {
    this.parts = [];
    this.rings = [];
    this.labels = [];
    this.shakeAmt = 0;
    this.flashA = 0;
    this.flashColor = '255,255,255';
    this.time = 0;
  }

  clear() {
    this.parts.length = 0;
    this.rings.length = 0;
    this.labels.length = 0;
    this.shakeAmt = 0;
    this.flashA = 0;
  }

  burst(x, y, opts = {}) {
    const n = opts.n ?? 14;
    for (let i = 0; i < n; i++) {
      const a = (opts.angle ?? 0) + (opts.spread ?? TAU) * (Math.random() - 0.5);
      const sp = (opts.speed ?? 2.2) * (0.35 + Math.random() * 0.8);
      this.parts.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (opts.lift ?? 0.8),
        g: opts.gravity ?? 3,
        life: 0,
        max: (opts.life ?? 0.7) * (0.6 + Math.random() * 0.6),
        size: (opts.size ?? 0.07) * (0.6 + Math.random() * 0.8),
        color: opts.colors ? opts.colors[(Math.random() * opts.colors.length) | 0] : opts.color ?? '#ffd76a',
        kind: opts.kind ?? 'spark',
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  ring(x, y, opts = {}) {
    this.rings.push({ x, y, t: 0, dur: opts.dur ?? 0.8, r0: opts.r0 ?? 0.2, r1: opts.r1 ?? 1.5, color: opts.color ?? '255,255,255', width: opts.width ?? 0.06 });
  }

  label(x, y, text, opts = {}) {
    this.labels.push({ x, y, text, t: 0, dur: opts.dur ?? 1.1, color: opts.color ?? '#fff', size: opts.size ?? 15 });
  }

  shake(a) { if (!REDUCED) this.shakeAmt = Math.max(this.shakeAmt, a); }

  flash(color, a) { this.flashColor = color; this.flashA = Math.max(this.flashA, REDUCED ? a * 0.4 : a); }

  update(dt) {
    this.time += dt;
    for (const p of this.parts) {
      p.life += dt;
      p.vy += p.g * dt;
      p.vx *= 1 - 1.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    this.parts = this.parts.filter((p) => p.life < p.max);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.dur);
    for (const l of this.labels) l.t += dt;
    this.labels = this.labels.filter((l) => l.t < l.dur);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * this.shakeAmt * 6 - dt * 0.5);
    this.flashA = Math.max(0, this.flashA - dt * 2.2);
  }

  // World-space drawing (ctx already in tile units).
  draw(ctx) {
    for (const r of this.rings) {
      const u = r.t / r.dur;
      const rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - u) * (1 - u));
      ctx.strokeStyle = `rgba(${r.color},${(1 - u) * 0.8})`;
      ctx.lineWidth = r.width * (1 - u * 0.5);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, TAU);
      ctx.stroke();
    }
    for (const p of this.parts) {
      const u = p.life / p.max;
      ctx.globalAlpha = 1 - u * u;
      ctx.fillStyle = p.color;
      if (p.kind === 'spark') {
        const s = p.size * (1 - u * 0.5);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(0, -s * 1.6); ctx.lineTo(s * 0.45, 0); ctx.lineTo(0, s * 1.6); ctx.lineTo(-s * 0.45, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + u), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Labels are drawn in screen space for crisp text.
  drawLabels(ctx, toScreen, fontFamily) {
    for (const l of this.labels) {
      const u = l.t / l.dur;
      const [sx, sy] = toScreen(l.x, l.y);
      const rise = 26 * (1 - (1 - u) * (1 - u));
      const pop = u < 0.15 ? 0.6 + (u / 0.15) * 0.5 : 1.1 - Math.min(0.1, (u - 0.15));
      ctx.save();
      ctx.translate(sx, sy - rise);
      ctx.scale(pop, pop);
      ctx.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 1;
      ctx.font = `800 ${l.size}px ${fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(8,10,20,0.85)';
      ctx.strokeText(l.text, 0, 0);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    }
  }
}
