// 星石三连的规则（不含画面）：交换相邻两颗星石，横着或竖着连成 3 颗以上同色就消掉。
// 游戏和离线测试机器人共用这一份代码，保证测出来的通关率就是游戏里的。
//
// 坐标：grid[c][r]，c = 列（左→右），r = 行（下→上，0 是最下面一行）。
// 特殊星石：4 连 → 横扫/竖扫（消掉一整行/一整列）；L 形或 T 形 → 炸弹（消掉周围 3×3）；5 连 → 彩虹（和谁换就消掉全场那个颜色）。

export const RAINBOW = -1;

export function createState({ cols = 8, rows = 8, nColors = 6, goals = {}, moves = Infinity, ice = 0, rand = Math.random, goalWeight = 1.5 } = {}) {
  const s = { cols, rows, nColors, goals: { ...goals }, moves, score: 0, rand, goalWeight, grid: [], ice: [], lastSwap: null, cascade: 0 };
  s.grid = Array.from({ length: cols }, () => Array(rows).fill(null));
  s.ice = Array.from({ length: cols }, () => Array(rows).fill(false));
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    let col;
    do { col = randColor(s); } while (makesRun(s, c, r, col));
    s.grid[c][r] = { color: col, special: null };
  }
  // 冰块铺在下半部分
  const spots = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < Math.ceil(rows * 0.6); r++) spots.push([c, r]);
  spots.sort(() => rand() - 0.5);
  for (const [c, r] of spots.slice(0, ice)) s.ice[c][r] = true;
  if (ice) s.goals.ice = ice;
  if (!hasMove(s)) reshuffle(s);
  return s;
}

// 掉下来的新星石：还没完成的目标颜色出现得多一些
export function randColor(s) {
  const w = [];
  for (let i = 0; i < s.nColors; i++) w.push(s.goals[i] > 0 ? s.goalWeight : 1);
  let t = s.rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < s.nColors; i++) { t -= w[i]; if (t < 0) return i; }
  return s.nColors - 1;
}

function makesRun(s, c, r, col) {
  const g = s.grid;
  if (c >= 2 && g[c - 1][r]?.color === col && g[c - 2][r]?.color === col) return true;
  if (r >= 2 && g[c][r - 1]?.color === col && g[c][r - 2]?.color === col) return true;
  return false;
}

export const inside = (s, c, r) => c >= 0 && r >= 0 && c < s.cols && r < s.rows;
export const adjacent = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

// 找出所有 3 连以上：返回 [{cells:[[c,r]...], dir:'h'|'v', color}]
export function findRuns(s) {
  const runs = [];
  const g = s.grid;
  for (let r = 0; r < s.rows; r++) {
    let c = 0;
    while (c < s.cols) {
      const col = g[c][r]?.color;
      let e = c + 1;
      if (col !== undefined && col !== RAINBOW) while (e < s.cols && g[e][r]?.color === col) e++;
      if (col !== undefined && col !== RAINBOW && e - c >= 3) runs.push({ dir: 'h', color: col, cells: Array.from({ length: e - c }, (_, i) => [c + i, r]) });
      c = e;
    }
  }
  for (let c = 0; c < s.cols; c++) {
    let r = 0;
    while (r < s.rows) {
      const col = g[c][r]?.color;
      let e = r + 1;
      if (col !== undefined && col !== RAINBOW) while (e < s.rows && g[c][e]?.color === col) e++;
      if (col !== undefined && col !== RAINBOW && e - r >= 3) runs.push({ dir: 'v', color: col, cells: Array.from({ length: e - r }, (_, i) => [c, r + i]) });
      r = e;
    }
  }
  return runs;
}

function swapCells(s, a, b) {
  const t = s.grid[a[0]][a[1]];
  s.grid[a[0]][a[1]] = s.grid[b[0]][b[1]];
  s.grid[b[0]][b[1]] = t;
}

// 这一步换完会不会有东西消掉（不改盘面）
export function swapWorks(s, a, b) {
  const pa = s.grid[a[0]][a[1]], pb = s.grid[b[0]][b[1]];
  if (!pa || !pb) return false;
  if (pa.color === RAINBOW || pb.color === RAINBOW) return true;
  swapCells(s, a, b);
  const ok = findRuns(s).some((run) => run.cells.some(([c, r]) => (c === a[0] && r === a[1]) || (c === b[0] && r === b[1])));
  swapCells(s, a, b);
  return ok;
}
export function allSwaps(s) {
  const out = [];
  for (let c = 0; c < s.cols; c++) for (let r = 0; r < s.rows; r++) {
    if (c + 1 < s.cols && swapWorks(s, [c, r], [c + 1, r])) out.push([[c, r], [c + 1, r]]);
    if (r + 1 < s.rows && swapWorks(s, [c, r], [c, r + 1])) out.push([[c, r], [c, r + 1]]);
  }
  return out;
}
export const hasMove = (s) => allSwaps(s).length > 0;

// 没有能走的了：打乱普通星石的颜色（保证打乱后没有现成的 3 连、但有能走的）
export function reshuffle(s) {
  for (let guard = 0; guard < 200; guard++) {
    for (let c = 0; c < s.cols; c++) for (let r = 0; r < s.rows; r++) {
      const p = s.grid[c][r];
      if (p && !p.special) p.color = -99;
    }
    for (let c = 0; c < s.cols; c++) for (let r = 0; r < s.rows; r++) {
      const p = s.grid[c][r];
      if (!p || p.special) continue;
      let col, tries = 0;
      do { col = randColor(s); } while (makesRun(s, c, r, col) && ++tries < 20);
      p.color = col;
    }
    if (!findRuns(s).length && hasMove(s)) return;
  }
}

// 交换：返回 { ok, rainbow? }。换了消不掉 → ok:false（盘面不变）
export function trySwap(s, a, b) {
  if (!adjacent(a, b) || !inside(s, ...a) || !inside(s, ...b)) return { ok: false };
  const pa = s.grid[a[0]][a[1]], pb = s.grid[b[0]][b[1]];
  if (!pa || !pb) return { ok: false };
  if (!swapWorks(s, a, b)) return { ok: false };
  swapCells(s, a, b);
  s.lastSwap = [a, b];
  s.cascade = 0;
  if (s.moves !== Infinity) s.moves--;
  // 彩虹：和谁换就消掉全场那个颜色（两个彩虹 = 全场）
  if (pa.color === RAINBOW || pb.color === RAINBOW) {
    const other = pa.color === RAINBOW ? pb : pa;
    const rb = pa.color === RAINBOW ? b : a; // 彩虹现在的位置
    const set = new Set([rb[0] * 100 + rb[1]]);
    for (let c = 0; c < s.cols; c++) for (let r = 0; r < s.rows; r++) {
      const p = s.grid[c][r];
      if (p && (other.color === RAINBOW || p.color === other.color)) set.add(c * 100 + r);
    }
    s.pendingClear = set;
    return { ok: true, rainbow: true };
  }
  return { ok: true };
}

// 消一轮：找出所有连线（加上交换彩虹的结果），触发特殊星石的连锁，生成新的特殊星石。
// 返回 { cleared:[{c,r,color,special}], created:[{c,r,color,special}], ice:[[c,r]], gained } 或 null（没东西可消）
export function resolveStep(s) {
  const runs = findRuns(s);
  const clear = new Map(); // key → {c,r}
  const add = (c, r) => { if (inside(s, c, r) && s.grid[c][r]) clear.set(c * 100 + r, [c, r]); };
  if (s.pendingClear) { for (const k of s.pendingClear) add(Math.floor(k / 100), k % 100); s.pendingClear = null; }
  if (!runs.length && !clear.size) return null;
  for (const run of runs) for (const [c, r] of run.cells) add(c, r);

  // 新的特殊星石（放在刚换过的那颗上，否则放在这条线中间）
  const created = [];
  const swapped = (c, r) => s.lastSwap?.some(([x, y]) => x === c && y === r);
  const pivotOf = (cells) => cells.find(([c, r]) => swapped(c, r)) || cells[Math.floor(cells.length / 2)];
  const used = new Set();
  const cellKey = ([c, r]) => c * 100 + r;
  // 5 连 → 彩虹
  for (const run of runs) if (run.cells.length >= 5) {
    const p = pivotOf(run.cells);
    created.push({ c: p[0], r: p[1], color: RAINBOW, special: 'rainbow' });
    run.cells.forEach((x) => used.add(cellKey(x)));
  }
  // 横竖交叉（L / T）→ 炸弹
  const hs = runs.filter((x) => x.dir === 'h'), vs = runs.filter((x) => x.dir === 'v');
  for (const h of hs) for (const v of vs) {
    if (h.color !== v.color) continue;
    const x = h.cells.find((a) => v.cells.some((b) => a[0] === b[0] && a[1] === b[1]));
    if (!x || used.has(cellKey(x))) continue;
    created.push({ c: x[0], r: x[1], color: h.color, special: 'bomb' });
    h.cells.forEach((y) => used.add(cellKey(y)));
    v.cells.forEach((y) => used.add(cellKey(y)));
  }
  // 4 连 → 横扫 / 竖扫
  for (const run of runs) if (run.cells.length === 4 && !run.cells.some((x) => used.has(cellKey(x)))) {
    const p = pivotOf(run.cells);
    created.push({ c: p[0], r: p[1], color: run.color, special: run.dir === 'h' ? 'row' : 'col' });
    run.cells.forEach((x) => used.add(cellKey(x)));
  }

  // 被消掉的特殊星石发动效果（可以连锁）
  const queue = [...clear.values()];
  const fired = new Set();
  while (queue.length) {
    const [c, r] = queue.pop();
    const p = s.grid[c][r];
    if (!p?.special || fired.has(c * 100 + r)) continue;
    fired.add(c * 100 + r);
    const more = [];
    if (p.special === 'row') for (let x = 0; x < s.cols; x++) more.push([x, r]);
    if (p.special === 'col') for (let y = 0; y < s.rows; y++) more.push([c, y]);
    if (p.special === 'bomb') for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) more.push([c + dx, r + dy]);
    if (p.special === 'rainbow') {
      // 被炸到的彩虹：消掉场上最多的那个颜色
      const cnt = {};
      for (const col of s.grid) for (const q of col) if (q && q.color >= 0) cnt[q.color] = (cnt[q.color] || 0) + 1;
      const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      for (let x = 0; x < s.cols; x++) for (let y = 0; y < s.rows; y++) if (s.grid[x][y]?.color === Number(best)) more.push([x, y]);
    }
    for (const [x, y] of more) if (inside(s, x, y) && s.grid[x][y] && !clear.has(x * 100 + y)) { clear.set(x * 100 + y, [x, y]); queue.push([x, y]); }
  }

  // 新特殊星石的位置不消（变身）
  for (const cr of created) clear.delete(cr.c * 100 + cr.r);

  s.cascade++;
  const cleared = [], ice = [];
  for (const [c, r] of clear.values()) {
    const p = s.grid[c][r];
    cleared.push({ c, r, color: p.color, special: p.special });
    if (p.color >= 0 && s.goals[p.color] > 0) s.goals[p.color]--;
    if (s.ice[c][r]) { s.ice[c][r] = false; ice.push([c, r]); if (s.goals.ice > 0) s.goals.ice--; }
    s.grid[c][r] = null;
  }
  for (const cr of created) {
    const p = s.grid[cr.c][cr.r];
    // 变身的那颗本身也算消掉了一颗（目标、冰块都算）
    if (p && p.color >= 0 && s.goals[p.color] > 0) s.goals[p.color]--;
    if (s.ice[cr.c][cr.r]) { s.ice[cr.c][cr.r] = false; ice.push([cr.c, cr.r]); if (s.goals.ice > 0) s.goals.ice--; }
    s.grid[cr.c][cr.r] = { color: cr.color, special: cr.special };
  }
  const gained = (cleared.length + created.length) * 10 * s.cascade;
  s.score += gained;
  if (s.goals.score > 0) s.goals.score = Math.max(0, s.goals.score - gained);
  s.lastSwap = null;
  return { cleared, created, ice, gained };
}

// 往下掉、顶上补新的。返回 { falls:[{c, from, to}], spawns:[{c, r, color, above}] }
export function gravity(s) {
  const falls = [], spawns = [];
  for (let c = 0; c < s.cols; c++) {
    let w = 0;
    for (let r = 0; r < s.rows; r++) {
      const p = s.grid[c][r];
      if (!p) continue;
      if (r !== w) { s.grid[c][w] = p; s.grid[c][r] = null; falls.push({ c, from: r, to: w }); }
      w++;
    }
    let k = 0;
    for (let r = w; r < s.rows; r++) {
      const p = { color: randColor(s), special: null };
      s.grid[c][r] = p;
      spawns.push({ c, r, color: p.color, above: k++ });
    }
  }
  return { falls, spawns };
}

export const goalsDone = (s) => Object.values(s.goals).every((v) => v <= 0);

// 这一步换完，第一轮消掉的东西里有没有目标（目标颜色、冰块；只有分数目标时任何一步都算）
function swapProgresses(s, a, b) {
  const onlyScore = Object.keys(s.goals).every((k) => k === 'score' || s.goals[k] <= 0);
  if (onlyScore) return true;
  const t = clone(s);
  if (!trySwap(t, a, b).ok) return false;
  const st = resolveStep(t);
  if (!st) return false;
  return st.ice.length > 0 || [...st.cleared, ...st.created].some((x) => x.color >= 0 && s.goals[x.color] > 0);
}
// 闯关保底：盘面上至少要有一步能推进目标。没有的话，就悄悄改两三颗普通星石的颜色，摆出一步来。
// 返回改了颜色的格子（游戏里让它们闪一下）。
export function ensureProgress(s) {
  if (goalsDone(s)) return [];
  if (allSwaps(s).some(([a, b]) => swapProgresses(s, a, b))) return [];
  const colorGoals = Object.keys(s.goals).filter((k) => /^\d+$/.test(k) && s.goals[k] > 0).map(Number);
  const targets = [];
  for (let c = 0; c < s.cols; c++) for (let r = 0; r < s.rows; r++) if (s.goals.ice > 0 && s.ice[c][r]) targets.push([c, r]);
  if (!targets.length) for (let c = 0; c < s.cols; c++) for (let r = 0; r < s.rows; r++) targets.push([c, r]);
  const plain = (c, r) => inside(s, c, r) && s.grid[c][r] && !s.grid[c][r].special;
  for (let tries = 0; tries < 60; tries++) {
    const [c, r] = targets[Math.floor(s.rand() * targets.length)];
    const col = colorGoals.length ? colorGoals[Math.floor(s.rand() * colorGoals.length)] : Math.floor(s.rand() * s.nColors);
    // 横着摆：T、T+1 同色，T+2 上面（或下面）那颗同色 → 把它换下来就是 3 连
    const dx = s.rand() < 0.5 ? 1 : -1, dy = s.rand() < 0.5 ? 1 : -1;
    const A = [c + dx, r], B = [c + 2 * dx, r + dy], hole = [c + 2 * dx, r];
    if (![[c, r], A, B, hole].every(([x, y]) => plain(x, y))) continue;
    const old = [[c, r], A, B].map(([x, y]) => s.grid[x][y].color);
    s.grid[c][r].color = col; s.grid[A[0]][A[1]].color = col; s.grid[B[0]][B[1]].color = col;
    if (s.grid[hole[0]][hole[1]].color === col) s.grid[hole[0]][hole[1]].color = (col + 1) % s.nColors;
    if (findRuns(s).length) { // 不能一改就直接连上了
      [[c, r], A, B].forEach(([x, y], i) => (s.grid[x][y].color = old[i]));
      continue;
    }
    return [[c, r], A, B, hole];
  }
  return [];
}

// 一次交换的全部结果（离线测试用：交换 → 一直消到停）
export function playSwap(s, a, b) {
  const res = trySwap(s, a, b);
  if (!res.ok) return false;
  for (let i = 0; i < 50; i++) {
    const st = resolveStep(s);
    if (!st) break;
    gravity(s);
  }
  if (!hasMove(s)) reshuffle(s);
  ensureProgress(s);
  return true;
}

export function clone(s) {
  return { ...s, goals: { ...s.goals }, grid: s.grid.map((col) => col.map((p) => (p ? { ...p } : null))), ice: s.ice.map((col) => col.slice()), pendingClear: s.pendingClear ? new Set(s.pendingClear) : null };
}
