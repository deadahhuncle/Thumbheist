// Progress + settings persisted to localStorage. Every access is guarded: private
// modes and sandboxed frames can throw, and the game must still run without it.

const KEY = 'one-thumb-heist.v1';

const fresh = () => ({
  v: 1,
  levels: {},          // id -> { stars, time, coins, done }
  settings: { sfx: true, music: true, haptics: true },
  seen: {},            // tutorial / story flags
  attempts: {},        // id -> failed attempts since last success (for hints)
});

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const d = JSON.parse(raw);
    const f = fresh();
    return { ...f, ...d, settings: { ...f.settings, ...(d.settings || {}) }, seen: { ...(d.seen || {}) }, levels: { ...(d.levels || {}) }, attempts: { ...(d.attempts || {}) } };
  } catch (e) {
    return fresh();
  }
}

export const save = {
  data: read(),

  write() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* storage unavailable */ }
  },

  level(id) { return this.data.levels[id] || null; },

  // Returns what improved so the results screen can celebrate it.
  record(id, r) {
    const prev = this.data.levels[id];
    const next = {
      done: true,
      stars: Math.max(prev?.stars || 0, r.stars),
      time: prev?.time != null ? Math.min(prev.time, r.time) : r.time,
      coins: Math.max(prev?.coins || 0, r.coins),
    };
    this.data.levels[id] = next;
    this.data.attempts[id] = 0;
    this.write();
    return {
      first: !prev,
      newStars: next.stars > (prev?.stars || 0),
      newTime: prev?.time != null && r.time < prev.time - 0.001,
    };
  },

  fail(id) {
    this.data.attempts[id] = (this.data.attempts[id] || 0) + 1;
    this.write();
    return this.data.attempts[id];
  },

  setting(k, v) {
    if (v === undefined) return this.data.settings[k];
    this.data.settings[k] = v;
    this.write();
    return v;
  },

  seen(flag, set) {
    if (set) { this.data.seen[flag] = true; this.write(); }
    return !!this.data.seen[flag];
  },

  reset() {
    const settings = this.data.settings;
    this.data = fresh();
    this.data.settings = settings;
    this.write();
  },
};
