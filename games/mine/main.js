// 深井矿工：你站在矿井底部的一小块空地上，四周一圈方块正好在腰的高度，站着挥镐就能挖。
// 把四周这一圈全部挖空，脚下就塌了，你往下掉一层，新的一圈方块又围上来。
// 头顶不停掉石块，但不会砸到你：它们落进四周的格子里，把挖开的洞填上、越堆越高，堆太高就被埋住了。
// 坐标：rig 放在你脚下（y=0 是真实地板）；world 是整口矿井，往下掉一层，world 就整体往上移一层。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio } from '../../shared/sfx.js';
import { createEnvManager, ENVIRONMENTS, savedEnvKey } from '../../shared/env/index.js';
import { createFeet } from '../../shared/feet.js';
import { exitToLobby } from '../../shared/exit.js';

// ================= 可调参数 =================
const C = 0.6;              // 每格宽度（米）。矿井是 4×4 格（2.4 米见方），中间 2×2 是你站的空地
const WAIST = 0.72;         // 方块顶面比眼睛低多少（大约到腰）
const MAXH = 3;             // 每格最多堆几块（1 块原来的 + 2 块碎石）
const BURY = 12;            // 四周高出腰部的碎石一共这么多块就算被埋住
const SPAWN_START = 2.6;    // 一开始每隔几秒掉一块
const SPAWN_MIN = 0.7;      // 最快每隔几秒掉一块
const HANG = 0.5;           // 石块在上面晃一下再掉（提前警告）
const G = 6.5;              // 石块下落的重力
const SWING = 1.2;          // 镐头速度超过这个（米/秒）才算砸到
const COOLDOWN = 0.18;      // 同一只手两次敲击的最小间隔（秒）
const RING = [];            // 四周一圈 12 个格子的编号（4×4 里去掉中间 2×2）
for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (!(i >= 1 && i <= 2 && j >= 1 && j <= 2)) RING.push(j * 4 + i);
const colX = (k) => ((k % 4) - 1.5) * C;
const colZ = (k) => (Math.floor(k / 4) - 1.5) * C;
let H = 0.88;               // 每层高度 = 方块高度（进入 VR 时按你的身高调到腰部）

// ================= 场景 =================
const app = createXRApp({ onFrame });
const { scene, camera, renderer } = app;

const rig = new THREE.Group();     // 放在你脚下、朝你面对的方向
scene.add(rig);
const world = new THREE.Group();   // 整口矿井 + 地面背景，往下掉时往上移
rig.add(world);
const envHolder = new THREE.Group();
world.add(envHolder);
const hud = new THREE.Group();     // 面板：固定在你面前
rig.add(hud);

const envs = createEnvManager(scene, {
  onChange: (def) => {
    if (envSelect) envSelect.value = def.key;
    const env = envs.current;
    if (env) { envHolder.add(env.group); clearShaft(env.group); cutHole(env.group); }
    menuEnvButton?.userData.ui.setLabel(`背景：${def.label} ▶`);
    if (state === 'playing') say(`背景换成了${def.label}`);
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
      if (Math.abs(p.x) < 2.6 && Math.abs(p.z) < 2.6) o.setMatrixAt(i, zero);
    }
    o.instanceMatrix.needsUpdate = true;
  });
}

// 在背景的地面（还有水面、街道）上挖一个和矿井一样大的方洞：
// 给背景的每个材质加一小段着色器代码，落在矿井这根方柱里、地面附近的像素直接丢掉
const holeUniforms = { uShaftInv: { value: new THREE.Matrix4() }, uHalf: { value: 2 * 0.6 }, uTop: { value: 1.3 } };
function cutHole(group) {
  group.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.userData.shaftHole) continue;
      m.userData.shaftHole = true;
      const prev = m.onBeforeCompile;
      const prevKey = m.customProgramCacheKey?.bind(m);
      m.onBeforeCompile = (shader, r) => {
        prev?.call(m, shader, r);
        Object.assign(shader.uniforms, holeUniforms);
        const decl = 'varying vec3 vShaftL;\nuniform mat4 uShaftInv;\nuniform float uHalf, uTop;\n';
        const vs = shader.vertexShader;
        const end = vs.lastIndexOf('}');
        shader.vertexShader = decl + vs.slice(0, end) +
          '\n  { vec4 sv = inverse(projectionMatrix) * gl_Position; sv /= sv.w; vShaftL = (uShaftInv * (inverse(viewMatrix) * sv)).xyz; }\n' + vs.slice(end);
        shader.fragmentShader = decl + shader.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/,
          'void main() {\n  if (abs(vShaftL.x) < uHalf && abs(vShaftL.z) < uHalf && vShaftL.y < uTop) discard;\n');
      };
      m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|shafthole';
      m.needsUpdate = true;
    }
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
const headLamp = new THREE.PointLight('#fff1d6', 2.2, 6, 1.2);
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

// 方块种类：hp = 要敲几下；pts = 挖掉时得几分
const TYPES = {
  dirt: { hp: 1, pts: 0, name: '泥土' },
  stone: { hp: 2, pts: 0, name: '石头' },
  hard: { hp: 3, pts: 0, name: '硬岩' },
  gem: { hp: 2, pts: 5, name: '宝石' },
  gold: { hp: 2, pts: 3, name: '金矿' },
  tnt: { hp: 1, pts: 0, name: '炸药' },
  rubble: { hp: 1, pts: 0, name: '碎石' },
};
const MAT = {};
for (const k of Object.keys(TYPES)) {
  MAT[k] = new THREE.MeshStandardMaterial({ map: TEX[k], roughness: 0.9, metalness: k === 'gold' ? 0.2 : 0 });
  if (k === 'gem' || k === 'gold') { MAT[k].emissive = new THREE.Color(k === 'gem' ? '#0a5160' : '#5a3b00'); MAT[k].emissiveIntensity = 0.6; }
}

// 深度分区：越往下颜色越深、越硬
const ZONES = [
  { from: 0, name: '表土层', wall: '#ffffff' },
  { from: 6, name: '岩石层', wall: '#b9bcc4' },
  { from: 15, name: '深岩层', wall: '#7f8aa8' },
  { from: 28, name: '熔岩层', wall: '#ff9a7a' },
];
const zoneOf = (d) => [...ZONES].reverse().find((z) => d >= z.from);

function pickType(d) {
  const r = Math.random();
  if (d >= 2 && r < 0.04) return 'tnt';
  if (Math.random() < 0.08 + Math.min(0.06, d * 0.003)) return d > 6 && Math.random() < 0.55 ? 'gem' : 'gold';
  if (d < 4) return r < 0.75 ? 'dirt' : 'stone';
  if (d < 12) return r < 0.35 ? 'dirt' : r < 0.9 ? 'stone' : 'hard';
  if (d < 25) return r < 0.55 ? 'stone' : 'hard';
  return r < 0.3 ? 'stone' : 'hard';
}

// ================= 矿井 =================
const shaft = new THREE.Group();
world.add(shaft);
const unitGeo = new THREE.BoxGeometry(C * 0.98, 1, C * 0.98); // 高度按 H 缩放

// 井壁：四面朝里的长条，从地面一直往下
const WALL_LEN = 400;
const wallMat = new THREE.MeshStandardMaterial({ map: TEX.wall, roughness: 0.95 });
TEX.wall.repeat.set(4, WALL_LEN / C);
// 左右两面墙往你身后多延伸 3 米：VR 里被后墙挡住看不见，电脑预览从背后看时不会露出天空
const wallMatSide = wallMat.clone();
wallMatSide.map = TEX.wall.clone();
wallMatSide.map.repeat.set((4 * C + 3) / C, WALL_LEN / C);
const walls = new THREE.Group();
shaft.add(walls);
for (let s = 0; s < 4; s++) {
  const side = s % 2 === 1;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(side ? 4 * C + 3 : 4 * C, WALL_LEN), side ? wallMatSide : wallMat);
  const a = s * Math.PI / 2;
  m.position.set(-Math.sin(a) * 2 * C, -WALL_LEN / 2, side ? 1.5 : -Math.cos(a) * 2 * C);
  m.rotation.y = a;
  walls.add(m);
}
// 井口一圈木框
const rim = new THREE.Group();
shaft.add(rim);
{
  const wood = new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 0.8 });
  for (let s = 0; s < 4; s++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(4 * C + 0.3, 0.12, 0.15), wood);
    const a = s * Math.PI / 2;
    beam.position.set(-Math.sin(a) * (2 * C + 0.075), 0.04, -Math.cos(a) * (2 * C + 0.075));
    beam.rotation.y = a;
    rim.add(beam);
  }
}

let depth = 0;          // 你在第几层（脚在 -depth*H）
let depthVis = 0;       // 动画用
const cols = Array.from({ length: 16 }, () => []); // 四周每格一摞方块，下面是原来的、上面是碎石
let below = [];         // 脚下一层（16 块），挖开的洞底下看得到
const feetY = () => -depth * H;
const unitY = (j) => feetY() + (j + 0.5) * H;
const ringLeft = () => RING.filter((k) => cols[k].length > 0).length;
const buryCount = () => RING.reduce((s, k) => s + Math.max(0, cols[k].length - 1), 0);

function makeUnit(type, k, j) {
  const m = new THREE.Mesh(unitGeo, MAT[type]);
  m.scale.y = H * 0.98;
  m.position.set(colX(k), unitY(j), colZ(k));
  if (type === 'rubble') m.rotation.y = (Math.random() - 0.5) * 0.25;
  m.userData = { k, unit: true };
  shaft.add(m);
  return { type, hp: TYPES[type].hp, mesh: m, ty: unitY(j) };
}
// 脚下一层：只是看的（挖开的洞底下、中间空地的地面）
function buildBelow() {
  below.forEach((u) => shaft.remove(u.mesh));
  below = [];
  for (let k = 0; k < 16; k++) {
    const t = pickType(depth + 1);
    const m = new THREE.Mesh(unitGeo, MAT[RING.includes(k) ? t : 'dirt']);
    m.scale.y = H * 0.98;
    m.position.set(colX(k), feetY() - H / 2, colZ(k));
    shaft.add(m);
    below.push({ type: t, mesh: m });
  }
}
function fillRing(types) {
  for (const k of RING) cols[k].push(makeUnit(types ? types[k] : pickType(depth), k, 0));
}
function layoutWorld() {
  envHolder.position.y = H - 0.02;  // 地面在最上面一层方块的顶上
  walls.position.y = H;
  rim.position.y = H;
}

// ================= 游戏状态 =================
let state = 'idle';    // idle | intro | playing | over
let ore = 0, smashed = 0, elapsed = 0, spawnTimer = 3;
let best = Number(loadPref('mine-best', '0')) || 0;
let message = '', messageT = 0;
const rocks = [];      // 正在掉的石块
const effects = [];    // 碎屑、飘字
let fallAnim = null;
let menuOpen = false;
let introSeen = false;
const score = () => depth * 10 + ore + smashed * 2;

function clearAll() {
  for (const col of cols) { col.forEach((u) => shaft.remove(u.mesh)); col.length = 0; }
  for (const r of rocks) shaft.remove(r.mesh, r.warn);
  rocks.length = 0;
}
function newGame() {
  clearAll();
  depth = 0; depthVis = 0;
  ore = 0; smashed = 0; elapsed = 0; spawnTimer = 4;
  fallAnim = null;
  layoutWorld();
  fillRing();
  buildBelow();
  setMenu(false);
  flash.material.opacity = 0;
  if (!introSeen && (app.presenting || desktopPreview)) { state = 'intro'; intro.mesh.visible = true; }
  else { state = 'playing'; say('把四周这一圈方块全部挖掉！'); }
  drawHud();
}
function startPlaying() {
  introSeen = true;
  intro.mesh.visible = false;
  state = 'playing';
  say('把四周这一圈方块全部挖掉！');
  sfx.click();
}
function say(t, s = 2.5) { message = t; messageT = s; drawHud(); }

function gameOver() {
  if (state !== 'playing') return;
  state = 'over';
  for (const r of rocks) { chips(r.mesh.position.clone(), MAT.rubble, 4); shaft.remove(r.mesh, r.warn); }
  rocks.length = 0;
  const s = score();
  const isBest = s > best;
  if (isBest) { best = s; savePref('mine-best', String(best)); }
  sfx.boom();
  app.pulseAll(1, 300);
  flash.material.color.set('#2a1a0e');
  flash.material.opacity = 0.8;
  say(isBest ? `新纪录 ${s} 分！按 A/X 再来` : `得分 ${s}，按 A/X 再来`, 999);
}

// ================= 敲击 =================
const HARD = { dirt: 0, stone: 1, hard: 2, gem: 1, gold: 1, tnt: 0, rubble: 0 };
function hitColumn(k, c = null) {
  const col = cols[k];
  if (!col.length || state !== 'playing' || fallAnim || menuOpen) return;
  const u = col[col.length - 1];
  u.hp--;
  sfx.pick(HARD[u.type]);
  if (c) app.pulse(c, 0.45 + HARD[u.type] * 0.15, 40);
  chips(u.mesh.position.clone().setY(u.ty + H / 2), MAT[u.type], 5);
  if (u.hp > 0) {
    // 还没碎：裂开、晃一下
    u.mesh.material = crackedMat(u.type, 1 - u.hp / TYPES[u.type].hp);
    u.mesh.position.x = colX(k) + 0.02;
    return;
  }
  col.pop();
  shaft.remove(u.mesh);
  sfx.smash();
  if (c) app.pulse(c, 0.8, 70);
  if (u.type === 'rubble') smashed++;
  if (TYPES[u.type].pts) {
    ore += TYPES[u.type].pts;
    sfx.bonus();
    popup(`+${TYPES[u.type].pts} ${TYPES[u.type].name}`, u.mesh.position.clone().setY(u.ty + H * 0.8), '#ffd166');
  }
  if (u.type === 'tnt') { explode(); return; }
  if (ringLeft() === 0) dropLayer(1);
  else drawHud();
}
// 裂纹：给方块换一份带裂纹的材质
const crackCache = new Map();
function crackedMat(type, frac) {
  const stage = Math.min(2, Math.floor(frac * 3));
  const key = type + stage;
  if (!crackCache.has(key)) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.drawImage(TEX[type].image, 0, 0);
    g.drawImage(crackTex[stage].image, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = MAT[type].clone();
    m.map = t;
    crackCache.set(key, m);
  }
  return crackCache.get(key);
}
function explode() {
  for (const k of RING) {
    for (const u of cols[k]) {
      chips(u.mesh.position.clone(), MAT[u.type], 3);
      if (TYPES[u.type].pts) ore += TYPES[u.type].pts;
      shaft.remove(u.mesh);
    }
    cols[k].length = 0;
  }
  sfx.boom();
  app.pulseAll(1, 250);
  flash.material.color.set('#ffb347');
  flash.material.opacity = 0.6;
  dropLayer(1);
  say('轰！整圈都炸开了');
}

// 四周挖空了：脚下塌了，往下掉一层，新的一圈方块围上来
function dropLayer(n) {
  for (const k of [5, 6, 9, 10]) chips(below[k].mesh.position.clone().setY(feetY()), MAT.dirt, 4);
  const types = {};
  for (const k of RING) types[k] = below[k].type;
  below.forEach((u) => shaft.remove(u.mesh));
  below = [];
  depth += n;
  fillRing(types);
  // 新的一圈从下面“冒出来”：先放在原位，跟着 world 一起往上移
  buildBelow();
  for (const r of rocks) r.mesh.position.y -= n * H; // 空中的石块也跟着一起往下
  fallAnim = { from: depthVis, to: depth, t: 0, dur: 0.3 };
  sfx.crumble();
  sfx.whoosh();
  app.pulseAll(0.8, 120);
  if (comfort) vignette.material.opacity = 0.9;
  const z = zoneOf(depth);
  if (zoneOf(depth - n) !== z) say(`进入${z.name}！石头更硬了`);
  else say(`往下 ${(depth * 0.6).toFixed(1)} 米，继续挖！`, 1.5);
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

// ================= 掉石块（只落在四周，不会砸到你）=================
const rockGeo = new THREE.DodecahedronGeometry(C * 0.4, 0);
const warnGeo = new THREE.RingGeometry(C * 0.28, C * 0.4, 32);
function spawnRock() {
  const open = RING.filter((k) => cols[k].length < MAXH && !rocks.some((r) => r.k === k));
  if (!open.length) return null;
  const k = open[Math.floor(Math.random() * open.length)];
  const mesh = new THREE.Mesh(rockGeo, MAT.rubble);
  mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  const warn = new THREE.Mesh(warnGeo, new THREE.MeshBasicMaterial({ color: '#ff9f43', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  warn.rotation.x = -Math.PI / 2;
  warn.renderOrder = 3;
  mesh.position.set(colX(k), feetY() + MAXH * H + 2.2, colZ(k));
  shaft.add(mesh, warn);
  const r = { mesh, warn, k, vy: 0, hang: HANG };
  rocks.push(r);
  return r;
}

function updateRocks(dt) {
  for (let n = rocks.length - 1; n >= 0; n--) {
    const r = rocks[n];
    const k = r.k;
    const landY = feetY() + cols[k].length * H;
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
    if (r.mesh.position.y - C * 0.38 <= landY) {
      rocks.splice(n, 1);
      shaft.remove(r.warn, r.mesh);
      if (cols[k].length >= MAXH) continue;
      // 落进格子：洞被填上，或者在方块上面再堆一层
      cols[k].push(makeUnit('rubble', k, cols[k].length));
      sfx.thud();
      app.pulseAll(0.25, 40);
      if (buryCount() >= BURY) { gameOver(); return; }
      else if (buryCount() >= BURY - 3) say('快被埋住了！先砸掉高出来的碎石');
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
  pick.rotation.x = Math.PI;
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
// 镐尖是不是在某一格那一摞方块里面
function inColumn(p, k, pad = 0.05) {
  const n = cols[k].length;
  if (!n) return false;
  return Math.abs(p.x - colX(k)) < C / 2 + pad && Math.abs(p.z - colZ(k)) < C / 2 + pad && p.y > feetY() - pad && p.y < feetY() + n * H + pad;
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
    if (!prev || c.cool > 0 || state !== 'playing' || menuOpen) continue;
    const speed = tipL.distanceTo(prev) / Math.max(dt, 1e-3);
    if (speed < SWING) continue;
    const hit = () => { c.cool = COOLDOWN; glow.material.opacity = 1; };
    const r = rocks.find((rk) => rk.mesh.position.distanceTo(tipL) < C * 0.5);
    if (r) { hitRock(r, c); hit(); continue; }
    // 镐尖从外面砸进一格（顶上或侧面都算）
    const k = RING.find((n) => inColumn(tipL, n) && !inColumn(prev, n));
    if (k !== undefined) { hitColumn(k, c); hit(); }
  }
}

// ================= 面板（永远看得到：不会被石堆挡住）=================
const panel = makeCanvasPlane(0.8, 0.3, 1000);
panel.mesh.material.depthTest = false;
panel.mesh.renderOrder = 900;
panel.mesh.userData.ui = { onClick: () => setMenu(!menuOpen), setHover() {} };
hud.add(panel.mesh);
// 菜单（按 B/Y 或用射线点面板打开）：继续 / 重新开始 / 换背景 / 对准脚下 / 退出
const menu = new THREE.Group();
menu.visible = false;
hud.add(menu);
const menuButtons = [];
const mb = (label, y, color, onClick) => {
  const b = makeButton(label, { width: 0.5, height: 0.09, color, onClick });
  b.material.depthTest = false;
  b.renderOrder = 950;
  b.position.set(0, y, 0);
  menu.add(b);
  menuButtons.push(b);
  return b;
};
mb('继续', 0.2, '#2f8f5b', () => setMenu(false));
mb('重新开始  A/X', 0.09, '#3a5bd9', () => newGame());
const menuEnvButton = mb(`背景：${envs.label || '…'} ▶`, -0.02, '#5a4a2e', () => envs.next());
mb('对准脚下', -0.13, '#2e5a46', () => { place(false); setMenu(false); say('矿井已经对准你脚下'); });
mb('✕ 退出', -0.24, '#b8323a', () => exitToLobby(app));
function setMenu(v) {
  menuOpen = v;
  menu.visible = v;
  drawHud();
}
const uiTargets = () => (menuOpen ? [...menuButtons, panel.mesh] : intro.mesh.visible ? [intro.mesh] : [panel.mesh]);

// 开局说明
const intro = makeCanvasPlane(0.9, 0.62, 1000);
intro.mesh.material.depthTest = false;
intro.mesh.renderOrder = 960;
intro.mesh.visible = false;
intro.mesh.userData.ui = { onClick: () => startPlaying(), setHover() {} };
hud.add(intro.mesh);
intro.redraw((g, w, h) => {
  roundRect(g, 6, 6, w - 12, h - 12, 44);
  g.fillStyle = 'rgba(16,20,34,0.95)'; g.fill();
  g.lineWidth = 6; g.strokeStyle = '#f5b941'; g.stroke();
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffd166'; g.font = `800 64px ${FONT}`;
  g.fillText('怎么玩', 50, 100);
  const lines = [
    ['⛏', '两只手柄都是镐。站着挥，砸你四周腰那么高的方块。'],
    ['⬇', '四周一圈全部挖空，脚下就塌了，往下掉一层。'],
    ['🪨', '石块从上面掉进四周的格子：填上挖开的洞、越堆越高。'],
    ['⚠', '高出腰的碎石太多就被埋住了，先把高的砸掉。'],
    ['💎', '宝石、金矿加分；红色炸药一下炸开整圈。'],
  ];
  g.font = `600 34px ${FONT}`;
  lines.forEach(([icon, t], i) => {
    g.fillStyle = '#f5b941'; g.fillText(icon, 50, 180 + i * 72);
    g.fillStyle = '#eef2fb'; g.fillText(t, 110, 180 + i * 72);
  });
  g.fillStyle = '#5cffb0'; g.font = `700 36px ${FONT}`; g.textAlign = 'center';
  g.fillText('扣扳机开始', w / 2, h - 40);
});

function drawHud() {
  panel.redraw((g, w, h) => {
    roundRect(g, 4, 4, w - 8, h - 8, 34);
    g.fillStyle = 'rgba(16,20,34,0.82)'; g.fill();
    g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.18)'; g.stroke();
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffd166'; g.font = `800 64px ${FONT}`; g.textAlign = 'left';
    g.fillText(`${(depth * 0.6).toFixed(1)} 米`, 34, 82);
    g.fillStyle = '#9aa6c2'; g.font = `600 26px ${FONT}`;
    g.fillText(`${zoneOf(depth).name} · 这一圈还剩 ${ringLeft()} 格`, 36, 120);
    g.textAlign = 'right';
    g.fillStyle = '#eef2fb'; g.font = `700 34px ${FONT}`;
    g.fillText(`得分 ${score()}`, w - 34, 70);
    g.fillStyle = '#9aa6c2'; g.font = `500 24px ${FONT}`;
    g.fillText(`矿石 ${ore} · 最高 ${best}`, w - 34, 106);
    // 被埋进度条
    const fill = Math.min(1, buryCount() / BURY);
    const bx = 34, by = 150, bw = w - 68, bh = 28;
    g.textAlign = 'left'; g.fillStyle = '#c9d3ea'; g.font = `600 24px ${FONT}`;
    g.fillText('被埋', bx, by + 21);
    roundRect(g, bx + 64, by, bw - 64, bh, 13); g.fillStyle = 'rgba(255,255,255,0.1)'; g.fill();
    if (fill > 0) {
      roundRect(g, bx + 64, by, Math.max(26, (bw - 64) * fill), bh, 13);
      g.fillStyle = fill > 0.75 ? '#ff4d4d' : fill > 0.5 ? '#ffb347' : '#8bd36b'; g.fill();
    }
    g.textAlign = 'center';
    if (state === 'over') {
      g.fillStyle = '#ff8080'; g.font = `800 40px ${FONT}`;
      g.fillText('被埋住了！', w / 2, 232);
      g.fillStyle = '#eef2fb'; g.font = `600 26px ${FONT}`;
      g.fillText(message, w / 2, 272);
    } else if (messageT > 0) {
      g.fillStyle = '#eef2fb'; g.font = `700 32px ${FONT}`;
      g.fillText(message, w / 2, 245);
    } else {
      g.fillStyle = '#7f8aa8'; g.font = `500 24px ${FONT}`;
      g.fillText(menuOpen ? '菜单打开中，游戏暂停' : 'B/Y 或点这块面板：菜单（换背景、退出）', w / 2, 245);
    }
  });
}

// ================= 防晕 / 闪屏 =================
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
flash.renderOrder = 880;
camera.add(flash);
const comfort = loadPref('mine-comfort', '1') === '1';

// 卡通脚
const feet = createFeet({ color: '#ffd166', accent: '#8a5a34' });
scene.add(feet.object);

// ================= 摆放：矿井中心对准你脚下，方块顶面在你腰部 =================
let placeAfter = -1;
function place(restart = true) {
  const f = app.headForward(new THREE.Vector3());
  const head = app.headPosition(new THREE.Vector3());
  const foot = app.footPosition(new THREE.Vector3());
  if (!app.presenting) { head.set(0, 1.6, 0); foot.set(0, 0, 0); f.set(0, 0, -1); }
  rig.position.set(foot.x, 0, foot.z);
  rig.rotation.y = Math.atan2(-f.x, -f.z);
  const newH = THREE.MathUtils.clamp(head.y - WAIST, 0.6, 1.1);
  if (restart || Math.abs(newH - H) > 0.02) { H = newH; placeHud(head.y); newGame(); }
  else placeHud(head.y);
}
function placeHud(eyeY) {
  panel.mesh.position.set(0, eyeY + 0.3, -1.05);
  panel.mesh.rotation.x = 0.3;
  menu.position.set(0, eyeY - 0.1, -0.75);
  intro.mesh.position.set(0, eyeY - 0.05, -0.85);
}

// ================= 每帧 =================
const fogColor = new THREE.Color();
function onFrame(dt) {
  if (placeAfter > 0) { placeAfter -= dt; if (placeAfter <= 0) place(true); }
  if (app.presenting) {
    app.pollButtons((c, bi) => {
      if (bi === 4) { initAudio(); newGame(); }
      if (bi === 5) setMenu(!menuOpen);
    });
  }
  controls.enabled = !app.presenting;
  if (!app.presenting) controls.update();

  envs.update(dt);
  const env = envs.current;
  if (env) env.group.visible = !isAR && depthVis * H < 25; // 深了就看不见地面了
  const z = zoneOf(depth);
  wallMat.color.lerp(fogColor.set(z.wall), Math.min(1, dt * 1.5));
  wallMatSide.color.copy(wallMat.color);
  caveLight.intensity = 0.35 + Math.min(0.5, depthVis * 0.05);
  caveLight.groundColor.set(z.from >= 28 ? '#a8361a' : '#3a2a1c');

  if (fallAnim) {
    fallAnim.t += dt;
    const k = Math.min(1, fallAnim.t / fallAnim.dur);
    depthVis = fallAnim.from + (fallAnim.to - fallAnim.from) * k * k;
    if (k >= 1) { fallAnim = null; depthVis = depth; sfx.land(); }
  }
  world.position.y = depthVis * H;
  shaft.updateWorldMatrix(true, false);
  holeUniforms.uShaftInv.value.copy(shaft.matrixWorld).invert();
  holeUniforms.uTop.value = H + 0.5;

  // 敲过的方块晃回原位
  for (const k of RING) for (const u of cols[k]) u.mesh.position.x += (colX(k) - u.mesh.position.x) * Math.min(1, dt * 20);

  if (state === 'playing' && !menuOpen) {
    elapsed += dt;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnRock();
      if (depth > 10 && Math.random() < 0.25) spawnRock();
      spawnTimer = Math.max(SPAWN_MIN, SPAWN_START - elapsed * 0.02 - depth * 0.04) * (0.75 + Math.random() * 0.5);
    }
    updateRocks(dt);
    updatePicks(dt);
    if (messageT > 0 && messageT < 900) { messageT -= dt; if (messageT <= 0) drawHud(); }
  } else {
    for (const c of app.controllers) c.prevTip = null;
  }

  // 射线只在指着面板/菜单时才显示
  if (app.presenting) {
    const targets = uiTargets();
    const hovered = new Set();
    for (const c of app.controllers) {
      if (!c.inputSource) continue;
      const hit = app.pointAt(c, targets, 3);
      c.hover = hit ? hit.object : null;
      c.line.visible = !!hit;
      if (hit) hovered.add(hit.object);
    }
    for (const b of menuButtons) b.userData.ui.setHover(hovered.has(b));
    feet.update(app.footPosition(tmpV), app.headForward(new THREE.Vector3()), 0, dt);
  } else feet.hide();

  if (vignette.material.opacity > 0) vignette.material.opacity = Math.max(0, vignette.material.opacity - dt * 2.2);
  if (state === 'over') flash.material.opacity = Math.max(0.35, flash.material.opacity - dt * 0.8);
  else if (flash.material.opacity > 0) flash.material.opacity = Math.max(0, flash.material.opacity - dt * 2.5);

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
  if (t?.userData.ui) { app.pulse(c, 0.4, 30); t.userData.ui.onClick?.(); return; }
  if (state === 'intro') startPlaying();
  else if (state === 'over') newGame();
});

// ================= 电脑上预览 =================
camera.position.set(0, 3.0, 2.3); // 从背后斜上方看（后墙从背面看是透明的）
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, -0.3);
controls.enableDamping = true;
controls.maxDistance = 5;
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
  const ui = uiTargets();
  const uiHit = ray.intersectObjects(ui, false)[0];
  if (uiHit) return uiHit.object.userData.ui.onClick?.();
  if (state === 'intro') return startPlaying();
  const targets = rocks.map((r) => r.mesh);
  for (const k of RING) for (const u of cols[k]) targets.push(u.mesh);
  const hit = ray.intersectObjects(targets, false)[0];
  if (!hit) return;
  const r = rocks.find((rk) => rk.mesh === hit.object);
  if (r) return hitRock(r);
  hitColumn(hit.object.userData.k);
}
window.addEventListener('keydown', (e) => {
  if (app.presenting) return;
  if (e.code === 'KeyR') newGame();
  if (e.code === 'KeyM' || e.code === 'Escape') setMenu(!menuOpen);
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
  if (!vr && !ar) note.textContent = '这台设备不支持 VR。可以先在电脑上预览：点方块 = 敲一下，M 打开菜单，R 重来，拖动转视角。';
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

placeHud(1.6);
layoutWorld();
fillRing();
buildBelow();
drawHud();

// 调试用
window.minegame = {
  get state() { return state; }, get depth() { return depth; }, get cols() { return cols.map((c) => c.length); },
  get rocks() { return rocks; }, get score() { return score(); }, get ore() { return ore; }, get bury() { return buryCount(); },
  get ringLeft() { return ringLeft(); }, get menuOpen() { return menuOpen; }, RING,
  newGame, hitColumn, hitRock, spawnRock, clickTargets, startPlaying, setMenu, camera, controls, envs, rig, shaft,
  get falling() { return !!fallAnim; }, controllers: app.controllers,
  setSpawn(t) { spawnTimer = t; }, get H() { return H; },
};
