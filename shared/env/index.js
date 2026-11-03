// 背景场景管理：列表、按需加载、切换时释放旧场景、混合现实模式下隐藏。
// 每个场景模块导出 create()，返回 { group, lights, fog, update(dt), dispose() }。

export const ENVIRONMENTS = [
  { key: 'meadow', label: '草地森林', load: () => import('./meadow.js') },
  { key: 'underwater', label: '海底世界', load: () => import('./underwater.js') },
  { key: 'winter', label: '冬日雪地', load: () => import('./winter.js') },
  { key: 'harbor', label: '秋日港口', load: () => import('./harbor.js') },
  { key: 'fjord', label: '峡湾', load: () => import('./fjord.js') },
  { key: 'waterfall', label: '瀑布', load: () => import('./waterfall.js') },
  { key: 'japan', label: '日本街头', load: () => import('./japan.js') },
  { key: 'london', label: '雨中伦敦', load: () => import('./london.js') },
];

const STORE_KEY = 'pocketvr-env';

export function savedEnvKey() {
  try {
    const k = localStorage.getItem(STORE_KEY);
    if (ENVIRONMENTS.some((e) => e.key === k)) return k;
  } catch (_) { /* 读不到就用默认 */ }
  return 'meadow';
}

export function createEnvManager(scene, { onChange } = {}) {
  let current = null;
  let currentKey = null;
  let ar = false;
  let token = 0;

  function apply() {
    if (!current) return;
    current.group.visible = !ar;
    scene.fog = ar ? null : current.fog || null;
  }

  async function set(key) {
    const def = ENVIRONMENTS.find((e) => e.key === key) || ENVIRONMENTS[0];
    const my = ++token;
    const mod = await def.load();
    if (my !== token) return; // 加载期间又切换了别的
    const env = mod.create();
    if (current) {
      current.group.removeFromParent(); // 游戏可能把背景挪到了别的父节点下
      scene.remove(...current.lights);
      current.dispose();
    }
    current = env;
    currentKey = def.key;
    scene.add(env.group, ...env.lights);
    apply();
    try { localStorage.setItem(STORE_KEY, def.key); } catch (_) { /* 无痕模式 */ }
    onChange?.(def);
  }

  function next(step = 1) {
    const i = ENVIRONMENTS.findIndex((e) => e.key === currentKey);
    return set(ENVIRONMENTS[(i + step + ENVIRONMENTS.length) % ENVIRONMENTS.length].key);
  }

  return {
    set, next,
    setAR(v) { ar = v; apply(); },
    update(dt) { if (current && !ar) current.update(dt); },
    get key() { return currentKey; },
    get label() { return ENVIRONMENTS.find((e) => e.key === currentKey)?.label || ''; },
    get current() { return current; },
  };
}
