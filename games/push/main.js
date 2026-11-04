// 大力搬箱：关卡按真实尺寸铺在地板上，你走过去用身体把箱子推到目标点。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio } from '../../shared/sfx.js';
import { createEnvManager, ENVIRONMENTS, savedEnvKey } from '../../shared/env/index.js';
import { makePawn } from '../jump/themes.js';
import { HANDMADE, parse, step, solved, solve, generate, DIRS } from './levels.js';
import { createFeet } from '../../shared/feet.js';
import { makeExitButton } from '../../shared/exit.js';
import { createWristMap } from '../../shared/wrist.js';
import { fitRect } from '../../shared/room.js';
import { safeInset, area as polyArea } from '../../shared/geometry2d.js';

// ================= 可调参数 =================
const CELL = 0.45;        // 每格边长（米）
const BOX = 0.4;          // 箱子边长（底面）
const BOX_H = 0.85;       // 箱子高度：差不多到腰，有用手推的感觉
const WALL_H = 0.55;      // 墙高
const ENTER = 0.42;       // 头部投影离格子中心多近（以格为单位）才算走进这一格（防抖）
const MAX_CATCHUP = 5;    // 走得快时一帧里最多补走几步
const STICK_ON = 0.7, STICK_OFF = 0.3; // 摇杆推到多少算走一步

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
  if (mode !== 'desktop') { placeAfter = 0.6; guardianPoly = null; }
});
// 安全边界：关卡一定放在它里面（试玩反馈：之前会超出去）
let guardianPoly = null;
app.on('bounds', (pts) => {
  const poly = safeInset(pts, 0.2);
  if (polyArea(poly) < 1) return;
  guardianPoly = poly;
  if (steps === 0 && level) placeLevel(false);
});

function loadPref(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } }
function savePref(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 无痕模式 */ } }

const rig = new THREE.Group();   // 整个关卡（局部坐标：格子 (x, y) → (x*CELL, 0, y*CELL)，y 越小越靠前）
scene.add(rig);
const levelGroup = new THREE.Group();
rig.add(levelGroup);

// ---- 贴图 ----
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const crateTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#b07a42'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) { g.fillStyle = 'rgba(70,40,15,0.7)'; g.fillRect(0, y, w, 3); }
  g.strokeStyle = '#6b4220'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
  g.lineWidth = 9; g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, h - 10); g.stroke();
});
const crateSideTex = canvasTex(128, 256, (g, w, h) => {
  for (const y0 of [0, 128]) {
    g.fillStyle = '#b07a42'; g.fillRect(0, y0, w, 128);
    for (let y = 0; y < 128; y += 32) { g.fillStyle = 'rgba(70,40,15,0.7)'; g.fillRect(0, y0 + y, w, 3); }
    g.strokeStyle = '#6b4220'; g.lineWidth = 12; g.strokeRect(6, y0 + 6, w - 12, 116);
    g.lineWidth = 9; g.beginPath(); g.moveTo(10, y0 + 10); g.lineTo(w - 10, y0 + 118); g.stroke();
  }
});
const tileTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#cfc6b4'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(90,80,60,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  g.strokeStyle = 'rgba(80,70,55,0.6)'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
});
const wallTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#7d766a'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? -32 : 0; x < w; x += 64) {
    g.fillStyle = ['#8f877a', '#857d70', '#9a9284'][Math.floor(Math.random() * 3)];
    g.fillRect(x + 2, y + 2, 60, 28);
  }
});

const mats = {
  floor: new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.85 }),
  wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }),
  wallTop: new THREE.MeshStandardMaterial({ color: '#a59d8f', roughness: 0.8 }),
  goal: new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, depthWrite: false }),
};

// ================= 关卡状态 =================
let levelIndex = Number(loadPref('push-level', '0')) || 0; // 0..HANDMADE.length-1 是手写关卡，之后都是随机关卡
let level = null;      // { w, h, walls, goals, boxes, player, name, best? }
let st = null;         // { player, boxes }
let history = [];
let steps = 0;
let state = 'playing'; // playing | won
let boxMeshes = [];
let goalMeshes = [];
let floorMeshes = [];
let statusText = '';
let physCell = null;   // 你身体所在的格子（头部投影）
let blockedFlash = 0;
const effects = [];

const avatar = makePawn('runner');
avatar.scale.setScalar(4.2);
avatar.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; } });
rig.add(avatar);
// 卡通脚：看得见自己踩在哪一格
const feet = createFeet({ color: '#3a86ff', accent: '#ffd166' });
scene.add(feet.object);
const youRing = new THREE.Mesh(
  new THREE.RingGeometry(CELL * 0.36, CELL * 0.44, 48),
  new THREE.MeshBasicMaterial({ color: '#5cffb0', transparent: true, opacity: 0.8, depthWrite: false })
);
youRing.rotation.x = -Math.PI / 2;
rig.add(youRing);
const hintArrow = (() => {
  const s = new THREE.Shape([new THREE.Vector2(-0.06, -0.12), new THREE.Vector2(0.06, -0.12), new THREE.Vector2(0.06, 0), new THREE.Vector2(0.13, 0), new THREE.Vector2(0, 0.14), new THREE.Vector2(-0.13, 0), new THREE.Vector2(-0.06, 0)]);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(1.6);
  m.renderOrder = 5;
  m.visible = false;
  rig.add(m);
  return m;
})();

const cellLocal = (k, y = 0) => new THREE.Vector3((k % level.w) * CELL, y, Math.floor(k / level.w) * CELL);

function loadLevel(i, preset = null) {
  levelIndex = Math.max(0, i);
  savePref('push-level', String(levelIndex));
  if (preset) {
    level = preset;
  } else if (levelIndex < HANDMADE.length) {
    level = parse(HANDMADE[levelIndex].map, `${levelIndex + 1}. ${HANDMADE[levelIndex].name}`);
  } else {
    const g = generate({ minSteps: 12, boxes: Math.random() < 0.5 ? 2 : 3 }) || parse(HANDMADE[HANDMADE.length - 1].map, '随机关卡');
    level = { ...g, name: `随机关卡 ${levelIndex - HANDMADE.length + 1}` };
  }
  st = { player: level.player, boxes: level.boxes.slice() };
  history = [];
  steps = 0;
  state = 'playing';
  physCell = null;
  buildLevel();
  if (placeLevel(false) === false) return; // 放不下，已经换成别的关卡
  refreshButtons();
  if (!app.presenting) {
    // 电脑上：镜头对准关卡中间
    const c = rig.localToWorld(new THREE.Vector3(((level.w - 1) / 2) * CELL, 0, ((level.h - 1) / 2) * CELL));
    controls.target.copy(c);
    camera.position.set(c.x, 2.9, c.z + 2.2);
  }
  if (levelSelect) levelSelect.value = String(Math.min(levelIndex, HANDMADE.length));
  setStatus(levelIndex === 0 ? '走到箱子后面，往前走一格就能推动它' : '把所有箱子推到黄色圆圈上');
  sfx.click();
}

// 从起点能走到的格子（地砖）
function floorCells(lv) {
  const inside = new Set([lv.player]);
  const q = [lv.player];
  while (q.length) {
    const k = q.pop();
    for (const [dx, dy] of Object.values(DIRS)) {
      const x = (k % lv.w) + dx, y = Math.floor(k / lv.w) + dy;
      if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) continue;
      const n = y * lv.w + x;
      if (lv.walls.has(n) || inside.has(n)) continue;
      inside.add(n);
      q.push(n);
    }
  }
  return inside;
}
// 关卡里能走的范围（rig 坐标的长方形），用来塞进安全边界
function levelRect(lv) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const k of floorCells(lv)) { const x = k % lv.w, y = Math.floor(k / lv.w); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0: (x0 - 0.5) * CELL, x1: (x1 + 0.5) * CELL, z0: (y0 - 0.5) * CELL, z1: (y1 + 0.5) * CELL };
}

function buildLevel() {
  levelGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  levelGroup.clear();
  boxMeshes = []; goalMeshes = []; floorMeshes = [];
  const { w, walls } = level;
  // 从起点能走到的地方铺地砖
  const inside = floorCells(level);
  const floorGeo = new THREE.BoxGeometry(CELL * 0.98, 0.02, CELL * 0.98);
  for (const k of inside) {
    const m = new THREE.Mesh(floorGeo, mats.floor);
    m.position.copy(cellLocal(k, 0.01));
    m.userData.cell = k;
    levelGroup.add(m);
    floorMeshes.push(m);
  }
  // 只画挨着地砖的墙
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
  const capGeo = new THREE.BoxGeometry(CELL * 1.02, 0.03, CELL * 1.02);
  for (const k of walls) {
    const x = k % w, y = Math.floor(k / w);
    let touches = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inside.has((y + dy) * w + (x + dx)) && x + dx >= 0 && x + dx < w) touches = true;
    if (!touches) continue;
    const m = new THREE.Mesh(wallGeo, mats.wall);
    m.position.copy(cellLocal(k, WALL_H / 2));
    const cap = new THREE.Mesh(capGeo, mats.wallTop);
    cap.position.copy(cellLocal(k, WALL_H + 0.015));
    levelGroup.add(m, cap);
  }
  for (const k of level.goals) {
    const g = new THREE.Mesh(new THREE.RingGeometry(CELL * 0.18, CELL * 0.3, 40), mats.goal);
    g.rotation.x = -Math.PI / 2;
    g.position.copy(cellLocal(k, 0.022));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(CELL * 0.08, 24), mats.goal);
    dot.rotation.x = -Math.PI / 2;
    dot.position.copy(cellLocal(k, 0.023));
    levelGroup.add(g, dot);
    goalMeshes.push(g);
  }
  const boxGeo = new THREE.BoxGeometry(BOX, BOX_H, BOX);
  st.boxes.forEach((k, i) => {
    // 侧面贴两层箱子的图案，顶面一层
    const side = new THREE.MeshStandardMaterial({ map: crateSideTex, roughness: 0.75, emissive: '#000000' });
    const top = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.75, emissive: '#000000' });
    const m = new THREE.Mesh(boxGeo, [side, side, top, top, side, side]);
    m.position.copy(cellLocal(k, BOX_H / 2 + 0.02));
    m.userData.cell = k;
    m.userData.box = i;
    levelGroup.add(m);
    boxMeshes.push(m);
  });
  avatar.position.copy(cellLocal(st.player, 0.02));
  refreshBoxes(true);
  positionPanel();
}

// 箱子到位：变成金色发光
function refreshBoxes(silent = false) {
  st.boxes.forEach((k, i) => {
    const on = level.goals.includes(k);
    const m = boxMeshes[i];
    const was = m.userData.on;
    m.userData.on = on;
    for (const mt of m.material) { mt.emissive.set(on ? '#7a5a00' : '#000000'); mt.color.set(on ? '#ffe08a' : '#ffffff'); }
    if (on && !was && !silent) { sfx.perfect(1); sparkle(rig.localToWorld(cellLocal(k, BOX_H))); }
  });
}

// 把关卡放好：你现在站的地方 = 起点格子，关卡朝你面对的方向展开
let placeAfter = -1;
let needStart = false;   // 关卡挪过位置后，要先走到起点（小人那一格）才开始认身体
function placeLevel(withSound = true) {
  const head = app.presenting ? app.footPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);
  const f = app.presenting ? app.headForward(new THREE.Vector3()) : new THREE.Vector3(0, 0, -1);
  const yaw = Math.atan2(-f.x, -f.z);
  const local = cellLocal(st.player).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const want = [head.x - local.x, head.z - local.z]; // 起点正好在你脚下时 rig 的位置
  if (app.presenting && guardianPoly) {
    const fit = fitRect(guardianPoly, levelRect(level), { prefer: want, forward: [f.x, f.z] });
    if (!fit) { noFit(); return false; }
    rig.rotation.set(0, fit.yaw, 0);
    rig.position.set(fit.x, 0, fit.z);
    needStart = Math.hypot(fit.x - want[0], fit.z - want[1]) > CELL * 0.3 || Math.abs(fit.yaw - yaw) > 0.05;
    if (needStart && steps === 0) setStatus('关卡放在安全边界里了：先走到绿色圆圈（小人那一格）');
  } else {
    rig.rotation.set(0, yaw, 0);
    rig.position.set(want[0], 0, want[1]);
    needStart = false;
    if (app.presenting && steps === 0) setStatus('没读到安全边界，走动时注意四周');
  }
  physCell = st.player;
  if (withSound) sfx.click();
}
// 这一关放不进安全边界：换一关能放下的，实在不行就提示边界太小
function noFit() {
  const fits = (lv) => !!fitRect(guardianPoly, levelRect(lv), { step: 0.15 });
  const from = levelIndex;
  for (let n = 1; n <= HANDMADE.length; n++) {
    const j = (from + n) % HANDMADE.length;
    if (fits(parse(HANDMADE[j].map, ''))) {
      loadLevel(j);
      setStatus(`上一关放不进你的安全边界，换成第 ${j + 1} 关`);
      return;
    }
  }
  for (let t = 0; t < 15; t++) {
    const g = generate({ minSteps: 8, boxes: 2 });
    if (g && fits(g)) {
      loadLevel(Math.max(HANDMADE.length, levelIndex), { ...g, name: '随机关卡（小）' });
      setStatus('换成一关能放进安全边界的随机关卡');
      return;
    }
  }
  state = 'noroom';
  setStatus('安全边界太小，放不下关卡（至少约 2×2 米）');
}

// ================= 移动 =================
function move(dir, source = 'stick') {
  if (state !== 'playing') return false;
  const ns = step(level, st, dir);
  if (!ns) {
    blocked(dir);
    return false;
  }
  history.push({ player: st.player, boxes: st.boxes.slice() });
  st = { player: ns.player, boxes: ns.boxes };
  steps++;
  hintArrow.visible = false;
  if (ns.pushed >= 0) {
    boxMeshes[ns.pushed].userData.cell = st.boxes[ns.pushed];
    sfx.thud();
    app.pulseAll(0.6, 80);
  } else {
    sfx.tick();
    if (source === 'stick') app.pulseAll(0.15, 20);
  }
  refreshBoxes();
  drawPanel();
  if (solved(level, st)) win();
  return true;
}
function blocked(dir) {
  const [dx, dy] = DIRS[dir];
  const n = (Math.floor(st.player / level.w) + dy) * level.w + (st.player % level.w) + dx;
  const bi = st.boxes.indexOf(n);
  if (bi >= 0) {
    boxMeshes[bi].userData.flash = 0.4;
    setStatus('推不动：箱子后面是墙或者别的箱子');
  } else {
    setStatus('那边是墙');
  }
  if (performance.now() - blockedFlash > 400) { sfx.warn(); app.pulseAll(0.9, 120); }
  blockedFlash = performance.now();
}
function undo() {
  const h = history.pop();
  if (!h) { sfx.warn(); return; }
  st = { player: h.player, boxes: h.boxes };
  steps = Math.max(0, steps - 1);
  st.boxes.forEach((k, i) => (boxMeshes[i].userData.cell = k));
  if (state === 'won') state = 'playing';
  refreshBoxes(true);
  setStatus('撤销了一步');
  sfx.unflag();
}
function restart() {
  st = { player: level.player, boxes: level.boxes.slice() };
  history = [];
  steps = 0;
  state = 'playing';
  st.boxes.forEach((k, i) => (boxMeshes[i].userData.cell = k));
  refreshBoxes(true);
  setStatus('重新开始，回到绿色圆圈的位置');
  sfx.click();
}
function showHint() {
  if (state !== 'playing') return;
  const sol = solve({ ...level, player: st.player, boxes: st.boxes }, 200000);
  if (!sol) { setStatus('现在这样已经推不出来了，撤销几步或者重来'); sfx.warn(); return; }
  const dir = sol.path[0];
  const [dx, dy] = DIRS[dir];
  hintArrow.visible = true;
  hintArrow.position.copy(cellLocal(st.player, 0.05)).add(new THREE.Vector3(dx * CELL * 0.55, 0, dy * CELL * 0.55));
  hintArrow.rotation.set(-Math.PI / 2, 0, Math.atan2(-dx, -dy));
  setStatus(`往箭头方向走（最少还要 ${sol.steps} 步）`);
  sfx.click();
}

function bestKey() { return levelIndex < HANDMADE.length ? 'push-best-' + levelIndex : null; }
function win() {
  state = 'won';
  const k = bestKey();
  let record = false;
  if (k) {
    const best = Number(loadPref(k, '0')) || 0;
    if (!best || steps < best) { savePref(k, String(steps)); record = true; }
  }
  sfx.win();
  confetti();
  setStatus(record ? `过关！${steps} 步，新纪录。马上进入下一关…` : `过关！用了 ${steps} 步。马上进入下一关…`);
  refreshButtons();
  const mine = levelIndex;
  setTimeout(() => { if (state === 'won' && levelIndex === mine) loadLevel(levelIndex + 1); }, 3000);
}

// ================= 特效 =================
const dotTex = canvasTex(64, 64, (g) => {
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
});
function sparkle(at, n = 30, color = '#fff2b0', speed = 0.6, size = 0.03, life = 0.8, gravity = 0.5) {
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
  const c = new THREE.Vector3(((level.w - 1) / 2) * CELL, 1.4, ((level.h - 1) / 2) * CELL);
  const at = rig.localToWorld(c);
  for (const col of ['#ffd166', '#5cffb0', '#5aa9ff', '#ff7a2f', '#c891ff']) sparkle(at, 50, col, 2.2, 0.05, 2.5, 2);
}

// ================= 面板（立在关卡远端，面向你）=================
const panelGroup = new THREE.Group();
rig.add(panelGroup);
const panel = makeCanvasPlane(0.9, 0.36, 1100);
panelGroup.add(panel.mesh);
const uiButtons = [];
const mk = (label, x, y, color, onClick, w = 0.28) => {
  const b = makeButton(label, { width: w, height: 0.08, color, onClick });
  b.position.set(x, y, 0);
  panelGroup.add(b);
  uiButtons.push(b);
  return b;
};
mk('撤销  A/X', -0.305, -0.24, '#8a6a1f', undo);
mk('重来', 0, -0.24, '#8a6a1f', restart);
mk('提示', 0.305, -0.24, '#8a6a1f', showHint);
const prevBtn = mk('上一关', -0.305, -0.335, '#3a5bd9', () => loadLevel(levelIndex - 1));
mk('下一关', 0, -0.335, '#3a5bd9', () => loadLevel(levelIndex + 1));
mk('随机关卡', 0.305, -0.335, '#3a5bd9', () => loadLevel(Math.max(levelIndex + 1, HANDMADE.length)));
mk('移到脚下  B/Y', -0.155, -0.43, '#2e5a46', () => placeLevel(), 0.43);
const envButton = mk('背景：… ▶', 0.23, -0.43, '#5a4a2e', () => envs.next(), 0.43);
if (envs.label) envButton.userData.ui.setLabel(`背景：${envs.label} ▶`);
const wristButton = mk('', -0.155, -0.525, '#2e4f6a', () => { wrist.enabled = !wrist.enabled; savePref('push-wrist', wrist.enabled ? '1' : '0'); wristButton.userData.ui.setLabel(`手腕地图：${wrist.enabled ? '开' : '关'}`); }, 0.43);
{
  const exitButton = makeExitButton(app, { width: 0.43, height: 0.08 });
  exitButton.position.set(0.23, -0.525, 0);
  panelGroup.add(exitButton);
  uiButtons.push(exitButton);
}

// ---- 手腕地图：抬起左手像看手表，显示整个关卡；你面对的方向朝上 ----
const wrist = createWristMap(app, {
  enabled: loadPref('push-wrist', '1') === '1',
  draw(ctx, w, h) {
    roundRect(ctx, 6, 6, w - 12, h - 12, 40);
    ctx.fillStyle = 'rgba(14,20,36,0.94)'; ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = '#3b4a78'; ctx.stroke();
    if (!level) return;
    const inside = floorCells(level);
    const f = app.headForward(new THREE.Vector3()).applyAxisAngle(new THREE.Vector3(0, 1, 0), -rig.rotation.y);
    const cs = Math.min((w - 120) / level.w, (h - 120) / level.h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.atan2(f.x, -f.z));
    ctx.translate(-level.w * cs / 2, -level.h * cs / 2);
    for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
      const k = y * level.w + x;
      if (level.walls.has(k)) { ctx.fillStyle = '#6d665c'; ctx.fillRect(x * cs + 2, y * cs + 2, cs - 4, cs - 4); }
      else if (inside.has(k)) { ctx.fillStyle = '#cfc6b4'; ctx.fillRect(x * cs + 2, y * cs + 2, cs - 4, cs - 4); }
    }
    for (const k of level.goals) {
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = cs * 0.1;
      ctx.beginPath(); ctx.arc((k % level.w + 0.5) * cs, (Math.floor(k / level.w) + 0.5) * cs, cs * 0.28, 0, Math.PI * 2); ctx.stroke();
    }
    for (const k of st.boxes) {
      ctx.fillStyle = level.goals.includes(k) ? '#ffd166' : '#a8723e';
      ctx.fillRect((k % level.w + 0.14) * cs, (Math.floor(k / level.w) + 0.14) * cs, cs * 0.72, cs * 0.72);
    }
    // 小人（游戏里你在哪一格）
    ctx.fillStyle = '#5cffb0';
    ctx.beginPath(); ctx.arc((st.player % level.w + 0.5) * cs, (Math.floor(st.player / level.w) + 0.5) * cs, cs * 0.26, 0, Math.PI * 2); ctx.fill();
    // 你本人（真实位置）
    const me = rig.worldToLocal(app.footPosition(new THREE.Vector3()));
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc((me.x / CELL + 0.5) * cs, (me.z / CELL + 0.5) * cs, cs * 0.18, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#c9d3ea'; ctx.font = `600 44px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(needStart ? '先走到绿点' : `${st.boxes.filter((b) => level.goals.includes(b)).length}/${level.goals.length} 到位`, w / 2, h - 30);
  },
});
wristButton.userData.ui.setLabel(`手腕地图：${wrist.enabled ? '开' : '关'}`);

function positionPanel() {
  panelGroup.position.set(((level.w - 1) / 2) * CELL, 1.45, -CELL * 0.9);
}
function refreshButtons() {
  prevBtn.userData.ui.setDisabled(levelIndex === 0);
}
function drawPanel() {
  const k = bestKey();
  const best = k ? Number(loadPref(k, '0')) || 0 : 0;
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
    ctx.font = `800 60px ${FONT}`;
    ctx.fillText('大力搬箱', 40, 68);
    ctx.font = `600 40px ${FONT}`;
    ctx.fillStyle = '#9fb0d6';
    ctx.fillText(level ? level.name : '', 330, 72);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f5b941';
    ctx.font = `800 56px ${FONT}`;
    ctx.fillText(`${steps} 步`, w - 40, 72);
    ctx.textAlign = 'left';
    ctx.font = `600 38px ${FONT}`;
    ctx.fillStyle = '#c9d3ea';
    const onGoal = level ? st.boxes.filter((b) => level.goals.includes(b)).length : 0;
    ctx.fillText(`到位 ${onGoal}/${level ? level.goals.length : 0}`, 40, 165);
    ctx.fillText(k ? `最佳 ${best || '--'} 步` : `最少 ${level?.best ?? '--'} 步`, 330, 165);
    ctx.font = `700 38px ${FONT}`;
    ctx.fillStyle = state === 'won' ? '#5cffb0' : '#eef2fb';
    ctx.fillText(statusText, 40, 270);
    ctx.font = `500 28px ${FONT}`;
    ctx.fillStyle = '#8f9bb8';
    ctx.fillText('用身体走，也可以用摇杆或射线点相邻的格子走一步', 40, 345);
  });
}
function setStatus(t) { statusText = t; drawPanel(); }

// ================= 每一帧 =================
const tmpHead = new THREE.Vector3();
const stickPrev = [false, false];
function onFrame(dt) {
  envs.update(dt);
  if (!level) return;

  if (app.presenting) {
    if (placeAfter > 0) { placeAfter -= dt; if (placeAfter <= 0) placeLevel(false); }
    updateBody();
    feet.update(app.footPosition(tmpHead), app.headForward(new THREE.Vector3()), 0.022, dt);
    wrist.update(dt);
    updatePointers();
    app.pollButtons((c, bi) => {
      if (bi === 4) undo();
      if (bi === 5) placeLevel();
    });
    // 摇杆：往哪边推就往哪边走一格（方向以你面对的方向为准）
    app.controllers.forEach((c, n) => {
      const ax = c.inputSource?.gamepad?.axes;
      if (!ax || ax.length < 4) return;
      const sx = ax[2], sy = ax[3];
      const mag = Math.hypot(sx, sy);
      if (!stickPrev[n] && mag > STICK_ON) { stickPrev[n] = true; move(dirFromView(sx, sy)); }
      if (mag < STICK_OFF) stickPrev[n] = false;
    });
  } else {
    feet.hide();
    controls.update();
  }

  // 箱子和小人平滑移动
  boxMeshes.forEach((m) => {
    const target = cellLocal(m.userData.cell, BOX_H / 2 + 0.02);
    m.position.lerp(target, Math.min(1, dt * 14));
    if (m.userData.flash > 0) {
      m.userData.flash -= dt;
      for (const mt of m.material) mt.emissive.set(Math.sin(performance.now() / 40) > 0 ? '#aa1111' : '#000000');
      if (m.userData.flash <= 0) refreshBoxes(true);
    }
  });
  const ap = cellLocal(st.player, 0.02);
  avatar.position.lerp(ap, Math.min(1, dt * 20));
  youRing.position.set(ap.x, 0.025, ap.z);
  youRing.material.opacity = 0.55 + 0.35 * Math.sin(performance.now() / 250);
  // 你本人站在小人那一格时，小人变透明（不挡你看脚下）
  let alpha = 1;
  if (app.presenting) {
    const local = rig.worldToLocal(app.footPosition(tmpHead).clone());
    const d = Math.hypot(local.x - ap.x, local.z - ap.z);
    alpha = THREE.MathUtils.clamp((d - 0.15) / 0.3, 0.15, 1);
  }
  avatar.traverse((o) => { if (o.material) o.material.opacity = alpha; });
  for (const g of goalMeshes) g.rotation.z += dt * 0.6;
  if (hintArrow.visible) hintArrow.material.opacity = 0.6 + 0.4 * Math.sin(performance.now() / 150);

  for (let n = effects.length - 1; n >= 0; n--) {
    const e = effects[n];
    e.t += dt;
    const k = Math.min(e.t / e.life, 1);
    e.update(k, e.t);
    if (k >= 1) { e.done?.(); effects.splice(n, 1); }
  }
}

// 头部在地面的投影 → 你在哪一格。走得快、斜着走也没关系：
// 小人会沿着直线一步一步追上你（每一步都按规则走，碰到箱子就推）。
let blockedTarget = -1;
function updateBody() {
  const local = rig.worldToLocal(app.footPosition(tmpHead).clone());
  const fx = local.x / CELL, fy = local.z / CELL;
  const cx = Math.round(fx), cy = Math.round(fy);
  if (Math.hypot(fx - cx, fy - cy) > ENTER) return; // 在两格中间，先不算
  if (cx < 0 || cy < 0 || cx >= level.w || cy >= level.h) return;
  const cell = cy * level.w + cx;
  physCell = cell;
  if (needStart) {
    if (cell !== st.player) return;
    needStart = false;
    setStatus('好，开始推箱子吧');
    sfx.click();
  }
  if (cell === st.player) { blockedTarget = -1; return; }
  if (cell === blockedTarget) return; // 刚才这里推不动，等你换个地方再试
  for (let n = 0; n < MAX_CATCHUP && st.player !== cell && state === 'playing'; n++) {
    const px = st.player % level.w, py = Math.floor(st.player / level.w);
    const dx = cx - px, dy = cy - py;
    const tryX = dx !== 0 ? (dx > 0 ? 'right' : 'left') : null;
    const tryY = dy !== 0 ? (dy > 0 ? 'down' : 'up') : null;
    // 先走差得多的那个方向，走不通再试另一个
    const order = Math.abs(dx) >= Math.abs(dy) ? [tryX, tryY] : [tryY, tryX];
    let moved = false;
    for (const d of order) {
      if (!d) continue;
      if (step(level, st, d)) { move(d, 'body'); moved = true; break; }
    }
    if (!moved) {
      blocked(order.find(Boolean));
      blockedTarget = cell;
      setStatus('这边走不过去：回到绿色圆圈，换条路');
      break;
    }
  }
}

// 把摇杆方向（相对你面对的方向）换成关卡里的上下左右
function dirFromView(sx, sy) {
  const f = app.headForward(new THREE.Vector3());
  const r = new THREE.Vector3(-f.z, 0, f.x);
  const world = r.multiplyScalar(sx).addScaledVector(f, -sy);
  const local = world.applyAxisAngle(new THREE.Vector3(0, 1, 0), -rig.rotation.y);
  if (Math.abs(local.x) > Math.abs(local.z)) return local.x > 0 ? 'right' : 'left';
  return local.z > 0 ? 'down' : 'up';
}

function updatePointers() {
  const hovered = new Set();
  for (const c of app.controllers) {
    if (!c.inputSource) continue;
    const hit = app.pointAt(c, [...uiButtons, ...floorMeshes, ...boxMeshes], 6);
    c.hover = hit ? hit.object : null;
    if (c.hover) hovered.add(c.hover);
  }
  for (const b of uiButtons) b.userData.ui.setHover(hovered.has(b));
}
// 射线点相邻的格子（或旁边的箱子）= 往那边走一步
function clickCell(k) {
  const px = st.player % level.w, py = Math.floor(st.player / level.w);
  const dx = (k % level.w) - px, dy = Math.floor(k / level.w) - py;
  if (Math.abs(dx) + Math.abs(dy) !== 1) { setStatus('点紧挨着你的格子，一次走一步'); return; }
  move(dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up', 'stick');
}
app.on('select', (c) => {
  initAudio();
  const t = c.hover;
  if (!t) return;
  if (t.userData.ui) { app.pulse(c, 0.4, 30); t.userData.ui.onClick?.(); return; }
  if (t.userData.cell !== undefined) clickCell(t.userData.cell);
});

// ================= 电脑上预览 =================
camera.position.set(0.9, 3.2, 2.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.9, 0, -0.6);
controls.enableDamping = true;
window.addEventListener('keydown', (e) => {
  if (app.presenting) return;
  const dir = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' }[e.code];
  if (dir) { e.preventDefault(); initAudio(); move(dir, 'key'); }
  if (e.code === 'KeyZ' || e.code === 'Backspace') undo();
  if (e.code === 'KeyR') restart();
  if (e.code === 'KeyH') showHint();
});
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
  const hit = mouseRay.intersectObjects([...uiButtons, ...floorMeshes, ...boxMeshes], false)[0];
  if (!hit) return;
  if (hit.object.userData.ui) hit.object.userData.ui.onClick?.();
  else clickCell(hit.object.userData.cell);
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
const levelSelect = document.getElementById('level-select');
let desktopPreview = false;
for (const e of ENVIRONMENTS) envSelect.add(new Option(e.label, e.key));
envSelect.value = savedEnvKey();
envSelect.addEventListener('change', () => envs.set(envSelect.value));
HANDMADE.forEach((l, i) => levelSelect.add(new Option(`${i + 1}. ${l.name}`, String(i))));
levelSelect.add(new Option('随机关卡', String(HANDMADE.length)));
levelSelect.value = String(Math.min(levelIndex, HANDMADE.length));
levelSelect.addEventListener('change', () => loadLevel(Number(levelSelect.value)));

(async () => {
  const [vr, ar] = await Promise.all([app.supports('immersive-vr'), app.supports('immersive-ar')]);
  btnVR.hidden = !vr;
  btnAR.hidden = !ar;
  if (!vr && !ar) note.textContent = '这台设备不支持 VR。可以先在电脑上预览：方向键（或 WASD）走，Z 撤销，R 重来，H 提示。';
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

loadLevel(levelIndex);

// 调试用
window.pushgame = {
  get state() { return state; }, get level() { return level; }, get st() { return st; }, get steps() { return steps; }, get levelIndex() { return levelIndex; },
  move, undo, restart, loadLevel, showHint, solve, updateBody, placeLevel, camera, controls, envs, rig, levelRect, wrist,
  setGuardian(pts) { guardianPoly = pts; }, get needStart() { return needStart; },
  HANDMADE_COUNT: HANDMADE.length,
};
