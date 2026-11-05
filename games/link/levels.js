// 空中连线闯关：30 关，每关有固定种子（开局和每次掉下来的颜色都一样）。
// 这些关卡是电脑挑出来的：“聪明的”离线机器人每一关都实际通关过（所以一定有解），
// 而“随便连”的机器人经常会输（所以要动脑子）。步数 = 机器人用掉的步数 + 3 到 12 步余量。
// moves = 步数，colors = 颜色数，goals = 目标（颜色编号 0 红 1 黄 2 绿 3 蓝 4 紫 5 橙；ice 冰块；stone 石头），seed = 种子。
export const GOAL_WEIGHT = 1.2; // 还没完成的目标颜色掉下来的机会稍微多一点（离线测试用的也是这个数）

export const LEVELS = [
  { moves: 11, colors: 4, goals: { 0: 12, 1: 12 }, seed: 31676 },
  { moves: 15, colors: 5, goals: { 0: 10, 2: 15, 3: 15 }, seed: 55534 },
  { moves: 17, colors: 5, goals: { ice: 10 }, seed: 87311 },
  { moves: 16, colors: 5, goals: { stone: 8 }, seed: 47817 },
  { moves: 23, colors: 5, goals: { 4: 20, ice: 8 }, seed: 71675 },
  { moves: 22, colors: 5, goals: { 0: 25, 3: 25 }, seed: 95533 },
  { moves: 16, colors: 5, goals: { 1: 15, stone: 10 }, seed: 40201 },
  { moves: 26, colors: 5, goals: { ice: 16, stone: 6 }, seed: 40302 },
  { moves: 18, colors: 5, goals: { 0: 12, 1: 12, 2: 12 }, seed: 56241 },
  { moves: 35, colors: 6, goals: { 0: 15, ice: 20, stone: 10 }, seed: 16747 },
  { moves: 20, colors: 6, goals: { 1: 17, 3: 11, stone: 6 }, seed: 16848 },
  { moves: 28, colors: 6, goals: { 2: 18, ice: 11 }, seed: 9030 },
  { moves: 32, colors: 6, goals: { 1: 12, 3: 19, ice: 12, stone: 7 }, seed: 48726 },
  { moves: 20, colors: 6, goals: { 4: 20, stone: 7 }, seed: 56746 },
  { moves: 23, colors: 6, goals: { 5: 21, ice: 13 }, seed: 33090 },
  { moves: 30, colors: 6, goals: { 0: 22, ice: 13, stone: 8 }, seed: 56948 },
  { moves: 21, colors: 6, goals: { 1: 23, 3: 15, stone: 8 }, seed: 49130 },
  { moves: 30, colors: 6, goals: { 2: 23, ice: 14 }, seed: 88826 },
  { moves: 32, colors: 6, goals: { 1: 16, 3: 24, ice: 15, stone: 9 }, seed: 17656 },
  { moves: 20, colors: 6, goals: { 4: 25, stone: 9 }, seed: 25676 },
  { moves: 36, colors: 6, goals: { 5: 26, ice: 16 }, seed: 49534 },
  { moves: 28, colors: 6, goals: { 0: 27, ice: 16, stone: 10 }, seed: 10040 },
  { moves: 28, colors: 6, goals: { 1: 28, 3: 19, stone: 10 }, seed: 41817 },
  { moves: 30, colors: 6, goals: { 2: 29, ice: 17 }, seed: 33999 },
  { moves: 24, colors: 6, goals: { 1: 20, 3: 30, ice: 18, stone: 11 }, seed: 34100 },
  { moves: 28, colors: 6, goals: { 4: 30, stone: 11 }, seed: 57958 },
  { moves: 37, colors: 6, goals: { 5: 30, ice: 18 }, seed: 65978 },
  { moves: 33, colors: 6, goals: { 0: 30, ice: 18, stone: 11 }, seed: 34403 },
  { moves: 28, colors: 6, goals: { 1: 30, 3: 20, stone: 11 }, seed: 89937 },
  { moves: 23, colors: 6, goals: { 2: 30, ice: 18 }, seed: 10848 },
];
export const LEVEL_COUNT = LEVELS.length;
export const levelSpec = (i) => LEVELS[Math.min(i, LEVELS.length - 1)];
