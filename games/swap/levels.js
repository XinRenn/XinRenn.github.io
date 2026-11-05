// 星石三连的关卡：30 关，每关有固定种子（开局和每次掉下来的星石都一样）。
// 这些关卡是电脑挑出来的：“聪明的”离线机器人每一关都实际通关过（所以一定有解），
// 而“随便换”的机器人经常会输（所以要动脑子）。步数 = 机器人用掉的步数 + 3 到 12 步余量。
// moves = 步数，colors = 颜色数，ice = 冰块，goals = 目标（颜色编号：要消掉几颗；score：要拿多少分），seed = 种子。
export const GOAL_WEIGHT = 1.2; // 还没完成的目标颜色掉下来的机会稍微多一点（离线测试用的也是这个数）

export const LEVELS = [
  { moves: 15, colors: 5, goals: { 0: 15, 2: 15 }, seed: 48056 },
  { moves: 14, colors: 5, goals: { score: 1200 }, seed: 6138 },
  { moves: 18, colors: 5, ice: 10, goals: {}, seed: 12276 },
  { moves: 18, colors: 6, goals: { 1: 20, 3: 20, 5: 15 }, seed: 24421 },
  { moves: 20, colors: 6, ice: 16, goals: { 4: 15 }, seed: 6531 },
  { moves: 20, colors: 6, goals: { 0: 20, score: 1000 }, seed: 42704 },
  { moves: 24, colors: 6, ice: 20, goals: {}, seed: 60856 },
  { moves: 25, colors: 6, ice: 14, goals: { 2: 25, 3: 25 }, seed: 24945 },
  { moves: 21, colors: 6, goals: { 0: 25, 1: 25, 2: 25 }, seed: 19069 },
  { moves: 26, colors: 6, ice: 24, goals: { score: 1200 }, seed: 7186 },
  { moves: 22, colors: 6, goals: { 1: 19, 3: 16 }, seed: 13324 },
  { moves: 22, colors: 6, ice: 14, goals: { 2: 20 }, seed: 19462 },
  { moves: 22, colors: 6, ice: 15, goals: { 1: 18, 3: 21 }, seed: 7579 },
  { moves: 22, colors: 6, goals: { 4: 21 }, seed: 25731 },
  { moves: 22, colors: 6, ice: 16, goals: { 5: 19 }, seed: 7841 },
  { moves: 23, colors: 6, ice: 17, goals: { 0: 23 }, seed: 38007 },
  { moves: 22, colors: 6, goals: { 1: 24, 3: 21 }, seed: 50152 },
  { moves: 22, colors: 6, ice: 19, goals: { 2: 25 }, seed: 8234 },
  { moves: 24, colors: 6, ice: 20, goals: { 1: 23, 3: 26 }, seed: 20379 },
  { moves: 22, colors: 6, goals: { 4: 26 }, seed: 26517 },
  { moves: 22, colors: 6, ice: 21, goals: { 5: 24 }, seed: 44669 },
  { moves: 24, colors: 6, ice: 22, goals: { 0: 28 }, seed: 26779 },
  { moves: 22, colors: 6, goals: { 1: 28, 3: 25 }, seed: 38924 },
  { moves: 22, colors: 6, ice: 22, goals: { 2: 28 }, seed: 21034 },
  { moves: 22, colors: 6, ice: 22, goals: { 1: 25, 3: 28 }, seed: 33179 },
  { moves: 22, colors: 6, goals: { 4: 28 }, seed: 9282 },
  { moves: 22, colors: 6, ice: 22, goals: { 5: 25 }, seed: 39448 },
  { moves: 17, colors: 6, ice: 22, goals: { 0: 28 }, seed: 57600 },
  { moves: 22, colors: 6, goals: { 1: 28, 3: 25 }, seed: 9675 },
  { moves: 22, colors: 6, ice: 22, goals: { 2: 28 }, seed: 9806 },
];
export const LEVEL_COUNT = LEVELS.length;
export const levelSpec = (i) => LEVELS[Math.min(i, LEVELS.length - 1)];
