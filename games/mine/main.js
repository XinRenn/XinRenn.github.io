// 深井矿工（样品）：站在 3×3 的矿井正中间，挥镐往下挖。头顶不停掉石块，四周堆满就被埋住。
// 坐标：rig 放在你脚下（y=0 是真实地板）；world 是整口矿井，往下挖一层，world 就整体往上移一层，
// 所以你一直站在真实地板上，看起来却是一层一层掉下去。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio } from '../../shared/sfx.js';
import { createEnvManager, ENVIRONMENTS, savedEnvKey } from '../../shared/env/index.js';
import { createFeet } from '../../shared/feet.js';

// ================= 可调参数 =================
const C = 0.6;              // 每格（方块）边长，也是每层的高度（米）
const MAXH = 3;             // 每个石堆最多堆几块（3 块 = 1.8 米）
const BURY = 16;            // 四周一共堆了这么多块就算被埋住
const HEARTS = 3;
const SPAWN_START = 2.4;    // 一开始每隔几秒掉一块
const SPAWN_MIN = 0.6;      // 最快每隔几秒掉一块
const HANG = 0.55;          // 石块在头顶晃一下再掉（提前警告）
const G = 6.5;              // 石块下落的重力（比真实的小，留出反应时间）
const SWING = 1.3;          // 镐头速度超过这个（米/秒）才算砸到
const COOLDOWN = 0.2;       // 同一只手两次敲击的最小间隔（秒）
const HEAD_R = 0.33;        // 头离中心多近会被正上方的石块砸到
const SHED = 0.5;           // 往下掉一层时，四周石堆塌掉的比例

// ================= 场景 =================
const app = createXRApp({ onFrame });
const { scene, camera, renderer } = app;

const rig = new THREE.Group();     // 放在你脚下、朝你面对的方向
scene.add(rig);
const world = new THREE.Group();   // 整口矿井 + 地面背景，挖下去时往上移
rig.add(world);
const envHolder = new THREE.Group();
envHolder.position.y = -0.02;      // 背景的地面比方块顶面低一点点，不打架
world.add(envHolder);
const hud = new THREE.Group();     // 面板：固定在你面前的井壁上
rig.add(hud);

const envs = createEnvManager(scene, {
  onChange: (def) => {
    envButton?.userData.ui.setLabel(`背景：${def.label} ▶`);
    if (envSelect) envSelect.value = def.key;
    const env = envs.current;
    if (env) { envHolder.add(env.group); clearShaft(env.group); }
  },
});
envs.set(savedEnvKey());

// 矿井口附近的树、草、石头等批量物体藏起来
function clearShaft(group) {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (Math.abs(p.x) < 2.2 && Math.abs(p.z) < 2.2) o.setMatrixAt(i, zero);
    }
    o.instanceMatrix.needsUpdate = true;
  });
}

let isAR = false;
app.on('modechange', (mode) => {
  isAR = mode === 'ar';
  envs.setAR(isAR);
  overlay.classList.toggle('hidden', mode !== 'desktop' || desktopPreview);
  backLink.style.display = mode === 'desktop' ? '' : 'none';
  hint.style.display = mode === 'desktop' && desktopPreview ? 'block' : 'none';
  if (mode !== 'desktop') { placeAfter = 0.6; state = 'idle'; }
});

function loadPref(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } }
function savePref(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 无痕模式 */ } }

// 头灯 + 一点环境光（井底很暗）
const headLamp = new THREE.PointLight('#fff1d6', 2.2, 5, 1.2);
camera.add(headLamp);
const caveLight = new THREE.HemisphereLight('#c9d6ff', '#3a2a1c', 0.5);
scene.add(caveLight);

// ================= 贴图（全部代码画的）=================
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
function speckle(g, w, h, base, dots, n = 260, size = 5) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    g.fillStyle = dots[Math.floor(rnd() * dots.length)];
    const s = 2 + rnd() * size;
    g.fillRect(rnd() * w, rnd() * h, s, s);
  }
}
function blockEdge(g, w, h, dark) {
  g.strokeStyle = dark; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
}
function crystals(g, w, h, colors, n) {
  for (let i = 0; i < n; i++) {
    const x = 18 + rnd() * (w - 36), y = 18 + rnd() * (h - 36), r = 7 + rnd() * 9;
    g.fillStyle = colors[0];
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.7, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.7, y); g.closePath(); g.fill();
    g.fillStyle = colors[1];
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.7, y); g.lineTo(x, y); g.closePath(); g.fill();
  }
}
const TEX = {
  dirt: canvasTex(128, 128, (g, w, h) => { speckle(g, w, h, '#8a5a34', ['#6e4526', '#9c6a40', '#5b3a20', '#a77a4c']); blockEdge(g, w, h, 'rgba(50,28,12,0.6)'); }),
  stone: canvasTex(128, 128, (g, w, h) => { speckle(g, w, h, '#7f8288', ['#6a6d73', '#93969c', '#5c5f65'], 220, 8); blockEdge(g, w, h, 'rgba(30,32,36,0.6)'); }),
  hard: canvasTex(128, 128, (g, w, h) => {
    speckle(g, w, h, '#3e4456', ['#353a4a', '#4c5368', '#2b2f3c'], 220, 8);
    g.strokeStyle = 'rgba(160,175,210,0.35)'; g.lineWidth = 3;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(rnd() * w, rnd() * h); g.lineTo(rnd() * w, rnd() * h); g.stroke(); }
    blockEdge(g, w, h, 'rgba(10,12,20,0.7)');
  }),
  gem: canvasTex(128, 128, (g, w, h) => { speckle(g, w, h, '#7a7e86', ['#666a72', '#8c9098'], 200, 7); crystals(g, w, h, ['#3ee6ff', '#c8fbff'], 6); blockEdge(g, w, h, 'rgba(30,32,36,0.6)'); }),
  gold: canvasTex(128, 128, (g, w, h) => { speckle(g, w, h, '#7a7e86', ['#666a72', '#8c9098'], 200, 7); crystals(g, w, h, ['#ffc23a', '#fff1a8'], 7); blockEdge(g, w, h, 'rgba(30,32,36,0.6)'); }),
  tnt: canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c8322b'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 21) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 3, h); }
    g.fillStyle = '#f4efe2'; g.fillRect(0, h * 0.36, w, h * 0.28);
    g.fillStyle = '#1b1b1b'; g.font = `900 34px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('炸药', w / 2, h / 2 + 1);
    blockEdge(g, w, h, 'rgba(60,8,6,0.7)');
  }),
  rubble: canvasTex(128, 128, (g, w, h) => { speckle(g, w, h, '#86786a', ['#6f6356', '#9a8c7c', '#5d5247', '#a89a88'], 320, 10); blockEdge(g, w, h, 'rgba(40,32,26,0.6)'); }),
  wall: canvasTex(128, 128, (g, w, h) => {
    speckle(g, w, h, '#6a5644', ['#5a4838', '#7a6450', '#4c3c2e'], 300, 9);
    g.strokeStyle = 'rgba(30,22,16,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, h - 2); g.lineTo(w, h - 2); g.stroke();
  }, [3, 1]),
};
const crackTex = [1, 2, 3].map((stage) => canvasTex(128, 128, (g, w, h) => {
  g.strokeStyle = 'rgba(15,10,6,0.9)'; g.lineCap = 'round';
  seed = 77;
  for (let i = 0; i < stage * 3; i++) {
    let x = w / 2, y = h / 2, a = rnd() * Math.PI * 2;
    g.lineWidth = 5 - stage * 0.6;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 4 + stage; s++) { a += (rnd() - 0.5) * 1.2; x += Math.cos(a) * 12; y += Math.sin(a) * 12; g.lineTo(x, y); }
    g.stroke();
  }
}));

// 方块种类：hp = 要敲几下；pts = 塌掉时得几分
const TYPES = {
  dirt: { hp: 2, pts: 0, name: '泥土' },
  stone: { hp: 3, pts: 0, name: '石头' },
  hard: { hp: 5, pts: 0, name: '硬岩' },
  gem: { hp: 3, pts: 5, name: '宝石' },
  gold: { hp: 3, pts: 3, name: '金矿' },
  tnt: { hp: 1, pts: 0, name: '炸药' },
};
const MAT = {};
for (const k of [...Object.keys(TYPES), 'rubble']) {
  MAT[k] = new THREE.MeshStandardMaterial({ map: TEX[k], roughness: 0.9, metalness: k === 'gold' ? 0.2 : 0 });
  if (k === 'gem' || k === 'gold') { MAT[k].emissive = new THREE.Color(k === 'gem' ? '#0a5160' : '#5a3b00'); MAT[k].emissiveIntensity = 0.6; }
}

// 深度分区：越往下颜色越深、越硬
const ZONES = [
  { from: 0, name: '表土层', wall: '#ffffff', fog: '#2a2018' },
  { from: 8, name: '岩石层', wall: '#b9bcc4', fog: '#1c1e24' },
  { from: 20, name: '深岩层', wall: '#7f8aa8', fog: '#11131c' },
  { from: 35, name: '熔岩层', wall: '#ff9a7a', fog: '#2a0d06' },
];
const zoneOf = (d) => [...ZONES].reverse().find((z) => d >= z.from);

function pickType(d, k) {
  const r = Math.random();
  if (d >= 3 && k === 4 && r < 0.06) return 'tnt';
  const ore = Math.random();
  if (ore < 0.07 + Math.min(0.06, d * 0.002)) return d > 10 && Math.random() < 0.55 ? 'gem' : 'gold';
  if (d < 6) return r < 0.8 ? 'dirt' : 'stone';
  if (d < 18) return r < 0.3 ? 'dirt' : r < 0.9 ? 'stone' : 'hard';
  if (d < 35) return r < 0.6 ? 'stone' : 'hard';
  return r < 0.35 ? 'stone' : 'hard';
}

// ================= 矿井 =================
const shaft = new THREE.Group();
world.add(shaft);
const colX = (k) => ((k % 3) - 1) * C;
const colZ = (k) => (Math.floor(k / 3) - 1) * C;
const blockGeo = new THREE.BoxGeometry(C, C, C);
const rubbleGeo = new THREE.BoxGeometry(C * 0.96, C * 0.96, C * 0.96);

// 井壁：四面朝里的长条，从地面一直往下
const WALL_LEN = 400;
const wallMat = new THREE.MeshStandardMaterial({ map: TEX.wall, roughness: 0.95 });
TEX.wall.repeat.set(3, WALL_LEN / C);
// 左右两面墙往你身后多延伸 3 米：VR 里被后墙挡住看不见，电脑预览从背后看时不会露出天空
const wallMatSide = wallMat.clone();
wallMatSide.map = TEX.wall.clone();
wallMatSide.map.repeat.set((3 * C + 3) / C, WALL_LEN / C);
for (let s = 0; s < 4; s++) {
  const side = s % 2 === 1;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(side ? 3 * C + 3 : 3 * C, WALL_LEN), side ? wallMatSide : wallMat);
  const a = s * Math.PI / 2;
  m.position.set(-Math.sin(a) * 1.5 * C, -WALL_LEN / 2, side ? 1.5 : -Math.cos(a) * 1.5 * C);
  m.rotation.y = a;
  shaft.add(m);
}
// 井口一圈木框
{
  const wood = new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 0.8 });
  for (let s = 0; s < 4; s++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(3 * C + 0.3, 0.12, 0.15), wood);
    const a = s * Math.PI / 2;
    beam.position.set(-Math.sin(a) * (1.5 * C + 0.075), 0.04, -Math.cos(a) * (1.5 * C + 0.075));
    beam.rotation.y = a;
    shaft.add(beam);
  }
}

let depth = 0;          // 你站在第几层的顶上
let depthVis = 0;       // 动画用（平滑）
const layers = new Map(); // d → { types[9], meshes[9] }
const piles = Array.from({ length: 9 }, () => []); // 四周 8 个石堆（中间 4 号不用）
let centreHP = 0;
const crack = new THREE.Mesh(new THREE.PlaneGeometry(C * 0.98, C * 0.98), new THREE.MeshBasicMaterial({ map: crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
crack.rotation.x = -Math.PI / 2;
crack.visible = false;
shaft.add(crack);

function makeLayer(d) {
  if (layers.has(d)) return layers.get(d);
  const types = [], meshes = [];
  for (let k = 0; k < 9; k++) {
    const t = pickType(d, k);
    const m = new THREE.Mesh(blockGeo, MAT[t]);
    m.position.set(colX(k), -d * C - C / 2, colZ(k));
    m.userData = { layer: d, k };
    shaft.add(m);
    types.push(t); meshes.push(m);
  }
  const L = { types, meshes };
  layers.set(d, L);
  return L;
}
function ensureLayers() {
  for (const [d, L] of layers) if (d < depth) { L.meshes.forEach((m) => shaft.remove(m)); layers.delete(d); }
  for (let d = depth; d <= depth + 2; d++) makeLayer(d);
}
const centreType = () => layers.get(depth).types[4];
const centreMesh = () => layers.get(depth).meshes[4];

const floorTop = () => -depth * C;
const pileCount = () => piles.reduce((s, p) => s + p.length, 0);

function placePileBlock(k, m, j) {
  m.userData.ty = floorTop() + j * C + C / 2;
  m.userData.k = k;
  m.userData.pile = true;
}

// ================= 游戏状态 =================
let state = 'idle';    // idle | playing | over
let hearts = HEARTS;
let ore = 0, smashed = 0, elapsed = 0, spawnTimer = 3;
let best = Number(loadPref('mine-best', '0')) || 0;
let overReason = '';
let message = '', messageT = 0;
const rocks = [];      // 正在掉的石块
const effects = [];    // 碎屑、飘字
let fallAnim = null;
const score = () => depth * 10 + ore + smashed * 2;

function clearAll() {
  for (const [, L] of layers) L.meshes.forEach((m) => shaft.remove(m));
  layers.clear();
  for (const p of piles) { p.forEach((m) => shaft.remove(m)); p.length = 0; }
  for (const r of rocks) { shaft.remove(r.mesh, r.warn); }
  rocks.length = 0;
}
function newGame() {
  clearAll();
  depth = 0; depthVis = 0;
  hearts = HEARTS; ore = 0; smashed = 0; elapsed = 0; spawnTimer = 3;
  overReason = '';
  fallAnim = null;
  ensureLayers();
  resetCentre();
  state = 'playing';
  say('挥镐砸脚下正中间那块！');
  drawHud();
}
function resetCentre() {
  centreHP = TYPES[centreType()].hp;
  crack.visible = false;
  crack.position.set(0, floorTop() + 0.004, 0);
}
function say(t, s = 2.5) { message = t; messageT = s; drawHud(); }

function gameOver(reason) {
  if (state !== 'playing') return;
  state = 'over';
  overReason = reason;
  for (const r of rocks) { chips(r.mesh.position.clone(), MAT.rubble, 4); shaft.remove(r.mesh, r.warn); }
  rocks.length = 0;
  const s = score();
  const isBest = s > best;
  if (isBest) { best = s; savePref('mine-best', String(best)); }
  sfx.boom();
  app.pulseAll(1, 300);
  flash.material.color.set(reason === 'buried' ? '#2a1a0e' : '#7a0a0a');
  flash.material.opacity = 0.85;
  say(isBest ? '新纪录！' : '按 A / X 或点“重新开始”', 999);
}

// ================= 敲击 =================
function hitCentre(power = 1, c = null) {
  if (state !== 'playing' || fallAnim) return;
  const t = centreType();
  centreHP -= power;
  const hardIdx = { dirt: 0, stone: 1, hard: 2, gem: 1, gold: 1, tnt: 0 }[t];
  sfx.pick(hardIdx);
  if (c) app.pulse(c, 0.5 + hardIdx * 0.15, 40);
  chips(new THREE.Vector3(0, floorTop() + 0.02, 0), MAT[t], 6);
  if (centreHP <= 0) { breakLayer(c); return; }
  const frac = 1 - centreHP / TYPES[t].hp;
  crack.visible = true;
  crack.material.map = crackTex[Math.min(2, Math.floor(frac * 3))];
  crack.material.needsUpdate = true;
}

function breakLayer(c) {
  const L = layers.get(depth);
  const isTnt = L.types[4] === 'tnt';
  let gained = 0, gems = 0;
  L.types.forEach((t, k) => {
    gained += TYPES[t].pts;
    if (TYPES[t].pts) gems++;
    chips(L.meshes[k].position.clone().setY(floorTop() - 0.1), MAT[t], 5);
  });
  // 四周石堆塌掉一部分（炸药：全部炸飞）
  for (let k = 0; k < 9; k++) {
    const p = piles[k];
    const shed = isTnt ? p.length : Math.ceil(p.length * SHED - 0.01);
    for (let n = 0; n < shed; n++) {
      const m = p.shift();
      chips(m.position.clone(), MAT.rubble, 3);
      shaft.remove(m);
    }
  }
  let drop = 1;
  if (isTnt) {
    drop = 2;
    const L2 = makeLayer(depth + 1);
    L2.types.forEach((t) => { gained += TYPES[t].pts; if (TYPES[t].pts) gems++; });
    sfx.boom();
    app.pulseAll(1, 250);
    flash.material.color.set('#ffb347');
    flash.material.opacity = 0.6;
    say('轰！炸开两层，石堆全飞了');
  } else {
    sfx.crumble();
    if (c) app.pulse(c, 1, 120);
  }
  if (gained) {
    ore += gained;
    sfx.bonus();
    popup(`+${gained} ${gems > 1 ? '矿石 ×' + gems : '矿石'}`, new THREE.Vector3(0, floorTop() + 1.1, -0.45), '#ffd166');
  }
  depth += drop;
  ensureLayers();
  resetCentre();
  // 剩下的石堆跟着一起掉
  piles.forEach((p, k) => p.forEach((m, j) => placePileBlock(k, m, j)));
  for (const r of rocks) r.mesh.position.y -= drop * C; // 空中的石块也跟着一起往下
  fallAnim = { from: depthVis, to: depth, t: 0, dur: 0.28 + 0.08 * drop };
  sfx.whoosh();
  if (comfort) vignette.material.opacity = 0.9;
  const z = zoneOf(depth);
  if (zoneOf(depth - drop) !== z) say(`进入${z.name}！石头更硬了`);
  drawHud();
}

function hitPile(k, c = null) {
  const p = piles[k];
  if (!p.length || state !== 'playing') return;
  const m = p.pop();
  chips(m.position.clone(), MAT.rubble, 6);
  shaft.remove(m);
  sfx.smash();
  if (c) app.pulse(c, 0.6, 50);
  drawHud();
}

function hitRock(r, c = null) {
  const i = rocks.indexOf(r);
  if (i < 0) return;
  rocks.splice(i, 1);
  shaft.remove(r.mesh, r.warn);
  chips(r.mesh.position.clone(), MAT.rubble, 8);
  smashed++;
  sfx.smash();
  sfx.perfect(1);
  if (c) app.pulse(c, 0.8, 60);
  popup('+2 空中击碎', r.mesh.position.clone().add(new THREE.Vector3(0, 0.25, 0)), '#5cffb0');
  drawHud();
}

// ================= 掉石块 =================
const rockGeo = new THREE.DodecahedronGeometry(C * 0.42, 0);
const warnGeo = new THREE.RingGeometry(C * 0.3, C * 0.42, 32);
function spawnRock() {
  let k;
  const open = [0, 1, 2, 3, 5, 6, 7, 8].filter((n) => piles[n].length < MAXH);
  if (!open.length || Math.random() < 0.22) k = 4;
  else k = open[Math.floor(Math.random() * open.length)];
  const mesh = new THREE.Mesh(rockGeo, MAT.rubble);
  mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  const warn = new THREE.Mesh(warnGeo, new THREE.MeshBasicMaterial({ color: k === 4 ? '#ff3b3b' : '#ff9f43', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  warn.rotation.x = -Math.PI / 2;
  warn.renderOrder = 3;
  const y = floorTop() + 4.2;
  mesh.position.set(colX(k), y, colZ(k));
  shaft.add(mesh, warn);
  const r = { mesh, warn, k, vy: 0, hang: HANG, passedHead: false };
  rocks.push(r);
  if (k === 4) sfx.warn();
  return r;
}

function updateRocks(dt, headL) {
  for (let n = rocks.length - 1; n >= 0; n--) {
    const r = rocks[n];
    const k = r.k;
    const landY = k === 4 ? floorTop() : floorTop() + piles[k].length * C;
    r.warn.position.set(colX(k), landY + 0.012, colZ(k));
    r.warn.material.opacity = 0.5 + 0.45 * Math.sin(performance.now() / 70);
    if (r.hang > 0) {
      r.hang -= dt;
      r.mesh.position.x = colX(k) + Math.sin(performance.now() / 30) * 0.02;
      continue;
    }
    r.mesh.position.x = colX(k);
    r.vy -= G * dt;
    r.mesh.position.y += r.vy * dt;
    r.mesh.rotation.x += dt * 3;
    const bottom = r.mesh.position.y - C * 0.4;
    // 正上方的石块：砸到头就扣心，歪头躲开就落到地上碎掉
    if (k === 4 && !r.passedHead && bottom <= headL.y + 0.08) {
      r.passedHead = true;
      if (Math.hypot(headL.x, headL.z) < HEAD_R) {
        rocks.splice(n, 1);
        shaft.remove(r.mesh, r.warn);
        chips(r.mesh.position.clone(), MAT.rubble, 8);
        hearts--;
        sfx.thud(); sfx.fall();
        app.pulseAll(1, 200);
        flash.material.color.set('#c01818');
        flash.material.opacity = 0.65;
        if (hearts <= 0) gameOver('hit');
        else say(`被砸中了！还剩 ${hearts} 颗心`);
        drawHud();
        continue;
      }
      say('躲开了！');
    }
    if (bottom <= landY) {
      rocks.splice(n, 1);
      shaft.remove(r.warn);
      if (k === 4) {
        shaft.remove(r.mesh);
        chips(r.mesh.position.clone(), MAT.rubble, 6);
        sfx.smash();
        continue;
      }
      // 落在石堆上：变成一块方方正正的碎石
      shaft.remove(r.mesh);
      if (piles[k].length >= MAXH) continue;
      const b = new THREE.Mesh(rubbleGeo, MAT.rubble);
      b.position.set(colX(k), landY + C / 2, colZ(k));
      b.rotation.y = (Math.random() - 0.5) * 0.3;
      placePileBlock(k, b, piles[k].length);
      piles[k].push(b);
      shaft.add(b);
      sfx.thud();
      app.pulseAll(0.25, 40);
      if (pileCount() >= BURY) gameOver('buried');
      else if (pileCount() >= BURY - 4) say('快被埋住了！砸掉石堆或者往下挖');
      drawHud();
    }
  }
}

// ================= 碎屑 / 飘字 =================
const chipGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
function chips(pos, mat, n) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(chipGeo, mat);
    m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.15, (Math.random() - 0.5) * 0.3));
    const v = new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random() * 1.8, (Math.random() - 0.5) * 2);
    shaft.add(m);
    effects.push({ t: 0, life: 0.7, update(k, t, dt) { v.y -= 9 * dt; m.position.addScaledVector(v, dt); m.rotation.x += dt * 8; m.scale.setScalar(1 - k); }, done() { shaft.remove(m); } });
  }
}
function popup(text, pos, color) {
  const p = makeCanvasPlane(0.7, 0.16, 600);
  p.redraw((g, w, h) => {
    g.font = `800 ${Math.round(h * 0.62)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(text, w / 2, h / 2);
    g.fillStyle = color; g.fillText(text, w / 2, h / 2);
  });
  p.mesh.position.copy(pos);
  p.mesh.renderOrder = 20;
  shaft.add(p.mesh);
  effects.push({
    t: 0, life: 1.3,
    update(k, t, dt) { p.mesh.position.y += dt * 0.35; p.mesh.material.opacity = 1 - k * k; p.mesh.lookAt(camera.getWorldPosition(tmpV)); },
    done() { shaft.remove(p.mesh); p.tex.dispose(); p.mesh.material.dispose(); p.mesh.geometry.dispose(); },
  });
}

// ================= 镐子 =================
const TIP = new THREE.Vector3(0, -0.2, -0.4); // 镐尖在手柄坐标系里的位置
function makePickaxe() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#9b6a3c', roughness: 0.7 });
  const iron = new THREE.MeshStandardMaterial({ color: '#b8c0cc', roughness: 0.35, metalness: 0.7 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.46, 10), wood);
  handle.rotation.x = Math.PI / 2;
  handle.position.z = -0.17;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.05), iron);
  head.position.set(0, 0, -0.4);
  const pick = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.16, 8), iron);
  pick.rotation.x = Math.PI; // 尖朝下
  pick.position.set(0, -0.13, -0.4);
  const back = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.08, 8), iron);
  back.position.set(0, 0.09, -0.4);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 }));
  glow.position.copy(TIP);
  g.add(handle, head, pick, back, glow);
  g.userData.glow = glow;
  return g;
}
for (const c of app.controllers) {
  c.pick = makePickaxe();
  c.grip.add(c.pick);
  c.tip = new THREE.Vector3();
  c.prevTip = null;
  c.cool = 0;
}

const tmpV = new THREE.Vector3(), tmpHead = new THREE.Vector3();
function insideBox(p, cx, cy, cz, half) {
  return Math.abs(p.x - cx) < half && Math.abs(p.y - cy) < half && Math.abs(p.z - cz) < half;
}
function updatePicks(dt) {
  for (const c of app.controllers) {
    c.cool -= dt;
    const glow = c.pick.userData.glow;
    glow.material.opacity = Math.max(0, glow.material.opacity - dt * 4);
    if (!c.inputSource) { c.prevTip = null; continue; }
    const tipL = shaft.worldToLocal(c.grip.localToWorld(c.tip.copy(TIP)));
    const prev = c.prevTip;
    c.prevTip = tipL.clone();
    if (!prev || c.cool > 0 || state !== 'playing') continue;
    const speed = tipL.distanceTo(prev) / Math.max(dt, 1e-3);
    if (speed < SWING) continue;
    const hit = () => { c.cool = COOLDOWN; glow.material.opacity = 1; };
    // 1) 空中的石块
    const r = rocks.find((rk) => rk.mesh.position.distanceTo(tipL) < C * 0.55);
    if (r) { hitRock(r, c); hit(); continue; }
    // 2) 四周石堆最上面那块
    let done = false;
    for (let k = 0; k < 9 && !done; k++) {
      const p = piles[k];
      if (k === 4 || !p.length) continue;
      const top = p[p.length - 1];
      const y = top.userData.ty;
      if (insideBox(tipL, colX(k), y, colZ(k), C / 2 + 0.05) && !insideBox(prev, colX(k), y, colZ(k), C / 2 + 0.05)) {
        hitPile(k, c); hit(); done = true;
      }
    }
    if (done) continue;
    // 3) 脚下正中间那块：镐尖从上往下穿过它的顶面
    const top = floorTop() + 0.12;
    const half = C / 2 + 0.1;
    if (Math.abs(tipL.x) < half && Math.abs(tipL.z) < half && tipL.y < top && prev.y >= top && (prev.y - tipL.y) / dt > SWING * 0.7) {
      hitCentre(1, c); hit();
    }
  }
}

// ================= 面板 =================
const panel = makeCanvasPlane(0.92, 0.36, 900);
panel.mesh.position.set(0, 2.3, -0.7);
panel.mesh.rotation.x = 0.5; // 抬头看：石堆堆满也挡不住
hud.add(panel.mesh);
const restartButton = makeButton('重新开始', { width: 0.34, height: 0.085, color: '#2f8f5b', onClick: () => newGame() });
restartButton.position.set(-0.2, 2.56, -0.62);
restartButton.rotation.x = 0.5;
const envButton = makeButton('背景', { width: 0.38, height: 0.085, color: '#3a5bd9', onClick: () => envs.next() });
envButton.position.set(0.2, 2.56, -0.62);
envButton.rotation.x = 0.5;
envButton.userData.ui.setLabel(`背景：${envs.label || '…'} ▶`);
hud.add(restartButton, envButton);
const uiButtons = [restartButton, envButton];

function drawHud() {
  panel.redraw((g, w, h) => {
    roundRect(g, 4, 4, w - 8, h - 8, 34);
    g.fillStyle = 'rgba(16,20,34,0.86)'; g.fill();
    g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.18)'; g.stroke();
    g.textBaseline = 'alphabetic';
    // 深度 + 分区
    g.fillStyle = '#ffd166'; g.font = `800 66px ${FONT}`; g.textAlign = 'left';
    g.fillText(`${(depth * C).toFixed(1)} 米`, 34, 86);
    g.fillStyle = '#9aa6c2'; g.font = `600 28px ${FONT}`;
    g.fillText(zoneOf(depth).name, 36, 124);
    // 心
    g.textAlign = 'right'; g.font = `700 46px ${FONT}`;
    let hs = '';
    for (let i = 0; i < HEARTS; i++) hs += i < hearts ? '♥' : '♡';
    g.fillStyle = '#ff5d73'; g.fillText(hs, w - 34, 80);
    g.fillStyle = '#eef2fb'; g.font = `700 32px ${FONT}`;
    g.fillText(`得分 ${score()}`, w - 34, 124);
    g.fillStyle = '#9aa6c2'; g.font = `500 24px ${FONT}`;
    g.fillText(`矿石 ${ore} · 最高 ${best}`, w - 34, 156);
    // 被埋进度条
    const fill = Math.min(1, pileCount() / BURY);
    const bx = 34, by = 176, bw = w - 68, bh = 30;
    g.textAlign = 'left'; g.fillStyle = '#c9d3ea'; g.font = `600 24px ${FONT}`;
    g.fillText('碎石', bx, by - 6 + 0);
    roundRect(g, bx + 64, by - 26, bw - 64, bh, 14); g.fillStyle = 'rgba(255,255,255,0.1)'; g.fill();
    if (fill > 0) {
      roundRect(g, bx + 64, by - 26, Math.max(28, (bw - 64) * fill), bh, 14);
      g.fillStyle = fill > 0.75 ? '#ff4d4d' : fill > 0.5 ? '#ffb347' : '#8bd36b'; g.fill();
    }
    // 消息
    g.textAlign = 'center';
    if (state === 'over') {
      g.fillStyle = '#ff8080'; g.font = `800 44px ${FONT}`;
      g.fillText(overReason === 'buried' ? '被埋住了！' : '被砸晕了！', w / 2, 258);
      g.fillStyle = '#eef2fb'; g.font = `600 28px ${FONT}`;
      g.fillText(message || '按 A / X 或点“重新开始”', w / 2, 300);
    } else if (state === 'idle') {
      g.fillStyle = '#eef2fb'; g.font = `600 30px ${FONT}`;
      g.fillText('准备好了就开始挖', w / 2, 270);
    } else if (messageT > 0) {
      g.fillStyle = '#eef2fb'; g.font = `700 32px ${FONT}`;
      g.fillText(message, w / 2, 276);
    } else {
      g.fillStyle = '#7f8aa8'; g.font = `500 26px ${FONT}`;
      const t = centreType();
      g.fillText(`脚下：${TYPES[t].name}（还要敲 ${Math.max(1, centreHP)} 下）`, w / 2, 276);
    }
  });
}

// ================= 防晕 / 受伤闪屏 =================
const vignette = (() => {
  const tex = canvasTex(256, 256, (g) => {
    const grad = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.2)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  m.position.z = -0.12;
  m.renderOrder = 1000;
  camera.add(m);
  return m;
})();
const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#c01818', transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
flash.position.z = -0.11;
flash.renderOrder = 1001;
camera.add(flash);
const comfort = loadPref('mine-comfort', '1') === '1';

// 卡通脚
const feet = createFeet({ color: '#ffd166', accent: '#8a5a34' });
scene.add(feet.object);

// ================= 摆放 =================
let placeAfter = -1;
function place(restart = true) {
  const head = app.headPosition(tmpHead);
  const f = app.headForward(new THREE.Vector3());
  rig.position.set(head.x, 0, head.z);
  rig.rotation.y = Math.atan2(-f.x, -f.z);
  if (restart) newGame();
}

// ================= 每帧 =================
let fogColor = new THREE.Color();
function onFrame(dt) {
  if (placeAfter > 0) { placeAfter -= dt; if (placeAfter <= 0) place(true); }
  if (app.presenting) {
    app.pollButtons((c, bi) => {
      if (bi === 4) { initAudio(); newGame(); }
      if (bi === 5) { place(false); say('矿井已经对准你脚下'); }
    });
  }
  controls.enabled = !app.presenting;
  if (!app.presenting) controls.update();

  envs.update(dt);
  // 深了就看不见地面了：把背景藏起来省性能
  const env = envs.current;
  if (env) env.group.visible = !isAR && depthVis * C < 30;
  const z = zoneOf(depth);
  wallMat.color.lerp(fogColor.set(z.wall), Math.min(1, dt * 1.5));
  wallMatSide.color.copy(wallMat.color);
  caveLight.intensity = 0.35 + Math.min(0.5, depthVis * 0.04);
  caveLight.groundColor.set(z.from >= 35 ? '#a8361a' : '#3a2a1c');

  // 往下掉的动画（先慢后快，像真的往下掉）
  if (fallAnim) {
    fallAnim.t += dt;
    const k = Math.min(1, fallAnim.t / fallAnim.dur);
    depthVis = fallAnim.from + (fallAnim.to - fallAnim.from) * k * k;
    if (k >= 1) { fallAnim = null; depthVis = depth; sfx.land(); app.pulseAll(0.5, 60); }
  }
  world.position.y = depthVis * C;

  // 石堆方块落到位
  for (const p of piles) for (const m of p) {
    const ty = m.userData.ty;
    if (m.position.y > ty) m.position.y = Math.max(ty, m.position.y - dt * 6);
    else m.position.y = ty;
  }

  // 头的位置（矿井坐标）
  const headW = app.headPosition(tmpHead);
  const headL = shaft.worldToLocal(headW.clone());
  if (!app.presenting) { headL.x = 0; headL.z = 0; }

  if (state === 'playing') {
    elapsed += dt;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnRock();
      if (depth > 15 && Math.random() < 0.25) spawnRock();
      spawnTimer = Math.max(SPAWN_MIN, SPAWN_START - elapsed * 0.022 - depth * 0.025) * (0.75 + Math.random() * 0.5);
    }
    updateRocks(dt, headL);
    updatePicks(dt);
    if (messageT > 0 && messageT < 900) { messageT -= dt; if (messageT <= 0) drawHud(); }
  } else {
    for (const c of app.controllers) c.prevTip = null;
  }

  // 面板按钮：手柄射线指着按钮才显示射线
  if (app.presenting) {
    const hovered = new Set();
    for (const c of app.controllers) {
      if (!c.inputSource) continue;
      const hit = app.pointAt(c, uiButtons, 3);
      c.hover = hit ? hit.object : null;
      c.line.visible = !!hit;
      if (hit) hovered.add(hit.object);
    }
    for (const b of uiButtons) b.userData.ui.setHover(hovered.has(b));
    feet.update(headW, app.headForward(tmpV), 0, dt);
  } else feet.hide();

  if (vignette.material.opacity > 0) vignette.material.opacity = Math.max(0, vignette.material.opacity - dt * 2.2);
  if (flash.material.opacity > 0 && state !== 'over') flash.material.opacity = Math.max(0, flash.material.opacity - dt * 2.5);
  else if (state === 'over') flash.material.opacity = Math.max(0.35, flash.material.opacity - dt * 0.8);

  for (let n = effects.length - 1; n >= 0; n--) {
    const e = effects[n];
    e.t += dt;
    const k = Math.min(e.t / e.life, 1);
    e.update(k, e.t, dt);
    if (k >= 1) { e.done?.(); effects.splice(n, 1); }
  }
}

app.on('select', (c) => {
  initAudio();
  const t = c.hover;
  if (t?.userData.ui) { app.pulse(c, 0.4, 30); t.userData.ui.onClick?.(); }
});

// ================= 电脑上预览 =================
camera.position.set(0, 2.9, 1.6); // 电脑预览：从背后斜上方看（后墙从背面看是透明的）
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, -0.35);
controls.enableDamping = true;
controls.maxDistance = 4;
const mouse = new THREE.Vector2();
const mouseRay = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (app.presenting || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 6) return;
  initAudio();
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  mouseRay.setFromCamera(mouse, camera);
  clickTargets(mouseRay);
});
function clickTargets(ray) {
  const targets = [...uiButtons, ...rocks.map((r) => r.mesh)];
  for (let k = 0; k < 9; k++) if (piles[k].length) targets.push(piles[k][piles[k].length - 1]);
  if (layers.has(depth)) targets.push(centreMesh());
  const hit = ray.intersectObjects(targets, false)[0];
  if (!hit) return;
  const o = hit.object;
  if (o.userData.ui) return o.userData.ui.onClick?.();
  const r = rocks.find((rk) => rk.mesh === o);
  if (r) return hitRock(r);
  if (o.userData.pile) return hitPile(o.userData.k);
  if (o === centreMesh()) hitCentre(1);
}
window.addEventListener('keydown', (e) => {
  if (app.presenting) return;
  if (e.code === 'KeyR') newGame();
  if (e.code === 'Space') { e.preventDefault(); initAudio(); hitCentre(1); }
});

// ================= 页面 =================
const overlay = document.getElementById('overlay');
const backLink = document.getElementById('back');
const hint = document.getElementById('hint');
const btnVR = document.getElementById('enter-vr');
const btnAR = document.getElementById('enter-ar');
const btnDesktop = document.getElementById('desktop');
const note = document.getElementById('note');
const envSelect = document.getElementById('env-select');
let desktopPreview = false;
for (const e of ENVIRONMENTS) envSelect.add(new Option(e.label, e.key));
envSelect.value = savedEnvKey();
envSelect.addEventListener('change', () => envs.set(envSelect.value));

(async () => {
  const [vr, ar] = await Promise.all([app.supports('immersive-vr'), app.supports('immersive-ar')]);
  btnVR.hidden = !vr;
  btnAR.hidden = !ar;
  if (!vr && !ar) note.textContent = '这台设备不支持 VR。可以先在电脑上预览：点方块 = 敲一下，空格 = 敲脚下，R 重来，拖动转视角。';
})();
async function start(mode) {
  initAudio();
  try { await app.enter(mode); } catch (err) { note.textContent = '无法进入：' + err.message; }
}
btnVR.addEventListener('click', () => start('immersive-vr'));
btnAR.addEventListener('click', () => start('immersive-ar'));
btnDesktop.addEventListener('click', () => {
  initAudio();
  desktopPreview = true;
  overlay.classList.add('hidden');
  hint.style.display = 'block';
  newGame();
});

ensureLayers();
resetCentre();
drawHud();

// 调试用
window.minegame = {
  get state() { return state; }, get depth() { return depth; }, get hearts() { return hearts; }, get piles() { return piles.map((p) => p.length); },
  get rocks() { return rocks; }, get score() { return score(); }, get ore() { return ore; }, get centreHP() { return centreHP; },
  newGame, hitCentre, hitPile, hitRock, spawnRock, clickTargets, camera, controls, envs, rig, shaft,
  get falling() { return !!fallAnim; }, controllers: app.controllers, setHearts(n) { hearts = n; },
  setSpawn(t) { spawnTimer = t; },
};
