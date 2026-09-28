// Procedural sprites. Everything is drawn in tile units around (0,0), which is the
// point where the figure touches the floor. The caller sets up the transform.

import { TAU } from './geom.js';

export const PAL = {
  ink: '#0b0d1a',
  paper: '#f1e8d6',
  gold: '#f4c24f',
  goldDeep: '#b8862a',
  red: '#ff4b5c',
  mint: '#6fe3c1',
  amberLight: '255,214,150',
  coolLight: '170,215,255',
  thiefShirt: '#1c1c26',
  thiefStripe: '#ece6da',
  scarf: '#ff6a4d',
  skin: '#f0c49c',
  sack: '#c89b5e',
  sackDark: '#8e6a3a',
  guardBlue: '#34539e',
  guardDark: '#1d2d5b',
  keyColors: ['#56a8ff', '#ffc94a'],
};

function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export { rr as roundRect };

export function shadow(ctx, rx = 0.26, ry = 0.1, a = 0.38) {
  ellipse(ctx, 0, 0.02, rx, ry, `rgba(0,0,0,${a})`);
}

// The thief: striped shirt, beanie, eye mask, coral scarf and a swag sack that
// fills up as loot is collected.
export function drawThief(ctx, o) {
  const f = o.facing || 0;
  const fx = Math.cos(f), fy = Math.sin(f);
  const side = fx >= 0 ? 1 : -1;
  const bob = o.moving ? Math.abs(Math.sin(o.walk * 9)) * 0.05 : Math.sin(o.time * 2.2) * 0.012;
  const squash = o.moving ? 1 + Math.sin(o.walk * 18) * 0.03 : 1;
  ctx.save();
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  shadow(ctx, 0.24, 0.09);
  ctx.translate(0, -bob);
  ctx.scale(1 / squash, squash);

  // feet
  if (o.moving) {
    const s = Math.sin(o.walk * 9);
    ellipse(ctx, -0.08, -0.03 + Math.max(0, s) * -0.04, 0.06, 0.04, '#111118');
    ellipse(ctx, 0.08, -0.03 + Math.max(0, -s) * -0.04, 0.06, 0.04, '#111118');
  } else {
    ellipse(ctx, -0.08, -0.03, 0.06, 0.04, '#111118');
    ellipse(ctx, 0.08, -0.03, 0.06, 0.04, '#111118');
  }

  // sack (behind the body, away from the facing side)
  const sackR = 0.1 + Math.min(4, o.bag || 0) * 0.025;
  const sackX = -side * 0.19, sackY = -0.36;
  const drawSack = () => {
    ellipse(ctx, sackX, sackY, sackR * 1.05, sackR, PAL.sack);
    ellipse(ctx, sackX - side * 0.02, sackY - sackR * 0.25, sackR * 0.55, sackR * 0.35, '#dcb57c');
    ctx.fillStyle = PAL.sackDark;
    ctx.fillRect(sackX - 0.03, sackY - sackR - 0.02, 0.06, 0.04);
    if ((o.bag || 0) > 0) {
      ctx.fillStyle = PAL.gold;
      ctx.beginPath();
      ctx.arc(sackX + side * 0.01, sackY - sackR - 0.035, 0.035, 0, TAU);
      ctx.fill();
    }
  };
  if (fy < 0.2) drawSack();

  // body
  rr(ctx, -0.16, -0.5, 0.32, 0.44, 0.13);
  ctx.fillStyle = PAL.thiefShirt;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAL.thiefStripe;
  for (let y = -0.44; y < -0.06; y += 0.1) ctx.fillRect(-0.2, y, 0.4, 0.045);
  ctx.restore();
  // arms
  const armSwing = o.moving ? Math.sin(o.walk * 9) * 0.05 : 0;
  ellipse(ctx, -0.17, -0.3 + armSwing, 0.05, 0.1, '#15151d');
  ellipse(ctx, 0.17, -0.3 - armSwing, 0.05, 0.1, '#15151d');

  if (fy >= 0.2) drawSack();

  // scarf
  const tail = o.moving ? Math.sin(o.walk * 14) * 0.04 : Math.sin(o.time * 3) * 0.015;
  ctx.fillStyle = PAL.scarf;
  rr(ctx, -0.15, -0.55, 0.3, 0.08, 0.04);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-side * 0.1, -0.52);
  ctx.quadraticCurveTo(-side * 0.22, -0.48 + tail, -side * 0.3, -0.42 - tail);
  ctx.lineTo(-side * 0.26, -0.38 - tail);
  ctx.quadraticCurveTo(-side * 0.18, -0.44, -side * 0.06, -0.49);
  ctx.closePath();
  ctx.fill();

  // head
  const hx = fx * 0.02, hy = -0.66;
  ellipse(ctx, hx, hy, 0.17, 0.16, PAL.skin);
  // beanie
  ctx.fillStyle = '#23232e';
  ctx.beginPath();
  ctx.ellipse(hx, hy - 0.03, 0.175, 0.15, 0, Math.PI, TAU);
  ctx.fill();
  ctx.fillRect(hx - 0.18, hy - 0.05, 0.36, 0.05);
  ellipse(ctx, hx, hy - 0.19, 0.04, 0.035, PAL.scarf);
  // mask band + eyes (look toward facing)
  if (fy > -0.75) {
    ctx.fillStyle = '#101016';
    rr(ctx, hx - 0.17, hy - 0.005, 0.34, 0.075, 0.035);
    ctx.fill();
    const ex = fx * 0.055, ey = fy * 0.015;
    ellipse(ctx, hx - 0.065 + ex, hy + 0.033 + ey, 0.035, 0.025, '#fff');
    ellipse(ctx, hx + 0.065 + ex, hy + 0.033 + ey, 0.035, 0.025, '#fff');
    ellipse(ctx, hx - 0.06 + ex * 1.3, hy + 0.035 + ey, 0.016, 0.018, '#111');
    ellipse(ctx, hx + 0.07 + ex * 1.3, hy + 0.035 + ey, 0.016, 0.018, '#111');
  }
  ctx.restore();
}

// A night-shift guard with a flashlight held toward where he is looking.
export function drawGuard(ctx, o) {
  const f = o.facing || 0;
  const fx = Math.cos(f), fy = Math.sin(f);
  const bob = o.moving ? Math.abs(Math.sin(o.walk * 7)) * 0.04 : Math.sin(o.time * 1.7 + o.seed) * 0.01;
  ctx.save();
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  shadow(ctx, 0.28, 0.1);
  ctx.translate(0, -bob);

  if (o.moving) {
    const s = Math.sin(o.walk * 7);
    ellipse(ctx, -0.09, -0.03 + Math.max(0, s) * -0.04, 0.07, 0.045, '#15182a');
    ellipse(ctx, 0.09, -0.03 + Math.max(0, -s) * -0.04, 0.07, 0.045, '#15182a');
  } else {
    ellipse(ctx, -0.09, -0.03, 0.07, 0.045, '#15182a');
    ellipse(ctx, 0.09, -0.03, 0.07, 0.045, '#15182a');
  }

  const handX = fx * 0.22, handY = -0.3 + fy * 0.1;
  const drawTorch = () => {
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(f);
    ctx.fillStyle = '#3a3f4f';
    rr(ctx, -0.02, -0.035, 0.16, 0.07, 0.02);
    ctx.fill();
    ctx.fillStyle = o.alert ? '#ffb3b3' : '#fff2c8';
    ctx.fillRect(0.12, -0.04, 0.035, 0.08);
    ctx.restore();
    ellipse(ctx, handX, handY, 0.055, 0.05, PAL.skin);
  };
  if (fy < -0.1) drawTorch();

  // body
  rr(ctx, -0.19, -0.54, 0.38, 0.5, 0.14);
  ctx.fillStyle = PAL.guardBlue;
  ctx.fill();
  ctx.fillStyle = '#26356b';
  ctx.fillRect(-0.19, -0.2, 0.38, 0.05);
  ctx.fillStyle = PAL.gold;
  ctx.fillRect(-0.025, -0.2, 0.05, 0.05);
  // badge
  ctx.beginPath();
  ctx.arc(-0.09, -0.4, 0.03, 0, TAU);
  ctx.fill();
  // shoulders
  ellipse(ctx, -0.18, -0.44, 0.07, 0.05, '#2b4586');
  ellipse(ctx, 0.18, -0.44, 0.07, 0.05, '#2b4586');

  if (fy >= -0.1) drawTorch();

  // head + cap
  const hx = fx * 0.025, hy = -0.7;
  ellipse(ctx, hx, hy, 0.16, 0.155, PAL.skin);
  if (fy > -0.75) {
    const ex = fx * 0.055, ey = fy * 0.02;
    ellipse(ctx, hx - 0.06 + ex, hy + 0.03 + ey, 0.022, 0.028, '#1a1a22');
    ellipse(ctx, hx + 0.06 + ex, hy + 0.03 + ey, 0.022, 0.028, '#1a1a22');
    // moustache for character
    ctx.fillStyle = '#5a3a22';
    rr(ctx, hx - 0.06 + ex * 0.8, hy + 0.08 + ey, 0.12, 0.03, 0.015);
    ctx.fill();
  }
  ctx.fillStyle = PAL.guardDark;
  ctx.beginPath();
  ctx.ellipse(hx, hy - 0.05, 0.175, 0.12, 0, Math.PI, TAU);
  ctx.fill();
  ctx.fillRect(hx - 0.175, hy - 0.06, 0.35, 0.04);
  // visor toward facing
  ctx.fillStyle = '#10183a';
  ctx.beginPath();
  ctx.ellipse(hx + fx * 0.1, hy - 0.03 + Math.max(0, fy) * 0.02, 0.12, 0.045, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PAL.gold;
  ctx.beginPath();
  ctx.arc(hx + fx * 0.02, hy - 0.12, 0.028, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Wall-mounted security camera.
export function drawCamera(ctx, x, y, angle, o) {
  ctx.save();
  ctx.translate(x, y);
  // mount plate
  ctx.fillStyle = '#2b2f3d';
  ctx.beginPath();
  ctx.arc(0, 0, 0.1, 0, TAU);
  ctx.fill();
  ctx.rotate(angle);
  ctx.fillStyle = '#2b2f3d';
  ctx.fillRect(0, -0.035, 0.12, 0.07);
  ctx.translate(0.14, 0);
  rr(ctx, -0.06, -0.11, 0.3, 0.22, 0.06);
  ctx.fillStyle = o.off ? '#8d93a3' : '#dfe3ec';
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(-0.06, 0.03, 0.3, 0.08);
  ctx.fillStyle = '#1b1e29';
  ctx.beginPath();
  ctx.arc(0.22, 0, 0.075, 0, TAU);
  ctx.fill();
  ctx.fillStyle = o.off ? '#2a2d38' : o.alert ? '#ff6b6b' : '#6f9cff';
  ctx.beginPath();
  ctx.arc(0.225, 0, 0.035, 0, TAU);
  ctx.fill();
  if (!o.off && Math.sin(o.time * 5) > 0.2) {
    ctx.fillStyle = PAL.red;
    ctx.beginPath();
    ctx.arc(0.02, -0.06, 0.022, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export function drawCoin(ctx, time, seed) {
  const s = Math.cos(time * 3 + seed);
  const sx = Math.max(0.3, Math.abs(s));
  const bob = Math.sin(time * 2.5 + seed) * 0.04;
  shadow(ctx, 0.14 * (0.6 + sx * 0.4), 0.05, 0.3);
  ctx.save();
  ctx.translate(0, -0.2 + bob);
  ctx.scale(sx, 1);
  ctx.beginPath();
  ctx.arc(0, 0, 0.15, 0, TAU);
  ctx.fillStyle = PAL.goldDeep;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -0.01, 0.13, 0, TAU);
  ctx.fillStyle = PAL.gold;
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,80,20,0.55)';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.arc(0, -0.01, 0.085, 0, TAU);
  ctx.stroke();
  if (s > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(-0.05, -0.06, 0.03, 0.02, -0.6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export function drawKey(ctx, color, time, seed) {
  const bob = Math.sin(time * 2.2 + seed) * 0.04;
  shadow(ctx, 0.16, 0.05, 0.3);
  ctx.save();
  ctx.translate(0, -0.22 + bob);
  ctx.rotate(-0.18);
  rr(ctx, -0.19, -0.13, 0.38, 0.26, 0.05);
  ctx.fillStyle = PAL.keyColors[color];
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(-0.19, -0.07, 0.38, 0.05);
  ctx.fillStyle = '#e8d58a';
  rr(ctx, -0.13, 0.0, 0.09, 0.07, 0.015);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0.0, 0.03, 0.13, 0.025);
  ctx.restore();
}

// ---------------------------------------------------------------- loot
const LOOT = {
  painting(ctx) {
    ctx.fillStyle = '#c69a3e';
    rr(ctx, -0.3, -0.24, 0.6, 0.48, 0.03);
    ctx.fill();
    ctx.fillStyle = '#7a5a1e';
    ctx.fillRect(-0.24, -0.18, 0.48, 0.36);
    ctx.fillStyle = '#2d3e6b';
    ctx.fillRect(-0.22, -0.16, 0.44, 0.32);
    ctx.fillStyle = '#f0b64a';
    ctx.beginPath(); ctx.arc(0.08, -0.05, 0.07, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1b2a4a';
    ctx.beginPath(); ctx.moveTo(-0.22, 0.16); ctx.lineTo(-0.06, -0.02); ctx.lineTo(0.06, 0.08); ctx.lineTo(0.22, -0.04); ctx.lineTo(0.22, 0.16); ctx.fill();
  },
  cat(ctx) {
    ctx.fillStyle = '#c69a3e';
    rr(ctx, -0.26, -0.3, 0.52, 0.6, 0.03);
    ctx.fill();
    ctx.fillStyle = '#e9d7b2';
    ctx.fillRect(-0.2, -0.24, 0.4, 0.48);
    ctx.fillStyle = '#2a2a33';
    ctx.beginPath(); ctx.ellipse(0, 0.08, 0.12, 0.12, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -0.08, 0.08, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-0.07, -0.12); ctx.lineTo(-0.06, -0.2); ctx.lineTo(-0.02, -0.14); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0.07, -0.12); ctx.lineTo(0.06, -0.2); ctx.lineTo(0.02, -0.14); ctx.fill();
    ctx.fillStyle = '#9be36f';
    ctx.fillRect(-0.04, -0.09, 0.025, 0.02); ctx.fillRect(0.015, -0.09, 0.025, 0.02);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(-0.06, -0.01, 0.12, 0.025);
  },
  gem(ctx) {
    ctx.fillStyle = '#bff3ff';
    ctx.beginPath(); ctx.moveTo(-0.24, -0.08); ctx.lineTo(-0.12, -0.2); ctx.lineTo(0.12, -0.2); ctx.lineTo(0.24, -0.08); ctx.lineTo(0, 0.24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6fd6f2';
    ctx.beginPath(); ctx.moveTo(-0.24, -0.08); ctx.lineTo(0.24, -0.08); ctx.lineTo(0, 0.24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3aaed8';
    ctx.beginPath(); ctx.moveTo(-0.08, -0.08); ctx.lineTo(0.08, -0.08); ctx.lineTo(0, 0.24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.moveTo(-0.12, -0.2); ctx.lineTo(-0.02, -0.2); ctx.lineTo(-0.08, -0.08); ctx.closePath(); ctx.fill();
  },
  ruby(ctx) {
    ctx.fillStyle = '#ffb3c1';
    ctx.beginPath(); ctx.moveTo(-0.22, -0.06); ctx.lineTo(-0.1, -0.2); ctx.lineTo(0.1, -0.2); ctx.lineTo(0.22, -0.06); ctx.lineTo(0, 0.22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8364f';
    ctx.beginPath(); ctx.moveTo(-0.22, -0.06); ctx.lineTo(0.22, -0.06); ctx.lineTo(0, 0.22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a3172d';
    ctx.beginPath(); ctx.moveTo(-0.07, -0.06); ctx.lineTo(0.07, -0.06); ctx.lineTo(0, 0.22); ctx.closePath(); ctx.fill();
  },
  gold(ctx) {
    const bar = (x, y) => {
      ctx.fillStyle = '#b8862a';
      ctx.beginPath(); ctx.moveTo(x - 0.15, y + 0.07); ctx.lineTo(x + 0.15, y + 0.07); ctx.lineTo(x + 0.11, y - 0.05); ctx.lineTo(x - 0.11, y - 0.05); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f7cf5c';
      ctx.fillRect(x - 0.1, y - 0.05, 0.2, 0.05);
    };
    bar(-0.12, 0.12); bar(0.12, 0.12); bar(0, -0.02);
  },
  crown(ctx) {
    ctx.fillStyle = '#f4c24f';
    ctx.beginPath();
    ctx.moveTo(-0.26, 0.14); ctx.lineTo(-0.26, -0.12); ctx.lineTo(-0.13, 0.0); ctx.lineTo(0, -0.2);
    ctx.lineTo(0.13, 0.0); ctx.lineTo(0.26, -0.12); ctx.lineTo(0.26, 0.14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b8862a';
    ctx.fillRect(-0.26, 0.08, 0.52, 0.06);
    ctx.fillStyle = '#e8364f';
    ctx.beginPath(); ctx.arc(0, 0.03, 0.04, 0, TAU); ctx.fill();
    ctx.fillStyle = '#56a8ff';
    ctx.beginPath(); ctx.arc(-0.15, 0.05, 0.03, 0, TAU); ctx.arc(0.15, 0.05, 0.03, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    [[-0.26, -0.12], [0, -0.2], [0.26, -0.12]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 0.025, 0, TAU); ctx.fill(); });
  },
  vase(ctx) {
    ctx.fillStyle = '#eef3fb';
    ctx.beginPath();
    ctx.moveTo(-0.07, -0.26); ctx.lineTo(0.07, -0.26); ctx.lineTo(0.06, -0.18);
    ctx.bezierCurveTo(0.26, -0.1, 0.24, 0.18, 0.09, 0.26); ctx.lineTo(-0.09, 0.26);
    ctx.bezierCurveTo(-0.24, 0.18, -0.26, -0.1, -0.06, -0.18); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#2d5fb8'; ctx.lineWidth = 0.025;
    ctx.beginPath(); ctx.moveTo(-0.17, -0.02); ctx.bezierCurveTo(-0.08, -0.08, 0.08, 0.04, 0.17, -0.02); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.17, 0.1); ctx.bezierCurveTo(-0.08, 0.04, 0.08, 0.16, 0.17, 0.1); ctx.stroke();
    ctx.fillStyle = '#2d5fb8';
    ctx.fillRect(-0.075, -0.26, 0.15, 0.03);
  },
  egg(ctx) {
    ctx.fillStyle = '#d04a7a';
    ctx.beginPath(); ctx.ellipse(0, 0, 0.17, 0.23, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f4c24f'; ctx.lineWidth = 0.025;
    ctx.beginPath(); ctx.ellipse(0, 0, 0.17, 0.06, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -0.23); ctx.lineTo(0, 0.23); ctx.stroke();
    ctx.fillStyle = '#fff';
    [[-0.08, -0.12], [0.08, 0.12], [0.09, -0.1], [-0.09, 0.11]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 0.02, 0, TAU); ctx.fill(); });
    ctx.fillStyle = '#f4c24f';
    ctx.fillRect(-0.04, 0.2, 0.08, 0.06);
  },
  briefcase(ctx) {
    ctx.strokeStyle = '#3b2a1a'; ctx.lineWidth = 0.035;
    ctx.beginPath(); ctx.moveTo(-0.07, -0.14); ctx.lineTo(-0.07, -0.2); ctx.lineTo(0.07, -0.2); ctx.lineTo(0.07, -0.14); ctx.stroke();
    ctx.fillStyle = '#7a4b27';
    rr(ctx, -0.26, -0.14, 0.52, 0.34, 0.05); ctx.fill();
    ctx.fillStyle = '#5c3719'; ctx.fillRect(-0.26, 0.0, 0.52, 0.03);
    ctx.fillStyle = '#f4c24f'; ctx.fillRect(-0.18, -0.06, 0.06, 0.05); ctx.fillRect(0.12, -0.06, 0.06, 0.05);
  },
  watch(ctx) {
    ctx.strokeStyle = '#f4c24f'; ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.arc(0, -0.25, 0.05, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#d9a93a';
    ctx.beginPath(); ctx.arc(0, 0.03, 0.22, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fbf6e8';
    ctx.beginPath(); ctx.arc(0, 0.03, 0.17, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 0.022;
    ctx.beginPath(); ctx.moveTo(0, 0.03); ctx.lineTo(0, -0.09); ctx.moveTo(0, 0.03); ctx.lineTo(0.08, 0.07); ctx.stroke();
  },
  idol(ctx) {
    ctx.fillStyle = '#e0a93a';
    ctx.beginPath(); ctx.moveTo(-0.16, 0.26); ctx.lineTo(0.16, 0.26); ctx.lineTo(0.1, -0.02); ctx.lineTo(-0.1, -0.02); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -0.13, 0.13, 0, TAU); ctx.fill();
    ctx.fillStyle = '#9c6a16';
    ctx.fillRect(-0.07, -0.16, 0.04, 0.03); ctx.fillRect(0.03, -0.16, 0.04, 0.03); ctx.fillRect(-0.05, -0.07, 0.1, 0.02);
    ctx.fillStyle = '#6fe3c1';
    ctx.beginPath(); ctx.arc(0, 0.1, 0.035, 0, TAU); ctx.fill();
  },
  necklace(ctx) {
    ctx.strokeStyle = '#f4f1ea'; ctx.lineWidth = 0.035;
    ctx.beginPath(); ctx.arc(0, -0.06, 0.2, 0.15, Math.PI - 0.15); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (let a = 0.25; a < Math.PI - 0.2; a += 0.28) { ctx.beginPath(); ctx.arc(Math.cos(a) * 0.2, -0.06 + Math.sin(a) * 0.2, 0.035, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#56a8ff';
    ctx.beginPath(); ctx.moveTo(0, 0.12); ctx.lineTo(0.07, 0.2); ctx.lineTo(0, 0.28); ctx.lineTo(-0.07, 0.2); ctx.closePath(); ctx.fill();
  },
  tiara(ctx) {
    ctx.strokeStyle = '#e8ecf5'; ctx.lineWidth = 0.04;
    ctx.beginPath(); ctx.arc(0, 0.2, 0.26, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.fillStyle = '#e8ecf5';
    ctx.beginPath(); ctx.moveTo(-0.12, -0.02); ctx.lineTo(0, -0.24); ctx.lineTo(0.12, -0.02); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b983ff';
    ctx.beginPath(); ctx.arc(0, -0.08, 0.05, 0, TAU); ctx.fill();
  },
  scroll(ctx) {
    ctx.fillStyle = '#efe0b9';
    ctx.fillRect(-0.2, -0.16, 0.4, 0.32);
    ctx.fillStyle = '#c9ad74';
    ctx.beginPath(); ctx.ellipse(-0.2, 0, 0.05, 0.18, 0, 0, TAU); ctx.ellipse(0.2, 0, 0.05, 0.18, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b3342f';
    ctx.beginPath(); ctx.arc(0.05, 0.07, 0.05, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,20,0.5)'; ctx.lineWidth = 0.015;
    for (let y = -0.1; y < 0.02; y += 0.05) { ctx.beginPath(); ctx.moveTo(-0.13, y); ctx.lineTo(0.13, y); ctx.stroke(); }
  },
};

export const LOOT_KINDS = Object.keys(LOOT);

export function drawLoot(ctx, kind, time, seed, scale = 1) {
  const bob = Math.sin(time * 2 + seed) * 0.05;
  shadow(ctx, 0.22, 0.07, 0.35);
  ctx.save();
  // glow
  const g = ctx.createRadialGradient(0, -0.3, 0, 0, -0.3, 0.6);
  const pulse = 0.28 + Math.sin(time * 3 + seed) * 0.07;
  g.addColorStop(0, `rgba(255,210,110,${pulse})`);
  g.addColorStop(1, 'rgba(255,210,110,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-0.6, -0.9, 1.2, 1.2);
  ctx.translate(0, -0.32 + bob);
  ctx.scale(scale * 0.95, scale * 0.95);
  (LOOT[kind] || LOOT.gem)(ctx);
  ctx.restore();
}

export function drawLootIcon(ctx, kind) {
  (LOOT[kind] || LOOT.gem)(ctx);
}
