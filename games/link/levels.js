// 闯关模式的关卡：moves = 步数（每消一次算一步），colors = 几种颜色，
// goals = 目标（颜色编号 0 红 1 黄 2 绿 3 蓝 4 紫 5 橙：要消掉几个；ice：打碎几块冰；stone：打碎几块石头）。
export const LEVELS = [
  { moves: 15, colors: 4, goals: { 0: 12, 1: 12 } },
  { moves: 18, colors: 5, goals: { 3: 15, 2: 15, 0: 10 } },
  { moves: 20, colors: 5, goals: { ice: 10 } },
  { moves: 20, colors: 5, goals: { stone: 8 } },
  { moves: 18, colors: 5, goals: { 4: 20, ice: 8 } },
  { moves: 22, colors: 5, goals: { 0: 25, 3: 25 } },
  { moves: 20, colors: 5, goals: { stone: 10, 1: 15 } },
  { moves: 25, colors: 5, goals: { ice: 16, stone: 6 } },
  { moves: 22, colors: 5, goals: { 0: 12, 1: 12, 2: 12 } },
  { moves: 25, colors: 6, goals: { ice: 20, stone: 10, 0: 15 } },
];

// 第 10 关以后自动生成：步数越来越紧、目标越来越多
export function levelSpec(i) {
  if (i < LEVELS.length) return LEVELS[i];
  const k = i - LEVELS.length + 1;
  const colors = 6;
  const goals = {};
  const c1 = k % colors, c2 = (k * 2 + 1) % colors;
  goals[c1] = 18 + k * 2;
  if (k % 2) goals[c2] = 12 + k;
  if (k % 3 !== 1) goals.ice = Math.min(30, 12 + k * 2);
  if (k % 3 !== 2) goals.stone = Math.min(16, 6 + k);
  return { moves: Math.max(18, 28 - Math.floor(k / 2)), colors, goals };
}
