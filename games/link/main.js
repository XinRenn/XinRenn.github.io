// 空中连线：一个由图案方块组成的立方体悬浮在面前。
// 用手（手柄尖端）从一个方块画线到另一个相同图案的方块，线不能碰到别的方块；
// 或者用射线点两个相同的方块，按经典规则（空位里最多拐两个弯）自动连。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio } from '../../shared/sfx.js';
import { createEnvManager, ENVIRONMENTS, savedEnvKey } from '../../shared/env/index.js';
import { iconMaterial, ICON_COUNT } from './icons.js';

// ================= 可调参数 =================
const PRESETS = {
  easy:   { label: '简单', dims: [4, 3, 2], icons: 8 },
  normal: { label: '普通', dims: [6, 4, 2], icons: 12 },
  hard:   { label: '困难', dims: [6, 4, 3], icons: 16 },
};
const SPACING = 0.1;          // 方块间距（米）
const TILE = 0.075;           // 方块边长
const HALF = TILE / 2;
const GRAB_PAD = 0.018;       // 手柄尖端离方块多近算“碰到”
const FORGIVE = 0.006;        // 画线时擦边的宽容度
const TIP = 0.045;            // 手柄尖端在手柄前方多远
const COMBO_WINDOW = 4;       // 几秒内连上下一对算连击

// ================= 场景 =================
const app = createXRApp({ onFrame });
const { scene, camera, renderer } = app;

const envs = createEnvManager(scene, {
  onChange: (def) => {
    envButton?.userData.ui.setLabel(`背景：${def.label} ▶`);
    if (envSelect) envSelect.value = def.key;
  },
});
envs.set(savedEnvKey());

app.on('modechange', (mode) => {
  envs.setAR(mode === 'ar');
  overlay.classList.toggle('hidden', mode !== 'desktop' || desktopPreview);
  backLink.style.display = mode === 'desktop' ? '' : 'none';
  hint.style.display = mode === 'desktop' && desktopPreview ? 'block' : 'none';
  if (mode !== 'desktop') placeAfter = 0.6;
});

function loadPref(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } }
function savePref(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 无痕模式 */ } }

const rig = new THREE.Group();
rig.position.set(0, 1.3, -0.5);
scene.add(rig);
const cluster = new THREE.Group();
rig.add(cluster);

// 手柄尖端的小光球（画线的笔尖）
const tips = app.controllers.map(() => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  m.visible = false;
  scene.add(m);
  return m;
});

// 选中 / 悬停 / 提示 用的发光框
function outline(color) {
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE * 1.18, TILE * 1.18, TILE * 1.18));
  const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
  m.visible = false;
  cluster.add(m);
  return m;
}
const selBox = outline('#ffffff');
const hoverBox = outline('#8ecae6');
const hintBoxes = [outline('#ffd166'), outline('#ffd166')];

const tileGeo = new THREE.BoxGeometry(TILE, TILE, TILE);

// ================= 游戏状态 =================
let presetKey = loadPref('link-preset', 'normal');
if (!PRESETS[presetKey]) presetKey = 'normal';
let cfg = PRESETS[presetKey];
let grid = [];       // grid[i][j][k] = tile | null
let tiles = [];
let state = 'playing'; // playing | won
let score = 0, combo = 0, lastMatch = -99, startTime = 0, endTime = 0;
let selected = null;
let stroke = null;   // 正在用手画的线
let grab = null;     // 正在用握把转立方体
let hintUntil = 0;
let statusText = '';
const effects = [];
let clock = 0;

const cellPos = (i, j, k) => new THREE.Vector3(
  (i - (cfg.dims[0] - 1) / 2) * SPACING,
  (j - (cfg.dims[1] - 1) / 2) * SPACING,
  (k - (cfg.dims[2] - 1) / 2) * SPACING
);

function newGame(key = presetKey) {
  presetKey = key;
  savePref('link-preset', key);
  cfg = PRESETS[key];
  for (const t of tiles) cluster.remove(t.mesh);
  tiles = [];
  const [X, Y, Z] = cfg.dims;
  const n = X * Y * Z;
  const icons = [];
  for (let p = 0; p < n / 2; p++) { const ic = p % Math.min(cfg.icons, ICON_COUNT); icons.push(ic, ic); }
  shuffleArr(icons);
  grid = Array.from({ length: X }, () => Array.from({ length: Y }, () => Array(Z).fill(null)));
  let idx = 0;
  for (let i = 0; i < X; i++) for (let j = 0; j < Y; j++) for (let k = 0; k < Z; k++) {
    const mesh = new THREE.Mesh(tileGeo, iconMaterial(icons[idx]));
    mesh.position.copy(cellPos(i, j, k));
    const t = { i, j, k, icon: icons[idx++], mesh, alive: true };
    mesh.userData.tile = t;
    grid[i][j][k] = t;
    tiles.push(t);
    cluster.add(mesh);
  }
  cluster.quaternion.identity();
  // 稍微转一点角度，一开始就能看出是立体的
  cluster.rotation.set(0.25, -0.35, 0);
  state = 'playing';
  score = 0; combo = 0; lastMatch = -99;
  startTime = performance.now(); endTime = 0;
  selected = null; stroke = null; grab = null; hintUntil = 0;
  selBox.visible = false; hintBoxes.forEach((b) => (b.visible = false));
  refreshButtons();
  setStatus('用手柄尖端碰一个方块，按住扳机画线到相同图案');
  sfx.click();
}

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const alive = () => tiles.filter((t) => t.alive);

// ================= 经典规则：最多拐两个弯的路径 =================
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function findPath(a, b) {
  if (a === b || a.icon !== b.icon) return null;
  const [X, Y, Z] = cfg.dims;
  const inside = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < X && j < Y && k < Z;
  const inBounds = (i, j, k) => i >= -1 && j >= -1 && k >= -1 && i <= X && j <= Y && k <= Z;
  const free = (i, j, k) => !inside(i, j, k) || !grid[i][j][k] || grid[i][j][k] === b;
  const key = (i, j, k, d) => `${i},${j},${k},${d}`;
  const best = new Map();
  const queue = [];
  for (let d = 0; d < 6; d++) queue.push({ i: a.i, j: a.j, k: a.k, d, turns: 0, prev: null, start: true });
  while (queue.length) {
    const s = queue.shift();
    const [di, dj, dk] = DIRS[s.d];
    const ni = s.i + di, nj = s.j + dj, nk = s.k + dk;
    if (!inBounds(ni, nj, nk) || !free(ni, nj, nk)) continue;
    const node = { i: ni, j: nj, k: nk, d: s.d, turns: s.turns, prev: s.start ? { i: a.i, j: a.j, k: a.k, prev: null } : s };
    if (ni === b.i && nj === b.j && nk === b.k) {
      const cells = [];
      for (let p = node; p; p = p.prev) cells.push([p.i, p.j, p.k]);
      return simplifyPath(cells.reverse());
    }
    for (let d = 0; d < 6; d++) {
      const turns = node.turns + (d === node.d ? 0 : 1);
      if (turns > 2) continue;
      const kk = key(ni, nj, nk, d);
      if (best.has(kk) && best.get(kk) <= turns) continue;
      best.set(kk, turns);
      const next = { ...node, d, turns };
      if (d === node.d) queue.unshift(next); else queue.push(next);
    }
  }
  return null;
}
// 只保留拐点，画出来的线更干净
function simplifyPath(cells) {
  const out = [cells[0]];
  for (let n = 1; n < cells.length - 1; n++) {
    const a = cells[n - 1], b = cells[n], c = cells[n + 1];
    const d1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], d2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    if (d1[0] !== d2[0] || d1[1] !== d2[1] || d1[2] !== d2[2]) out.push(b);
  }
  out.push(cells[cells.length - 1]);
  return out;
}
function anyPair() {
  const list = alive();
  for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
    if (list[x].icon === list[y].icon && findPath(list[x], list[y])) return [list[x], list[y]];
  }
  return null;
}

// ================= 连上一对 =================
function match(a, b, localPoints) {
  a.alive = false; b.alive = false;
  grid[a.i][a.j][a.k] = null;
  grid[b.i][b.j][b.k] = null;
  combo = clock - lastMatch < COMBO_WINDOW ? combo + 1 : 1;
  lastMatch = clock;
  const gained = 10 * combo;
  score += gained;
  flashLine(localPoints, '#ffd166', 0.6);
  pop(a); pop(b);
  sfx.perfect(Math.min(combo, 3));
  app.pulseAll(0.6, 70);
  if (selected === a || selected === b) { selected = null; selBox.visible = false; }
  hintBoxes.forEach((h) => (h.visible = false));
  const left = alive().length;
  if (left === 0) return win();
  setStatus(combo > 1 ? `连击 ×${combo}！+${gained}` : `+${gained}  还剩 ${left / 2} 对`);
}

function win() {
  state = 'won';
  endTime = performance.now();
  const t = endTime - startTime;
  const bestKey = 'link-best-' + presetKey;
  const best = Number(loadPref(bestKey, '0')) || 0;
  const record = !best || t < best;
  if (record) savePref(bestKey, String(t));
  sfx.win();
  confetti();
  setStatus(record ? `全部连完！新纪录 ${fmt(t)}` : `全部连完！用时 ${fmt(t)}`);
}

// ================= 用手画线 =================
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
function tipWorld(c, target = new THREE.Vector3()) {
  target.setFromMatrixPosition(c.ray.matrixWorld);
  tmpV.set(0, 0, -1).applyQuaternion(c.ray.getWorldQuaternion(tmpQ));
  return target.addScaledVector(tmpV, TIP);
}
function tileAtLocal(p, pad) {
  let best = null, bestD = Infinity;
  for (const t of tiles) {
    if (!t.alive) continue;
    const q = t.mesh.position;
    const dx = Math.abs(p.x - q.x), dy = Math.abs(p.y - q.y), dz = Math.abs(p.z - q.z);
    if (dx < HALF + pad && dy < HALF + pad && dz < HALF + pad) {
      const d = dx + dy + dz;
      if (d < bestD) { bestD = d; best = t; }
    }
  }
  return best;
}
// 线段 p0→p1 与方块（轴对齐盒子）的相交，返回进入点的参数 t（0~1），没碰到返回 null
function segBox(p0, p1, center, h) {
  let tmin = 0, tmax = 1;
  for (const ax of ['x', 'y', 'z']) {
    const d = p1[ax] - p0[ax];
    const lo = center[ax] - h, hi = center[ax] + h;
    if (Math.abs(d) < 1e-9) {
      if (p0[ax] < lo || p0[ax] > hi) return null;
    } else {
      let t1 = (lo - p0[ax]) / d, t2 = (hi - p0[ax]) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

function startStroke(c, from) {
  stroke = { c, from, points: [from.mesh.position.clone()], line: makeLine('#9bf6ff') };
  selected = null;
  selBox.visible = false;
  sfx.click();
  app.pulse(c, 0.4, 30);
}

function updateStroke() {
  const local = cluster.worldToLocal(tipWorld(stroke.c));
  const last = stroke.points[stroke.points.length - 1];
  if (local.distanceTo(last) > 0.004) {
    // 检查这一小段有没有穿过别的方块
    let hit = null, hitT = Infinity;
    for (const t of tiles) {
      if (!t.alive || t === stroke.from) continue;
      const tt = segBox(last, local, t.mesh.position, HALF - (t.icon === stroke.from.icon ? -0.004 : FORGIVE));
      if (tt !== null && tt < hitT) { hitT = tt; hit = t; }
    }
    if (hit) {
      if (hit.icon === stroke.from.icon) {
        const pts = [...stroke.points, hit.mesh.position.clone()];
        const from = stroke.from;
        disposeLine(stroke.line);
        stroke = null;
        match(from, hit, pts);
        return;
      }
      // 碰到别的图案：线断了
      const pts = [...stroke.points, last.clone().lerp(local, hitT)];
      disposeLine(stroke.line);
      flashLine(pts, '#ff4d4d', 0.5);
      flashTile(hit, '#ff4d4d');
      sfx.warn();
      app.pulse(stroke.c, 0.9, 120);
      stroke = null;
      combo = 0;
      setStatus('碰到别的方块了，线断了');
      return;
    }
    stroke.points.push(local);
  }
  setLinePoints(stroke.line, [...stroke.points, local]);
}

function cancelStroke() {
  if (!stroke) return;
  flashLine([...stroke.points], '#9bf6ff', 0.25);
  disposeLine(stroke.line);
  stroke = null;
}

// ================= 用射线点选 =================
function clickTile(t) {
  if (state !== 'playing' || !t.alive) return;
  if (!selected) { select(t); return; }
  if (selected === t) { selected = null; selBox.visible = false; return; }
  if (selected.icon === t.icon) {
    const path = findPath(selected, t);
    if (path) { match(selected, t, path.map(([i, j, k]) => cellPos(i, j, k))); return; }
    setStatus('被挡住了：试试用手画线，或者转一下立方体');
    sfx.warn();
    flashTile(t, '#ff9f43');
    return;
  }
  select(t);
}
function select(t) {
  selected = t;
  selBox.visible = true;
  selBox.position.copy(t.mesh.position);
  sfx.click();
}

// ================= 线和特效 =================
function makeLine(color) {
  const mat = new LineMaterial({ color, linewidth: 0.007, worldUnits: true, transparent: true, depthTest: true });
  mat.resolution.set(innerWidth, innerHeight);
  const line = new Line2(new LineGeometry(), mat);
  line.frustumCulled = false;
  cluster.add(line);
  return line;
}
function setLinePoints(line, pts) {
  if (pts.length < 2) { line.visible = false; return; }
  line.visible = true;
  const arr = [];
  for (const p of pts) arr.push(p.x, p.y, p.z);
  line.geometry.dispose();
  line.geometry = new LineGeometry();
  line.geometry.setPositions(arr);
}
function disposeLine(line) {
  cluster.remove(line);
  line.geometry.dispose();
  line.material.dispose();
}
function flashLine(pts, color, life) {
  const line = makeLine(color);
  setLinePoints(line, pts);
  line.material.linewidth = 0.01;
  effects.push({ t: 0, life, update: (k) => { line.material.opacity = 1 - k; }, done: () => disposeLine(line) });
}
function flashTile(t, color) {
  const box = outline(color);
  box.visible = true;
  box.position.copy(t.mesh.position);
  effects.push({ t: 0, life: 0.5, update: (k) => { box.material.opacity = 1 - k; box.scale.setScalar(1 + k * 0.3); }, done: () => { cluster.remove(box); box.geometry.dispose(); box.material.dispose(); } });
}
function pop(t) {
  const m = t.mesh;
  effects.push({
    t: 0, life: 0.35,
    update: (k) => { m.scale.setScalar(k < 0.3 ? 1 + k : (1.3 * (1 - (k - 0.3) / 0.7))); m.rotation.y += 0.3; },
    done: () => cluster.remove(m),
  });
  sparkle(m.position);
}
const dotTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
function sparkle(at, n = 24, color = '#fff2b0', speed = 0.35, inScene = false) {
  const pos = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
    vel.push(new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.4 + Math.random())));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, size: inScene ? 0.04 : 0.014, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  (inScene ? scene : cluster).add(pts);
  let last = 0;
  effects.push({
    t: 0, life: inScene ? 2.5 : 0.6,
    update: (k, t) => {
      const dt = t - last; last = t;
      for (let i = 0; i < n; i++) {
        if (inScene) vel[i].y -= 1.5 * dt;
        pos[i * 3] += vel[i].x * dt; pos[i * 3 + 1] += vel[i].y * dt; pos[i * 3 + 2] += vel[i].z * dt;
      }
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = 1 - k;
    },
    done: () => { (inScene ? scene : cluster).remove(pts); geo.dispose(); pts.material.dispose(); },
  });
}
function confetti() {
  const at = rig.localToWorld(new THREE.Vector3(0, 0.2, 0));
  for (const c of ['#ffd166', '#5cffb0', '#5aa9ff', '#ff7a2f', '#c891ff']) sparkle(at, 50, c, 1.6, true);
}

// ================= 提示 / 洗牌 =================
function showHint() {
  if (state !== 'playing') return;
  const pair = anyPair();
  if (!pair) { setStatus('经典规则下没有能连的了，可以用手画线或者洗牌'); sfx.warn(); return; }
  pair.forEach((t, n) => { hintBoxes[n].visible = true; hintBoxes[n].position.copy(t.mesh.position); });
  hintUntil = clock + 4;
  sfx.click();
}
function shuffleTiles() {
  if (state !== 'playing') return;
  const list = alive();
  const icons = shuffleArr(list.map((t) => t.icon));
  list.forEach((t, n) => { t.icon = icons[n]; t.mesh.material = iconMaterial(t.icon); });
  selected = null; selBox.visible = false;
  hintBoxes.forEach((h) => (h.visible = false));
  combo = 0;
  setStatus('洗好了');
  sfx.flag();
}

// ================= 面板 =================
const panelGroup = new THREE.Group();
panelGroup.position.set(-0.72, 0.12, -0.08);
panelGroup.rotation.y = 0.55;
rig.add(panelGroup);
const panel = makeCanvasPlane(0.62, 0.3, 1400);
panelGroup.add(panel.mesh);
const uiButtons = [];
const diffButtons = {};
Object.keys(PRESETS).forEach((k, n) => {
  const b = makeButton(PRESETS[k].label, { width: 0.19, height: 0.065, color: '#2f3f6e', onClick: () => newGame(k) });
  b.position.set((n - 1) * 0.205, -0.2, 0);
  panelGroup.add(b);
  diffButtons[k] = b;
  uiButtons.push(b);
});
const mk = (label, x, y, color, onClick, w = 0.3) => {
  const b = makeButton(label, { width: w, height: 0.065, color, onClick });
  b.position.set(x, y, 0);
  panelGroup.add(b);
  uiButtons.push(b);
  return b;
};
mk('提示', -0.155, -0.275, '#8a6a1f', showHint);
mk('洗牌', 0.155, -0.275, '#8a6a1f', shuffleTiles);
mk('重新开始 A/X', -0.155, -0.35, '#3a5bd9', () => newGame());
mk('移到面前 B/Y', 0.155, -0.35, '#3a5bd9', () => placeInFront());
const envButton = mk('背景：… ▶', 0, -0.425, '#5a4a2e', () => envs.next(), 0.61);
if (envs.label) envButton.userData.ui.setLabel(`背景：${envs.label} ▶`);

function refreshButtons() {
  for (const [k, b] of Object.entries(diffButtons)) b.userData.ui.setActive(k === presetKey);
}
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function drawPanel() {
  const best = Number(loadPref('link-best-' + presetKey, '0')) || 0;
  const t = (state === 'won' ? endTime : performance.now()) - startTime;
  panel.redraw((ctx, w, h) => {
    roundRect(ctx, 4, 4, w - 8, h - 8, 34);
    ctx.fillStyle = 'rgba(18, 25, 44, 0.9)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = state === 'won' ? '#5cffb0' : '#3b4a78';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#eef2fb';
    ctx.font = `800 64px ${FONT}`;
    ctx.fillText('空中连线', 40, 70);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f5b941';
    ctx.font = `800 80px ${FONT}`;
    ctx.fillText(String(score), w - 40, 76);
    ctx.textAlign = 'left';
    ctx.font = `600 38px ${FONT}`;
    ctx.fillStyle = '#c9d3ea';
    ctx.fillText(`还剩 ${alive().length / 2} 对`, 40, 160);
    ctx.fillText(`用时 ${fmt(t)}`, 300, 160);
    ctx.fillText(`最佳 ${best ? fmt(best) : '--'}`, 560, 160);
    ctx.font = `700 38px ${FONT}`;
    ctx.fillStyle = state === 'won' ? '#5cffb0' : '#eef2fb';
    ctx.fillText(statusText, 40, 300);
    ctx.font = `500 30px ${FONT}`;
    ctx.fillStyle = '#8f9bb8';
    ctx.fillText('按住握把可以转动立方体', 40, 360);
  });
}
function setStatus(t) { statusText = t; drawPanel(); }

let placeAfter = -1;
function placeInFront() {
  const head = app.headPosition(new THREE.Vector3());
  const f = app.headForward(new THREE.Vector3());
  const y = app.presenting ? head.y - 0.32 : 1.3;
  rig.position.set(head.x + f.x * 0.5, y, head.z + f.z * 0.5);
  rig.rotation.y = Math.atan2(-f.x, -f.z);
  sfx.click();
}

// ================= 每一帧 =================
let lastSecond = -1;
const tmpW = new THREE.Vector3();
function onFrame(dt) {
  clock += dt;
  envs.update(dt);

  if (app.presenting) {
    if (placeAfter > 0) { placeAfter -= dt; if (placeAfter <= 0) placeInFront(); }
    updateControllers();
    app.pollButtons((c, bi) => {
      if (bi === 4) newGame();
      if (bi === 5) placeInFront();
    });
  } else {
    controls.update();
  }

  if (stroke) updateStroke();
  if (grab) {
    const q = grab.c.grip.getWorldQuaternion(new THREE.Quaternion()).multiply(grab.invStart);
    const world = q.multiply(grab.startWorld);
    const rigQ = rig.getWorldQuaternion(new THREE.Quaternion()).invert();
    cluster.quaternion.copy(rigQ.multiply(world));
  }
  if (hintUntil && clock > hintUntil) { hintBoxes.forEach((h) => (h.visible = false)); hintUntil = 0; }
  for (const h of hintBoxes) if (h.visible) h.material.opacity = 0.6 + 0.4 * Math.sin(clock * 8);

  for (let n = effects.length - 1; n >= 0; n--) {
    const e = effects[n];
    e.t += dt;
    const k = Math.min(e.t / e.life, 1);
    e.update(k, e.t);
    if (k >= 1) { e.done?.(); effects.splice(n, 1); }
  }

  if (state === 'playing') {
    const s = Math.floor((performance.now() - startTime) / 1000);
    if (s !== lastSecond) { lastSecond = s; drawPanel(); }
  }
}

function updateControllers() {
  const targets = [...uiButtons, ...alive().map((t) => t.mesh)];
  const hovered = new Set();
  let hoverTile = null;
  app.controllers.forEach((c, n) => {
    const tip = tips[n];
    if (!c.inputSource) { tip.visible = false; return; }
    tip.visible = true;
    tip.position.copy(tipWorld(c, tmpW));
    // 笔尖碰到方块时变色
    const near = state === 'playing' && !stroke ? tileAtLocal(cluster.worldToLocal(tmpW.clone()), GRAB_PAD) : null;
    tip.material.color.set(stroke?.c === c ? '#9bf6ff' : near ? '#5cffb0' : '#ffffff');
    c.near = near;
    const hit = stroke?.c === c ? null : app.pointAt(c, targets, 3);
    c.hover = hit ? hit.object : null;
    if (c.hover) hovered.add(c.hover);
    if (c.hover?.userData.tile) hoverTile = c.hover.userData.tile;
  });
  for (const b of uiButtons) b.userData.ui.setHover(hovered.has(b));
  hoverBox.visible = !!hoverTile;
  if (hoverTile) hoverBox.position.copy(hoverTile.mesh.position);
}

app.on('select', (c) => {
  initAudio();
  if (c.hover?.userData.ui) { app.pulse(c, 0.4, 30); c.hover.userData.ui.onClick?.(); return; }
  if (state !== 'playing' || stroke) return;
  if (c.near) { startStroke(c, c.near); return; } // 笔尖碰着方块：开始用手画线
  if (c.hover?.userData.tile) { app.pulse(c, 0.3, 30); clickTile(c.hover.userData.tile); } // 射线点选
});
app.on('selectend', (c) => { if (stroke?.c === c) cancelStroke(); });
app.on('squeeze', (c) => {
  initAudio();
  grab = {
    c,
    invStart: c.grip.getWorldQuaternion(new THREE.Quaternion()).invert(),
    startWorld: cluster.getWorldQuaternion(new THREE.Quaternion()),
  };
  app.pulse(c, 0.3, 30);
});
app.on('squeezeend', (c) => { if (grab?.c === c) grab = null; });

// ================= 电脑上预览 =================
camera.position.set(0, 1.55, 0.45);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.3, -0.5);
controls.enableDamping = true;
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
  const hit = mouseRay.intersectObjects([...uiButtons, ...alive().map((t) => t.mesh)], false)[0];
  if (!hit) return;
  if (hit.object.userData.ui) hit.object.userData.ui.onClick?.();
  else clickTile(hit.object.userData.tile);
});
// 方向键转立方体
window.addEventListener('keydown', (e) => {
  if (app.presenting) return;
  const r = 0.2;
  const axis = { ArrowLeft: [0, 1, 0, -r], ArrowRight: [0, 1, 0, r], ArrowUp: [1, 0, 0, -r], ArrowDown: [1, 0, 0, r] }[e.key];
  if (axis) { e.preventDefault(); cluster.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(axis[0], axis[1], axis[2]), axis[3])); }
  if (e.key === 'h') showHint();
});
window.addEventListener('resize', () => {
  for (const o of cluster.children) if (o.isLine2) o.material.resolution.set(innerWidth, innerHeight);
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
const diffSelect = document.getElementById('diff-select');
let desktopPreview = false;
for (const e of ENVIRONMENTS) envSelect.add(new Option(e.label, e.key));
envSelect.value = savedEnvKey();
envSelect.addEventListener('change', () => envs.set(envSelect.value));
diffSelect.value = presetKey;
diffSelect.addEventListener('change', () => newGame(diffSelect.value));

(async () => {
  const [vr, ar] = await Promise.all([app.supports('immersive-vr'), app.supports('immersive-ar')]);
  btnVR.hidden = !vr;
  btnAR.hidden = !ar;
  if (!vr && !ar) note.textContent = '这台设备不支持 VR。可以先在电脑上预览：点两个相同的方块连线，方向键转立方体，H 键提示。';
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
});

newGame(presetKey);

// 调试用
window.linkgame = {
  get state() { return state; }, get score() { return score; }, get combo() { return combo; },
  get tiles() { return tiles; }, get stroke() { return stroke; },
  cluster, rig, camera, controls, envs, newGame, findPath, anyPair, clickTile, match, showHint, shuffleTiles,
  // 用一串（立方体局部坐标的）点模拟手画线
  simulateStroke(from, localPts) {
    stroke = { c: null, from, points: [from.mesh.position.clone()], line: makeLine('#9bf6ff') };
    for (const p of localPts) {
      if (!stroke) break;
      const last = stroke.points[stroke.points.length - 1];
      let hit = null, hitT = Infinity;
      for (const t of tiles) {
        if (!t.alive || t === from) continue;
        const tt = segBox(last, p, t.mesh.position, HALF - (t.icon === from.icon ? -0.004 : FORGIVE));
        if (tt !== null && tt < hitT) { hitT = tt; hit = t; }
      }
      if (hit) {
        disposeLine(stroke.line);
        const pts = [...stroke.points, hit.mesh.position.clone()];
        stroke = null;
        if (hit.icon === from.icon) { match(from, hit, pts); return 'matched'; }
        flashLine(pts, '#ff4d4d', 0.5);
        return 'blocked';
      }
      stroke.points.push(p.clone());
      setLinePoints(stroke.line, stroke.points);
    }
    if (stroke) { cancelStroke(); }
    return 'open';
  },
};
