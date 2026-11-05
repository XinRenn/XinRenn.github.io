// 可以复现的随机数：同一个种子，每次掉下来的颜色顺序都一样（闯关的每一关都有固定的种子）。
// clone() 复制出一个“从现在这一刻继续”的副本，离线测试机器人用它往前试走。
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.clone = () => { const c = makeRng(0); c.setState(s); return c; };
  r.setState = (v) => { s = v >>> 0; };
  return r;
}
// 用这个随机数把数组打乱（Fisher–Yates，每次调用的次数固定）
export function shuffleWith(rand, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
