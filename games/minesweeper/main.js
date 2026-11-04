// 雷区漫步：踩在地板上的扫雷。格子是不规则的石板，铺满你划定的场地。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio } from '../../shared/sfx.js';
import { createEnvManager, ENVIRONMENTS, savedEnvKey } from '../../shared/env/index.js';
import * as G from '../../shared/geometry2d.js';
import { createFeet } from '../../shared/feet.js';
import { makeExitButton } from '../../shared/exit.js';
import { createWristMap } from '../../shared/wrist.js';
import { fitRect } from '../../shared/room.js';

// ================= 可调参数 =================
// size：石板之间的平均间距（米）；density：多少比例的石板下面有雷
const PRESETS = {
  easy:   { label: '简单', size: 0.44, square: 0.5, density: 0.14 },
  normal: { label: '普通', size: 0.37, square: 0.4, density: 0.18 },
  hard:   { label: '困难', size: 0.32, square: 0.33, density: 0.22 },
};
const LAYOUTS = {
  guardian: '安全边界',
  drawn: '自己画',
  default: '小场地 2×2',
};
const DWELL = 1.0;          // 站在一格上多少秒才翻开（第一轮：0.7 秒太快；第二轮：1.5 秒又太慢）
const ROOM_WAIT = 5;        // 进入 VR 后最多等几秒读安全边界
const MIN_ROOM = 1.5;       // 安全边界（往里缩之后）至少要多少平方米才能玩
const GUARDIAN_INSET = 0.3; // 用安全边界时往里缩多少米，离墙远一点
const ARM_DISTANCE = 0.3;   // 开局后要先走动多远才开始计算踩格子（防止一开始脚下那格被直接翻开）
const GAP = 0.025;          // 石板之间的缝
const COLORS = {
  hidden: 0xd6cdb9, open: 0x4a3f33, stand: 0x2fbf7f, hover: 0x3d6ccc,
  wrongFlag: 0x8a2530, boom: 0xff3b30,
};
const NUM_COLORS = ['', '#5aa9ff', '#5fe07a', '#ff6b6b', '#c891ff', '#ffb547', '#45e0d8', '#ffffff', '#b4bdd0', '#ff9ec7', '#ffe066'];

// ================= 场景 =================
const app = createXRApp({ onFrame });
const { scene, camera, renderer } = app;

// 背景场景（可以在面板或开始页面切换，会记住上次的选择）
const envs = createEnvManager(scene, {
  onChange: (def) => {
    envButton?.userData.ui.setLabel(`背景：${def.label} ▶`);
    if (envSelect) envSelect.value = def.key;
  },
});
envs.set(savedEnvKey());

const SHAPES = { voronoi: '格子：不规则石板', square: '格子：方格' };
function loadPref(k, d) { try { return localStorage.getItem(k) || d; } catch (_) { return d; } }
function savePref(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 无痕模式 */ } }
let tileShape = SHAPES[loadPref('minewalk-shape', 'voronoi')] ? loadPref('minewalk-shape', 'voronoi') : 'voronoi';

app.on('modechange', (mode) => {
  envs.setAR(mode === 'ar');
  overlay.classList.toggle('hidden', mode !== 'desktop' || desktopPreview);
  backLink.style.display = mode === 'desktop' ? '' : 'none';
  if (mode !== 'desktop') {
    // 每次进入都重新读取安全边界；读到之前场地先藏起来（雷区一定要在安全边界里面）
    guardianPoly = null;
    roomState = 'waiting';
    roomWait = ROOM_WAIT;
    placeAfter = 0.3;
    refreshLayoutButtons();
  } else {
    roomState = 'ok';
    hideBoard(false);
  }
});

// 拿到安全边界后，如果还没开始玩，就自动用它铺满场地
app.on('bounds', (pts) => {
  const poly = G.safeInset(pts, GUARDIAN_INSET);
  if (G.area(poly) < MIN_ROOM) { roomState = 'small'; roomArea = G.area(G.ensureCCW(pts)); showRoomProblem(); return; }
  guardianPoly = poly;
  refreshLayoutButtons();
  if (roomState !== 'ok') {
    roomState = 'ok';
    hideBoard(false);
    useLayout('guardian');
  }
});

// ---- 没有安全边界 / 太小：不让开始 ----
let roomState = 'ok';   // ok | waiting | none | small
let roomWait = 0, roomArea = 0;
function hideBoard(v) {
  boardContent.children.forEach((o) => { if (o !== panelGroup) o.visible = !v; });
}
function showRoomProblem() {
  state = 'noroom';
  hideBoard(true);
  positionPanelForDrawing();
  refreshButtons();
  if (roomState === 'waiting') setStatus('正在读取你的安全边界…');
  else if (roomState === 'small') setStatus(`安全边界太小（约 ${roomArea.toFixed(1)} 平方米），至少要 2×2 米`);
  else setStatus('没有找到房间规模的安全边界，请先设置一个');
  drawPanel();
}

const youMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.11, 0.14, 40),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })
);
youMarker.rotation.x = -Math.PI / 2;
youMarker.visible = false;
scene.add(youMarker);
// 卡通脚：踩在哪一格一目了然
const feet = createFeet();
scene.add(feet.object);

const flash = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false })
);
flash.renderOrder = 999;
camera.add(flash);

// ================= 场地 =================
// board：整个场地的容器。默认场地时它被放到玩家面前；用安全边界/自己画时它就是世界坐标（不移动）
const board = new THREE.Group();
scene.add(board);
const boardContent = new THREE.Group();
board.add(boardContent);
const drawGroup = new THREE.Group(); // 画边界时的点和线
scene.add(drawGroup);

const discGeo = new THREE.CircleGeometry(0.5, 40);
const numTexCache = {};
function numberTexture(n) {
  if (numTexCache[n]) return numTexCache[n];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = `800 104px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 14;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.strokeText(String(n), 64, 70);
  g.fillStyle = NUM_COLORS[n % NUM_COLORS.length] || '#ffffff';
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (numTexCache[n] = t);
}

function makeFlag(scale) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.26, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8ecf5 })
  );
  pole.position.y = 0.13;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.13, -0.045);
  shape.lineTo(0, -0.09);
  shape.closePath();
  const cloth = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({ color: 0xff7a2f, emissive: 0x6b2200, side: THREE.DoubleSide })
  );
  cloth.position.set(0.008, 0.26, 0);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 0.015, 16),
    new THREE.MeshStandardMaterial({ color: 0x30384f })
  );
  base.position.y = 0.0075;
  g.add(pole, cloth, base);
  g.scale.setScalar(scale);
  return g;
}

function makeMine(radius) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 0),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.4, metalness: 0.6, flatShading: true })
  );
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.45, 12, 8),
    new THREE.MeshBasicMaterial({ color: COLORS.boom })
  );
  core.position.y = radius * 0.75;
  g.add(body, core);
  g.position.y = radius + 0.01;
  g.userData.core = core;
  return g;
}

// 把多边形做成一块有厚度、带倒角的石板
function makeSlab(poly, center) {
  const shrunk = poly.map((p) => {
    const v = G.sub(center, p);
    const len = Math.hypot(v[0], v[1]) || 1;
    const k = Math.min(GAP, len * 0.3) / len;
    return [p[0] + v[0] * k, p[1] + v[1] * k];
  });
  const shape = new THREE.Shape(shrunk.map((p) => new THREE.Vector2(p[0], -p[1])));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1,
  });
  const mat = new THREE.MeshStandardMaterial({ color: COLORS.hidden, roughness: 0.75, metalness: 0.02 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2; // 形状在 XY 平面，转平放到地上
  return mesh;
}

// ---- 游戏状态 ----
let presetKey = 'normal';
let cfg = PRESETS[presetKey];
let layoutSource = 'default';
let guardianPoly = null;
let drawnPoly = null;
let boundary = [];      // 当前场地的多边形（board 坐标）
let cells = [];
let mineTotal = 0;
let state = 'ready';    // ready | playing | lost | won | drawing
let startTime = 0, endTime = 0, revealedCount = 0, flagCount = 0;
let standing = { cell: null, t: 0, nextTick: 0 };
let armed = false, armOrigin = null;
const pointerHover = new Set();
let effects = [];
let placeAfter = -1;
let drawPoints = [];
let drawPointerHit = null;

let panel, panelGroup, statusText = '';
let difficultyButtons = {}, layoutButtons = {}, uiButtons = [];
let restartButton, secondaryButton, shapeButton, envButton;
let progressDisc;

function loadBest(key) {
  try { return Number(localStorage.getItem(`minewalk2-best-${key}-${layoutSource}-${tileShape}`)) || 0; } catch (_) { return 0; }
}
function saveBest(key, ms) {
  try { localStorage.setItem(`minewalk2-best-${key}-${layoutSource}-${tileShape}`, String(ms)); } catch (_) { /* 无痕模式下存不了 */ }
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry && o.geometry !== discGeo && !o.isSprite) o.geometry.dispose();
    if (o.material) {
      if (o.material.map && !Object.values(numTexCache).includes(o.material.map)) o.material.map.dispose();
      o.material.dispose();
    }
  });
}

// 当前场地的形状（board 坐标）
function currentBoundary() {
  if (layoutSource === 'guardian' && guardianPoly) return guardianPoly;
  if (layoutSource === 'drawn' && drawnPoly) return drawnPoly;
  return G.roundedRect(2, 2, 0.35);
}

function buildBoard() {
  disposeTree(boardContent);
  boardContent.clear();
  boundary = G.ensureCCW(currentBoundary());

  const geoCells = tileShape === 'square' ? G.makeGridCells(boundary, cfg.square) : G.makeCells(boundary, cfg.size);
  cells = geoCells.map((gc, i) => {
    const center = G.centroid(gc.poly);
    const slab = makeSlab(gc.poly, center);
    // 每块石板颜色稍有不同，更自然
    const tint = new THREE.Color(COLORS.hidden).offsetHSL((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.08);
    slab.material.color.copy(tint);
    const inR = G.distToEdges(center, gc.poly);
    const flag = makeFlag(Math.min(1.1, inR / 0.18));
    flag.position.set(center[0], 0.05, center[1]);
    flag.visible = false;
    const c = {
      i, poly: gc.poly, cx: center[0], cz: center[1], inR, neighborIds: [...gc.neighbors],
      mine: false, adj: 0, revealed: false, flagged: false, tile: slab, tint, flag, extras: [],
    };
    slab.userData.cell = c;
    boardContent.add(slab, flag);
    return c;
  });
  cells.forEach((c) => (c.neighbors = c.neighborIds.map((j) => cells[j])));
  mineTotal = Math.max(1, Math.round(cells.length * cfg.density));

  // 场地外圈的一条细边，让你看清边界
  const edgePts = boundary.map((p) => new THREE.Vector3(p[0], 0.012, p[1]));
  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(edgePts),
    new THREE.LineBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.8 })
  );
  boardContent.add(edge);

  // 默认场地才有起点（玩家站在场地外面）
  if (layoutSource === 'default') {
    const start = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.17, 0.21, 48),
      new THREE.MeshBasicMaterial({ color: 0x5cffb0, transparent: true, opacity: 0.85, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    const label = makeCanvasPlane(0.26, 0.11, 1000);
    label.redraw((ctx, w, h) => {
      ctx.fillStyle = '#5cffb0';
      ctx.font = `800 ${h * 0.7}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('起点', w / 2, h / 2 + 4);
    });
    label.mesh.rotation.x = -Math.PI / 2;
    label.mesh.position.y = 0.002;
    start.add(ring, label.mesh);
    start.position.set(0, 0.004, 1.35);
    boardContent.add(start);
  }

  progressDisc = new THREE.Mesh(
    discGeo,
    new THREE.MeshBasicMaterial({ color: 0x9dffd2, transparent: true, opacity: 0.6, depthWrite: false })
  );
  progressDisc.rotation.x = -Math.PI / 2;
  progressDisc.visible = false;
  boardContent.add(progressDisc);

  buildPanel();
}

// ---- 信息面板和按钮 ----
function buildPanel() {
  panelGroup = new THREE.Group();
  boardContent.add(panelGroup);
  positionPanel();

  panel = makeCanvasPlane(1.2, 0.46, 1000);
  panelGroup.add(panel.mesh);

  uiButtons = [];
  difficultyButtons = {};
  layoutButtons = {};
  Object.keys(PRESETS).forEach((key, i) => {
    const b = makeButton(PRESETS[key].label, { width: 0.34, height: 0.1, color: '#2f3f6e', onClick: () => newGame(key) });
    b.position.set((i - 1) * 0.39, -0.32, 0);
    panelGroup.add(b);
    difficultyButtons[key] = b;
    uiButtons.push(b);
  });
  restartButton = makeButton('重新开始  A/X', { width: 0.56, height: 0.1, color: '#3a5bd9', onClick: () => primaryAction() });
  restartButton.position.set(-0.3, -0.44, 0);
  secondaryButton = makeButton('移到面前  B/Y', { width: 0.56, height: 0.1, color: '#3a5bd9', onClick: () => secondaryAction() });
  secondaryButton.position.set(0.3, -0.44, 0);
  panelGroup.add(restartButton, secondaryButton);
  uiButtons.push(restartButton, secondaryButton);
  Object.keys(LAYOUTS).forEach((key, i) => {
    const b = makeButton(LAYOUTS[key], { width: 0.34, height: 0.1, color: '#2e5a46', onClick: () => useLayout(key) });
    b.position.set((i - 1) * 0.39, -0.56, 0);
    panelGroup.add(b);
    layoutButtons[key] = b;
    uiButtons.push(b);
  });
  shapeButton = makeButton(SHAPES[tileShape], { width: 0.56, height: 0.1, color: '#5a4a2e', onClick: () => setTileShape(tileShape === 'square' ? 'voronoi' : 'square') });
  shapeButton.position.set(-0.3, -0.68, 0);
  envButton = makeButton(`背景：${envs.label || '…'} ▶`, { width: 0.56, height: 0.1, color: '#5a4a2e', onClick: () => envs.next() });
  envButton.position.set(0.3, -0.68, 0);
  panelGroup.add(shapeButton, envButton);
  uiButtons.push(shapeButton, envButton);
  wristButton = makeButton('', { width: 0.34, height: 0.1, color: '#2e4f6a', onClick: () => { wrist.enabled = !wrist.enabled; savePref('minewalk-wrist', wrist.enabled ? '1' : '0'); refreshToggles(); } });
  wristButton.position.set(-0.39, -0.8, 0);
  floatButton = makeButton('', { width: 0.34, height: 0.1, color: '#2e4f6a', onClick: () => setFloatNums(!floatNums) });
  floatButton.position.set(0, -0.8, 0);
  const exitButton = makeExitButton(app, { width: 0.34, height: 0.1 });
  exitButton.position.set(0.39, -0.8, 0);
  panelGroup.add(wristButton, floatButton, exitButton);
  uiButtons.push(wristButton, floatButton, exitButton);
  refreshToggles();
  refreshButtons();
  drawPanel();
}

// 默认场地：面板在场地远端。其他场地：面板放在场地外、你面对的方向上
function positionPanel() {
  if (!panelGroup) return;
  if (layoutSource === 'default') {
    panelGroup.position.set(0, 1.45, -1.6);
    panelGroup.rotation.set(0, 0, 0);
    return;
  }
  const head = app.headPosition(new THREE.Vector3());
  const f = app.headForward(new THREE.Vector3());
  const dir = [f.x, f.z];
  const c = G.centroid(boundary);
  const reach = Math.max(...boundary.map((p) => G.dot(G.sub(p, c), dir)));
  const d = Math.max(reach + 0.7, 1.6);
  const hp = [head.x, head.z];
  const base = G.pointInPolygon(hp, boundary) || layoutSource === 'drawn' ? c : hp;
  panelGroup.position.set(base[0] + dir[0] * d, 1.45, base[1] + dir[1] * d);
  panelGroup.rotation.set(0, Math.atan2(-dir[0], -dir[1]), 0);
}

let wristButton = null, floatButton = null;
function refreshToggles() {
  wristButton?.userData.ui.setLabel(`手腕地图：${wrist.enabled ? '开' : '关'}`);
  floatButton?.userData.ui.setLabel(`半空数字：${floatNums ? '开' : '关'}`);
}
function setFloatNums(v) {
  floatNums = v;
  savePref('minewalk-float', v ? '1' : '0');
  for (const c of cells) for (const e of c.extras) if (e.userData.float) e.visible = v;
  refreshToggles();
}

function refreshButtons() {
  for (const [k, b] of Object.entries(difficultyButtons)) b.userData.ui.setActive(k === presetKey);
  refreshLayoutButtons();
  if (!restartButton) return;
  if (state === 'drawing') {
    restartButton.userData.ui.setLabel('画好了  A/X');
    secondaryButton.userData.ui.setLabel('撤销一点  B/Y');
    secondaryButton.visible = true;
  } else {
    restartButton.userData.ui.setLabel('重新开始  A/X');
    secondaryButton.userData.ui.setLabel('移到面前  B/Y');
    secondaryButton.visible = layoutSource === 'default';
  }
}

function refreshLayoutButtons() {
  for (const [k, b] of Object.entries(layoutButtons)) {
    b.userData.ui.setActive(state === 'drawing' ? k === 'drawn' : k === layoutSource);
    b.userData.ui.setDisabled((k === 'guardian' || app.presenting) && !guardianPoly);
  }
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function elapsed() {
  if (state === 'ready' || state === 'drawing') return 0;
  return (state === 'playing' ? performance.now() : endTime) - startTime;
}

function drawPanel() {
  if (!panel) return;
  const best = loadBest(presetKey);
  panel.redraw((ctx, w, h) => {
    roundRect(ctx, 4, 4, w - 8, h - 8, 36);
    ctx.fillStyle = 'rgba(18, 25, 44, 0.92)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = state === 'lost' ? '#ff4d4d' : state === 'won' ? '#5cffb0' : '#3b4a78';
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#eef2fb';
    ctx.font = `800 70px ${FONT}`;
    ctx.fillText('雷区漫步', 50, 82);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f5b941';
    ctx.font = `700 42px ${FONT}`;
    const info = state === 'drawing' ? `画边界 · ${drawPoints.length} 个点` : `${cfg.label} · ${LAYOUTS[layoutSource]} · ${cells.length} 块`;
    ctx.fillText(info, w - 50, 82);

    ctx.textAlign = 'left';
    ctx.font = `600 44px ${FONT}`;
    ctx.fillStyle = '#c9d3ea';
    if (state !== 'drawing') {
      ctx.fillText(`剩余雷数 ${mineTotal - flagCount}`, 50, 200);
      ctx.fillText(`用时 ${fmt(elapsed())}`, 430, 200);
      ctx.fillText(`最佳 ${best ? fmt(best) : '--'}`, 780, 200);
    } else {
      ctx.fillText('用射线指着地面，按扳机放一个点', 50, 200);
    }

    ctx.font = `700 44px ${FONT}`;
    ctx.fillStyle = state === 'lost' ? '#ff6b6b' : state === 'won' ? '#5cffb0' : '#eef2fb';
    ctx.fillText(statusText, 50, 330);
  });
}

function setStatus(text) {
  statusText = text;
  drawPanel();
}

// ================= 游戏逻辑 =================
function cellAt(lx, lz) {
  const p = [lx, lz];
  for (const c of cells) if (G.pointInPolygon(p, c.poly)) return c;
  return null;
}

// 第一步之后才埋雷，保证第一脚和它周围一定安全
function placeMines(first) {
  const forbidden = new Set([first, ...first.neighbors]);
  const pool = cells.filter((c) => !forbidden.has(c));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  mineTotal = Math.min(mineTotal, pool.length);
  pool.slice(0, mineTotal).forEach((c) => (c.mine = true));
  for (const c of cells) c.adj = c.neighbors.filter((n) => n.mine).length;
}

function showRevealed(c) {
  c.tile.material.color.setHex(COLORS.open);
  c.tile.scale.z = 0.25; // 石板沉下去，露出泥土
  if (c.adj > 0) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(c.adj), depthWrite: false }));
    s.scale.setScalar(Math.min(0.3, Math.max(0.16, c.inR * 1.4)));
    s.position.set(c.cx, 0.18, c.cz);
    boardContent.add(s);
    c.extras.push(s);
    // 同一个数字再飘一个在胸口高度：平视就能看到，不用一直低头
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(c.adj), depthWrite: false, transparent: true, opacity: 0.9 }));
    f.scale.setScalar(0.13);
    f.position.set(c.cx, FLOAT_Y, c.cz);
    f.userData.float = true;
    f.visible = floatNums;
    boardContent.add(f);
    c.extras.push(f);
  }
}
const FLOAT_Y = 1.05;
let floatNums = loadPref('minewalk-float', '1') === '1';

// ---- 手腕地图：抬起左手看 ----
const wrist = createWristMap(app, {
  enabled: loadPref('minewalk-wrist', '1') === '1',
  draw(ctx, w, h) {
    roundRect(ctx, 6, 6, w - 12, h - 12, 40);
    ctx.fillStyle = 'rgba(14,20,36,0.94)'; ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = '#3b4a78'; ctx.stroke();
    if (!cells.length || state === 'noroom') {
      ctx.fillStyle = '#c9d3ea'; ctx.font = `700 60px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('没有场地', w / 2, h / 2);
      return;
    }
    // 以你为中心、你面对的方向朝上
    const foot = board.worldToLocal(app.footPosition(new THREE.Vector3()));
    const fl = app.headForward(new THREE.Vector3()).applyAxisAngle(new THREE.Vector3(0, 1, 0), -board.rotation.y);
    const f = [fl.x, fl.z];
    const r = [-f[1], f[0]];
    const p0 = G.centroid(boundary); // 地图以场地中心为中心、你面对的方向朝上
    let maxR = 0.5;
    for (const q of boundary) maxR = Math.max(maxR, Math.hypot(q[0] - p0[0], q[1] - p0[1]));
    const sc = (w / 2 - 50) / maxR;
    const map = (q) => { const dx = q[0] - p0[0], dz = q[1] - p0[1]; return [w / 2 + (dx * r[0] + dz * r[1]) * sc, h / 2 - (dx * f[0] + dz * f[1]) * sc]; };
    for (const c of cells) {
      ctx.beginPath();
      c.poly.forEach((q, i) => { const [x, y] = map(q); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.fillStyle = c === standing.cell && !c.revealed ? '#2fbf7f' : c.revealed ? '#4a3f33' : state === 'lost' && c.mine ? '#ff3b30' : '#d6cdb9';
      ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
      const [x, y] = map([c.cx, c.cz]);
      const fs = Math.max(26, Math.min(70, c.inR * sc * 1.3));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (c.revealed && c.adj) { ctx.fillStyle = NUM_COLORS[c.adj]; ctx.font = `900 ${fs}px ${FONT}`; ctx.fillText(String(c.adj), x, y + 2); }
      if (c.flagged) { ctx.fillStyle = '#ff4d4d'; ctx.font = `900 ${fs}px ${FONT}`; ctx.fillText('⚑', x, y); }
    }
    // 你：一个朝上的小三角（地图跟着你转，所以箭头永远朝上）
    let [mx, my] = map([foot.x, foot.z]);
    mx = Math.max(40, Math.min(w - 40, mx)); my = Math.max(40, Math.min(h - 40, my));
    ctx.fillStyle = '#5cffb0'; ctx.strokeStyle = '#0d1220'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(mx, my - 34); ctx.lineTo(mx + 24, my + 22); ctx.lineTo(mx - 24, my + 22); ctx.closePath();
    ctx.fill(); ctx.stroke();
  },
});

function reveal(c) {
  if (state !== 'ready' && state !== 'playing') return;
  if (c.revealed || c.flagged) return;
  if (state === 'ready') {
    placeMines(c);
    state = 'playing';
    startTime = performance.now();
  }
  if (c.mine) {
    explode(c);
    return;
  }
  const queue = [c];
  let opened = 0;
  while (queue.length) {
    const k = queue.shift();
    if (k.revealed || k.flagged || k.mine) continue;
    k.revealed = true;
    revealedCount++;
    opened++;
    showRevealed(k);
    if (k.adj === 0) for (const n of k.neighbors) if (!n.revealed) queue.push(n);
  }
  sfx.reveal(opened > 1);
  app.pulseAll(0.35, 40);
  if (revealedCount === cells.length - mineTotal) win();
  else setStatus(opened > 1 ? `一下翻开了 ${opened} 块！` : '继续，小心脚下…');
}

function toggleFlag(c) {
  if ((state !== 'ready' && state !== 'playing') || c.revealed) return;
  c.flagged = !c.flagged;
  c.flag.visible = c.flagged;
  flagCount += c.flagged ? 1 : -1;
  c.flagged ? sfx.flag() : sfx.unflag();
  drawPanel();
}

function explode(c) {
  state = 'lost';
  endTime = performance.now();
  for (const k of cells) {
    if (k.mine && !k.flagged) {
      const m = makeMine(Math.min(0.09, k.inR * 0.45));
      m.position.x = k.cx;
      m.position.z = k.cz;
      boardContent.add(m);
      k.extras.push(m);
    }
    if (k.flagged && !k.mine) k.tile.material.color.setHex(COLORS.wrongFlag);
  }
  c.tile.material.color.setHex(COLORS.boom);
  sfx.boom();
  app.pulseAll(1.0, 600);
  effects.push(blastEffect(c));
  flash.material.opacity = 0.75;
  setStatus('踩到雷了！按 A/X 再来一局');
}

function win() {
  state = 'won';
  endTime = performance.now();
  for (const k of cells) if (k.mine && !k.flagged) { k.flagged = true; k.flag.visible = true; flagCount++; }
  const t = endTime - startTime;
  const best = loadBest(presetKey);
  const record = !best || t < best;
  if (record) saveBest(presetKey, t);
  sfx.win();
  [0, 150, 300].forEach((d) => setTimeout(() => app.pulseAll(0.6, 80), d));
  effects.push(confettiEffect());
  setStatus(record ? `全部排除！新纪录 ${fmt(t)}` : `全部排除！用时 ${fmt(t)}`);
}

// 每一局都会重新切一次石板，所以每局形状都不一样
function newGame(key = presetKey) {
  if (app.presenting && roomState !== 'ok') { presetKey = key; cfg = PRESETS[key]; showRoomProblem(); return; }
  const wasDrawing = state === 'drawing';
  presetKey = key;
  cfg = PRESETS[key];
  state = 'ready';
  revealedCount = 0;
  flagCount = 0;
  startTime = endTime = 0;
  standing = { cell: null, t: 0, nextTick: 0 };
  armed = false;
  armOrigin = null;
  pointerHover.clear();
  effects.forEach((e) => e.dispose?.());
  effects = [];
  flash.material.opacity = 0;
  clearDrawing();
  statusText = layoutSource === 'default' ? '走进场地，在一块石板上站稳就会翻开' : '走动一下就开始，在石板上站稳就会翻开';
  if (wasDrawing && layoutSource === 'default' && savedBoard) {
    board.position.copy(savedBoard.position); // 画到一半取消了，把默认场地放回原处
    board.rotation.y = savedBoard.rotY;
  }
  buildBoard();
  sfx.click();
}

function setTileShape(shape) {
  tileShape = shape;
  savePref('minewalk-shape', shape);
  if (shapeSelect) shapeSelect.value = shape;
  if (state === 'drawing') return;
  newGame();
}

function useLayout(key) {
  if (app.presenting && roomState !== 'ok') return;
  if (key === 'drawn') { startDrawing(); return; }
  if (key === 'guardian' && !guardianPoly) return;
  layoutSource = key;
  if (key === 'default') {
    if (placeBoardInFront(false) === false) return;
  } else {
    board.position.set(0, 0, 0);
    board.rotation.set(0, 0, 0);
  }
  newGame();
}

function primaryAction() {
  if (state === 'drawing') finishDrawing();
  else newGame();
}
function secondaryAction() {
  if (state === 'drawing') {
    drawPoints.pop();
    updateDrawVisuals();
    drawPanel();
    sfx.unflag();
  } else if (layoutSource === 'default') {
    placeBoardInFront();
  }
}

// 把默认场地放到玩家正前方（起点刚好在脚下）
function placeBoardInFront(withSound = true) {
  if (layoutSource !== 'default') return;
  const head = app.headPosition(new THREE.Vector3());
  const dir = app.headForward(new THREE.Vector3());
  const dist = 1.35;
  if (app.presenting) {
    // VR 里：2×2 场地（连同身后的起点）必须整块落在安全边界里面
    if (!guardianPoly) return;
    const fit = fitRect(guardianPoly, { x0: -1.05, x1: 1.05, z0: -1.05, z1: 1.6 }, { prefer: [head.x + dir.x * dist, head.z + dir.z * dist], forward: [dir.x, dir.z] });
    if (!fit) { useLayout('guardian'); setStatus('安全边界里放不下 2×2 小场地，已改成铺满安全边界'); return false; }
    board.position.set(fit.x, 0, fit.z);
    board.rotation.y = fit.yaw;
  } else {
    board.position.set(head.x + dir.x * dist, 0, head.z + dir.z * dist);
    board.rotation.y = Math.atan2(-dir.x, -dir.z);
  }
  if (withSound) sfx.click();
}

// ================= 自己画边界 =================
const drawMatPoint = new THREE.MeshBasicMaterial({ color: 0xffd36b });
const drawMatFirst = new THREE.MeshBasicMaterial({ color: 0x5cffb0 });
const drawPointGeo = new THREE.SphereGeometry(0.035, 16, 10);
const drawLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd36b }));
const drawPreview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.06, gapSize: 0.04 }));
drawGroup.add(drawLine, drawPreview);

let savedBoard = null;
function startDrawing() {
  if (state !== 'drawing') savedBoard = { position: board.position.clone(), rotY: board.rotation.y };
  state = 'drawing';
  drawPoints = [];
  board.position.set(0, 0, 0);
  board.rotation.set(0, 0, 0);
  for (const c of cells) { c.tile.visible = false; c.flag.visible = false; c.extras.forEach((e) => (e.visible = false)); }
  boardContent.children.forEach((o) => { if (o !== panelGroup) o.visible = false; });
  positionPanelForDrawing();
  refreshButtons();
  setStatus('沿着你想玩的范围放点，绕一圈回到绿点');
  sfx.click();
}

function positionPanelForDrawing() {
  const head = app.headPosition(new THREE.Vector3());
  const f = app.headForward(new THREE.Vector3());
  panelGroup.position.set(head.x + f.x * 2.2, 1.45, head.z + f.z * 2.2);
  panelGroup.rotation.set(0, Math.atan2(-f.x, -f.z), 0);
}

function clearDrawing() {
  drawPoints = [];
  updateDrawVisuals();
}

let drawnCount = -1;
function updateDrawVisuals() {
  if (drawnCount !== drawPoints.length) {
    drawnCount = drawPoints.length;
    for (const m of drawGroup.children.filter((o) => o.isMesh)) drawGroup.remove(m);
    drawPoints.forEach((p, i) => {
      const m = new THREE.Mesh(drawPointGeo, i === 0 ? drawMatFirst : drawMatPoint);
      m.position.set(p[0], 0.03, p[1]);
      if (i === 0) m.scale.setScalar(1.6);
      drawGroup.add(m);
    });
    drawLine.geometry.dispose();
    drawLine.geometry = new THREE.BufferGeometry().setFromPoints(drawPoints.map((p) => new THREE.Vector3(p[0], 0.02, p[1])));
  }
  const showPreview = state === 'drawing' && drawPoints.length > 0 && drawPointerHit;
  drawPreview.visible = !!showPreview;
  if (showPreview) {
    const last = drawPoints[drawPoints.length - 1];
    drawPreview.geometry.dispose();
    drawPreview.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(last[0], 0.02, last[1]), new THREE.Vector3(drawPointerHit[0], 0.02, drawPointerHit[1])]);
    drawPreview.computeLineDistances();
  }
}

function nearFirstPoint(p) {
  return drawPoints.length >= 3 && G.dist(p, drawPoints[0]) < 0.25;
}

function addDrawPoint(p) {
  if (nearFirstPoint(p)) { finishDrawing(); return; }
  if (app.presenting && guardianPoly && !G.pointInPolygon(p, guardianPoly)) { setStatus('这个点在安全边界外面，往里放一点'); sfx.warn(); return; }
  if (drawPoints.length && G.dist(p, drawPoints[drawPoints.length - 1]) < 0.1) return;
  drawPoints.push(p);
  updateDrawVisuals();
  drawPanel();
  sfx.flag();
}

function finishDrawing() {
  if (drawPoints.length < 3) { setStatus('至少要放 3 个点才能围成一块地'); sfx.warn(); return; }
  const poly = G.ensureCCW(drawPoints);
  if (G.selfIntersects(poly)) { setStatus('边界线交叉了，按 B/Y 撤销几个点再试'); sfx.warn(); return; }
  if (G.area(poly) < 1) { setStatus(`太小了（${G.area(poly).toFixed(1)} 平方米），至少要 1 平方米`); sfx.warn(); return; }
  drawnPoly = poly;
  layoutSource = 'drawn';
  state = 'ready';
  clearDrawing();
  newGame();
}

// ================= 特效 =================
function blastEffect(c) {
  const world = board.localToWorld(new THREE.Vector3(c.cx, 0.1, c.cz));
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  m.position.copy(world);
  scene.add(m);
  let t = 0;
  return {
    update(dt) {
      t += dt;
      m.scale.setScalar(1 + t * 9);
      m.material.opacity = Math.max(0, 0.9 - t * 1.4);
      return t < 0.7;
    },
    dispose() { scene.remove(m); m.geometry.dispose(); m.material.dispose(); },
  };
}

function confettiEffect() {
  const n = 400;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const vel = [];
  const c = G.centroid(boundary);
  const origin = board.localToWorld(new THREE.Vector3(c[0], 1.2, c[1]));
  const palette = [0x5cffb0, 0xf5b941, 0x5aa9ff, 0xff7a2f, 0xc891ff].map((h) => new THREE.Color(h));
  for (let i = 0; i < n; i++) {
    origin.toArray(pos, i * 3);
    palette[i % palette.length].toArray(col, i * 3);
    vel.push(new THREE.Vector3((Math.random() - 0.5) * 3.5, Math.random() * 3.5 + 1.5, (Math.random() - 0.5) * 3.5));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true }));
  scene.add(pts);
  let t = 0;
  return {
    update(dt) {
      t += dt;
      for (let i = 0; i < n; i++) {
        vel[i].y -= 4.5 * dt;
        pos[i * 3] += vel[i].x * dt;
        pos[i * 3 + 1] = Math.max(0.01, pos[i * 3 + 1] + vel[i].y * dt);
        pos[i * 3 + 2] += vel[i].z * dt;
      }
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = Math.max(0, 1 - Math.max(0, t - 2.5));
      return t < 3.5;
    },
    dispose() { scene.remove(pts); geo.dispose(); pts.material.dispose(); },
  };
}

// ================= 每一帧 =================
const tmpHead = new THREE.Vector3();
let lastSecond = -1;

// 根据头部位置判断你站在哪一块（头在脚的正上方）
function updateStanding(headWorld, dt) {
  youMarker.position.set(headWorld.x, 0.006, headWorld.z);
  const local = board.worldToLocal(headWorld.clone());
  const active = state === 'ready' || state === 'playing';

  // 开局后先走动一点才开始，避免脚下那块一开局就被翻开
  if (active && !armed) {
    if (!armOrigin) armOrigin = [local.x, local.z];
    if (G.dist(armOrigin, [local.x, local.z]) > ARM_DISTANCE) armed = true;
  }

  const c = active ? cellAt(local.x, local.z) : null;
  if (standing.cell !== c) {
    standing = { cell: c, t: 0, nextTick: 0 };
    if (c && armed && c.flagged) sfx.warn();
  }
  if (c && armed && !c.revealed && !c.flagged) {
    standing.t += dt;
    if (standing.t >= standing.nextTick) {
      sfx.tick();
      app.pulseAll(0.15, 25);
      standing.nextTick += 0.18;
    }
    const p = Math.min(standing.t / DWELL, 1);
    progressDisc.visible = true;
    progressDisc.position.set(c.cx, 0.06, c.cz);
    progressDisc.scale.setScalar(c.inR * 1.8 * p);
    if (standing.t >= DWELL) {
      progressDisc.visible = false;
      reveal(c);
    }
  } else if (progressDisc) {
    progressDisc.visible = false;
  }
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpRay = new THREE.Ray();
const tmpHit = new THREE.Vector3();

function updatePointers() {
  pointerHover.clear();
  const visibleButtons = uiButtons.filter((b) => b.visible);
  const tiles = state === 'drawing' ? [] : cells.filter((c) => !c.revealed).map((c) => c.tile);
  drawPointerHit = null;
  for (const c of app.controllers) {
    if (!c.inputSource) continue;
    const hit = app.pointAt(c, [...visibleButtons, ...tiles], 6);
    c.hover = hit ? hit.object : null;
    c.groundHit = null;
    if (c.hover) {
      pointerHover.add(c.hover);
    } else if (state === 'drawing') {
      // 画边界时，射线打到地面的位置
      app.getRay(c, tmpRay);
      if (tmpRay.intersectPlane(groundPlane, tmpHit) && tmpHit.distanceTo(tmpRay.origin) < 8) {
        c.groundHit = [tmpHit.x, tmpHit.z];
        drawPointerHit = c.groundHit;
        c.line.scale.z = tmpHit.distanceTo(tmpRay.origin);
        c.dot.visible = true;
        c.dot.position.copy(tmpHit);
      }
    }
  }
  for (const b of uiButtons) b.userData.ui.setHover(pointerHover.has(b));
  if (state === 'drawing') {
    updateDrawVisuals();
    const first = drawGroup.children.find((o) => o.isMesh);
    if (first) first.scale.setScalar(drawPointerHit && nearFirstPoint(drawPointerHit) ? 2.6 : 1.6);
  }
}

function updateTileColors() {
  for (const c of cells) {
    let e = 0x000000;
    if (!c.revealed && state !== 'lost') {
      if (standing.cell === c && armed && !c.flagged) e = COLORS.stand;
      else if (pointerHover.has(c.tile)) e = COLORS.hover;
    }
    c.tile.material.emissive.setHex(e);
    c.tile.material.emissiveIntensity = 0.55;
  }
}

function onFrame(dt) {
  envs.update(dt);
  effects = effects.filter((e) => {
    const alive = e.update(dt);
    if (!alive) e.dispose?.();
    return alive;
  });
  if (flash.material.opacity > 0) flash.material.opacity = Math.max(0, flash.material.opacity - dt * 1.2);

  if (state === 'lost') {
    const k = 0.5 + 0.5 * Math.sin(performance.now() / 120);
    for (const c of cells) for (const ex of c.extras) if (ex.userData.core) ex.userData.core.scale.setScalar(0.7 + k * 0.5);
  }

  if (app.presenting) {
    if (placeAfter > 0) {
      placeAfter -= dt;
      if (placeAfter <= 0 && roomState === 'waiting') showRoomProblem();
    }
    if (roomState === 'waiting') {
      roomWait -= dt;
      if (roomWait <= 0) { roomState = 'none'; showRoomProblem(); }
    }
    youMarker.visible = false;
    updateStanding(app.footPosition(tmpHead), dt);
    feet.update(tmpHead, app.headForward(new THREE.Vector3()), 0.045, dt);
    wrist.update(dt);
    updatePointers();
    app.pollButtons((c, bi) => {
      if (bi === 4) primaryAction();
      if (bi === 5) secondaryAction();
    });
  } else {
    youMarker.visible = false;
    feet.hide();
    controls.update();
  }

  if (state === 'playing') {
    const s = Math.floor(elapsed() / 1000);
    if (s !== lastSecond) { lastSecond = s; drawPanel(); }
  }
  updateTileColors();
}

app.on('select', (c) => {
  initAudio();
  const target = c.hover;
  if (target?.userData.ui) {
    app.pulse(c, 0.4, 30);
    target.userData.ui.onClick?.();
  } else if (target?.userData.cell) {
    app.pulse(c, 0.3, 30);
    toggleFlag(target.userData.cell);
  } else if (state === 'drawing' && c.groundHit) {
    app.pulse(c, 0.3, 30);
    addDrawPoint(c.groundHit);
  }
});

// ================= 电脑上预览（鼠标）=================
camera.position.set(0, 2.1, 1.1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, -1.7);
controls.enableDamping = true;

const mouse = new THREE.Vector2();
const mouseRay = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointermove', (e) => {
  if (app.presenting || state !== 'drawing') return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  mouseRay.setFromCamera(mouse, camera);
  drawPointerHit = mouseRay.ray.intersectPlane(groundPlane, tmpHit) ? [tmpHit.x, tmpHit.z] : null;
  updateDrawVisuals();
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (app.presenting || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 6) return; // 是在拖动视角，不算点击
  initAudio();
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  mouseRay.setFromCamera(mouse, camera);
  const targets = [...uiButtons.filter((b) => b.visible), ...(state === 'drawing' ? [] : cells.filter((c) => !c.revealed).map((c) => c.tile))];
  const hit = mouseRay.intersectObjects(targets, false)[0];
  if (hit?.object.userData.ui) hit.object.userData.ui.onClick?.();
  else if (hit && e.button === 2) toggleFlag(hit.object.userData.cell);
  else if (hit) reveal(hit.object.userData.cell);
  else if (state === 'drawing' && mouseRay.ray.intersectPlane(groundPlane, tmpHit)) addDrawPoint([tmpHit.x, tmpHit.z]);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') primaryAction();
  if (e.key === 'Backspace') secondaryAction();
});

// ================= 页面上的按钮 =================
const overlay = document.getElementById('overlay');
const backLink = document.getElementById('back');
const btnVR = document.getElementById('enter-vr');
const btnAR = document.getElementById('enter-ar');
const btnDesktop = document.getElementById('desktop');
const note = document.getElementById('note');
const envSelect = document.getElementById('env-select');
const shapeSelect = document.getElementById('shape-select');
let desktopPreview = false;
for (const e of ENVIRONMENTS) envSelect.add(new Option(e.label, e.key));
envSelect.value = savedEnvKey();
envSelect.addEventListener('change', () => envs.set(envSelect.value));
shapeSelect.value = tileShape;
shapeSelect.addEventListener('change', () => setTileShape(shapeSelect.value));

(async () => {
  const [vr, ar] = await Promise.all([app.supports('immersive-vr'), app.supports('immersive-ar')]);
  btnVR.hidden = !vr;
  btnAR.hidden = !ar;
  if (!vr && !ar) note.textContent = '这台设备不支持 VR。可以先在电脑上预览：左键 = 踩石板，右键 = 插旗，拖动 = 转视角。';
})();

async function start(mode) {
  initAudio();
  try {
    await app.enter(mode);
  } catch (err) {
    note.textContent = '无法进入：' + err.message;
  }
}
btnVR.addEventListener('click', () => start('immersive-vr'));
btnAR.addEventListener('click', () => start('immersive-ar'));
btnDesktop.addEventListener('click', () => {
  initAudio();
  desktopPreview = true;
  overlay.classList.add('hidden');
});

board.position.set(0, 0, -1.35);
newGame('normal');

// 方便调试：在浏览器控制台里可以用 window.minewalk 查看状态
window.minewalk = {
  get state() { return state; }, get cells() { return cells; }, get cfg() { return cfg; },
  get layout() { return layoutSource; }, get mineTotal() { return mineTotal; },
  board, newGame, reveal, toggleFlag, updateStanding, useLayout, addDrawPoint, finishDrawing,
  setGuardian(pts) { guardianPoly = G.safeInset(pts, GUARDIAN_INSET); refreshLayoutButtons(); },
  get roomState() { return roomState; }, wrist, setFloatNums, placeBoardInFront, fitRect, G,
  camera, controls, envs, setTileShape,
};
