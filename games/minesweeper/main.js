// 雷区漫步：踩在地板上的扫雷。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio } from '../../shared/sfx.js';
import { createNatureEnv } from '../../shared/nature-env.js';

// ================= 可调参数 =================
const PRESETS = {
  easy:   { label: '简单', cols: 4, rows: 4, cell: 0.45, mines: 3 },
  normal: { label: '普通', cols: 5, rows: 5, cell: 0.38, mines: 5 },
  hard:   { label: '困难', cols: 6, rows: 6, cell: 0.33, mines: 8 },
};
const DWELL = 0.7; // 站在一格上多少秒才翻开
// 石板（未翻开）、泥土（已翻开）、木框
const COLORS = {
  hidden: 0xd6cdb9, open: 0x4a3f33, stand: 0x2fbf7f, hover: 0x3d6ccc,
  frame: 0x9a6b3f, frameGlow: 0x2a1a0a, wrongFlag: 0x8a2530, boom: 0xff3b30,
};
const NUM_COLORS = ['', '#5aa9ff', '#5fe07a', '#ff6b6b', '#c891ff', '#ffb547', '#45e0d8', '#ffffff', '#b4bdd0'];

// ================= 场景 =================
const app = createXRApp({ onFrame });
const { scene, camera, renderer } = app;

// 大自然背景（混合现实模式下隐藏，你看到的是自己的房间）
const nature = createNatureEnv({ clearRadius: 4 });
scene.add(nature.group, ...nature.lights);
scene.fog = nature.fog;

app.on('modechange', (mode) => {
  const ar = mode === 'ar';
  nature.group.visible = !ar;
  scene.fog = ar ? null : nature.fog;
  overlay.classList.toggle('hidden', mode !== 'desktop' || desktopPreview);
  backLink.style.display = mode === 'desktop' ? '' : 'none';
  if (mode !== 'desktop') placeAfter = 0.4; // 进入后稍等一下再把雷区放到面前
});

// 地板上"你在这里"的圆圈（VR 里看不到自己的脚）
const youMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.11, 0.14, 40),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })
);
youMarker.rotation.x = -Math.PI / 2;
youMarker.visible = false;
scene.add(youMarker);

// 踩雷时罩住视野的红色闪光
const flash = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false })
);
flash.renderOrder = 999;
camera.add(flash);

// ================= 雷区 =================
const board = new THREE.Group();
scene.add(board);
const boardContent = new THREE.Group();
board.add(boardContent);

const tileGeo = new THREE.BoxGeometry(1, 1, 1);
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
  g.fillStyle = NUM_COLORS[n];
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
  g.position.y = radius;
  g.userData.core = core;
  return g;
}

// ---- 游戏状态 ----
let presetKey = 'normal';
let cfg = PRESETS[presetKey];
let cells = [];
let W = 0, D = 0;
let state = 'ready'; // ready | playing | lost | won
let startTime = 0, endTime = 0, revealedCount = 0, flagCount = 0;
let standing = { cell: null, t: 0, nextTick: 0 };
const pointerHover = new Set();
let effects = [];
let placeAfter = -1;

let panel, statusText = '', difficultyButtons = {}, uiButtons = [];
let progressDisc;

function loadBest(key) {
  try { return Number(localStorage.getItem('minewalk-best-' + key)) || 0; } catch (_) { return 0; }
}
function saveBest(key, ms) {
  try { localStorage.setItem('minewalk-best-' + key, String(ms)); } catch (_) { /* 无痕模式下存不了 */ }
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry && o.geometry !== tileGeo && o.geometry !== discGeo) o.geometry.dispose();
    if (o.material) {
      if (o.material.map && !Object.values(numTexCache).includes(o.material.map)) o.material.map.dispose();
      o.material.dispose();
    }
  });
}

function buildBoard() {
  disposeTree(boardContent);
  boardContent.clear();
  const { cols, rows, cell } = cfg;
  W = cols * cell;
  D = rows * cell;

  // 边框
  const frameMat = new THREE.MeshStandardMaterial({ color: COLORS.frame, emissive: COLORS.frameGlow, roughness: 0.8 });
  const t = 0.03;
  for (const [w, d, x, z] of [
    [W + t * 2, t, 0, -D / 2 - t / 2], [W + t * 2, t, 0, D / 2 + t / 2],
    [t, D, -W / 2 - t / 2, 0], [t, D, W / 2 + t / 2, 0],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), frameMat);
    m.position.set(x, 0.025, z);
    boardContent.add(m);
  }

  // 格子
  cells = [];
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const cx = -W / 2 + cell * (x + 0.5);
      const cz = -D / 2 + cell * (z + 0.5);
      const tile = new THREE.Mesh(
        tileGeo,
        new THREE.MeshStandardMaterial({ color: COLORS.hidden, roughness: 0.55, metalness: 0.05 })
      );
      tile.scale.set(cell * 0.92, 0.04, cell * 0.92);
      tile.position.set(cx, 0.02, cz);
      const flag = makeFlag(cell / 0.4);
      flag.position.set(cx, 0.04, cz);
      flag.visible = false;
      const c = { x, z, cx, cz, mine: false, adj: 0, revealed: false, flagged: false, tile, flag, extras: [] };
      tile.userData.cell = c;
      boardContent.add(tile, flag);
      cells.push(c);
    }
  }

  // 起点
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
  start.position.set(0, 0.004, D / 2 + 0.35);
  boardContent.add(start);

  // 站立进度圆盘
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
  const group = new THREE.Group();
  group.position.set(0, 1.45, -D / 2 - 0.6);
  boardContent.add(group);

  panel = makeCanvasPlane(1.2, 0.46, 1000);
  group.add(panel.mesh);

  uiButtons = [];
  difficultyButtons = {};
  const keys = Object.keys(PRESETS);
  keys.forEach((key, i) => {
    const b = makeButton(PRESETS[key].label, {
      width: 0.34, height: 0.11, color: '#2f3f6e',
      onClick: () => newGame(key),
    });
    b.position.set((i - 1) * 0.39, -0.33, 0);
    group.add(b);
    difficultyButtons[key] = b;
    uiButtons.push(b);
  });
  const restart = makeButton('重新开始  A/X', { width: 0.56, height: 0.11, color: '#3a5bd9', onClick: () => newGame() });
  restart.position.set(-0.3, -0.47, 0);
  const move = makeButton('移到面前  B/Y', { width: 0.56, height: 0.11, color: '#3a5bd9', onClick: () => placeBoardInFront() });
  move.position.set(0.3, -0.47, 0);
  group.add(restart, move);
  uiButtons.push(restart, move);

  for (const [k, b] of Object.entries(difficultyButtons)) b.userData.ui.setActive(k === presetKey);
  drawPanel();
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function elapsed() {
  if (state === 'ready') return 0;
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
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText(`${cfg.label} · ${cfg.cols}×${cfg.rows}`, w - 50, 82);

    ctx.textAlign = 'left';
    ctx.font = `600 44px ${FONT}`;
    ctx.fillStyle = '#c9d3ea';
    const left = cfg.mines - flagCount;
    ctx.fillText(`剩余雷数 ${left}`, 50, 200);
    ctx.fillText(`用时 ${fmt(elapsed())}`, 430, 200);
    ctx.fillText(`最佳 ${best ? fmt(best) : '--'}`, 780, 200);

    ctx.font = `700 46px ${FONT}`;
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
  const x = Math.floor((lx + W / 2) / cfg.cell);
  const z = Math.floor((lz + D / 2) / cfg.cell);
  if (x < 0 || z < 0 || x >= cfg.cols || z >= cfg.rows) return null;
  return cells[z * cfg.cols + x];
}

function neighbors(c) {
  const out = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const x = c.x + dx, z = c.z + dz;
      if (x >= 0 && z >= 0 && x < cfg.cols && z < cfg.rows) out.push(cells[z * cfg.cols + x]);
    }
  }
  return out;
}

// 第一步之后才埋雷，保证第一脚和它周围一定安全
function placeMines(first) {
  const forbidden = new Set([first, ...neighbors(first)]);
  const pool = cells.filter((c) => !forbidden.has(c));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  pool.slice(0, cfg.mines).forEach((c) => (c.mine = true));
  for (const c of cells) c.adj = neighbors(c).filter((n) => n.mine).length;
}

function showRevealed(c) {
  c.tile.material.color.setHex(COLORS.open);
  c.tile.scale.y = 0.008;
  c.tile.position.y = 0.004;
  if (c.adj > 0) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(c.adj), depthWrite: false }));
    s.scale.setScalar(cfg.cell * 0.72);
    s.position.set(c.cx, 0.18, c.cz);
    boardContent.add(s);
    c.extras.push(s);
  }
}

function reveal(c) {
  if (state === 'lost' || state === 'won' || c.revealed || c.flagged) return;
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
    if (k.adj === 0) for (const n of neighbors(k)) if (!n.revealed) queue.push(n);
  }
  sfx.reveal(opened > 1);
  app.pulseAll(0.35, 40);
  if (revealedCount === cells.length - cfg.mines) win();
  else setStatus(opened > 1 ? `一下翻开了 ${opened} 格！` : '继续，小心脚下…');
}

function toggleFlag(c) {
  if (state === 'lost' || state === 'won' || c.revealed) return;
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
      const m = makeMine(cfg.cell * 0.2);
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

function newGame(key = presetKey) {
  presetKey = key;
  cfg = PRESETS[key];
  state = 'ready';
  revealedCount = 0;
  flagCount = 0;
  startTime = endTime = 0;
  standing = { cell: null, t: 0, nextTick: 0 };
  pointerHover.clear();
  effects.forEach((e) => e.dispose?.());
  effects = [];
  flash.material.opacity = 0;
  statusText = '走进雷区，在一格上站稳就会翻开';
  buildBoard();
  sfx.click();
}

// 把雷区放到玩家正前方（起点刚好在脚下）
function placeBoardInFront() {
  const head = app.headPosition(new THREE.Vector3());
  const dir = app.headForward(new THREE.Vector3());
  const dist = D / 2 + 0.4;
  board.position.set(head.x + dir.x * dist, 0, head.z + dir.z * dist);
  board.rotation.y = Math.atan2(-dir.x, -dir.z);
  sfx.click();
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
  const origin = board.localToWorld(new THREE.Vector3(0, 1.2, 0));
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

// 根据头部位置判断你站在哪一格（头在脚的正上方）
function updateStanding(headWorld, dt) {
  youMarker.position.set(headWorld.x, 0.006, headWorld.z);
  const local = board.worldToLocal(headWorld.clone());
  const c = cellAt(local.x, local.z);
  const active = state === 'ready' || state === 'playing';

  if (standing.cell !== c) {
    standing = { cell: c, t: 0, nextTick: 0 };
    if (c && active && c.flagged) sfx.warn();
  }
  if (c && active && !c.revealed && !c.flagged) {
    standing.t += dt;
    if (standing.t >= standing.nextTick) {
      sfx.tick();
      app.pulseAll(0.15, 25);
      standing.nextTick += 0.18;
    }
    const p = Math.min(standing.t / DWELL, 1);
    progressDisc.visible = true;
    progressDisc.position.set(c.cx, 0.045, c.cz);
    progressDisc.scale.setScalar(cfg.cell * 0.88 * p);
    if (standing.t >= DWELL) {
      progressDisc.visible = false;
      reveal(c);
    }
  } else {
    progressDisc.visible = false;
  }
}

function updatePointers() {
  pointerHover.clear();
  const targets = [...uiButtons, ...cells.filter((c) => !c.revealed).map((c) => c.tile)];
  for (const c of app.controllers) {
    if (!c.inputSource) continue;
    const hit = app.pointAt(c, targets, 5);
    c.hover = hit ? hit.object : null;
    if (c.hover) pointerHover.add(c.hover);
  }
  for (const b of uiButtons) b.userData.ui.setHover(pointerHover.has(b));
}

function updateTileColors() {
  for (const c of cells) {
    let e = 0x000000;
    if (!c.revealed && state !== 'lost') {
      if (standing.cell === c && !c.flagged) e = COLORS.stand;
      else if (pointerHover.has(c.tile)) e = COLORS.hover;
    }
    c.tile.material.emissive.setHex(e);
    c.tile.material.emissiveIntensity = 0.55;
  }
}

function onFrame(dt) {
  if (nature.group.visible) nature.update(dt);
  effects = effects.filter((e) => {
    const alive = e.update(dt);
    if (!alive) e.dispose?.();
    return alive;
  });
  if (flash.material.opacity > 0) flash.material.opacity = Math.max(0, flash.material.opacity - dt * 1.2);

  // 地雷里的红点闪烁
  if (state === 'lost') {
    const k = 0.5 + 0.5 * Math.sin(performance.now() / 120);
    for (const c of cells) for (const ex of c.extras) if (ex.userData.core) ex.userData.core.scale.setScalar(0.7 + k * 0.5);
  }

  if (app.presenting) {
    if (placeAfter > 0) {
      placeAfter -= dt;
      if (placeAfter <= 0) placeBoardInFront();
    }
    youMarker.visible = true;
    updateStanding(app.headPosition(tmpHead), dt);
    updatePointers();
    app.pollButtons((c, bi) => {
      if (bi === 4) newGame();
      if (bi === 5) placeBoardInFront();
    });
  } else {
    youMarker.visible = false;
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
  if (!target) return;
  if (target.userData.ui) {
    app.pulse(c, 0.4, 30);
    target.userData.ui.onClick?.();
  } else if (target.userData.cell) {
    app.pulse(c, 0.3, 30);
    toggleFlag(target.userData.cell);
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
renderer.domElement.addEventListener('pointerup', (e) => {
  if (app.presenting || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 6) return; // 是在拖动视角，不算点击
  initAudio();
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  mouseRay.setFromCamera(mouse, camera);
  const targets = [...uiButtons, ...cells.filter((c) => !c.revealed).map((c) => c.tile)];
  const hit = mouseRay.intersectObjects(targets, false)[0];
  if (!hit) return;
  if (hit.object.userData.ui) hit.object.userData.ui.onClick?.();
  else if (e.button === 2) toggleFlag(hit.object.userData.cell);
  else reveal(hit.object.userData.cell);
});

// ================= 页面上的按钮 =================
const overlay = document.getElementById('overlay');
const backLink = document.getElementById('back');
const btnVR = document.getElementById('enter-vr');
const btnAR = document.getElementById('enter-ar');
const btnDesktop = document.getElementById('desktop');
const note = document.getElementById('note');
let desktopPreview = false;

(async () => {
  const [vr, ar] = await Promise.all([app.supports('immersive-vr'), app.supports('immersive-ar')]);
  btnVR.hidden = !vr;
  btnAR.hidden = !ar;
  if (!vr && !ar) note.textContent = '这台设备不支持 VR。可以先在电脑上预览：左键 = 踩格子，右键 = 插旗，拖动 = 转视角。';
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

newGame('normal');
board.position.set(0, 0, -(D / 2 + 0.4));

// 方便调试：在浏览器控制台里可以用 window.minewalk 查看状态
window.minewalk = {
  get state() { return state; }, get cells() { return cells; }, get cfg() { return cfg; },
  board, newGame, reveal, toggleFlag, updateStanding, camera, controls,
};
