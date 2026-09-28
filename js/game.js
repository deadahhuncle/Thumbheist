// The in-level controller: input, planning preview, playback and outcomes.
//
// States: intro -> idle -> drawing -> rewind -> running -> caught|escaped -> result
// While drawing, the world is shown at the moment the thief would reach the tip
// of the line, so the player literally scrubs time with their thumb.

import { Sim, frameAt, DT } from './sim.js';
import { Plan, Drawer } from './plan.js';
import { Renderer } from './render.js';
import { FX } from './fx.js';
import { audio } from './audio.js';
import { clamp, dist, angLerp } from './geom.js';

const HOLD_R = 0.45;         // thumb within this many tiles of the line's tip can hold
const HOLD_DELAY = 0.25;     // seconds of resting before waiting kicks in
const HOLD_PX = 6;           // a thumb that stays within this many CSS pixels is resting
const GRAB_TILES = 1.0;      // how close to the thief a plan may start
const CANCEL_LEN = 0.35;     // lines shorter than this are treated as a cancel

const popcount = (m) => { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; };

export class Game {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.r = new Renderer(canvas);
    this.fx = new FX();
    this.hooks = hooks;
    this.level = null;
    this.state = 'none';
    this.time = 0;
    this.stateT = 0;
    this.paused = false;
    this.pointerId = null;
    this.bindInput();
  }

  // ------------------------------------------------------------------ lifecycle
  resize(w, h, area) {
    const { ts, ox, oy } = this.r;
    this.r.resize(w, h, area);
    // The board moved under the thumb (rotation, split screen): the line in
    // progress no longer lines up with the finger, so drop it.
    const moved = Math.abs(this.r.ts - ts) > 0.5 || Math.abs(this.r.ox - ox) > 2 || Math.abs(this.r.oy - oy) > 2;
    if (moved && this.state === 'drawing') this.cancelDraw('scrap');
  }

  load(level) {
    this.level = level;
    this.r.setLevel(level);
    this.fx.clear();
    this.ghostPlan = null;
    this.ghostCaughtT = null;
    this.paused = false;
    this.fails = 0;
    this.hasDrawn = false;
    this.dropSounded = false;
    this.setState('intro');
    this.resetWorld();
    this.hooks.hud(this.hudState());
    this.hooks.tip(level.brief, 'brief');
    audio.setMood('plan');
  }

  resetWorld() {
    const L = this.level;
    this.idleSim = new Sim(L, new Plan(L.start.x, L.start.y), { detect: false, interact: false });
    this.idleT = 0;
    this.drawer = null;
    this.sim = null;
    this.viewT = 0;
    this.playT = 0;
    this.evIdx = 0;
    this.speed = 1;
    this.slowmo = 0;
    this.nearCount = 0;
    this.lastNearT = -10;
    this.stepT = 0;
    this.walk = 0;
    this.facing = this.startFacing();
    this.fast = false;
    this.alarm = 0;
    this.resultShown = false;
    this.outcome = null;
    this.lastTickSec = 0;
    this.previewCaught = false;
    this.previewEscaped = false;
    this.lockCount = 0;
    this.waitTickT = 0;
    this.powerUpAt = null;
    this.thiefHidden = false;
    this.exitAnim = 0;
  }

  // Face into the building from the entry window.
  startFacing() {
    const L = this.level;
    const x = Math.floor(L.start.x), y = Math.floor(L.start.y);
    let best = 0.4, bestOpen = -1;
    for (const [dx, dy] of [[1, 0], [0, -1], [-1, 0], [0, 1]]) {
      let open = 0;
      for (let k = 1; k <= 3; k++) {
        const cx = x + dx * k, cy = y + dy * k;
        if (cx < 0 || cy < 0 || cx >= L.W || cy >= L.H || L.kind[cy * L.W + cx] !== 0) break;
        open++;
      }
      if (open > bestOpen) { bestOpen = open; best = Math.atan2(dy, dx); }
    }
    return best;
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  retry() {
    this.fx.clear();
    this.resetWorld();
    this.setState('idle');
    this.hooks.hud(this.hudState());
    this.hooks.tip(this.fails >= 3 && this.level.hint ? this.level.hint : this.level.brief, this.fails >= 3 ? 'hint' : 'brief');
    audio.setMood('plan');
  }

  pause(p) {
    this.paused = p;
    if (p && this.state === 'drawing') this.cancelDraw();
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const c = this.canvas;
    const pos = (e) => {
      const b = c.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top];
    };
    c.addEventListener('pointerdown', (e) => {
      audio.unlock();
      if (this.pointerId !== null || this.paused) return;
      this.pointerId = e.pointerId;
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
      this.onDown(...pos(e));
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (evs && evs.length) for (const ce of evs) this.onMove(...pos(ce));
      else this.onMove(...pos(e));
    });
    const up = (cancel) => (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.onUp(cancel);
    };
    c.addEventListener('pointerup', up(false));
    c.addEventListener('pointercancel', up(true));
    c.addEventListener('lostpointercapture', (e) => {
      if (e.pointerId === this.pointerId) { this.pointerId = null; this.onUp(true); }
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onDown(px, py) {
    const L = this.level;
    if (!L) return;
    this.finger = [px, py];
    if (this.state === 'running' || this.state === 'rewind') {
      this.fast = true;
      this.hooks.hud(this.hudState());
      return;
    }
    if (this.state !== 'idle' && this.state !== 'intro') return;
    const [wx, wy] = this.r.toWorld(px, py);
    const d = dist(wx, wy, L.start.x, L.start.y);
    const grab = Math.max(GRAB_TILES, 36 / this.r.ts);
    if (d > grab) {
      this.fx.ring(L.start.x, L.start.y, { r0: 0.2, r1: 1.1, color: '244,238,226', dur: 0.6 });
      this.hooks.tip('Start your plan on the thief — press and drag from them.', 'nudge');
      audio.play('locked');
      return;
    }
    this.beginDraw(px, py);
  }

  beginDraw(px, py) {
    const L = this.level;
    this.hasDrawn = true;
    this.drawer = new Drawer(L);
    this.sim = new Sim(L, this.drawer.plan);
    this.viewT = this.state === 'idle' || this.state === 'intro' ? this.idleT : 0;
    this.setState('drawing');
    this.anchor = [px, py];
    this.holdAnchor = [px, py];
    this.still = 0;
    this.lastTickSec = 0;
    this.previewCaught = false;
    this.previewEscaped = false;
    this.lockCount = 0;
    this.waitTickT = 0;
    this.holding = false;
    audio.play('penDown');
    if (this.viewT > 0.4) audio.play('rewind');
    this.hooks.tip(L.tutorial?.drawing || 'Draw the whole route in one stroke. Lift your thumb to run it.', 'drawing');
    this.hooks.haptic(8);
    this.hooks.hud(this.hudState());
  }

  onMove(px, py) {
    if (this.state !== 'drawing') { this.finger = [px, py]; return; }
    this.finger = [px, py];
    // A thumb that is travelling, however slowly, is not holding.
    if (Math.hypot(px - this.holdAnchor[0], py - this.holdAnchor[1]) > HOLD_PX) {
      this.holdAnchor = [px, py];
      this.still = 0;
      this.holding = false;
    }
    const [wx, wy] = this.r.toWorld(px, py);
    const dr = this.drawer;
    const before = dr.plan.n;
    const waitBefore = dr.plan.totalWait;
    if (dr.retrace(wx, wy)) {
      // erasing: rebuild the preview from scratch
      this.sim = new Sim(this.level, dr.plan);
      this.sim.advanceTo(dr.plan.end);
      if (before - dr.plan.n > 0) audio.play('erase');
      this.lastTickSec = Math.floor(dr.plan.end);
      this.still = 0;
      this.holding = false;
      if (waitBefore - dr.plan.totalWait > 0.35 && !this.previewCaught) {
        this.hooks.tip('That undid a wait. To wait and come back the same way, loop a little to one side.', 'hint');
      }
      this.afterPlanChange();
      return;
    }
    if (dr.extend(wx, wy)) {
      this.still = 0;
      this.holding = false;
      this.sim.advanceTo(dr.plan.end);
      this.afterPlanChange();
    }
  }

  afterPlanChange() {
    const dr = this.drawer, plan = dr.plan, s = this.sim;
    const sec = Math.floor(plan.end);
    if (sec > this.lastTickSec) {
      audio.play('tick', sec % 5 === 0);
      this.lastTickSec = sec;
    } else if (sec < this.lastTickSec) this.lastTickSec = sec;
    if (dr.lockEvents.length > this.lockCount) {
      const ev = dr.lockEvents[dr.lockEvents.length - 1];
      audio.play(ev.type === 'noise' ? 'creak' : 'lock');
      this.hooks.haptic(6);
      this.lockCount = dr.lockEvents.length;
    }
    const caught = s.status === 'caught';
    if (caught && !this.previewCaught) {
      audio.play('danger');
      this.hooks.haptic([30, 40, 30]);
      this.hooks.tip('You’d be seen here. Slide back along your line to undo, or drag off the board and lift to scrap the plan.', 'danger');
    } else if (!caught && this.previewCaught) {
      this.hooks.tip(this.level.tutorial?.drawing || 'Draw the whole route in one stroke. Lift your thumb to run it.', 'drawing');
    }
    this.previewCaught = caught;
    const esc = s.status === 'escaped';
    if (esc && !this.previewEscaped) {
      audio.play('safe');
      this.hooks.tip('Clean exit planned. Lift your thumb to run it.', 'ready');
      this.hooks.haptic(12);
    }
    this.previewEscaped = esc;
    this.hooks.hud(this.hudState());
  }

  onUp(cancel) {
    if (this.state === 'running' || this.state === 'rewind') {
      this.fast = false;
      this.hooks.hud(this.hudState());
      return;
    }
    if (this.state !== 'drawing') return;
    const plan = this.drawer.plan;
    if (!cancel && !this.drawer.escaped && this.finger) {
      const [wx, wy] = this.r.toWorld(this.finger[0], this.finger[1]);
      const off = 0.6;
      if (wx < -off || wy < -off || wx > this.level.W + off || wy > this.level.H + off) {
        audio.play('back');
        this.cancelDraw('scrap');
        return;
      }
    }
    if (cancel || plan.length < CANCEL_LEN) {
      this.cancelDraw(cancel ? null : plan.totalWait > 0.4 ? 'look' : 'tap');
      return;
    }
    this.commit();
  }

  cancelDraw(why) {
    this.idleT = this.viewT;
    this.idleSim = new Sim(this.level, new Plan(this.level.start.x, this.level.start.y), { detect: false, interact: false });
    this.drawer = null;
    this.sim = null;
    this.setState('idle');
    if (why === 'tap') this.hooks.tip('Press on the thief and drag to draw a route.', 'nudge');
    else if (why === 'look') this.hooks.tip('Just looking? Drag out from the thief to draw a route.', 'nudge');
    else if (why === 'scrap') this.hooks.tip('Plan scrapped. Press on the thief to start a new one.', 'nudge');
    else this.hooks.tip(this.level.brief, 'brief');
    this.hooks.hud(this.hudState());
  }

  commit() {
    const plan = this.drawer.plan;
    this.plan = plan;
    this.locks = this.drawer.lockEvents.slice();
    // make sure the sim covers the whole plan plus a moment after it ends
    this.sim.advanceTo(plan.end + 1);
    this.rewindFrom = this.viewT;
    this.setState('rewind');
    this.playT = 0;
    this.evIdx = 0;
    audio.play('go');
    audio.setMood('run');
    this.hooks.haptic(15);
    this.hooks.tip(plan.end > 7 ? 'Hold anywhere to fast-forward.' : '', 'run');
    this.hooks.hud(this.hudState());
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    if (!this.level || this.paused) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.stateT += dt;
    this.fx.update(dt);
    this.alarm = Math.max(0, this.alarm - dt * 0.25);

    switch (this.state) {
      case 'intro':
        this.idleT += dt;
        if (this.stateT > 0.25 && !this.dropSounded) { this.dropSounded = true; audio.play('drop'); }
        if (this.stateT > 0.9) this.setState('idle');
        break;
      case 'idle':
        this.idleT += dt;
        if (this.idleT > 120) {
          this.idleT = 0;
          this.idleSim = new Sim(this.level, new Plan(this.level.start.x, this.level.start.y), { detect: false, interact: false });
        }
        break;
      case 'drawing':
        this.updateDrawing(dt);
        break;
      case 'rewind': {
        const u = clamp(this.stateT / 0.32, 0, 1);
        this.viewT = this.rewindFrom * (1 - u * u * (3 - 2 * u));
        if (u >= 1) { this.setState('running'); this.viewT = 0; }
        break;
      }
      case 'running':
        this.updateRunning(dt);
        break;
      case 'caught':
        if (this.stateT > 1.25 && !this.resultShown) this.showResult();
        break;
      case 'escaped':
        this.playT += dt;
        this.sim.advanceTo(this.playT + DT);
        this.exitAnim = Math.min(1, this.exitAnim + dt / 0.45);
        if (this.stateT > 1.2 && !this.resultShown) this.showResult();
        break;
      case 'stranded':
        this.playT += dt;
        this.sim.advanceTo(this.playT + DT);
        if (this.stateT > 1.1 && !this.resultShown) this.showResult();
        break;
    }
  }

  updateDrawing(dt) {
    const dr = this.drawer;
    this.still += dt;
    // A hold: the line hasn't grown for a moment and the thumb rests near its tip.
    // (The drawer ignores tiny wobbles, so a resting thumb never creeps the line.)
    const p = dr.plan;
    const [fx, fy] = this.r.toWorld(this.finger[0], this.finger[1]);
    const near = Math.hypot(fx - p.xs[p.n - 1], fy - p.ys[p.n - 1]) <= HOLD_R;
    if (!near) { this.still = 0; this.holding = false; }
    if (this.still > HOLD_DELAY && near) {
      if (dr.hold(dt)) {
        this.sim.advanceTo(dr.plan.end);
        if (!this.holding) {
          this.holding = true;
          if (!this.previewCaught && !this.previewEscaped) this.hooks.tip('Holding still makes the thief wait. Watch the world move.', 'hold');
        }
        this.waitTickT += dt;
        if (this.waitTickT > 0.5) { this.waitTickT = 0; audio.play('wait'); }
        this.afterPlanChange();
      }
    }
    const target = dr.plan.end;
    this.viewT += (target - this.viewT) * Math.min(1, dt * 14);
    if (Math.abs(target - this.viewT) < 0.004) this.viewT = target;
  }

  updateRunning(dt) {
    const s = this.sim, plan = this.plan;
    this.hudT = (this.hudT || 0) + dt;
    if (this.hudT > 0.1) { this.hudT = 0; this.hooks.hud(this.hudState()); }
    let scale = this.fast ? 3 : 1;
    if (this.slowmo > 0) { this.slowmo -= dt; scale = 0.3; }
    const prevT = this.playT;
    this.playT += dt * scale;
    s.advanceTo(this.playT + DT);
    // footsteps
    const p0 = plan.posAt(prevT), p1 = plan.posAt(this.playT);
    const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    this.walk += moved;
    if (moved > 1e-4) {
      this.stepT += moved;
      if (this.stepT > 0.62) { this.stepT = 0; audio.play('step', (this.walk * 3) | 0); }
    }
    if (this.powerUpAt != null && this.playT >= this.powerUpAt) {
      this.powerUpAt = null;
      audio.play('powerUp');
    }
    // process events in order
    while (this.evIdx < s.events.length && s.events[this.evIdx].t <= this.playT) {
      const e = s.events[this.evIdx++];
      if (this.handleEvent(e)) return;
    }
    if (this.playT > plan.end + 0.5 && s.status === 'active') {
      this.setState('stranded');
      audio.play('stranded');
      audio.setMood('silent');
      this.hooks.haptic([20, 60, 20]);
    }
  }

  handleEvent(e) {
    const L = this.level;
    switch (e.type) {
      case 'pickup': {
        const it = L.items[e.item];
        if (it.type === 'loot') {
          audio.play('loot');
          this.fx.burst(it.x, it.y - 0.3, { n: 22, colors: ['#ffd76a', '#fff3c4', '#f4c24f'], speed: 3, life: 0.9 });
          this.fx.ring(it.x, it.y, { color: '255,210,110', r1: 1.4 });
          this.fx.label(it.x, it.y - 0.9, L.loot.name, { color: '#ffd76a', size: 16, dur: 1.4 });
          this.hooks.haptic(20);
        } else if (it.type === 'coin') {
          audio.play('coin');
          this.fx.burst(it.x, it.y - 0.2, { n: 10, color: '#ffd76a', speed: 2, life: 0.6 });
          this.fx.label(it.x, it.y - 0.7, '+1', { color: '#ffd76a', size: 15 });
          this.hooks.haptic(8);
        } else {
          audio.play('key');
          this.fx.burst(it.x, it.y - 0.2, { n: 10, color: it.color ? '#ffc94a' : '#56a8ff', speed: 2, life: 0.6 });
          this.fx.label(it.x, it.y - 0.7, 'KEYCARD', { color: it.color ? '#ffc94a' : '#8cc4ff', size: 14 });
          this.hooks.haptic(8);
        }
        this.hooks.hud(this.hudState());
        break;
      }
      case 'door':
        audio.play('door');
        break;
      case 'noise':
        audio.play('creak');
        this.fx.shake(0.04);
        if (e.heard.length) setTimeout(() => audio.play('huh'), 380);
        break;
      case 'power':
        audio.play('power');
        this.fx.flash('0,0,0', 0.35);
        this.powerUpAt = e.until;
        break;
      case 'near':
        if (this.nearCount < 2 && this.playT - this.lastNearT > 3 && !this.fast) {
          this.nearCount++;
          this.lastNearT = this.playT;
          this.slowmo = 0.55;
          audio.play('near');
          this.hooks.haptic(10);
        }
        break;
      case 'caught':
        this.onCaught(e);
        return true;
      case 'escape':
        this.onEscape();
        return true;
    }
    return false;
  }

  onCaught(e) {
    this.playT = e.t;
    this.setState('caught');
    this.alarm = 1;
    this.fx.flash('255,60,70', 0.45);
    this.fx.shake(0.18);
    audio.setMood('silent');
    audio.play(e.by === 'laser' ? 'zap' : 'caught');
    if (e.by === 'laser') setTimeout(() => audio.play('caught'), 120);
    this.hooks.haptic([60, 50, 120]);
    this.hooks.hud(this.hudState());
  }

  onEscape() {
    const L = this.level;
    this.setState('escaped');
    this.outcome = this.successResult();
    this.hooks.won?.(this.outcome);
    this.exitAnim = 0;
    audio.setMood('result');
    audio.play('escape');
    this.fx.burst(L.exit.x, L.exit.y, { n: 36, kind: 'confetti', colors: ['#ffd76a', '#6fe3c1', '#f4eee2', '#ff6a4d'], speed: 3.5, life: 1.3, lift: 2, gravity: 4 });
    this.fx.ring(L.exit.x, L.exit.y, { color: '111,227,193', r1: 2.2, dur: 0.9, width: 0.08 });
    this.hooks.haptic([15, 40, 15]);
    this.hooks.hud(this.hudState());
  }

  showResult() {
    this.resultShown = true;
    const L = this.level, s = this.sim;
    if (this.state === 'escaped') {
      this.ghostPlan = null;
      this.fails = 0;
      this.hooks.result(this.outcome || this.successResult());
    } else {
      this.fails++;
      this.ghostPlan = this.plan;
      this.ghostCaughtT = this.state === 'caught' ? s.caught.t : null;
      const reason = this.state === 'stranded' ? 'stranded' : s.caught.by;
      this.hooks.result({ success: false, reason, level: L, fails: this.fails });
    }
  }

  successResult() {
    const L = this.level, s = this.sim;
    const time = s.endT;
    const coins = popcount(s.mask & L.coinMask);
    const stars = 1 + (coins === L.coinCount ? 1 : 0) + (time <= L.par + 1e-6 ? 1 : 0);
    return { success: true, time, coins, coinTotal: L.coinCount, stars, par: L.par, level: L, plan: this.plan };
  }

  // ------------------------------------------------------------------ HUD model
  hudState() {
    const L = this.level;
    let mask = 0, time = null, projected = false;
    if (this.state === 'drawing' && this.sim) {
      mask = this.sim.mask; time = this.drawer.plan.end; projected = true;
      if (this.sim.status === 'escaped') time = this.sim.endT;
    } else if (this.sim && ['running', 'rewind', 'caught', 'escaped', 'stranded'].includes(this.state)) {
      const f = frameAt(this.sim.frames, Math.min(this.playT, this.sim.t)).a;
      mask = f.m;
      time = this.state === 'escaped' ? this.sim.endT : this.playT;
    }
    return {
      state: this.state,
      projected,
      loot: (mask & L.lootMask) === L.lootMask,
      lootGot: popcount(mask & L.lootMask),
      lootTotal: popcount(L.lootMask),
      coins: popcount(mask & L.coinMask),
      coinTotal: L.coinCount,
      par: L.par,
      time,
      fast: this.fast && this.state === 'running',
      danger: projected && this.sim.status === 'caught',
    };
  }

  // ------------------------------------------------------------------ render
  render() {
    const L = this.level;
    if (!L) return;
    const scene = { time: this.time, fx: this.fx };
    const st = this.state;
    const thief = { x: L.start.x, y: L.start.y, facing: this.facing, moving: false, walk: this.walk, time: this.time, bag: 0 };
    if (st === 'intro' || st === 'idle' || st === 'drawing') {
      const t = st === 'drawing' ? this.viewT : this.idleT;
      scene.worldT = t;
      scene.frame = this.frameFor(t);
      if (st === 'intro') {
        const u = clamp(this.stateT / 0.55, 0, 1);
        thief.scale = 1 + (1 - u) * (1 - u) * 1.6;
        thief.alpha = clamp(this.stateT / 0.2, 0, 1);
        thief.y -= (1 - u) * (1 - u) * 1.2;
      }
      if (st !== 'drawing') {
        scene.ghostPlan = this.ghostPlan;
        scene.ghostCaughtT = this.ghostCaughtT;
        if (L.def.demo && !this.hasDrawn && st === 'idle') scene.demo = { pts: L.def.demo, t: this.stateT };
      }
    }
    if (st === 'drawing') {
      const dr = this.drawer, plan = dr.plan, s = this.sim;
      scene.plan = plan;
      scene.planning = true;
      scene.events = s.events;
      scene.doorTimes = this.doorTimes(s);
      scene.powerUntil = (s.events.find((e) => e.type === 'power') || {}).until;
      const caughtT = s.caught ? s.caught.t : null;
      scene.planStyle = { caughtT, locks: dr.lockEvents, showCaughtMark: caughtT != null };
      const hx = plan.xs[plan.n - 1], hy = plan.ys[plan.n - 1];
      const i = plan.n - 1;
      let face = this.facing;
      if (i > 0) {
        const k = Math.max(0, i - 3);
        if (dist(plan.xs[k], plan.ys[k], hx, hy) > 0.05) face = Math.atan2(hy - plan.ys[k], hx - plan.xs[k]);
      }
      if (plan.n > 3) thief.facing = Math.atan2(plan.ys[3] - plan.ys[0], plan.xs[3] - plan.xs[0]);
      scene.ghost = plan.length > 0.3 ? { x: hx, y: hy, facing: face, moving: false, walk: 0, time: this.time, bag: popcount(s.mask & L.lootMask), alpha: 0.62 } : null;
      scene.head = { x: hx, y: hy, danger: s.status === 'caught' };
      const esc = s.status === 'escaped';
      const waitNow = plan.waits[i];
      let sub = '';
      if (s.status === 'caught') sub = s.caught.by === 'laser' ? 'TRIPS A LASER' : s.caught.by === 'camera' ? 'ON CAMERA' : 'SPOTTED';
      else if (esc) sub = 'CLEAN EXIT — LIFT TO GO';
      else if (this.holding && waitNow > 0.05) sub = `WAITING ${waitNow.toFixed(1)}s`;
      else if ((s.mask & L.lootMask) === L.lootMask) sub = 'NOW GET OUT';
      const shown = esc ? s.endT : plan.end;
      scene.readout = {
        x: hx, y: hy,
        fingerX: this.finger ? this.finger[0] : undefined,
        fingerY: this.finger ? this.finger[1] : undefined,
        text: `${shown.toFixed(1)}s`,
        sub,
        danger: s.status === 'caught',
        good: esc,
      };
      scene.planMask = s.mask;
    }
    if (st === 'rewind') {
      scene.worldT = this.viewT;
      scene.frame = this.frameFor(this.viewT);
      scene.plan = this.plan;
      scene.planStyle = { caughtT: this.sim.caught ? this.sim.caught.t : null, locks: this.locks };
      scene.itemMask = 0;
      scene.planMask = 0;
    }
    if (['running', 'caught', 'escaped', 'stranded'].includes(st)) {
      const s = this.sim, plan = this.plan;
      const t = this.playT;
      scene.worldT = t;
      scene.frame = frameAt(s.frames, Math.min(t, s.t));
      scene.plan = plan;
      scene.events = s.events;
      scene.doorTimes = this.doorTimes(s);
      scene.planStyle = { progressT: t, locks: this.locks, caughtT: st === 'caught' ? s.caught.t : null, alpha: st === 'escaped' ? Math.max(0, 1 - this.stateT * 2) : 1 };
      scene.powerUntil = (s.events.find((e) => e.type === 'power') || {}).until;
      const A = scene.frame.a, B = scene.frame.b, f = scene.frame.f;
      thief.x = A.tx + (B.tx - A.tx) * f;
      thief.y = A.ty + (B.ty - A.ty) * f;
      const pa = plan.posAt(Math.max(0, t - 0.09)), pb = plan.posAt(t + 0.09);
      const moving = st === 'running' && dist(pa.x, pa.y, pb.x, pb.y) > 0.02;
      if (moving) this.facing = angLerp(this.facing, Math.atan2(pb.y - pa.y, pb.x - pa.x), 0.35);
      thief.facing = this.facing;
      thief.moving = moving;
      thief.walk = this.walk;
      thief.bag = popcount(A.m & L.lootMask);
      if (st === 'caught') scene.caught = s.caught;
      if (st === 'escaped') {
        const u = this.exitAnim;
        thief.scale = 1 - u * 0.6;
        thief.alpha = 1 - u;
        if (u >= 1) thief.visible = false;
      }
    }
    scene.thief = thief;
    scene.alarm = this.alarm;
    this.r.draw(scene);
  }

  doorTimes(s) {
    const out = {};
    for (const e of s.events) if (e.type === 'door') out[e.color] = e.t;
    return out;
  }

  frameFor(t) {
    const s = this.sim;
    if (s && t <= s.t + 1e-9) return frameAt(s.frames, t);
    // Beyond the planned future: the idle world is only a faithful stand-in while
    // the plan hasn't changed anything (no pickups, creaks, doors or blackout).
    if (s && s.events.some((e) => e.type !== 'near')) return frameAt(s.frames, s.t);
    this.idleSim.advanceTo(t + DT);
    return frameAt(this.idleSim.frames, t);
  }

  // Debug hook: freeze the planning view of a scripted plan at time t.
  debugView(points, t) {
    const L = this.level;
    this.drawer = new Drawer(L);
    this.drawer.plan = Plan.fromPoints(points);
    this.sim = new Sim(L, this.drawer.plan);
    this.sim.advanceTo(this.drawer.plan.end);
    this.setState('drawing');
    this.viewT = Math.min(t, this.drawer.plan.end);
    this.paused = true;
    const p = this.drawer.plan.posAt(this.viewT);
    // show the plan up to t only, like a thumb that has drawn that far
    const cut = this.drawer.plan.seek(this.viewT);
    this.drawer.plan.truncate(cut + 1);
    this.drawer.plan.xs.push(p.x); this.drawer.plan.ys.push(p.y); this.drawer.plan.waits.push(0);
    this.drawer.plan.arr.push(this.viewT); this.drawer.plan.len.push(this.drawer.plan.len[cut]);
    const [sx, sy] = this.r.toScreen(p.x, p.y);
    this.finger = [sx, sy];
    this.render();
  }

  // Test hook: run a scripted plan through the real game flow.
  runScripted(points) {
    const L = this.level;
    this.drawer = new Drawer(L);
    this.drawer.plan = Plan.fromPoints(points);
    this.sim = new Sim(L, this.drawer.plan);
    this.sim.advanceTo(this.drawer.plan.end);
    this.setState('drawing');
    this.commit();
  }
}
