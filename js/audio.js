// All sound is synthesised with Web Audio: no files to download.
// SFX are short one-shots; music is a small generative noir-jazz combo whose
// layers fade in and out with the game state.

const A4 = 440;
const mtof = (m) => A4 * Math.pow(2, (m - 69) / 12);

class Audio {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.musicVol = 0.55;
    this.mood = 'menu';
    this.started = false;
  }

  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      return false;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(c.destination);

    this.sfx = c.createGain();
    this.sfx.gain.value = this.sfxOn ? 0.8 : 0;
    this.sfx.connect(this.master);
    this.music = c.createGain();
    this.music.gain.value = this.musicOn ? this.musicVol : 0;
    this.music.connect(this.master);

    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(1.9, 2.6);
    const rv = c.createGain();
    rv.gain.value = 0.32;
    this.reverb.connect(rv).connect(this.master);

    this.noiseBuf = this.makeNoise(2);
    this.buses = {};
    for (const name of ['bass', 'drums', 'keys', 'vibes', 'hats']) {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this.music);
      this.buses[name] = g;
    }
    return true;
  }

  unlock() {
    if (!this.init()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.started) {
      this.started = true;
      // iOS needs a sound started inside the gesture
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      this.startMusic();
    }
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended' && this.started) this.ctx.resume(); }

  setSfx(on) {
    this.sfxOn = on;
    if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.02);
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.music) this.music.gain.setTargetAtTime(on ? this.musicVol : 0, this.ctx.currentTime, 0.2);
  }

  makeNoise(sec) {
    const c = this.ctx;
    const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  impulse(sec, decay) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  // ---------------------------------------------------------------- primitives
  env(g, t, a, peak, d, sustain = 0, r = 0.05) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (sustain > 0) {
      g.gain.setTargetAtTime(peak * 0.6, t + a, d * 0.5);
      g.gain.setTargetAtTime(0.0001, t + a + sustain, r);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
  }

  tone(opts) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = opts.t ?? c.currentTime;
    const o = c.createOscillator();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(opts.f, t);
    if (opts.f2) o.frequency.exponentialRampToValueAtTime(opts.f2, t + (opts.glide ?? opts.d ?? 0.2));
    if (opts.detune) o.detune.value = opts.detune;
    const g = c.createGain();
    this.env(g, t, opts.a ?? 0.005, opts.v ?? 0.3, opts.d ?? 0.2, opts.hold ?? 0, opts.r ?? 0.05);
    let node = o;
    if (opts.filter) {
      const fl = c.createBiquadFilter();
      fl.type = opts.filter.type || 'lowpass';
      fl.frequency.setValueAtTime(opts.filter.f, t);
      if (opts.filter.f2) fl.frequency.exponentialRampToValueAtTime(opts.filter.f2, t + (opts.d ?? 0.2));
      fl.Q.value = opts.filter.q ?? 1;
      node.connect(fl);
      node = fl;
    }
    node.connect(g);
    g.connect(opts.bus || this.sfx);
    if (opts.verb) {
      const s = c.createGain(); s.gain.value = opts.verb; g.connect(s).connect(this.reverb);
    }
    o.start(t);
    o.stop(t + (opts.a ?? 0.005) + (opts.d ?? 0.2) + (opts.hold ?? 0) + 0.3);
  }

  noise(opts) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = opts.t ?? c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const fl = c.createBiquadFilter();
    fl.type = opts.ftype || 'bandpass';
    fl.frequency.setValueAtTime(opts.f || 2000, t);
    if (opts.f2) fl.frequency.exponentialRampToValueAtTime(opts.f2, t + (opts.d ?? 0.2));
    fl.Q.value = opts.q ?? 1;
    const g = c.createGain();
    this.env(g, t, opts.a ?? 0.003, opts.v ?? 0.2, opts.d ?? 0.1, opts.hold ?? 0, opts.r ?? 0.05);
    s.connect(fl).connect(g).connect(opts.bus || this.sfx);
    if (opts.verb) { const v = c.createGain(); v.gain.value = opts.verb; g.connect(v).connect(this.reverb); }
    s.start(t, Math.random() * 1.5);
    s.stop(t + (opts.a ?? 0.003) + (opts.d ?? 0.1) + (opts.hold ?? 0) + 0.3);
  }

  // Soft FM bell used for keys, coins and vibes.
  bell(f, t, v = 0.2, d = 1.2, bus, ratio = 3.5, idx = 1.2) {
    if (!this.ctx) return;
    const c = this.ctx;
    const car = c.createOscillator();
    const mod = c.createOscillator();
    const mg = c.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * ratio;
    mg.gain.setValueAtTime(f * idx, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + d * 0.6);
    mod.connect(mg).connect(car.frequency);
    const g = c.createGain();
    this.env(g, t, 0.004, v, d);
    car.connect(g).connect(bus || this.sfx);
    const s = c.createGain(); s.gain.value = 0.35; g.connect(s).connect(this.reverb);
    car.start(t); mod.start(t);
    car.stop(t + d + 0.2); mod.stop(t + d + 0.2);
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  // ---------------------------------------------------------------- sound effects
  play(name, arg) {
    if (!this.ctx || !this.sfxOn) return;
    const fn = this['sfx_' + name];
    if (fn) fn.call(this, this.ctx.currentTime + 0.005, arg);
  }

  sfx_ui(t) {
    this.tone({ t, f: 1250, f2: 900, d: 0.06, v: 0.12, type: 'triangle' });
    this.noise({ t, f: 4500, q: 2, d: 0.02, v: 0.05 });
  }
  sfx_back(t) {
    this.tone({ t, f: 700, f2: 520, d: 0.08, v: 0.12, type: 'triangle' });
  }
  sfx_select(t) {
    this.tone({ t, f: 660, d: 0.08, v: 0.1, type: 'triangle' });
    this.tone({ t: t + 0.06, f: 990, d: 0.14, v: 0.1, type: 'triangle', verb: 0.3 });
  }
  sfx_locked(t) {
    this.tone({ t, f: 220, d: 0.1, v: 0.14, type: 'square', filter: { f: 900 } });
    this.tone({ t: t + 0.09, f: 180, d: 0.14, v: 0.12, type: 'square', filter: { f: 700 } });
  }
  sfx_penDown(t) {
    this.noise({ t, f: 1200, q: 0.8, d: 0.05, v: 0.12 });
    this.tone({ t, f: 330, f2: 660, d: 0.18, v: 0.08, type: 'sine', verb: 0.3 });
  }
  sfx_rewind(t) {
    this.tone({ t, f: 900, f2: 160, glide: 0.25, d: 0.28, v: 0.07, type: 'sawtooth', filter: { f: 2200, f2: 500, q: 3 } });
    this.noise({ t, f: 3000, f2: 600, d: 0.25, v: 0.07, q: 1.5 });
  }
  sfx_tick(t, strong) {
    this.noise({ t, f: strong ? 2600 : 3800, q: 6, d: strong ? 0.03 : 0.018, v: strong ? 0.12 : 0.06 });
  }
  sfx_erase(t) {
    this.noise({ t, f: 5000, f2: 2500, q: 1.2, d: 0.05, v: 0.05 });
  }
  sfx_wait(t) {
    this.tone({ t, f: 1560, d: 0.05, v: 0.06, type: 'sine' });
    this.noise({ t, f: 2400, q: 8, d: 0.025, v: 0.06 });
  }
  sfx_lock(t) {
    this.tone({ t, f: 520, f2: 780, d: 0.06, v: 0.08, type: 'square', filter: { f: 2000 } });
  }
  sfx_danger(t) {
    this.tone({ t, f: 110, d: 0.45, v: 0.18, type: 'sawtooth', filter: { f: 600, f2: 200 } });
    this.tone({ t, f: 116.5, d: 0.45, v: 0.14, type: 'sawtooth', filter: { f: 600, f2: 200 } });
    this.tone({ t, f: 1480, d: 0.18, v: 0.05, type: 'square', filter: { f: 2500 } });
  }
  sfx_safe(t) {
    this.tone({ t, f: 880, d: 0.1, v: 0.06, type: 'triangle' });
  }
  sfx_go(t) {
    this.noise({ t, f: 400, f2: 4000, q: 0.9, d: 0.32, v: 0.16 });
    this.tone({ t: t + 0.02, f: 180, f2: 90, d: 0.2, v: 0.2, type: 'sine' });
    this.tone({ t: t + 0.05, f: 1320, d: 0.12, v: 0.06, type: 'triangle', verb: 0.4 });
  }
  sfx_step(t, k) {
    this.noise({ t, f: k % 2 ? 220 : 180, q: 1.2, d: 0.05, v: 0.07, ftype: 'lowpass' });
  }
  sfx_coin(t) {
    this.tone({ t, f: 1318.5, d: 0.07, v: 0.1, type: 'square', filter: { f: 5000 } });
    this.tone({ t: t + 0.07, f: 1975.5, d: 0.28, v: 0.1, type: 'square', filter: { f: 6000 }, verb: 0.25 });
  }
  sfx_loot(t) {
    const notes = [72, 76, 79, 83, 88];
    notes.forEach((m, i) => this.bell(mtof(m), t + i * 0.055, 0.14, 1.1, null, 2, 0.8));
    this.noise({ t, f: 7000, q: 0.7, d: 0.6, v: 0.05, ftype: 'highpass', verb: 0.5 });
    this.tone({ t, f: 130.8, d: 0.4, v: 0.12, type: 'sine' });
  }
  sfx_key(t) {
    [0, 0.07, 0.13].forEach((dt, i) => this.bell(2200 + i * 380, t + dt, 0.07, 0.35, null, 1.41, 2.5));
  }
  sfx_door(t) {
    this.noise({ t, f: 300, f2: 1400, q: 1.4, d: 0.35, v: 0.12 });
    this.tone({ t: t + 0.33, f: 90, f2: 55, d: 0.15, v: 0.2, type: 'sine' });
    this.tone({ t, f: 1760, d: 0.08, v: 0.05, type: 'triangle' });
  }
  sfx_creak(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.linearRampToValueAtTime(210, t + 0.18);
    o.frequency.linearRampToValueAtTime(120, t + 0.42);
    const lfo = c.createOscillator();
    lfo.frequency.value = 38;
    const lg = c.createGain(); lg.gain.value = 30;
    lfo.connect(lg).connect(o.frequency);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 4;
    const g = c.createGain();
    this.env(g, t, 0.03, 0.22, 0.45);
    o.connect(bp).connect(g).connect(this.sfx);
    const v = c.createGain(); v.gain.value = 0.3; g.connect(v).connect(this.reverb);
    o.start(t); lfo.start(t); o.stop(t + 0.6); lfo.stop(t + 0.6);
  }
  sfx_huh(t) {
    this.tone({ t, f: 392, f2: 587, glide: 0.18, d: 0.22, v: 0.1, type: 'triangle', verb: 0.2 });
  }
  sfx_power(t) {
    this.tone({ t, f: 320, f2: 35, glide: 0.7, d: 0.75, v: 0.22, type: 'sawtooth', filter: { f: 1400, f2: 120 } });
    this.noise({ t, f: 120, d: 0.3, v: 0.1, ftype: 'lowpass' });
    this.tone({ t, f: 60, d: 0.5, v: 0.2, type: 'sine' });
  }
  sfx_powerUp(t) {
    this.tone({ t, f: 50, f2: 240, glide: 0.4, d: 0.45, v: 0.13, type: 'sawtooth', filter: { f: 300, f2: 1600 } });
    this.noise({ t: t + 0.35, f: 5000, q: 2, d: 0.06, v: 0.08 });
  }
  sfx_near(t) {
    this.tone({ t, f: 62, f2: 45, d: 0.16, v: 0.35, type: 'sine' });
    this.tone({ t: t + 0.2, f: 58, f2: 42, d: 0.2, v: 0.28, type: 'sine' });
  }
  sfx_caught(t) {
    // orchestral-ish stab + alarm bell
    [45, 52, 57, 60, 63].forEach((m) => this.tone({ t, f: mtof(m), d: 0.9, v: 0.09, type: 'sawtooth', filter: { f: 2500, f2: 500 }, verb: 0.4 }));
    this.noise({ t, f: 6000, q: 0.5, d: 0.8, v: 0.12, ftype: 'highpass', verb: 0.5 });
    this.tone({ t, f: 55, d: 0.8, v: 0.35, type: 'sine' });
    this.siren(t + 0.25, 2.2);
  }
  siren(t, dur) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 2.6;
    const lg = c.createGain(); lg.gain.value = 110;
    o.frequency.value = 770;
    lfo.connect(lg).connect(o.frequency);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.05);
    g.gain.setValueAtTime(0.07, t + dur - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.sfx);
    const v = c.createGain(); v.gain.value = 0.3; g.connect(v).connect(this.reverb);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
  }
  sfx_zap(t) {
    this.tone({ t, f: 2400, f2: 180, glide: 0.25, d: 0.3, v: 0.12, type: 'sawtooth', filter: { f: 5000 } });
  }
  sfx_escape(t) {
    // Cmaj9 rising electric piano + a bass note: the job's done
    const chord = [60, 64, 67, 71, 74];
    chord.forEach((m, i) => this.ep(mtof(m), t + i * 0.07, 0.12, 1.6, this.sfx));
    this.tone({ t, f: mtof(36), d: 1.2, v: 0.25, type: 'triangle' });
    this.noise({ t, f: 7000, q: 0.5, d: 1.0, v: 0.04, ftype: 'highpass', verb: 0.6 });
  }
  sfx_star(t, i = 0) {
    const base = [76, 79, 84][i] || 84;
    this.bell(mtof(base), t, 0.16, 0.9, null, 2, 0.9);
    this.bell(mtof(base + 12), t + 0.05, 0.06, 0.6, null, 2, 0.5);
  }
  sfx_starMiss(t) {
    this.tone({ t, f: 330, d: 0.12, v: 0.06, type: 'triangle' });
  }
  sfx_drop(t) {
    this.noise({ t, f: 900, f2: 300, q: 1, d: 0.2, v: 0.08 });
    this.tone({ t: t + 0.18, f: 150, f2: 70, d: 0.14, v: 0.2, type: 'sine' });
  }
  sfx_stranded(t) {
    this.tone({ t, f: 392, f2: 370, d: 0.3, v: 0.1, type: 'triangle' });
    this.tone({ t: t + 0.3, f: 330, f2: 311, d: 0.5, v: 0.1, type: 'triangle', verb: 0.3 });
  }

  // Electric-piano voice (FM, soft attack)
  ep(f, t, v, d, bus) {
    const c = this.ctx;
    const car = c.createOscillator();
    const mod = c.createOscillator();
    const mg = c.createGain();
    car.frequency.value = f;
    mod.frequency.value = f;
    mg.gain.setValueAtTime(f * 0.9, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.08, t + 0.5);
    mod.connect(mg).connect(car.frequency);
    const g = c.createGain();
    this.env(g, t, 0.008, v, d);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    car.connect(lp).connect(g).connect(bus);
    const s = c.createGain(); s.gain.value = 0.25; g.connect(s).connect(this.reverb);
    car.start(t); mod.start(t);
    car.stop(t + d + 0.1); mod.stop(t + d + 0.1);
  }

  // ---------------------------------------------------------------- music
  // Moods: menu, plan, run, result, silent
  setMood(mood) {
    this.mood = mood;
    if (!this.ctx) return;
    const levels = {
      menu:   { bass: 0.9, drums: 0.7, keys: 0.8, vibes: 0.8, hats: 0 },
      plan:   { bass: 0.75, drums: 0.35, keys: 0.45, vibes: 0.0, hats: 0 },
      run:    { bass: 1.0, drums: 0.9, keys: 0.7, vibes: 0.0, hats: 0.8 },
      result: { bass: 0.7, drums: 0.5, keys: 0.9, vibes: 0.9, hats: 0 },
      silent: { bass: 0, drums: 0, keys: 0, vibes: 0, hats: 0 },
    }[mood] || {};
    const t = this.ctx.currentTime;
    for (const [k, g] of Object.entries(this.buses)) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(levels[k] ?? 0, t, mood === 'silent' ? 0.08 : 0.6);
    }
  }

  startMusic() {
    if (this.timer) return;
    this.bpm = 88;
    this.step = 0;           // eighth-note counter
    this.nextT = this.ctx.currentTime + 0.1;
    this.bar = 0;
    this.melodySeed = 1;
    this.setMood(this.mood);
    this.timer = setInterval(() => this.schedule(), 30);
  }

  schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const beat = 60 / this.bpm;
    while (this.nextT < c.currentTime + 0.15) {
      const s = this.step % 8;       // eighth within bar
      const bar = Math.floor(this.step / 8) % 8;
      // swing: off-beats land late
      const t = this.nextT + (s % 2 ? beat * 0.16 : 0);
      this.playStep(t, s, bar, beat);
      this.nextT += beat / 2;
      this.step++;
    }
  }

  playStep(t, s, bar, beat) {
    // Am9 | Dm9 | Bm7b5 E7b9 | Am9 | Fmaj7 | Dm9 | Bm7b5 | E7b9
    const bassLines = [
      [33, 36, 40, 43], [38, 41, 45, 44], [35, 38, 40, 41], [45, 43, 40, 42],
      [41, 45, 48, 47], [38, 41, 43, 44], [35, 38, 41, 39], [40, 44, 47, 32],
    ];
    const chords = [
      [60, 64, 67, 71], [57, 60, 64, 65], [57, 62, 65, 68], [60, 64, 67, 71],
      [57, 60, 64, 69], [57, 60, 64, 65], [57, 62, 65, 69], [56, 59, 62, 65],
    ];
    const B = this.buses;
    if (s % 2 === 0) {
      const m = bassLines[bar][s / 2];
      this.pluck(mtof(m), t, beat * 0.9, B.bass);
    }
    // ride cymbal pattern: 1, 2, 2&, 3, 4, 4&
    if ([0, 2, 3, 4, 6, 7].includes(s)) {
      this.noise({ t, f: 7500, q: 0.6, d: s % 2 ? 0.08 : 0.16, v: s % 2 ? 0.035 : 0.05, ftype: 'highpass', bus: B.drums });
    }
    // brush swish on 2 and 4
    if (s === 2 || s === 6) this.noise({ t, a: 0.03, f: 2500, q: 0.5, d: 0.22, v: 0.06, bus: B.drums });
    // soft kick on 1
    if (s === 0) this.tone({ t, f: 70, f2: 45, d: 0.2, v: 0.22, type: 'sine', bus: B.drums });
    // hats while running: steady eighths, adds drive
    this.noise({ t, f: 9000, q: 1, d: 0.03, v: s % 2 ? 0.03 : 0.045, ftype: 'highpass', bus: B.hats });
    if (s === 3 || s === 7) this.tone({ t, f: 180, f2: 90, d: 0.08, v: 0.08, type: 'sine', bus: B.hats });
    // comping: anticipations on 2& and 4
    if (s === 3 || (s === 6 && bar % 2 === 1)) {
      chords[bar].forEach((m, i) => this.ep(mtof(m), t + i * 0.008, 0.035, beat * 1.3, B.keys));
    }
    // sparse vibraphone phrases
    if (bar % 2 === 0 && (s === 1 || s === 4 || s === 5)) {
      this.melodySeed = (this.melodySeed * 16807) % 2147483647;
      const r = this.melodySeed / 2147483647;
      if (r < 0.55) {
        const scale = [69, 72, 74, 76, 79, 81, 84];
        const m = scale[Math.floor(r / 0.55 * scale.length)];
        this.bell(mtof(m), t, 0.05, 1.4, B.vibes, 4, 0.35);
      }
    }
  }

  pluck(f, t, d, bus) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + d);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    const g2 = c.createGain(); g2.gain.value = 0.25;
    o.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(g).connect(bus);
    o.start(t); o2.start(t);
    o.stop(t + d + 0.05); o2.stop(t + d + 0.05);
  }
}

export const audio = new Audio();
