// Little illustrated vignettes for the briefing cards that introduce each new trick.

import * as S from './sprites.js';
import { TAU } from './geom.js';

export function drawBriefArt(canvas, kind) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = 280, H = 150;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  // floor
  ctx.fillStyle = '#1a1f3d';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(140,160,255,0.09)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 28) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 28) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
  const T = 28; // pixels per tile
  const at = (x, y, fn, s = 1) => { ctx.save(); ctx.translate(x, y); ctx.scale(T * s, T * s); fn(); ctx.restore(); };
  const cone = (x, y, a, half, len, rgb) => {
    const g = ctx.createRadialGradient(x, y, 2, x, y, len);
    g.addColorStop(0, `rgba(${rgb},0.55)`);
    g.addColorStop(1, `rgba(${rgb},0.12)`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, len, a - half, a + half); ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  const chalk = (pts, dash) => {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(6,8,18,0.6)'; ctx.lineWidth = 6;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.strokeStyle = '#f4eee2'; ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.restore();
  };
  const finger = (x, y) => {
    ctx.fillStyle = 'rgba(244,238,226,0.25)';
    ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(244,238,226,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.stroke();
  };
  const wall = (x, y, w, h) => {
    ctx.fillStyle = '#ece3d1'; ctx.fillRect(x, y, w, h - 7);
    ctx.fillStyle = '#a3937a'; ctx.fillRect(x, y + h - 7, w, 7);
  };

  switch (kind) {
    case 'draw': {
      chalk([[46, 110], [90, 104], [130, 70], [180, 58], [226, 62]]);
      at(46, 116, () => S.drawThief(ctx, { facing: 0, time: 0 }));
      at(232, 70, () => S.drawLoot(ctx, 'painting', 0, 0));
      finger(226, 62);
      break;
    }
    case 'camera': {
      wall(0, 0, W, 22);
      cone(140, 22, Math.PI / 2, 0.42, 120, S.PAL.coolLight);
      at(140, 22, () => S.drawCamera(ctx, 0, 0, Math.PI / 2, { time: 1 }), 1);
      chalk([[30, 130], [60, 90], [70, 50], [70, 40]], [2, 7]);
      at(34, 136, () => S.drawThief(ctx, { facing: -1.2, time: 0 }));
      at(240, 90, () => S.drawLoot(ctx, 'gem', 0, 0));
      break;
    }
    case 'wait': {
      wall(0, 0, W, 22);
      cone(140, 22, Math.PI / 2 + 0.7, 0.4, 130, S.PAL.coolLight);
      at(140, 22, () => S.drawCamera(ctx, 0, 0, Math.PI / 2 + 0.7, { time: 1 }), 1);
      at(200, 120, () => S.drawThief(ctx, { facing: Math.PI, time: 0 }));
      ctx.strokeStyle = '#f4c24f'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(200, 108, 22, -Math.PI / 2, -Math.PI / 2 + TAU * 0.65); ctx.stroke();
      ctx.fillStyle = '#f4eee2'; ctx.font = '800 16px "Big Shoulders Display", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('HOLD', 200, 146);
      break;
    }
    case 'guard': {
      ctx.save(); ctx.setLineDash([2, 8]); ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,214,150,0.5)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(30, 80); ctx.lineTo(250, 80); ctx.stroke(); ctx.restore();
      cone(120, 80, 0, 0.61, 100, S.PAL.amberLight);
      at(120, 86, () => S.drawGuard(ctx, { facing: 0, time: 0, seed: 0 }), 1.1);
      at(60, 132, () => S.drawThief(ctx, { facing: -0.5, time: 0 }));
      break;
    }
    case 'laser': {
      wall(0, 0, 24, H); wall(W - 24, 0, 24, H);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,40,70,0.3)'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(24, 60); ctx.lineTo(W - 24, 60); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,220,225,0.95)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(255,90,110,0.4)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(24, 100); ctx.lineTo(W - 24, 100); ctx.stroke(); ctx.restore();
      at(140, 132, () => S.drawThief(ctx, { facing: -Math.PI / 2, time: 0 }));
      break;
    }
    case 'key': {
      wall(186, 0, 30, 50); wall(186, 100, 30, 50);
      ctx.fillStyle = S.PAL.keyColors[0]; ctx.fillRect(193, 50, 16, 50);
      ctx.fillStyle = '#ff5b6a'; ctx.beginPath(); ctx.arc(201, 75, 4, 0, TAU); ctx.fill();
      chalk([[40, 110], [90, 90], [120, 84]]);
      at(40, 116, () => S.drawThief(ctx, { facing: 0, time: 0 }));
      at(126, 88, () => S.drawKey(ctx, 0, 0, 0), 1.3);
      at(248, 88, () => S.drawLoot(ctx, 'gold', 0, 0));
      break;
    }
    case 'noise': {
      ctx.save(); ctx.translate(84, 80); ctx.scale(T * 1.2, T * 1.2);
      ctx.fillStyle = '#7d583a'; ctx.fillRect(-0.5, -0.5, 1, 1);
      ctx.fillStyle = '#8a6443'; ctx.fillRect(-0.46, -0.44, 0.92, 0.26); ctx.fillRect(-0.46, 0.16, 0.92, 0.26);
      ctx.restore();
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = `rgba(255,190,110,${0.7 - k * 0.2})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(84, 80, 30 + k * 24, 0, TAU); ctx.stroke();
      }
      at(84, 86, () => S.drawThief(ctx, { facing: 0, time: 0 }));
      at(222, 92, () => S.drawGuard(ctx, { facing: Math.PI, time: 0, seed: 1, alert: true }), 1.1);
      ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(210, 30, 24, 26, 7) : ctx.rect(210, 30, 24, 26); ctx.fill();
      ctx.fillStyle = '#10121e'; ctx.font = '900 20px "Big Shoulders Display", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', 222, 50);
      break;
    }
    case 'power': {
      ctx.fillStyle = 'rgba(2,3,12,0.45)'; ctx.fillRect(0, 0, W, H);
      wall(0, 0, W, 22);
      at(140, 22, () => S.drawCamera(ctx, 0, 0, Math.PI / 2, { time: 1, off: true }), 1);
      ctx.save(); ctx.translate(60, 96); ctx.scale(T * 1.3, T * 1.3); ctx.translate(-0.5, -0.5);
      ctx.fillStyle = '#4b5263'; ctx.fillRect(0.1, 0.1, 0.8, 0.8);
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 0.05; ctx.strokeRect(0.16, 0.2, 0.68, 0.64);
      ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.moveTo(0.55, 0.26); ctx.lineTo(0.36, 0.54); ctx.lineTo(0.5, 0.54); ctx.lineTo(0.44, 0.78); ctx.lineTo(0.65, 0.46); ctx.lineTo(0.51, 0.46); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(60, 96, 30, -Math.PI / 2, -Math.PI / 2 + TAU * 0.7); ctx.stroke();
      at(200, 120, () => S.drawThief(ctx, { facing: -2.5, time: 0 }));
      break;
    }
    case 'glass': {
      wall(0, 0, W, 22);
      cone(70, 22, Math.PI / 2 - 0.2, 0.4, 130, S.PAL.coolLight);
      at(70, 22, () => S.drawCamera(ctx, 0, 0, Math.PI / 2 - 0.2, { time: 1 }), 1);
      ctx.save(); ctx.translate(96, 70); ctx.scale(T * 1.2, T * 1.2);
      ctx.fillStyle = '#4a3842'; ctx.fillRect(0, 0, 1, 0.6); ctx.fillStyle = 'rgba(190,235,255,0.25)'; ctx.fillRect(0, 0, 1, 0.6);
      ctx.strokeStyle = 'rgba(220,245,255,0.8)'; ctx.lineWidth = 0.03; ctx.strokeRect(0, 0, 1, 0.6);
      ctx.restore();
      at(120, 128, () => S.drawThief(ctx, { facing: -1.5, time: 0 }));
      ctx.fillStyle = '#ff4b5c'; ctx.font = '900 22px "Big Shoulders Display", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('SEEN THROUGH GLASS', 190, 140);
      break;
    }
    case 'crown': {
      const g = ctx.createRadialGradient(140, 75, 5, 140, 75, 90);
      g.addColorStop(0, 'rgba(255,210,110,0.5)'); g.addColorStop(1, 'rgba(255,210,110,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      at(140, 100, () => S.drawLoot(ctx, 'crown', 0, 0, 1.6), 1.2);
      at(70, 124, () => S.drawThief(ctx, { facing: 0, time: 0, bag: 4 }));
      break;
    }
    case 'case': {
      at(140, 110, () => S.drawThief(ctx, { facing: 0.3, time: 0, bag: 1 }), 1.5);
      break;
    }
  }
}
