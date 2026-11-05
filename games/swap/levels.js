// 星石三连的关卡：moves = 步数，colors = 几种颜色，goals = 目标（颜色编号：要消掉几颗；score：要拿多少分），ice = 冰块数（全部打碎）。
// 每一关都用离线机器人（只会随便挑一步能推进目标的走法）测过能过，见 README。
export const LEVELS = [
  { moves: 20, colors: 5, goals: { 0: 15, 2: 15 } },
  { moves: 20, colors: 5, goals: { score: 1200 } },
  { moves: 22, colors: 5, ice: 10, goals: {} },
  { moves: 22, colors: 6, goals: { 1: 20, 3: 20, 5: 15 } },
  { moves: 24, colors: 6, ice: 16, goals: { 4: 15 } },
  { moves: 24, colors: 6, goals: { score: 1000, 0: 20 } },
  { moves: 25, colors: 6, ice: 20, goals: {} },
  { moves: 27, colors: 6, ice: 14, goals: { 2: 25, 3: 25 } },
  { moves: 25, colors: 6, goals: { 0: 25, 1: 25, 2: 25 } },
  { moves: 30, colors: 6, ice: 24, goals: { score: 1200 } },
];

// 第 10 关以后自动生成，难度到一定程度就不再加
export function levelSpec(i) {
  if (i < LEVELS.length) return LEVELS[i];
  const k = i - LEVELS.length + 1;
  const t = Math.min(1, k / 12);
  const goals = {};
  goals[k % 6] = Math.round(18 + 10 * t);
  if (k % 2) goals[(k * 2 + 1) % 6] = Math.round(15 + 10 * t);
  return { moves: 28, colors: 6, ice: k % 3 !== 1 ? Math.round(12 + 10 * t) : 0, goals };
}
