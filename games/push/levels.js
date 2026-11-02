// 大力搬箱的关卡：手写的原创小关卡 + 随机生成（从“全部到位”的状态倒着拉箱子，保证有解）+ 求解器。
// 记号：# 墙   . 目标点   $ 箱子   * 箱子已在目标点上   @ 你   + 你站在目标点上   空格 地板

export const HANDMADE = [
  {
    name: '热身',
    map: [
      '#######',
      '#     #',
      '# @$ .#',
      '#     #',
      '#######',
    ],
  },
  {
    name: '两只箱子',
    map: [
      '######',
      '#    #',
      '#@$ .#',
      '# $ .#',
      '#    #',
      '######',
    ],
  },
  {
    name: '拐角',
    map: [
      '######',
      '#.   #',
      '#    #',
      '# #$ #',
      '#  @ #',
      '######',
    ],
  },
  {
    name: '中间的柱子',
    map: [
      '#######',
      '#.   .#',
      '# $#$ #',
      '#  @  #',
      '#     #',
      '#######',
    ],
  },
  {
    name: '窄道',
    map: [
      '#######',
      '#.    #',
      '### $ #',
      '#   $.#',
      '#  @  #',
      '#######',
    ],
  },
  {
    name: '三只箱子',
    map: [
      '#######',
      '#  .  #',
      '# $$$ #',
      '#. @ .#',
      '#     #',
      '#######',
    ],
  },
  {
    name: '绕一圈',
    map: [
      '#######',
      '#. #  #',
      '#  $  #',
      '# #$# #',
      '#  @ .#',
      '#######',
    ],
  },
];

// ---------- 解析 / 状态 ----------
export function parse(map, name = '') {
  const h = map.length, w = Math.max(...map.map((r) => r.length));
  const walls = new Set(), goals = [], boxes = [];
  let player = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = map[y][x] || ' ';
    const k = y * w + x;
    if (ch === '#') walls.add(k);
    if (ch === '.' || ch === '*' || ch === '+') goals.push(k);
    if (ch === '$' || ch === '*') boxes.push(k);
    if (ch === '@' || ch === '+') player = k;
  }
  return { name, w, h, walls, goals, boxes, player };
}

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export { DIRS };

// 走一步：返回新状态，或者 null（走不动）；pushed 表示有没有推箱子
export function step(level, st, dir) {
  const [dx, dy] = DIRS[dir];
  const { w, walls } = level;
  const px = st.player % w, py = Math.floor(st.player / w);
  const n = (py + dy) * w + (px + dx);
  if (walls.has(n)) return null;
  const bi = st.boxes.indexOf(n);
  if (bi < 0) return { player: n, boxes: st.boxes, pushed: -1 };
  const nn = (py + 2 * dy) * w + (px + 2 * dx);
  if (walls.has(nn) || st.boxes.includes(nn)) return null;
  const boxes = st.boxes.slice();
  boxes[bi] = nn;
  return { player: n, boxes, pushed: bi };
}
export const solved = (level, st) => st.boxes.every((b) => level.goals.includes(b));

// ---------- 求解器（广度优先，返回最少步数和走法；状态太多就放弃）----------
export function solve(level, limit = 400000) {
  const { w, h } = level;
  const keyOf = (st) => st.player + '|' + st.boxes.slice().sort((a, b) => a - b).join(',');
  const start = { player: level.player, boxes: level.boxes.slice() };
  if (solved(level, start)) return { steps: 0, path: [] };
  const seen = new Map([[keyOf(start), null]]);
  let frontier = [start];
  let depth = 0;
  // 死角剪枝：不在目标点上、而且两面贴墙的角落，箱子推进去就出不来
  const dead = new Set();
  for (let k = 0; k < w * h; k++) {
    if (level.walls.has(k) || level.goals.includes(k)) continue;
    const x = k % w, y = Math.floor(k / w);
    const wl = (xx, yy) => level.walls.has(yy * w + xx);
    if ((wl(x - 1, y) || wl(x + 1, y)) && (wl(x, y - 1) || wl(x, y + 1))) dead.add(k);
  }
  while (frontier.length && seen.size < limit) {
    depth++;
    const next = [];
    for (const st of frontier) {
      for (const dir of Object.keys(DIRS)) {
        const ns = step(level, st, dir);
        if (!ns) continue;
        if (ns.pushed >= 0 && dead.has(ns.boxes[ns.pushed])) continue;
        const k = keyOf(ns);
        if (seen.has(k)) continue;
        seen.set(k, { prev: keyOf(st), dir });
        if (solved(level, ns)) {
          const path = [];
          let cur = k;
          while (seen.get(cur)) { path.push(seen.get(cur).dir); cur = seen.get(cur).prev; }
          return { steps: depth, path: path.reverse() };
        }
        next.push(ns);
      }
    }
    frontier = next;
  }
  return null;
}

// ---------- 随机生成：从完成状态倒着“拉”箱子 ----------
// 倒着拉的每一步反过来都是一次合法的推，所以一定有解。最后用求解器挑出不太简单的关卡。
export function generate({ minSteps = 10, boxes = 2 } = {}) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const iw = 4 + Math.floor(Math.random() * 2), ih = 4 + Math.floor(Math.random() * 2);
    const w = iw + 2, h = ih + 2;
    const walls = new Set();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) walls.add(y * w + x);
    // 里面随机放 0~2 块墙
    const inner = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) inner.push(y * w + x);
    const nWalls = Math.floor(Math.random() * 3);
    for (let i = 0; i < nWalls; i++) walls.add(inner[Math.floor(Math.random() * inner.length)]);
    const floor = inner.filter((k) => !walls.has(k));
    if (floor.length < boxes * 2 + 4) continue;
    const pick = () => floor[Math.floor(Math.random() * floor.length)];
    const goals = [];
    while (goals.length < boxes) { const k = pick(); if (!goals.includes(k)) goals.push(k); }
    let player;
    do { player = pick(); } while (goals.includes(player));
    const level = { name: '随机关卡', w, h, walls, goals };
    let st = { player, boxes: goals.slice() };
    const dirs = Object.entries(DIRS);
    for (let s = 0; s < 220; s++) {
      const [, [dx, dy]] = dirs[Math.floor(Math.random() * 4)];
      const px = st.player % w, py = Math.floor(st.player / w);
      const to = (py + dy) * w + (px + dx);
      if (walls.has(to) || st.boxes.includes(to)) continue;
      const behind = (py - dy) * w + (px - dx);
      const bi = st.boxes.indexOf(behind);
      const boxesN = st.boxes.slice();
      // 身后有箱子时，有一半概率把它拉过来
      if (bi >= 0 && Math.random() < 0.6) boxesN[bi] = st.player;
      st = { player: to, boxes: boxesN };
    }
    if (st.boxes.some((b) => goals.includes(b))) continue;
    const lv = { ...level, boxes: st.boxes, player: st.player };
    const sol = solve(lv, 150000);
    if (sol && sol.steps >= minSteps) return { ...lv, best: sol.steps };
  }
  return null;
}
