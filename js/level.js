// Parses the hand-authored ASCII level definitions into runtime level objects.
//
// Legend
//   .  floor            #  wall                B  prop (blocks movement + sight)
//      (space) outside the building — blocks everything
//   g  glass case/desk (blocks movement, not sight)
//   T  thief entry      E  exit                $  loot (required)
//   c  coin (bonus)     k  blue keycard        D  blue door
//   y  gold keycard     Y  gold door           ~  creaky floorboard (noise)
//   P  fuse box (cuts cameras + lasers for a few seconds)

import { DEG } from './geom.js';

export const W = 10;
export const H = 16;

export const FLOOR = 0, WALL = 1, PROP = 2, GLASS = 3, DOOR = 4, VOID = 5;

const KEY_COLORS = { k: 0, y: 1 };
const DOOR_COLORS = { D: 0, Y: 1 };

export function parseLevel(def, meta = {}) {
  const rows = def.map;
  if (rows.length !== H) throw new Error(`${def.id}: map needs ${H} rows, has ${rows.length}`);
  const kind = new Uint8Array(W * H);
  const doorColor = new Int8Array(W * H).fill(-1);
  const items = [];
  const noise = [];
  const doors = [];
  let start = null, exit = null, power = null;

  for (let y = 0; y < H; y++) {
    const row = rows[y];
    if (row.length !== W) throw new Error(`${def.id}: row ${y} needs ${W} cols, has ${row.length}: "${row}"`);
    for (let x = 0; x < W; x++) {
      const ch = row[x];
      const i = y * W + x;
      const cx = x + 0.5, cy = y + 0.5;
      switch (ch) {
        case '.': break;
        case '#': kind[i] = WALL; break;
        case ' ': kind[i] = VOID; break;
        case 'B': kind[i] = PROP; break;
        case 'g': kind[i] = GLASS; break;
        case 'T': start = { x: cx, y: cy }; break;
        case 'E': exit = { x: cx, y: cy }; break;
        case '$': items.push({ type: 'loot', x: cx, y: cy }); break;
        case 'c': items.push({ type: 'coin', x: cx, y: cy }); break;
        case 'k': case 'y': items.push({ type: 'key', color: KEY_COLORS[ch], x: cx, y: cy }); break;
        case 'D': case 'Y':
          kind[i] = DOOR; doorColor[i] = DOOR_COLORS[ch];
          doors.push({ x, y, color: DOOR_COLORS[ch] });
          break;
        case '~': noise.push({ x, y, cx, cy }); break;
        case 'P': power = { x, y, cx, cy, duration: def.powerDuration ?? 5 }; break;
        default: throw new Error(`${def.id}: unknown tile "${ch}" at ${x},${y}`);
      }
    }
  }
  if (!start) throw new Error(`${def.id}: no start (T)`);
  if (!exit) throw new Error(`${def.id}: no exit (E)`);
  items.forEach((it, idx) => { it.idx = idx; it.bit = 1 << idx; });

  const lootMask = items.reduce((m, it) => (it.type === 'loot' ? m | it.bit : m), 0);
  const coinMask = items.reduce((m, it) => (it.type === 'coin' ? m | it.bit : m), 0);
  if (!lootMask) throw new Error(`${def.id}: no loot ($)`);

  // Keys held -> which door colours are open. Colours are bits in a small mask.
  const keyColorOf = items.map((it) => (it.type === 'key' ? it.color : -1));
  const doorsOpenFor = (mask) => {
    let open = 0;
    for (let i = 0; i < items.length; i++) if (keyColorOf[i] >= 0 && mask & items[i].bit) open |= 1 << keyColorOf[i];
    return open;
  };

  const blockCache = new Map();
  function blockers(openDoors = 0) {
    let b = blockCache.get(openDoors);
    if (b) return b;
    const isDoorClosed = (i) => kind[i] === DOOR && !(openDoors & (1 << doorColor[i]));
    b = {
      move: (cx, cy) => {
        const i = cy * W + cx;
        const k = kind[i];
        return k === WALL || k === VOID || k === PROP || k === GLASS || (k === DOOR && isDoorClosed(i));
      },
      sight: (cx, cy) => {
        const i = cy * W + cx;
        const k = kind[i];
        return k === WALL || k === VOID || k === PROP || (k === DOOR && isDoorClosed(i));
      },
      // Guards never walk through doors, even open ones.
      guard: (cx, cy) => {
        const k = kind[cy * W + cx];
        return k !== FLOOR;
      },
    };
    blockCache.set(openDoors, b);
    return b;
  }

  const guards = (def.guards || []).map((g, gi) => {
    const wp = g.path.map(([c, r]) => ({ x: c + 0.5, y: r + 0.5 }));
    const n = wp.length;
    const waits = Array.from({ length: n }, (_, i) => (Array.isArray(g.wait) ? g.wait[i] ?? 0 : g.wait ?? 0));
    const looks = Array.from({ length: n }, (_, i) => (g.looks && g.looks[i] != null ? g.looks[i] * DEG : null));
    return {
      id: gi,
      wp,
      loop: !!g.loop,
      speed: g.speed ?? 1.4,
      range: g.range ?? 3.4,
      half: ((g.fov ?? 70) * DEG) / 2,
      turn: (g.turn ?? 300) * DEG,
      waits,
      looks,
      lookCycle: g.look ? g.look.map((a) => a * DEG) : null,
      lookTime: g.lookTime ?? 1.8,
      face: g.face != null ? g.face * DEG : null,
      offset: g.offset ?? 0,
      hear: g.hear ?? 4.5,
      deaf: !!g.deaf,
    };
  });

  const cameras = (def.cameras || []).map((c) => ({
    x: c.at[0], y: c.at[1],
    dir: c.dir * DEG,
    sweep: (c.sweep ?? 0) * DEG,
    period: c.period ?? 4,
    phase: c.phase ?? 0,
    range: c.range ?? 4.5,
    half: ((c.fov ?? 44) * DEG) / 2,
  }));

  const lasers = (def.lasers || []).map((l) => ({
    ax: l.a[0], ay: l.a[1], bx: l.b[0], by: l.b[1],
    on: l.on ?? 1, off: l.off ?? 0, phase: l.phase ?? 0,
  }));

  return {
    id: def.id,
    title: def.title,
    brief: def.brief || '',
    hint: def.hint || '',
    loot: def.loot || { name: 'The Goods', value: 100, kind: 'gem' },
    par: def.par ?? 30,
    tutorial: def.tutorial || null,
    theme: meta.theme || 'gallery',
    chapter: meta.chapter ?? 0,
    index: meta.index ?? 0,
    W, H, kind, doorColor, items, noise, doors, start, exit, power,
    guards, cameras, lasers, lootMask, coinMask,
    coinCount: items.filter((it) => it.type === 'coin').length,
    doorsOpenFor, blockers,
    def,
  };
}

export function cellKind(level, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return WALL;
  return level.kind[y * W + x];
}
