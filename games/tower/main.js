// 方塔消消：一座多层的图案方块塔，绕着走、把“露出来”的方块收进 7 格槽，三个相同就消掉。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio } from '../../shared/sfx.js';
import { createEnvManager, ENVIRONMENTS, savedEnvKey } from '../../shared/env/index.js';
import { iconMaterial } from '../link/icons.js';

// ================= 可调参数 =================
// n：塔底是 n×n 根柱子；total：方块总数；maxH：最高几层
const PRESETS = {
  easy:   { label: '简单', n: 3, total: 27, maxH: 5, icons: 5 },
  normal: { label: '普通', n: 4, total: 54, maxH: 6, icons: 8 },
  hard:   { label: '困难', n: 5, total: 90, maxH: 7, icons: 12 },
};
const STEP = 0.09;        // 方块间距（米）
const TILE = 0.084;       // 方块边长
const LAYER_H = 0.09;     // 每层高度
const PEDESTAL_H = 0.8;   // 塔底座高度
const TOWER_AHEAD = 1.0;  // 塔离你多远
const TRAY_SLOTS = 7;
const TRAY_GAP = 0.075;   // 槽位间距
const TRAY_SCALE = 0.75;  // 方块进槽后缩小
const TIP = 0.045;        // 手柄尖端在手柄前方多远
const GRAB_PAD = 0.02;    // 尖端离方块多近算碰到

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

// rig：放在地上的塔（底座 + 塔身 + 旁边的小台子）
const rig = new THREE.Group();
rig.position.set(0, 0, -TOWER_AHEAD);
scene.add(rig);
const tower = new THREE.Group();
tower.position.y = PEDESTAL_H;
rig.add(tower);
{
  const stone = new THREE.MeshStandardMaterial({ color: '#8b8478', roughness: 0.85 });
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, PEDESTAL_H, 40), stone);
  ped.position.y = PEDESTAL_H / 2;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.03, 40), new THREE.MeshStandardMaterial({ color: '#a39b8d', roughness: 0.7 }));
  top.position.y = PEDESTAL_H - 0.015;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.06, 40), stone);
  foot.position.y = 0.03;
  rig.add(ped, top, foot);
}
// “移出 3 块”时放方块的小台子（底座前沿）
const SHELF = [-0.1, 0, 0.1].map((x) => new THREE.Vector3(x, TILE / 2 + 0.002, 0.355));

// 手柄尖端的小光球
const tips = app.controllers.map(() => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  m.visible = false;
  scene.add(m);
  return m;
});
const hoverBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE * 1.15, TILE * 1.15, TILE * 1.15)),
  new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true })
);
hoverBox.visible = false;
scene.add(hoverBox);

// ================= 收集槽（跟着你，飘在手边）=================
const tray = new THREE.Group();
scene.add(tray);
{
  const width = TRAY_GAP * TRAY_SLOTS + 0.03;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.012, 0.09), new THREE.MeshStandardMaterial({ color: '#2a2f45', roughness: 0.4, metalness: 0.3 }));
  bar.position.y = -0.04;
  tray.add(bar);
  for (let s = 0; s < TRAY_SLOTS; s++) {
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.066), new THREE.MeshBasicMaterial({ color: '#4a5378', transparent: true, opacity: 0.6 }));
    slot.rotation.x = -Math.PI / 2;
    slot.position.set(slotX(s), -0.033, 0);
    tray.add(slot);
  }
}
const trayGlow = new THREE.Mesh(
  new THREE.BoxGeometry(TRAY_GAP * TRAY_SLOTS + 0.06, 0.02, 0.12),
  new THREE.MeshBasicMaterial({ color: '#5cffb0', transparent: true, opacity: 0, depthWrite: false })
);
trayGlow.position.y = -0.045;
tray.add(trayGlow);
function slotX(s) { return (s - (TRAY_SLOTS - 1) / 2) * TRAY_GAP; }
const trayPos = (s) => new THREE.Vector3(slotX(s), 0, 0);

// ================= 状态 =================
let presetKey = loadPref('tower-preset', 'normal');
if (!PRESETS[presetKey]) presetKey = 'normal';
let cfg = PRESETS[presetKey];
let tiles = [];          // 所有方块
let trayList = [];       // 槽里的方块（按顺序）
let shelfList = [null, null, null];
let history = [];        // 用于撤销
let used = { undo: false, shuffle: false, out: false };
let state = 'playing';   // playing | won | lost
let startTime = 0, endTime = 0;
let statusText = '';
const effects = [];
const tileGeo = new THREE.BoxGeometry(TILE, TILE, TILE);

const dimCache = new Map();
function dimMaterial(i) {
  if (!dimCache.has(i)) {
    const m = iconMaterial(i).clone();
    m.color.set('#55586a');
    dimCache.set(i, m);
  }
  return dimCache.get(i);
}

// ---- 规则：正上方没有方块 + 同一层至少一侧是空的 ----
// 塔是一根根高低不同的柱子，所以外圈和比邻居高的柱子顶上的方块能拿，要绕着塔从四面找
const key = (L, cx, cz) => `${L},${cx},${cz}`;
function makeIndex(list) {
  const m = new Map();
  for (const t of list) m.set(key(t.L, t.cx, t.cz), t);
  return m;
}
function isFree(t, list, index) {
  if (index.has(key(t.L + 1, t.cx, t.cz))) return false;
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => index.has(key(t.L, t.cx + dx, t.cz + dz))).length;
  return sides < 4;
}

// ---- 生成关卡：先模拟一个合法的拿取顺序，再按顺序每 3 个一组分配图案（保证有解）----
function generate(spec) {
  const n = spec.n;
  // 每根柱子的高度：中间高、四周低，再加点随机，然后调整到总数刚好是 spec.total
  const c = (n - 1) / 2;
  const heights = [];
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
    const center = 1 - Math.max(Math.abs(x - c), Math.abs(z - c)) / (c + 1);
    heights.push({ x, z, h: Math.max(1, Math.round(1 + center * (spec.maxH - 1) + (Math.random() - 0.5) * 2)) });
  }
  let sum = heights.reduce((s, q) => s + q.h, 0);
  let guard = 0;
  while (sum !== spec.total && guard++ < 1000) {
    const q = heights[Math.floor(Math.random() * heights.length)];
    if (sum < spec.total && q.h < spec.maxH) { q.h++; sum++; }
    else if (sum > spec.total && q.h > 1) { q.h--; sum--; }
  }
  let pos = [];
  for (const q of heights) for (let L = 0; L < q.h; L++) pos.push({ L, cx: q.x, cz: q.z, n });
  while (pos.length % 3) pos.pop();
  const order = [];
  let rest = pos.slice();
  while (rest.length) {
    const idx = makeIndex(rest);
    const free = rest.filter((t) => isFree(t, rest, idx));
    const pick = free[Math.floor(Math.random() * free.length)];
    order.push(pick);
    rest = rest.filter((t) => t !== pick);
  }
  const groups = order.length / 3;
  const groupIcons = shuffleArr(Array.from({ length: groups }, (_, g) => g % spec.icons));
  // 每 6 块（两组）之间打乱一下，避免太好猜；最多同时占 5 格，7 格的槽一定装得下
  for (let w = 0; w < order.length; w += 6) {
    const win = order.slice(w, w + 6);
    const icons = [];
    for (let k = 0; k < win.length; k++) icons.push(groupIcons[Math.floor((w + k) / 3)]);
    shuffleArr(icons).forEach((ic, k) => (win[k].icon = ic));
  }
  return pos;
}
function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function towerLocal(t) {
  const c = (t.n - 1) / 2;
  return new THREE.Vector3((t.cx - c) * STEP, t.L * LAYER_H + LAYER_H / 2 + 0.002, (t.cz - c) * STEP);
}

function newGame(k = presetKey) {
  presetKey = k;
  savePref('tower-preset', k);
  cfg = PRESETS[k];
  for (const t of tiles) t.mesh.parent?.remove(t.mesh);
  for (const c of app.controllers) c.held = null;
  tiles = [];
  trayList = [];
  shelfList = [null, null, null];
  history = [];
  used = { undo: false, shuffle: false, out: false };
  effects.length = 0;
  for (const p of generate(cfg)) {
    const mesh = new THREE.Mesh(tileGeo, iconMaterial(p.icon));
    const t = { ...p, mesh, where: 'tower', target: null, free: false };
    mesh.userData.tile = t;
    mesh.position.copy(towerLocal(t));
    tower.add(mesh);
    tiles.push(t);
  }
  refreshFree();
  state = 'playing';
  startTime = performance.now();
  endTime = 0;
  refreshButtons();
  setStatus('拿亮着的方块，三个相同就消掉');
  sfx.click();
}

function towerTiles() { return tiles.filter((t) => t.where === 'tower'); }
function refreshFree() {
  const list = towerTiles();
  const idx = makeIndex(list);
  for (const t of list) {
    t.free = isFree(t, list, idx);
    t.mesh.material = t.free ? iconMaterial(t.icon) : dimMaterial(t.icon);
  }
}

// ================= 拿方块 =================
function canTake(t) {
  return state === 'playing' && ((t.where === 'tower' && t.free) || t.where === 'shelf');
}
function take(t, force = false) {
  if (!force && !canTake(t)) {
    if (state === 'playing' && t.where === 'tower') { sfx.warn(); app.pulseAll(0.5, 80); setStatus('这块被压住或者四面都被挡住了'); }
    return false;
  }
  const from = t.origin || (t.where === 'shelf' ? { where: 'shelf', slot: shelfList.indexOf(t) } : { where: 'tower' });
  t.origin = null;
  if (t.where === 'shelf') shelfList[from.slot] = null;
  t.where = 'tray';
  // 插到槽里相同图案的后面
  let at = trayList.length;
  for (let n = trayList.length - 1; n >= 0; n--) if (trayList[n].icon === t.icon) { at = n + 1; break; }
  trayList.splice(at, 0, t);
  t.mesh.material = iconMaterial(t.icon);
  tray.attach(t.mesh);
  history.push({ tile: t, from });
  sfx.flag();
  app.pulseAll(0.35, 40);
  refreshFree();
  layoutTray();
  checkTriples();
  return true;
}

function layoutTray() {
  trayList.forEach((t, n) => { t.target = trayPos(n); });
}

function checkTriples() {
  const counts = {};
  for (const t of trayList) counts[t.icon] = (counts[t.icon] || 0) + 1;
  const icon = Object.keys(counts).find((ic) => counts[ic] >= 3);
  if (icon !== undefined) {
    const three = trayList.filter((t) => String(t.icon) === icon).slice(0, 3);
    trayList = trayList.filter((t) => !three.includes(t));
    for (const t of three) {
      t.where = 'gone';
      history = history.filter((h) => h.tile !== t);
      const m = t.mesh;
      effects.push({ t: 0, life: 0.45, delay: 0.25, update: (k) => m.scale.setScalar(TRAY_SCALE * (k < 0.3 ? 1 + k : 1.3 * (1 - (k - 0.3) / 0.7))), done: () => { sparkle(m.getWorldPosition(new THREE.Vector3())); m.parent?.remove(m); } });
    }
    layoutTray();
    sfx.perfect(2);
    app.pulseAll(0.7, 90);
    if (!tiles.some((t) => t.where === 'tower' || t.where === 'shelf' || t.where === 'tray')) return win();
    setStatus(`消掉一组！还剩 ${tiles.filter((t) => t.where !== 'gone').length} 块`);
  } else if (trayList.length >= TRAY_SLOTS) {
    lose();
  } else if (trayList.length >= TRAY_SLOTS - 2) {
    setStatus(`小心，槽里只剩 ${TRAY_SLOTS - trayList.length} 格了`);
  } else {
    setStatus(`还剩 ${tiles.filter((t) => t.where !== 'gone').length} 块`);
  }
}

function win() {
  state = 'won';
  endTime = performance.now();
  const ms = endTime - startTime;
  const bestKey = 'tower-best-' + presetKey;
  const best = Number(loadPref(bestKey, '0')) || 0;
  const record = !best || ms < best;
  if (record) savePref(bestKey, String(ms));
  sfx.win();
  confetti();
  setStatus(record ? `塔拆完了！新纪录 ${fmt(ms)}` : `塔拆完了！用时 ${fmt(ms)}`);
  refreshButtons();
}
function lose() {
  state = 'lost';
  endTime = performance.now();
  sfx.fall();
  app.pulseAll(1, 400);
  setStatus('槽满了！按 A/X 再来一局');
  refreshButtons();
}

// ================= 道具 =================
function undo() {
  if (used.undo || state !== 'playing') return;
  const h = history.pop();
  if (!h || h.tile.where !== 'tray') { setStatus('没有可以撤销的'); sfx.warn(); return; }
  used.undo = true;
  const t = h.tile;
  trayList = trayList.filter((x) => x !== t);
  if (h.from.where === 'shelf') {
    t.where = 'shelf';
    shelfList[h.from.slot] = t;
    rig.attach(t.mesh);
    t.target = SHELF[h.from.slot].clone();
  } else {
    t.where = 'tower';
    tower.attach(t.mesh);
    t.target = towerLocal(t);
  }
  layoutTray();
  refreshFree();
  refreshButtons();
  sfx.unflag();
  setStatus('撤销了一步');
}
function shuffleTower() {
  if (used.shuffle || state !== 'playing') return;
  used.shuffle = true;
  const list = towerTiles();
  const icons = shuffleArr(list.map((t) => t.icon));
  list.forEach((t, n) => (t.icon = icons[n]));
  refreshFree();
  refreshButtons();
  sfx.flag();
  setStatus('塔上的图案打乱了');
}
function moveOut() {
  if (used.out || state !== 'playing' || trayList.length === 0) return;
  used.out = true;
  const three = trayList.slice(0, 3);
  trayList = trayList.slice(3);
  three.forEach((t, n) => {
    t.where = 'shelf';
    shelfList[n] = t;
    rig.attach(t.mesh);
    t.target = SHELF[n].clone();
    history = history.filter((h) => h.tile !== t);
  });
  layoutTray();
  refreshButtons();
  sfx.unflag();
  setStatus('3 块放到了塔前的台子上，随时可以再拿');
}

// ================= 特效 =================
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
function sparkle(at, n = 22, color = '#fff2b0', speed = 0.35, size = 0.014, life = 0.6, gravity = 0) {
  const pos = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
    vel.push(new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.4 + Math.random())));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, size, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(pts);
  let last = 0;
  effects.push({
    t: 0, life,
    update: (k, t) => {
      const dt = t - last; last = t;
      for (let i = 0; i < n; i++) {
        vel[i].y -= gravity * dt;
        pos[i * 3] += vel[i].x * dt; pos[i * 3 + 1] += vel[i].y * dt; pos[i * 3 + 2] += vel[i].z * dt;
      }
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = 1 - k;
    },
    done: () => { scene.remove(pts); geo.dispose(); pts.material.dispose(); },
  });
}
function confetti() {
  const at = tower.localToWorld(new THREE.Vector3(0, 0.5, 0));
  for (const c of ['#ffd166', '#5cffb0', '#5aa9ff', '#ff7a2f', '#c891ff']) sparkle(at, 50, c, 1.8, 0.04, 2.5, 1.5);
}

// ================= 面板（立在塔旁边，总是转向你）=================
const panelGroup = new THREE.Group();
panelGroup.position.set(0.72, 1.35, 0);
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
const mk = (label, x, y, color, onClick, w = 0.19) => {
  const b = makeButton(label, { width: w, height: 0.065, color, onClick });
  b.position.set(x, y, 0);
  panelGroup.add(b);
  uiButtons.push(b);
  return b;
};
const undoBtn = mk('撤销', -0.205, -0.275, '#8a6a1f', undo);
const shuffleBtn = mk('洗牌', 0, -0.275, '#8a6a1f', shuffleTower);
const outBtn = mk('移出 3 块', 0.205, -0.275, '#8a6a1f', moveOut);
mk('重新开始 A/X', -0.155, -0.35, '#3a5bd9', () => newGame(), 0.3);
mk('移到面前 B/Y', 0.155, -0.35, '#3a5bd9', () => placeInFront(), 0.3);
const envButton = mk('背景：… ▶', 0, -0.425, '#5a4a2e', () => envs.next(), 0.61);
if (envs.label) envButton.userData.ui.setLabel(`背景：${envs.label} ▶`);

function refreshButtons() {
  for (const [k, b] of Object.entries(diffButtons)) b.userData.ui.setActive(k === presetKey);
  undoBtn.userData.ui.setDisabled(used.undo || state !== 'playing');
  shuffleBtn.userData.ui.setDisabled(used.shuffle || state !== 'playing');
  outBtn.userData.ui.setDisabled(used.out || state !== 'playing');
}
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function drawPanel() {
  const best = Number(loadPref('tower-best-' + presetKey, '0')) || 0;
  const ms = (state === 'playing' ? performance.now() : endTime) - startTime;
  panel.redraw((ctx, w, h) => {
    roundRect(ctx, 4, 4, w - 8, h - 8, 34);
    ctx.fillStyle = 'rgba(18, 25, 44, 0.9)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = state === 'won' ? '#5cffb0' : state === 'lost' ? '#ff6b6b' : '#3b4a78';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#eef2fb';
    ctx.font = `800 64px ${FONT}`;
    ctx.fillText('方塔消消', 40, 70);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f5b941';
    ctx.font = `700 44px ${FONT}`;
    ctx.fillText(`槽 ${trayList.length}/${TRAY_SLOTS}`, w - 40, 72);
    ctx.textAlign = 'left';
    ctx.font = `600 38px ${FONT}`;
    ctx.fillStyle = '#c9d3ea';
    ctx.fillText(`剩 ${tiles.filter((t) => t.where !== 'gone').length} 块`, 40, 160);
    ctx.fillText(`用时 ${fmt(ms)}`, 290, 160);
    ctx.fillText(`最佳 ${best ? fmt(best) : '--'}`, 560, 160);
    ctx.font = `700 38px ${FONT}`;
    ctx.fillStyle = state === 'won' ? '#5cffb0' : state === 'lost' ? '#ff8a8a' : '#eef2fb';
    ctx.fillText(statusText, 40, 290);
    ctx.font = `500 30px ${FONT}`;
    ctx.fillStyle = '#8f9bb8';
    ctx.fillText('亮着的方块才能拿：上面没压着、至少一侧空着', 40, 360);
  });
}
function setStatus(t) { statusText = t; drawPanel(); }

let placeAfter = -1;
function placeInFront() {
  const head = app.headPosition(new THREE.Vector3());
  const f = app.headForward(new THREE.Vector3());
  rig.position.set(head.x + f.x * TOWER_AHEAD, 0, head.z + f.z * TOWER_AHEAD);
  rig.rotation.y = Math.atan2(-f.x, -f.z);
  sfx.click();
}

// ================= 每一帧 =================
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const headP = new THREE.Vector3(), headF = new THREE.Vector3();
let lastSecond = -1;
let trayInit = false;

function tipWorld(c, target) {
  target.setFromMatrixPosition(c.ray.matrixWorld);
  tmpV.set(0, 0, -1).applyQuaternion(c.ray.getWorldQuaternion(tmpQ));
  return target.addScaledVector(tmpV, TIP);
}

function onFrame(dt) {
  envs.update(dt);
  app.headPosition(headP);
  app.headForward(headF);

  // 收集槽：挂在你左手边、腰的高度（像个腰包），不挡你看塔；转身时它也跟着转过来
  const left = new THREE.Vector3(headF.z, 0, -headF.x);
  const want = headP.clone().addScaledVector(headF, 0.24).addScaledVector(left, app.presenting ? 0.36 : 0.3);
  want.y = headP.y - (app.presenting ? 0.62 : 0.42);
  const yaw = Math.atan2(-headF.x, -headF.z) + 0.55; // 稍微侧过来朝着你
  if (!trayInit) { tray.position.copy(want); tray.rotation.y = yaw; trayInit = true; }
  tray.position.lerp(want, Math.min(1, dt * 4));
  let dy = yaw - tray.rotation.y;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  tray.rotation.y += dy * Math.min(1, dt * 4);

  // 面板：永远在塔的旁边（从你这边看是塔的右侧），不会挡在你和塔之间；并且转向你
  const tc = rig.localToWorld(new THREE.Vector3(0, 0, 0));
  const toTower = tc.clone().sub(headP).setY(0);
  if (toTower.lengthSq() > 1e-4) {
    toTower.normalize();
    const side = new THREE.Vector3(-toTower.z, 0, toTower.x); // 塔的右手边
    const pwWant = tc.clone().addScaledVector(side, 0.78).addScaledVector(toTower, 0.05);
    pwWant.y = 1.35;
    const localWant = rig.worldToLocal(pwWant);
    panelGroup.position.lerp(localWant, Math.min(1, dt * 3));
  }
  const pw = panelGroup.getWorldPosition(new THREE.Vector3());
  panelGroup.rotation.y = Math.atan2(headP.x - pw.x, headP.z - pw.z) - rig.rotation.y;
  // 拿着方块靠近槽时，槽亮起来
  const holding = app.controllers.find((c) => c.held && nearTray(c.held));
  trayGlow.material.opacity = holding ? 0.55 + 0.25 * Math.sin(performance.now() / 90) : 0;

  // 方块飞向目标位置
  for (const t of tiles) {
    if (!t.target || t.where === 'gone') continue;
    t.mesh.position.lerp(t.target, Math.min(1, dt * 10));
    const s = t.where === 'tray' ? TRAY_SCALE : 1;
    t.mesh.scale.lerp(tmpV.set(s, s, s), Math.min(1, dt * 10));
    t.mesh.quaternion.slerp(tmpQ.identity(), Math.min(1, dt * 10));
  }

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

  for (let n = effects.length - 1; n >= 0; n--) {
    const e = effects[n];
    if (e.delay > 0) { e.delay -= dt; continue; }
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

function pickable() {
  return tiles.filter((t) => t.where === 'tower' || t.where === 'shelf');
}
function updateControllers() {
  const list = pickable();
  const targets = [...uiButtons, ...list.map((t) => t.mesh)];
  const hovered = new Set();
  let hoverTile = null;
  app.controllers.forEach((c, n) => {
    const tip = tips[n];
    if (!c.inputSource) { tip.visible = false; return; }
    tip.visible = true;
    tipWorld(c, tip.position);
    // 尖端碰到的方块
    let near = null, nearD = Infinity;
    for (const t of list) {
      const p = t.mesh.getWorldPosition(tmpV);
      const d = p.distanceTo(tip.position);
      if (d < TILE / 2 + GRAB_PAD && d < nearD) { nearD = d; near = t; }
    }
    c.near = near;
    tip.material.color.set(near ? (canTake(near) ? '#5cffb0' : '#ff6b6b') : '#ffffff');
    const hit = app.pointAt(c, targets, 4);
    c.hover = hit ? hit.object : null;
    if (c.hover) hovered.add(c.hover);
    const ht = near || c.hover?.userData.tile;
    if (ht) hoverTile = ht;
  });
  for (const b of uiButtons) b.userData.ui.setHover(hovered.has(b));
  hoverBox.visible = !!hoverTile;
  if (hoverTile) {
    hoverTile.mesh.getWorldPosition(hoverBox.position);
    hoverBox.quaternion.copy(rig.quaternion);
    hoverBox.material.color.set(canTake(hoverTile) ? '#ffffff' : '#ff6b6b');
  }
}

// 扳机或握把：手柄尖端碰着方块 = 用手捏起来；射线指着远处的方块 = 直接收进槽
function press(c) {
  initAudio();
  if (c.held) return;
  if (c.hover?.userData.ui) { app.pulse(c, 0.4, 30); c.hover.userData.ui.onClick?.(); return; }
  if (c.near) { grab(c, c.near); return; }
  const t = c.hover?.userData.tile;
  if (t) take(t);
}
app.on('select', press);
app.on('squeeze', press);
app.on('selectend', (c) => release(c));
app.on('squeezeend', (c) => release(c));

function grab(c, t) {
  if (!canTake(t)) { take(t); return; } // 拿不了：给出提示
  t.origin = t.where === 'shelf' ? { where: 'shelf', slot: shelfList.indexOf(t) } : { where: 'tower' };
  if (t.where === 'shelf') shelfList[t.origin.slot] = null;
  t.where = 'hand';
  t.mesh.material = iconMaterial(t.icon);
  c.ray.attach(t.mesh);
  t.target = new THREE.Vector3(0, 0, -TIP - 0.02);
  c.held = t;
  refreshFree();
  sfx.click();
  app.pulse(c, 0.5, 40);
  setStatus('拿起来了：放进左手边的槽里');
}
function nearTray(t) {
  const p = tray.worldToLocal(t.mesh.getWorldPosition(new THREE.Vector3()));
  return Math.abs(p.x) < (TRAY_GAP * TRAY_SLOTS) / 2 + 0.1 && Math.abs(p.y) < 0.18 && Math.abs(p.z) < 0.18;
}
function release(c) {
  const t = c.held;
  if (!t) return;
  c.held = null;
  if (state === 'playing' && nearTray(t)) {
    t.where = t.origin.where;
    take(t, true);
    return;
  }
  // 没放进槽：放回原处
  if (t.origin.where === 'shelf') {
    t.where = 'shelf';
    shelfList[t.origin.slot] = t;
    rig.attach(t.mesh);
    t.target = SHELF[t.origin.slot].clone();
  } else {
    t.where = 'tower';
    tower.attach(t.mesh);
    t.target = towerLocal(t);
  }
  t.origin = null;
  refreshFree();
  sfx.unflag();
  setStatus('放回去了');
}

// ================= 电脑上预览 =================
camera.position.set(0.5, 1.75, 0.35);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, -1.0);
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
  const hit = mouseRay.intersectObjects([...uiButtons, ...pickable().map((t) => t.mesh)], false)[0];
  if (!hit) return;
  if (hit.object.userData.ui) hit.object.userData.ui.onClick?.();
  else take(hit.object.userData.tile);
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
  if (!vr && !ar) note.textContent = '这台设备不支持 VR。可以先在电脑上预览：点亮着的方块把它收进槽里，拖动转视角。';
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
window.towergame = {
  get state() { return state; }, get tiles() { return tiles; }, get tray() { return trayList; }, get used() { return used; },
  take, undo, shuffleTower, moveOut, newGame, generate, isFree, makeIndex, camera, controls, envs, rig,
  freeTiles() { return tiles.filter((t) => (t.where === 'tower' && t.free) || t.where === 'shelf'); },
};
