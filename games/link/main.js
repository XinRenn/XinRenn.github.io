// 空中连线（新版）：面前一面彩色圆点墙，用手在空中把 3 个或更多相邻的同色点连成一条线，松手就破掉；
// 上面的点往下掉、顶上不断补新的，可以一直玩下去。连成一个圈 = 这个颜色全部消掉；一次连 6 个以上会留下一颗彩虹星（能当任何颜色用）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio } from '../../shared/sfx.js';
import { createEnvManager, ENVIRONMENTS, savedEnvKey } from '../../shared/env/index.js';

// ================= 可调参数 =================
const COLS = 7, ROWS = 8;
const GAP = 0.085;          // 圆点间距（米）
const DOT_R = 0.028;        // 圆点半径
const TOUCH = 0.034;        // 手柄尖端离圆点中心多近算碰到
const TIP = 0.045;          // 尖端在手柄前方多远
const COMBO_WINDOW = 3;     // 几秒内接着消算连击
const TIMED_SECONDS = 60;
const COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4dabf7', '#b197fc', '#ff922b'];
const STAR = -1;            // 彩虹星：能当任何颜色

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
rig.position.set(0, 1.25, -0.45);
scene.add(rig);
const board = new THREE.Group();
rig.add(board);

// 圆点墙的底板
{
  const w = COLS * GAP + 0.05, h = ROWS * GAP + 0.05;
  const back = makeCanvasPlane(w, h, 600);
  back.redraw((ctx, cw, ch) => {
    roundRect(ctx, 4, 4, cw - 8, ch - 8, 40);
    ctx.fillStyle = 'rgba(16, 22, 40, 0.72)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(160, 180, 230, 0.5)';
    ctx.stroke();
  });
  back.mesh.position.z = -0.03;
  board.add(back.mesh);
}
const cellPos = (c, r) => new THREE.Vector3((c - (COLS - 1) / 2) * GAP, (r - (ROWS - 1) / 2) * GAP, 0);

// 手柄尖端
const tips = app.controllers.map(() => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  m.visible = false;
  scene.add(m);
  return m;
});

// ================= 圆点 =================
const dotGeo = new THREE.SphereGeometry(DOT_R, 24, 16);
const starGeo = (() => {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? DOT_R * 0.5 : DOT_R * 1.15, a = Math.PI / 2 + (i * Math.PI) / 5;
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
  g.translate(0, 0, -0.007);
  return g;
})();
const dotMats = COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.05, emissive: c, emissiveIntensity: 0.12 }));
const starMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2, metalness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.35 });

let grid = [];           // grid[c][r] = dot | null
let nColors = 5;
let mode = 'endless';    // endless | timed
let state = 'playing';   // playing | over
let score = 0, combo = 0, lastClear = -99, timeLeft = TIMED_SECONDS;
let clock = 0;
let chain = null;        // { cells: [dot...], color, by: controller|'mouse', closed }
let statusText = '';
const effects = [];

function makeDot(c, r, color, fromRow = r) {
  const mesh = new THREE.Mesh(color === STAR ? starGeo : dotGeo, color === STAR ? starMat : dotMats[color]);
  mesh.position.copy(cellPos(c, fromRow));
  board.add(mesh);
  const d = { c, r, color, mesh, vy: 0 };
  mesh.userData.dot = d;
  return d;
}
const randColor = () => Math.floor(Math.random() * nColors);

function newGame(m = mode, colors = nColors) {
  mode = m;
  nColors = colors;
  savePref('dots-mode', mode);
  savePref('dots-colors', String(nColors));
  for (const col of grid) for (const d of col) if (d) board.remove(d.mesh);
  grid = Array.from({ length: COLS }, (_, c) => Array.from({ length: ROWS }, (_, r) => makeDot(c, r, randColor(), r + ROWS + 1)));
  ensureMove();
  state = 'playing';
  score = 0; combo = 0; lastClear = -99; timeLeft = TIMED_SECONDS;
  cancelChain();
  refreshButtons();
  setStatus(mode === 'timed' ? '60 秒挑战：能连多少连多少！' : '把 3 个以上相邻的同色点连成一条线');
  sfx.click();
}

// ================= 连线规则 =================
const adjacent = (a, b) => a !== b && Math.abs(a.c - b.c) <= 1 && Math.abs(a.r - b.r) <= 1; // 上下左右和斜对角都算
function chainColor(cells) {
  const d = cells.find((x) => x.color !== STAR);
  return d ? d.color : STAR;
}
function canJoin(cells, d) {
  const col = chainColor(cells);
  return d.color === STAR || col === STAR || d.color === col;
}

function startChain(d, by) {
  if (state !== 'playing' || chain) return;
  chain = { cells: [d], by, closed: false, line: makeLine(colorOf(d.color)) };
  bump(d);
  sfx.tick();
}
function colorOf(c) { return c === STAR ? '#ffffff' : COLORS[c]; }

// 手（或射线、鼠标）碰到一个点：加进链、退回一步、或者连成圈
function touchDot(d) {
  if (!chain || !d) return;
  const cells = chain.cells;
  const last = cells[cells.length - 1];
  if (d === last) return;
  if (cells.length >= 2 && d === cells[cells.length - 2]) { // 往回走：撤掉最后一个
    cells.pop();
    chain.closed = false;
    sfx.unflag();
    return;
  }
  if (!adjacent(last, d) || !canJoin(cells, d)) return;
  if (cells.includes(d)) {
    // 连回链上已有的点 = 圈
    if (cells.length >= 3 && !chain.closed) { chain.closed = true; sfx.perfect(1); chain.by?.inputSource && app.pulse(chain.by, 0.6, 60); }
    return;
  }
  if (chain.closed) return;
  cells.push(d);
  bump(d);
  const n = cells.length;
  playNote(n);
  if (chain.by?.inputSource) app.pulse(chain.by, 0.2 + Math.min(0.6, n * 0.05), 25);
}
function bump(d) { d.pop = 0.18; }

function finishChain() {
  if (!chain) return;
  const cells = chain.cells;
  const col = chainColor(cells);
  disposeLine(chain.line);
  if (cells.length < 3) { chain = null; return; }
  let clear = cells.slice();
  let label;
  if (chain.closed && col !== STAR) {
    // 圈：这个颜色全部消掉
    for (const column of grid) for (const d of column) if (d && d.color === col && !clear.includes(d)) clear.push(d);
    label = `成圈！整个颜色消掉`;
  }
  const n = clear.length;
  combo = clock - lastClear < COMBO_WINDOW ? combo + 1 : 1;
  lastClear = clock;
  const gained = Math.round(n * 10 * (1 + Math.max(0, cells.length - 3) * 0.3) * combo);
  score += gained;
  // 连 6 个以上：在最后一个点的位置留下一颗彩虹星
  const starAt = cells.length >= 6 ? cells[cells.length - 1] : null;
  for (const d of clear) {
    grid[d.c][d.r] = null;
    burst(d);
  }
  if (starAt) grid[starAt.c][starAt.r] = makeDot(starAt.c, starAt.r, STAR);
  drop();
  ensureMove();
  sfx.perfect(Math.min(3, Math.floor(cells.length / 2)));
  app.pulseAll(0.5 + Math.min(0.5, n * 0.04), 80);
  popup(`+${gained}${combo > 1 ? `  连击×${combo}` : ''}`, cells[cells.length - 1]);
  setStatus(label || (starAt ? `${cells.length} 连！留下一颗彩虹星` : combo > 1 ? `连击 ×${combo}！` : `${cells.length} 连 +${gained}`));
  chain = null;
  drawPanel();
}
function cancelChain() {
  if (chain) disposeLine(chain.line);
  chain = null;
}

// 上面的点往下掉，顶上补新的
function drop() {
  for (let c = 0; c < COLS; c++) {
    const col = grid[c].filter(Boolean);
    let spawn = 0;
    while (col.length < ROWS) { col.push(makeDot(c, 0, randColor(), ROWS + 0.6 + spawn)); spawn++; }
    col.forEach((d, r) => { d.c = c; d.r = r; });
    grid[c] = col;
  }
}
// 如果没有任何能连 3 个的地方，就把颜色打乱
function hasMove() {
  const all = grid.flat();
  for (const a of all) {
    for (const b of all) {
      if (!adjacent(a, b) || !canJoin([a], b)) continue;
      for (const c2 of all) if (c2 !== a && adjacent(b, c2) && canJoin([a, b], c2)) return true;
    }
  }
  return false;
}
function ensureMove() {
  let guard = 0;
  while (!hasMove() && guard++ < 20) {
    for (const d of grid.flat()) if (d.color !== STAR) { d.color = randColor(); d.mesh.material = dotMats[d.color]; }
  }
}

// ================= 声音、线和特效 =================
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
let audioCtx = null;
function playNote(n) {
  // 每多连一个点音调升高一点（五声音阶），听起来像在弹琴
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const f = 440 * Math.pow(2, SCALE[Math.min(SCALE.length - 1, n - 1)] / 12);
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.3);
  } catch (_) { /* 没有声音也能玩 */ }
}
function makeLine(color) {
  const mat = new LineMaterial({ color, linewidth: 0.012, worldUnits: true, transparent: true });
  mat.resolution.set(innerWidth, innerHeight);
  const line = new Line2(new LineGeometry(), mat);
  line.frustumCulled = false;
  line.visible = false;
  board.add(line);
  return line;
}
function setLinePoints(line, pts) {
  if (pts.length < 2) { line.visible = false; return; }
  line.visible = true;
  const arr = [];
  for (const p of pts) arr.push(p.x, p.y, p.z + 0.012);
  line.geometry.dispose();
  line.geometry = new LineGeometry();
  line.geometry.setPositions(arr);
}
function disposeLine(line) {
  board.remove(line);
  line.geometry.dispose();
  line.material.dispose();
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
function burst(d) {
  const m = d.mesh;
  effects.push({ t: 0, life: 0.22, update: (k) => m.scale.setScalar(1 + k * 0.8), done: () => board.remove(m) });
  const n = 14, pos = new Float32Array(n * 3), vel = [];
  const at = m.position;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
    vel.push(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.2) * 0.6, Math.random() * 0.3));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, size: 0.016, color: colorOf(d.color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  board.add(pts);
  let last = 0;
  effects.push({
    t: 0, life: 0.6,
    update: (k, t) => {
      const dt = t - last; last = t;
      for (let i = 0; i < n; i++) { vel[i].y -= 1.2 * dt; pos[i * 3] += vel[i].x * dt; pos[i * 3 + 1] += vel[i].y * dt; pos[i * 3 + 2] += vel[i].z * dt; }
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = 1 - k;
    },
    done: () => { board.remove(pts); geo.dispose(); pts.material.dispose(); },
  });
}
function popup(text, d) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = `800 64px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.strokeText(text, 256, 64);
  g.fillStyle = '#ffe066';
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(0.24, 0.06, 1);
  const p0 = cellPos(d.c, d.r).add(new THREE.Vector3(0, 0, 0.06));
  s.position.copy(p0);
  board.add(s);
  effects.push({ t: 0, life: 1, update: (k) => { s.position.y = p0.y + k * 0.06; s.material.opacity = 1 - Math.max(0, k - 0.6) / 0.4; }, done: () => { board.remove(s); tex.dispose(); s.material.dispose(); } });
}

// ================= 面板 =================
const panelGroup = new THREE.Group();
panelGroup.position.set(-0.7, 0.05, 0.04);
panelGroup.rotation.y = 0.55;
rig.add(panelGroup);
const panel = makeCanvasPlane(0.58, 0.3, 1400);
panelGroup.add(panel.mesh);
const uiButtons = [];
const mk = (label, x, y, color, onClick, w = 0.28) => {
  const b = makeButton(label, { width: w, height: 0.065, color, onClick });
  b.position.set(x, y, 0);
  panelGroup.add(b);
  uiButtons.push(b);
  return b;
};
const endlessBtn = mk('无尽模式', -0.145, -0.2, '#2f3f6e', () => newGame('endless'));
const timedBtn = mk('60 秒挑战', 0.145, -0.2, '#2f3f6e', () => newGame('timed'));
const c5Btn = mk('5 种颜色', -0.145, -0.275, '#2f3f6e', () => newGame(mode, 5));
const c6Btn = mk('6 种颜色', 0.145, -0.275, '#2f3f6e', () => newGame(mode, 6));
mk('重新开始 A/X', -0.145, -0.35, '#3a5bd9', () => newGame());
mk('移到面前 B/Y', 0.145, -0.35, '#3a5bd9', () => placeInFront());
const envButton = mk('背景：… ▶', 0, -0.425, '#5a4a2e', () => envs.next(), 0.57);
if (envs.label) envButton.userData.ui.setLabel(`背景：${envs.label} ▶`);

function refreshButtons() {
  endlessBtn.userData.ui.setActive(mode === 'endless');
  timedBtn.userData.ui.setActive(mode === 'timed');
  c5Btn.userData.ui.setActive(nColors === 5);
  c6Btn.userData.ui.setActive(nColors === 6);
}
const bestKey = () => `dots-best-${mode}-${nColors}`;
function drawPanel() {
  const best = Number(loadPref(bestKey(), '0')) || 0;
  panel.redraw((ctx, w, h) => {
    roundRect(ctx, 4, 4, w - 8, h - 8, 34);
    ctx.fillStyle = 'rgba(18, 25, 44, 0.9)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = state === 'over' ? '#5cffb0' : '#3b4a78';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#eef2fb';
    ctx.font = `800 62px ${FONT}`;
    ctx.fillText('空中连线', 40, 70);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f5b941';
    ctx.font = `800 80px ${FONT}`;
    ctx.fillText(String(score), w - 40, 76);
    ctx.textAlign = 'left';
    ctx.font = `600 38px ${FONT}`;
    ctx.fillStyle = '#c9d3ea';
    ctx.fillText(mode === 'timed' ? `剩余 ${Math.ceil(timeLeft)} 秒` : '无尽模式', 40, 160);
    ctx.fillText(`最佳 ${best}`, 330, 160);
    ctx.font = `700 38px ${FONT}`;
    ctx.fillStyle = state === 'over' ? '#5cffb0' : '#eef2fb';
    ctx.fillText(statusText, 40, 290);
    ctx.font = `500 28px ${FONT}`;
    ctx.fillStyle = '#8f9bb8';
    ctx.fillText('连成圈消掉整个颜色 · 6 连以上得彩虹星', 40, 360);
  });
}
function setStatus(t) { statusText = t; drawPanel(); }
function timeUp() {
  state = 'over';
  cancelChain();
  const best = Number(loadPref(bestKey(), '0')) || 0;
  const record = score > best;
  if (record) savePref(bestKey(), String(score));
  sfx.win();
  setStatus(record ? `时间到！新纪录 ${score} 分` : `时间到！得分 ${score}`);
}

let placeAfter = -1;
function placeInFront() {
  const head = app.headPosition(new THREE.Vector3());
  const f = app.headForward(new THREE.Vector3());
  const y = app.presenting ? head.y - 0.3 : 1.25;
  rig.position.set(head.x + f.x * 0.45, y, head.z + f.z * 0.45);
  rig.rotation.y = Math.atan2(-f.x, -f.z);
  sfx.click();
}

// ================= 每一帧 =================
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
let lastPanelSec = -1;
function tipWorld(c, target) {
  target.setFromMatrixPosition(c.ray.matrixWorld);
  tmpV.set(0, 0, -1).applyQuaternion(c.ray.getWorldQuaternion(tmpQ));
  return target.addScaledVector(tmpV, TIP);
}
function dotNear(local, radius) {
  let best = null, bd = radius;
  for (const col of grid) for (const d of col) {
    if (!d) continue;
    const p = cellPos(d.c, d.r);
    const dd = Math.hypot(local.x - p.x, local.y - p.y, (local.z - p.z) * 0.6);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

function onFrame(dt) {
  clock += dt;
  envs.update(dt);

  // 圆点掉落（带一点弹跳）
  for (const col of grid) for (const d of col) {
    if (!d) continue;
    const target = cellPos(d.c, d.r);
    const p = d.mesh.position;
    if (p.y > target.y + 1e-4) {
      d.vy -= 3.5 * dt;
      p.y = Math.max(target.y, p.y + d.vy * dt);
      if (p.y === target.y) d.vy = 0;
    } else { p.y = target.y; d.vy = 0; }
    p.x += (target.x - p.x) * Math.min(1, dt * 12);
    const inChain = chain?.cells.includes(d);
    d.pop = Math.max(0, (d.pop || 0) - dt);
    const s = (inChain ? 1.25 : 1) + d.pop * 1.5;
    d.mesh.scale.setScalar(THREE.MathUtils.lerp(d.mesh.scale.x, s, Math.min(1, dt * 18)));
    if (d.color === STAR) d.mesh.rotation.z += dt * 1.5;
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

  if (chain) {
    const pts = chain.cells.map((d) => cellPos(d.c, d.r));
    if (chain.closed) pts.push(cellPos(chain.cells[0].c, chain.cells[0].r));
    else if (chain.cursor) pts.push(chain.cursor);
    setLinePoints(chain.line, pts);
    chain.line.material.color.set(colorOf(chainColor(chain.cells)));
    chain.line.material.linewidth = chain.closed ? 0.018 : 0.012;
  }

  if (mode === 'timed' && state === 'playing') {
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; timeUp(); }
    const sec = Math.ceil(timeLeft);
    if (sec !== lastPanelSec) { lastPanelSec = sec; drawPanel(); }
  }

  for (let n = effects.length - 1; n >= 0; n--) {
    const e = effects[n];
    e.t += dt;
    const k = Math.min(e.t / e.life, 1);
    e.update(k, e.t);
    if (k >= 1) { e.done?.(); effects.splice(n, 1); }
  }
}

function updateControllers() {
  const dotsMeshes = grid.flat().filter(Boolean).map((d) => d.mesh);
  const hovered = new Set();
  app.controllers.forEach((c, n) => {
    const tip = tips[n];
    if (!c.inputSource) { tip.visible = false; return; }
    tip.visible = true;
    tipWorld(c, tip.position);
    const local = board.worldToLocal(tip.position.clone());
    c.near = Math.abs(local.z) < 0.08 ? dotNear(local, TOUCH) : null;
    tip.material.color.set(chain?.by === c ? colorOf(chainColor(chain.cells)) : c.near ? '#5cffb0' : '#ffffff');
    const hit = app.pointAt(c, [...uiButtons, ...dotsMeshes], 3);
    c.hover = hit ? hit.object : null;
    if (c.hover) hovered.add(c.hover);
    if (chain?.by === c) {
      // 用手画：尖端碰到哪个点；用射线画：射线指着哪个点
      if (chain.mode === 'hand') {
        chain.cursor = local;
        if (c.near) touchDot(c.near);
      } else if (hit?.object.userData.dot) {
        chain.cursor = board.worldToLocal(hit.point.clone());
        touchDot(hit.object.userData.dot);
      }
    }
  });
  for (const b of uiButtons) b.userData.ui.setHover(hovered.has(b));
}

app.on('select', (c) => {
  initAudio();
  if (c.hover?.userData.ui) { app.pulse(c, 0.4, 30); c.hover.userData.ui.onClick?.(); return; }
  if (c.near) { startChain(c.near, c); if (chain) chain.mode = 'hand'; return; }
  if (c.hover?.userData.dot) { startChain(c.hover.userData.dot, c); if (chain) chain.mode = 'ray'; }
});
app.on('selectend', (c) => { if (chain?.by === c) finishChain(); });

// ================= 电脑上预览：按住鼠标拖过去 =================
camera.position.set(0, 1.35, 0.55);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.25, -0.45);
controls.enableDamping = true;
const mouse = new THREE.Vector2();
const mouseRay = new THREE.Raycaster();
function mouseHit(e) {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  mouseRay.setFromCamera(mouse, camera);
  return mouseRay.intersectObjects([...uiButtons, ...grid.flat().filter(Boolean).map((d) => d.mesh)], false)[0];
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (app.presenting) return;
  initAudio();
  const hit = mouseHit(e);
  if (!hit) return;
  if (hit.object.userData.ui) { hit.object.userData.ui.onClick?.(); return; }
  controls.enabled = false;
  startChain(hit.object.userData.dot, 'mouse');
  if (chain) chain.mode = 'mouse';
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (app.presenting || chain?.by !== 'mouse') return;
  const hit = mouseHit(e);
  if (hit?.object.userData.dot) touchDot(hit.object.userData.dot);
  if (hit) chain.cursor = board.worldToLocal(hit.point.clone());
});
window.addEventListener('pointerup', () => {
  if (chain?.by === 'mouse') finishChain();
  controls.enabled = true;
});
window.addEventListener('resize', () => {
  for (const o of board.children) if (o.isLine2) o.material.resolution.set(innerWidth, innerHeight);
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
const modeSelect = document.getElementById('mode-select');
let desktopPreview = false;
for (const e of ENVIRONMENTS) envSelect.add(new Option(e.label, e.key));
envSelect.value = savedEnvKey();
envSelect.addEventListener('change', () => envs.set(envSelect.value));
mode = loadPref('dots-mode', 'endless') === 'timed' ? 'timed' : 'endless';
nColors = loadPref('dots-colors', '5') === '6' ? 6 : 5;
modeSelect.value = mode;
modeSelect.addEventListener('change', () => newGame(modeSelect.value));

(async () => {
  const [vr, ar] = await Promise.all([app.supports('immersive-vr'), app.supports('immersive-ar')]);
  btnVR.hidden = !vr;
  btnAR.hidden = !ar;
  if (!vr && !ar) note.textContent = '这台设备不支持 VR。可以先在电脑上预览：按住鼠标从一个点拖过同色的点，松开就消掉。';
})();
async function start(m) {
  initAudio();
  try { await app.enter(m); } catch (err) { note.textContent = '无法进入：' + err.message; }
}
btnVR.addEventListener('click', () => start('immersive-vr'));
btnAR.addEventListener('click', () => start('immersive-ar'));
btnDesktop.addEventListener('click', () => {
  initAudio();
  desktopPreview = true;
  overlay.classList.add('hidden');
  hint.style.display = 'block';
});

newGame(mode, nColors);

// 调试用
window.dotsgame = {
  get state() { return state; }, get score() { return score; }, get grid() { return grid; }, get chain() { return chain; },
  get combo() { return combo; },
  newGame, startChain, touchDot, finishChain, hasMove, camera, controls, envs, rig,
  setTime(t) { timeLeft = t; },
};
