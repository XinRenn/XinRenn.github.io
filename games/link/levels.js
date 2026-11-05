// 闯关模式的关卡：moves = 步数（每消一次算一步），colors = 几种颜色，
// goals = 目标（颜色编号 0 红 1 黄 2 绿 3 蓝 4 紫 5 橙：要消掉几个；ice：打碎几块冰；stone：打碎几块石头）。
// 掉下来补充的圆点里，还没完成的目标颜色出现得更多一些（权重；普通颜色是 1）
export const GOAL_WEIGHT = 1.6;

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

// 第 10 关以后自动生成：目标慢慢变多，但到一定程度就不再加（离线机器人测试过，普通玩法也能过）
export function levelSpec(i) {
  if (i < LEVELS.length) return LEVELS[i];
  const k = i - LEVELS.length + 1;
  const t = Math.min(1, k / 15);
  const colors = 6;
  const goals = {};
  const c1 = k % colors, c2 = (k * 2 + 1) % colors;
  goals[c1] = Math.round(16 + 14 * t);
  if (k % 2 && c2 !== c1) goals[c2] = Math.round(10 + 10 * t);
  if (k % 3 !== 1) goals.ice = Math.round(12 + 10 * t);
  if (k % 3 !== 2) goals.stone = Math.round(6 + 6 * t);
  return { moves: Object.keys(goals).length >= 4 ? 31 : 26, colors, goals };
}
