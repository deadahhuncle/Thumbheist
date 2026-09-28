// Boot, screen routing, menus and the glue between the game and the DOM.

import { CHAPTERS } from './levels.js';
import { parseLevel } from './level.js';
import { Game } from './game.js';
import { drawThumb, THEMES } from './render.js';
import { drawLoot } from './sprites.js';
import { audio } from './audio.js';
import { save } from './save.js';
import { drawBriefArt } from './brief-art.js';
import { MenuBackdrop, drawFingerprint } from './backdrop.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ------------------------------------------------------------------ data
const LEVELS = [];
CHAPTERS.forEach((ch, ci) => {
  ch.levels.forEach((def, li) => {
    const lv = parseLevel(def, { chapter: ci, index: li, theme: ch.theme });
    lv.global = LEVELS.length;
    LEVELS.push(lv);
  });
});
const byId = new Map(LEVELS.map((l) => [l.id, l]));
const TOTAL_STARS = LEVELS.length * 3;

const isDone = (lv) => !!save.level(lv.id)?.done;
const isUnlocked = (lv) => lv.global === 0 || isDone(LEVELS[lv.global - 1]) || isDone(lv);
const chapterUnlocked = (ci) => isUnlocked(LEVELS.find((l) => l.chapter === ci));
const starsOf = (lv) => save.level(lv.id)?.stars || 0;
const chapterStars = (ci) => LEVELS.filter((l) => l.chapter === ci).reduce((a, l) => a + starsOf(l), 0);
const totalStars = () => LEVELS.reduce((a, l) => a + starsOf(l), 0);
const nextLevel = () => LEVELS.find((l) => isUnlocked(l) && !isDone(l)) || LEVELS[LEVELS.length - 1];

function haul() {
  let v = 0;
  for (const l of LEVELS) {
    const r = save.level(l.id);
    if (r?.done) v += l.loot.value * 1000 + (r.coins || 0) * 5000;
  }
  return v;
}
export function money(v) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${v}`;
}

// ------------------------------------------------------------------ haptics
function haptic(p) {
  if (!save.setting('haptics')) return;
  try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* not supported */ }
}

// ------------------------------------------------------------------ screens
let current = null;
const backdrop = new MenuBackdrop($('#bg'));

function show(id) {
  if (current === id) return;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  current = id;
  const menu = id !== 'game';
  backdrop.active = menu;
  $('#bg').style.visibility = menu ? 'visible' : 'hidden';
  if (menu) audio.setMood('menu');
  if (id === 'title') renderTitle();
  if (id === 'cases') renderCases();
}

function renderTitle() {
  const nl = nextLevel();
  const any = LEVELS.some(isDone);
  $('#btn-play .btn-label').textContent = any ? 'Continue' : 'Start the job';
  $('#play-sub').textContent = `Case ${nl.chapter + 1} · ${nl.title}`;
  $('#haul').textContent = money(haul());
  $('#stars-total').textContent = `${totalStars()} / ${TOTAL_STARS}`;
}

function starGlyphs(n, size = 16) {
  return [0, 1, 2].map((i) => `<i class="s${i < n ? ' on' : ''}" style="width:${size}px;height:${size}px"></i>`).join('');
}

function renderCases() {
  const list = $('#case-list');
  list.innerHTML = '';
  $('#cases-stars').innerHTML = `★ ${totalStars()}/${TOTAL_STARS}`;
  CHAPTERS.forEach((ch, ci) => {
    const unlocked = chapterUnlocked(ci);
    const lvs = LEVELS.filter((l) => l.chapter === ci);
    const done = lvs.filter(isDone).length;
    const stars = chapterStars(ci);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'case' + (unlocked ? '' : ' locked');
    el.style.setProperty('--tilt', `${[-0.6, 0.5, -0.3, 0.7, -0.5][ci] || 0}deg`);
    const stamp = !unlocked ? 'Classified' : done === lvs.length ? (stars === lvs.length * 3 ? 'Flawless' : 'Closed') : '';
    el.innerHTML = `
      <div>
        <div class="case-num">Case ${String(ci + 1).padStart(2, '0')}</div>
        <div class="case-title">${unlocked ? ch.title : 'Sealed file'}</div>
        <p class="case-tag">${unlocked ? ch.tagline : `Close case ${String(ci).padStart(2, '0')} to open this file.`}</p>
        <div class="case-progress"><span>${done}/${lvs.length} jobs</span><span class="meter"><i style="width:${(done / lvs.length) * 100}%"></i></span><span>★ ${stars}</span></div>
      </div>
      <canvas class="case-thumb" width="192" height="280"></canvas>
      ${stamp ? `<span class="stamp-mini">${stamp}</span>` : ''}`;
    const cv = el.querySelector('canvas');
    drawThumb(cv, lvs[lvs.length - 1], !unlocked);
    el.addEventListener('click', () => {
      if (!unlocked) { audio.play('locked'); haptic(10); return; }
      audio.play('select');
      openJobs(ci);
    });
    list.appendChild(el);
  });
}

let jobsChapter = 0;
function openJobs(ci) {
  jobsChapter = ci;
  const ch = CHAPTERS[ci];
  $('#jobs-kicker').textContent = `Case ${String(ci + 1).padStart(2, '0')}`;
  $('#jobs-title').textContent = ch.title;
  $('#jobs-blurb').textContent = ch.blurb;
  $('#jobs-stars').textContent = `★ ${chapterStars(ci)}/${ch.levels.length * 3}`;
  const grid = $('#job-grid');
  grid.innerHTML = '';
  const nl = nextLevel();
  LEVELS.filter((l) => l.chapter === ci).forEach((lv) => {
    const unlocked = isUnlocked(lv);
    const rec = save.level(lv.id);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'job' + (unlocked ? '' : ' locked') + (lv === nl && !isDone(lv) ? ' next' : '');
    el.innerHTML = `
      <canvas class="job-thumb" width="200" height="320"></canvas>
      ${unlocked ? '' : '<div class="job-lock"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div>'}
      <div class="job-meta"><span class="job-id">${lv.id}</span><span class="job-name">${unlocked ? lv.title : 'Locked'}</span></div>
      <div class="job-stars">${starGlyphs(rec?.stars || 0, 15)}</div>
      <div class="job-best">${rec?.time != null ? `Best ${rec.time.toFixed(1)}s · par ${lv.par.toFixed(1)}s` : unlocked ? `Par ${lv.par.toFixed(1)}s` : '&nbsp;'}</div>`;
    drawThumb(el.querySelector('canvas'), lv, !unlocked);
    el.addEventListener('click', () => {
      if (!unlocked) { audio.play('locked'); haptic(10); return; }
      audio.play('select');
      startLevel(lv);
    });
    grid.appendChild(el);
  });
  show('jobs');
}

// ------------------------------------------------------------------ game
const hud = {
  id: $('#hud-id'), name: $('#hud-name'),
  loot: $('#chip-loot'), lootV: $('#chip-loot-v'),
  coins: $('#chip-coins'), coinsV: $('#chip-coins-v'),
  time: $('#chip-time'), timeV: $('#chip-time-v'),
  ff: $('#ff'), tip: $('#tip'),
};
let lastHud = {};
let tipText = null;
let tipTimer = 0;

const game = new Game($('#board'), {
  hud(h) {
    const set = (el, cls) => { el.classList.remove('ok', 'warn', 'bad'); if (cls) el.classList.add(cls); };
    const bump = (el, key, val) => {
      if (lastHud[key] !== undefined && lastHud[key] !== val && val) { el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 180); }
      lastHud[key] = val;
    };
    hud.lootV.textContent = h.lootTotal > 1 ? `${h.lootGot}/${h.lootTotal}` : h.loot ? '✓' : '—';
    set(hud.loot, h.loot ? 'ok' : null);
    bump(hud.loot, 'loot', h.lootGot);
    hud.coins.hidden = h.coinTotal === 0;
    hud.coinsV.textContent = `${h.coins}/${h.coinTotal}`;
    set(hud.coins, h.coins === h.coinTotal && h.coinTotal > 0 ? 'ok' : null);
    bump(hud.coins, 'coins', h.coins);
    if (h.time != null) {
      hud.timeV.textContent = `${h.time.toFixed(1)}/${h.par.toFixed(1)}`;
      set(hud.time, h.time > h.par + 1e-6 ? 'warn' : h.state === 'escaped' || (h.projected && h.loot) ? 'ok' : null);
    } else {
      hud.timeV.textContent = `par ${h.par.toFixed(1)}`;
      set(hud.time, null);
    }
    hud.ff.hidden = !h.fast;
  },
  tip(text, kind) {
    if (text === tipText) return;
    tipText = text;
    const el = hud.tip;
    el.classList.add('swap');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      el.textContent = text || '';
      el.className = 'tip' + (kind === 'danger' ? ' danger' : kind === 'ready' ? ' ready' : kind === 'hint' ? ' hint' : '');
    }, 140);
  },
  haptic,
  result: (r) => showResult(r),
});

let activeLevel = null;

function startLevel(lv, opts = {}) {
  activeLevel = lv;
  save.data.last = lv.id;
  save.write();
  closeSheets();
  show('game');
  hud.id.textContent = lv.id;
  hud.name.textContent = lv.title;
  lastHud = {};
  layout();
  game.load(lv);
  const intro = lv.def.intro;
  if (intro && !save.seen('intro:' + lv.id) && !opts.skipIntro) {
    game.pause(true);
    const kicker = lv.index === 0 && lv.chapter > 0 ? `Case ${String(lv.chapter + 1).padStart(2, '0')} · ${CHAPTERS[lv.chapter].title}` : intro.kicker;
    showBriefing({ ...intro, kicker }, () => { save.seen('intro:' + lv.id, true); game.pause(false); levelCard(lv); });
  } else {
    levelCard(lv);
  }
}

function levelCard(lv) {
  const el = $('#level-card');
  $('#lc-kicker').textContent = `Case ${lv.chapter + 1} · Job ${lv.index + 1}`;
  $('#lc-title').textContent = lv.title;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

let artRaf = 0;
function resultArt(kind, show) {
  const cv = $('#result-art');
  cancelAnimationFrame(artRaf);
  cv.hidden = !show;
  if (!show) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = 120 * dpr; cv.height = 96 * dpr;
  const ctx = cv.getContext('2d');
  const t0 = performance.now();
  const frame = (now) => {
    const t = (now - t0) / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const pop = Math.min(1, t / 0.35);
    const s = 70 * dpr * (0.5 + 0.5 * (1 - Math.pow(1 - pop, 3)));
    ctx.setTransform(s, 0, 0, s, 60 * dpr, 82 * dpr);
    drawLoot(ctx, kind, t, 0, 1);
    if (current === 'game' && !cv.hidden && !$('#sheet-result').hidden) artRaf = requestAnimationFrame(frame);
  };
  artRaf = requestAnimationFrame(frame);
}

function showBriefing(intro, done) {
  const el = $('#briefing');
  $('#brief-kicker').textContent = intro.kicker || 'New trick';
  $('#brief-h').textContent = intro.title;
  $('#brief-text').innerHTML = intro.text.map((p) => `<p>${p}</p>`).join('');
  drawBriefArt($('#brief-art'), intro.art);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  const go = $('#brief-go');
  go.textContent = intro.button || 'Got it';
  go.onclick = () => {
    audio.unlock();
    audio.play('select');
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 300);
    done();
  };
  setTimeout(() => go.focus({ preventScroll: true }), 350);
}

// ------------------------------------------------------------------ sheets
function openSheet(id) {
  const scrim = $('#scrim');
  $$('.sheet').forEach((s) => { if (s.id !== id) { s.classList.remove('show'); s.hidden = true; } });
  scrim.hidden = false;
  const sh = $('#' + id);
  sh.hidden = false;
  syncToggles();
  requestAnimationFrame(() => { scrim.classList.add('show'); sh.classList.add('show'); });
}

function closeSheets() {
  const scrim = $('#scrim');
  scrim.classList.remove('show');
  $$('.sheet').forEach((s) => s.classList.remove('show'));
  setTimeout(() => {
    if (!scrim.classList.contains('show')) {
      scrim.hidden = true;
      $$('.sheet').forEach((s) => { if (!s.classList.contains('show')) s.hidden = true; });
    }
  }, 420);
}

function syncToggles() {
  $$('.toggle').forEach((t) => t.classList.toggle('on', !!save.setting(t.dataset.setting)));
}

$$('.toggle').forEach((t) => t.addEventListener('click', () => {
  const k = t.dataset.setting;
  const v = !save.setting(k);
  save.setting(k, v);
  if (k === 'sfx') audio.setSfx(v);
  if (k === 'music') audio.setMusic(v);
  if (k === 'haptics' && v) haptic(15);
  syncToggles();
  audio.play('ui');
}));

$$('[data-close]').forEach((b) => b.addEventListener('click', () => { audio.play('back'); closeSheets(); }));
$('#scrim').addEventListener('click', () => {
  if ($('#sheet-result').classList.contains('show')) return;
  if ($('#sheet-pause').classList.contains('show')) { resumeGame(); return; }
  closeSheets();
});

function resumeGame() {
  audio.play('back');
  closeSheets();
  game.pause(false);
  audio.setMood(game.state === 'running' ? 'run' : 'plan');
}

$('#btn-pause').addEventListener('click', () => {
  audio.unlock();
  audio.play('ui');
  if (game.state === 'result') return;
  game.pause(true);
  audio.setMood('menu');
  $('#pause-brief').textContent = activeLevel ? `${activeLevel.id} · ${activeLevel.title}` : '';
  openSheet('sheet-pause');
});
$('#btn-resume').addEventListener('click', resumeGame);
$('#btn-restart').addEventListener('click', () => { audio.play('rewind'); closeSheets(); game.pause(false); game.retry(); });
$('#btn-tojobs').addEventListener('click', () => { audio.play('back'); closeSheets(); game.pause(false); openJobs(activeLevel.chapter); });

// results
const REASONS = {
  guard: ['Busted', 'A guard spotted you.'],
  camera: ['Busted', 'Caught on camera.'],
  laser: ['Busted', 'You tripped a laser.'],
  stranded: ['Stranded', 'The plan ended before you got out.'],
};

function showResult(r) {
  const lv = r.level;
  const stamp = $('#result-stamp');
  const note = $('#result-note');
  const slots = $$('#stars-row .star');
  const labels = [$('#star-l1'), $('#star-l2'), $('#star-l3')];
  slots.forEach((s) => s.classList.remove('on'));
  labels.forEach((l) => l.classList.remove('on'));
  stamp.classList.remove('thunk', 'bad');
  void stamp.offsetWidth;
  note.className = 'result-note';
  const next = LEVELS[lv.global + 1];
  if (r.success) {
    const improved = save.record(lv.id, { stars: r.stars, time: r.time, coins: r.coins });
    const caseEnd = !next || next.chapter !== lv.chapter;
    stamp.textContent = caseEnd ? 'Case closed' : r.stars === 3 ? 'Flawless' : 'Clean getaway';
    resultArt(lv.loot.kind, true);
    $('#result-loot').innerHTML = `You lifted <b>${lv.loot.name}</b><br>worth ${money(lv.loot.value * 1000)}${r.coins ? ` plus ${r.coins} coin${r.coins > 1 ? 's' : ''}` : ''}.`;
    labels[0].textContent = `Escaped · ${r.time.toFixed(1)}s`;
    labels[1].textContent = `Coins ${r.coins}/${r.coinTotal}`;
    labels[2].textContent = `Under par ${r.par.toFixed(1)}s`;
    const got = [true, r.coins === r.coinTotal, r.time <= r.par + 1e-6];
    got.forEach((g, i) => setTimeout(() => {
      if (g) { slots[i].classList.add('on'); labels[i].classList.add('on'); audio.play('star', i); haptic(10); }
      else audio.play('starMiss');
    }, 420 + i * 260));
    const bits = [];
    if (improved.newStars && !improved.first) bits.push('<span class="new">New best stars</span>');
    if (improved.newTime) bits.push('<span class="new">New best time</span>');
    if (!got[1] && !got[2]) bits.push('Grab every coin under par for three stars.');
    else if (!got[1]) bits.push('Some coins got away.');
    else if (!got[2]) bits.push(`Beat ${r.par.toFixed(1)}s for the last star.`);
    note.innerHTML = bits.join(' · ');
    const nextBtn = $('#btn-next');
    nextBtn.hidden = false;
    if (!next) nextBtn.textContent = 'The last word';
    else if (next.chapter !== lv.chapter) nextBtn.textContent = `Open case ${String(next.chapter + 1).padStart(2, '0')}`;
    else nextBtn.textContent = 'Next job';
    $('#btn-retry').textContent = 'Replay';
  } else {
    const fails = save.fail(lv.id);
    resultArt(null, false);
    const [title, text] = REASONS[r.reason] || REASONS.guard;
    stamp.textContent = title;
    stamp.classList.add('bad');
    $('#result-loot').textContent = text;
    labels.forEach((l, i) => (l.textContent = ['Escaped', 'All coins', 'Under par'][i]));
    if (fails >= 2 && lv.hint) { note.textContent = lv.hint; note.classList.add('hint'); }
    else note.textContent = 'Your last route stays on the floor as a guide.';
    $('#btn-next').hidden = true;
    $('#btn-retry').textContent = 'Try again';
  }
  stamp.classList.add('thunk');
  openSheet('sheet-result');
  // make the retry button the primary action on failure
  $('#btn-retry').classList.toggle('btn-primary', !r.success);
  audio.setMood(r.success ? 'result' : 'menu');
}

$('#btn-retry').addEventListener('click', () => {
  audio.play('rewind');
  closeSheets();
  game.retry();
});
$('#btn-next').addEventListener('click', () => {
  audio.play('select');
  const next = LEVELS[activeLevel.global + 1];
  if (!next) { closeSheets(); showEnding(); return; }
  startLevel(next);
});
$('#btn-result-jobs').addEventListener('click', () => { audio.play('back'); closeSheets(); openJobs(activeLevel.chapter); });

function showEnding() {
  const intro = {
    kicker: 'Case closed',
    title: 'The crown is yours',
    art: 'crown',
    text: [
      `Thirty jobs. One thumb. Total haul: <b>${money(haul())}</b>.`,
      `Stars collected: ${totalStars()} of ${TOTAL_STARS}. Every job can be replayed for a cleaner, faster line.`,
      'The city sleeps a little less soundly now. Take a bow.',
    ],
    button: 'Back to the hideout',
  };
  showBriefing(intro, () => show('title'));
}

// ------------------------------------------------------------------ menus
$('#btn-play').addEventListener('click', () => {
  audio.unlock();
  audio.play('select');
  const nl = nextLevel();
  const firstOfCase = nl.index === 0 && !isDone(nl) && nl.chapter > 0;
  if (firstOfCase && !save.seen('case:' + nl.chapter)) {
    save.seen('case:' + nl.chapter, true);
    openJobs(nl.chapter);
    return;
  }
  startLevel(nl);
});
$('#btn-cases').addEventListener('click', () => { audio.unlock(); audio.play('select'); show('cases'); });
$('#btn-settings').addEventListener('click', () => { audio.unlock(); audio.play('ui'); openSheet('sheet-settings'); });
$('#btn-credits').addEventListener('click', () => { audio.play('ui'); openSheet('sheet-credits'); });
$('#btn-howto').addEventListener('click', () => {
  audio.play('ui');
  closeSheets();
  showBriefing({
    kicker: 'How to play',
    title: 'One line, one lift',
    art: 'draw',
    text: [
      'Press on the thief and draw the whole route in a single stroke: grab the loot, then reach the exit.',
      'While your thumb is down, the world shows where everyone will be when the thief reaches your fingertip. Hold still to wait.',
      'Slide back along the line to undo. Lift your thumb and the plan runs. No second chances.',
    ],
  }, () => {});
});
$('#btn-reset').addEventListener('click', () => { audio.play('ui'); openSheet('sheet-confirm'); });
$('#btn-reset-yes').addEventListener('click', () => {
  save.reset();
  audio.play('back');
  closeSheets();
  renderTitle();
  show('title');
});
$$('[data-back]').forEach((b) => b.addEventListener('click', () => {
  audio.play('back');
  show(b.dataset.back);
}));

// ------------------------------------------------------------------ layout + loop
function layout() {
  const w = window.innerWidth, h = window.innerHeight;
  const hudEl = document.querySelector('.hud');
  const tipEl = document.querySelector('.tipbar');
  const top = hudEl.getBoundingClientRect().height + 4;
  const bottom = tipEl.getBoundingClientRect().height + 2;
  const side = 6;
  game.resize(w, h, { x: side, y: top, w: w - side * 2, h: h - top - bottom });
  backdrop.resize(w, h);
  $('#rotate').hidden = !(w > h && h < 500);
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 200));

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (current === 'game') {
    game.update(dt);
    game.render();
  } else {
    backdrop.frame(dt);
  }
  requestAnimationFrame(loop);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (current === 'game' && (game.state === 'drawing' || game.state === 'running') && !game.paused) {
      game.pause(true);
      $('#pause-brief').textContent = activeLevel ? `${activeLevel.id} · ${activeLevel.title}` : '';
      openSheet('sheet-pause');
    }
    audio.suspend();
  } else {
    audio.resume();
  }
});

document.addEventListener('pointerdown', () => audio.unlock(), { capture: true, passive: true });

// Desktop conveniences: Esc pauses/resumes, R restarts the job.
document.addEventListener('keydown', (e) => {
  if (current !== 'game' || e.repeat) return;
  const pauseOpen = !$('#sheet-pause').hidden;
  if (e.key === 'Escape') {
    if (pauseOpen) resumeGame();
    else if ($('#sheet-result').hidden && $('#briefing').hidden) $('#btn-pause').click();
  } else if ((e.key === 'r' || e.key === 'R') && game.state !== 'drawing' && $('#briefing').hidden) {
    audio.play('rewind');
    closeSheets();
    game.pause(false);
    game.retry();
  }
});
// iOS: stop double-tap zoom and pinch on the whole app
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// install affordances
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const h = $('#install-hint');
  h.hidden = false;
  h.innerHTML = '<button class="btn btn-ghost" id="btn-install" type="button">Install to home screen</button>';
  $('#btn-install').addEventListener('click', async () => {
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (err) { /* dismissed */ }
    deferredPrompt = null;
    h.hidden = true;
  });
});
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
if (!standalone && iOS && window.top === window.self) {
  const h = $('#install-hint');
  h.hidden = false;
  h.textContent = 'Tip: tap Share, then “Add to Home Screen” to play full-screen.';
}

if ('serviceWorker' in navigator && window.top === window.self && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  });
}

// ------------------------------------------------------------------ boot
audio.sfxOn = save.setting('sfx');
audio.musicOn = save.setting('music');
drawFingerprint($('#print'));
layout();
show('title');
requestAnimationFrame((t) => { last = t; loop(t); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); if (game.level) game.r.buildStatic(); });

// Deep link for testing: ?level=2-3  (or #level-2-3 inside sandboxed frames)
const deep = new URLSearchParams(location.search).get('level') || (location.hash.match(/^#level-(\d-\d)$/) || [])[1];
if (deep && byId.has(deep)) startLevel(byId.get(deep), { skipIntro: new URLSearchParams(location.search).has('nointro') });

// Test hooks
window.__oth = {
  game, LEVELS, save, audio, startLevel: (id, o) => startLevel(byId.get(id), o), show, openJobs,
};
