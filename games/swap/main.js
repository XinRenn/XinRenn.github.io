// 星石三连：面前一面星石墙，伸手（或用射线）按住一颗星石往旁边一拖，和旁边那颗交换位置；
// 横着或竖着连成 3 颗以上同色就消掉，上面的往下掉、顶上补新的。规则在 logic.js（和离线测试机器人共用）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio } from '../../shared/sfx.js';
import { createEnvManager, ENVIRONMENTS, savedEnvKey } from '../../shared/env/index.js';
import { makeExitButton } from '../../shared/exit.js';
import { createWallBoard } from '../../shared/wallboard.js';
import { RAINBOW, createState, trySwap, resolveStep, gravity, hasMove, reshuffle, goalsDone, adjacent } from './logic.js';
import { makeRng } from '../../shared/rng.js';
import { levelSpec, LEVEL_COUNT, GOAL_WEIGHT } from './levels.js';

// ================= 可调参数 =================
const COLS = 8, ROWS = 8;
const GAP = 0.1;            // 星石间距（米）：整块约 0.85 × 0.85 米
const TIP = 0.045;          // 尖端在手柄前方多远
const TOUCH_Z = 0.08;       // 尖端离墙面多近算“手碰到”（再远就用射线）
const DRAG = 0.5;           // 按住后往旁边拖超过多少格就交换
const BOARD_W = COLS * GAP + 0.05, BOARD_H = ROWS * GAP + 0.05;
// 6 种星石：每种颜色有自己的形状（色弱也分得清）
const KINDS = [
  { color: '#ff3d6e', name: '红' },
  { color: '#ffc928', name: '黄' },
  { color: '#2fd27a', name: '绿' },
  { color: '#2f8cff', name: '蓝' },
  { color: '#a64dff', name: '紫' },
  { color: '#ff8a1f', name: '橙' },
];

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

const rig = new THREE.Group();   // 原点 = 星石墙中心
scene.add(rig);
const board = new THREE.Group();
rig.add(board);
{
  const back = makeCanvasPlane(BOARD_W, BOARD_H, 600);
  back.redraw((ctx, cw, ch) => {
    // 深紫色的底板 + 每格一块圆角小方砖
    roundRect(ctx, 4, 4, cw - 8, ch - 8, 40);
    const bg = ctx.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, 'rgba(46, 30, 92, 0.92)');
    bg.addColorStop(1, 'rgba(22, 16, 52, 0.92)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255, 214, 120, 0.75)';
    ctx.stroke();
    const cs = (cw - 30) / COLS;
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      roundRect(ctx, 15 + c * cs + 3, 15 + r * cs + 3, cs - 6, cs - 6, 12);
      ctx.fillStyle = (c + r) % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.13)';
      ctx.fill();
    }
  });
  back.mesh.position.z = -0.04;
  board.add(back.mesh);
}
const cellPos = (c, r) => new THREE.Vector3((c - (COLS - 1) / 2) * GAP, (r - (ROWS - 1) / 2) * GAP, 0);
const cellAt = (x, y) => {
  const c = Math.round(x / GAP + (COLS - 1) / 2), r = Math.round(y / GAP + (ROWS - 1) / 2);
  return c >= 0 && r >= 0 && c < COLS && r < ROWS ? [c, r] : null;
};

// ================= 星石的样子：圆润、亮晶晶的糖果宝石（全部用代码做的形状）=================
const S = 0.034; // 星石大小（半径）
// 用“极坐标半径函数”画出一个平面形状，再挤出来、倒很大的圆角
function polarShape(rOf, n = 72) {
  const sh = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = rOf(a);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? sh.lineTo(x, y) : sh.moveTo(x, y);
  }
  sh.closePath();
  return sh;
}
function heartShape(R) {
  const sh = new THREE.Shape();
  for (let i = 0; i <= 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    i ? sh.lineTo(x * R / 17, y * R / 17 + R * 0.12) : sh.moveTo(x * R / 17, y * R / 17 + R * 0.12);
  }
  return sh;
}
const poly = (k, R, round = 0.12) => (a) => {
  const seg = (Math.PI * 2) / k;
  const t = ((a - Math.PI / 2) % seg + seg) % seg - seg / 2;
  return (R * Math.cos(Math.PI / k)) / Math.cos(t) * (1 - round) + R * round;
};
function gemGeo(shape) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: S * 0.45, bevelEnabled: true, bevelThickness: S * 0.32, bevelSize: S * 0.22, bevelSegments: 5, curveSegments: 24 });
  g.center();
  g.computeVertexNormals();
  return g;
}
const GEOS = [
  gemGeo(heartShape(S * 0.95)),                                              // 红：爱心
  gemGeo(polarShape((a) => { const seg = Math.PI * 2 / 5; const t = Math.abs((((a - Math.PI / 2) % seg) + seg) % seg - seg / 2) / (seg / 2); return S * (0.5 + 0.55 * t); }, 100)), // 黄：星星
  gemGeo(polarShape((a) => S * 0.95 / Math.pow(Math.abs(Math.cos(a)) ** 3 + Math.abs(Math.sin(a)) ** 3, 1 / 3) * 0.78)), // 绿：圆角方块（转 45° 变菱形）
  gemGeo(polarShape(poly(6, S * 0.92))),                                     // 蓝：六边形
  gemGeo(polarShape(poly(3, S * 1.05, 0.2))),                                // 紫：圆角三角
  gemGeo(polarShape((a) => S * (0.74 + 0.22 * Math.cos(5 * a)))),            // 橙：小花
];
GEOS[2].rotateZ(Math.PI / 4);
const rainbowGeo = (() => {
  const g = new THREE.SphereGeometry(S * 0.95, 32, 20);
  const col = [];
  const c = new THREE.Color();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { c.setHSL((Math.atan2(p.getY(i), p.getX(i)) / (Math.PI * 2) + 1) % 1, 0.85, 0.6); col.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
})();
const MATS = KINDS.map((k) => new THREE.MeshPhysicalMaterial({ color: k.color, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, emissive: k.color, emissiveIntensity: 0.18 }));
const rainbowMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#ffffff', emissiveIntensity: 0.15 });
// 高光：左上角一小块白色，看起来亮晶晶的
const shineGeo = new THREE.CircleGeometry(S * 0.22, 20);
const shineMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false });
const stripeMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const stripeGeo = new THREE.BoxGeometry(S * 2.1, S * 0.22, S * 0.15);
const bombRingGeo = new THREE.TorusGeometry(S * 1.12, S * 0.1, 10, 36);
const bombRingMat = new THREE.MeshBasicMaterial({ color: '#ffe48a' });
const iceGeo = new THREE.BoxGeometry(GAP * 0.92, GAP * 0.92, 0.012);
const iceMat = new THREE.MeshStandardMaterial({ color: '#bfe9ff', roughness: 0.1, transparent: true, opacity: 0.55, emissive: '#7fd3ff', emissiveIntensity: 0.25 });

function makePieceMesh(p) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(p.color === RAINBOW ? rainbowGeo : GEOS[p.color], p.color === RAINBOW ? rainbowMat : MATS[p.color]);
  g.add(body);
  const shine = new THREE.Mesh(shineGeo, shineMat);
  shine.scale.set(1.3, 0.75, 1);
  shine.rotation.z = 0.6;
  shine.position.set(-S * 0.38, S * 0.4, S * 0.62);
  g.add(shine);
  if (p.special === 'row' || p.special === 'col') {
    const st = new THREE.Mesh(stripeGeo, stripeMat);
    st.position.z = S * 0.6;
    if (p.special === 'col') st.rotation.z = Math.PI / 2;
    g.add(st);
  }
  if (p.special === 'bomb') {
    const ring = new THREE.Mesh(bombRingGeo, bombRingMat);
    ring.position.z = S * 0.3;
    g.add(ring);
  }
  g.userData = { color: p.color, special: p.special, body, spin: Math.random() * 6 };
  return g;
}

// ================= 游戏状态 =================
let S0 = null;            // logic.js 的盘面状态
let meshes = [];          // meshes[c][r]
let iceMeshes = [];
let mode = 'levels';      // levels | endless
let levelIdx = 0, lv = null;
let state = 'idle';       // playing | busy | won | lost
let statusText = '';
let best = 0;
const effects = [];

function newGame(m = mode) {
  mode = m;
  savePref('swap-mode', mode);
  if (mode === 'levels') {
    lv = levelSpec(levelIdx);
    // 每关固定种子：开局和每次掉下来的星石都一样，同一关可以研究怎么过
    S0 = createState({ cols: COLS, rows: ROWS, nColors: lv.colors, goals: lv.goals, moves: lv.moves, ice: lv.ice || 0, rand: makeRng(lv.seed), goalWeight: GOAL_WEIGHT });
  } else {
    lv = null;
    S0 = createState({ cols: COLS, rows: ROWS, nColors: 6 });
  }
  best = Number(loadPref(`swap-best-${mode}`, '0')) || 0;
  for (const col of meshes) for (const m of col) if (m) board.remove(m);
  for (const col of iceMeshes) for (const m of col) if (m) board.remove(m);
  meshes = Array.from({ length: COLS }, (_, c) => Array.from({ length: ROWS }, (_, r) => {
    const m = makePieceMesh(S0.grid[c][r]);
    m.position.copy(cellPos(c, r)).add(new THREE.Vector3(0, (ROWS + 1) * GAP, 0));
    m.userData.target = cellPos(c, r);
    board.add(m);
    return m;
  }));
  iceMeshes = Array.from({ length: COLS }, (_, c) => Array.from({ length: ROWS }, (_, r) => {
    if (!S0.ice[c][r]) return null;
    const m = new THREE.Mesh(iceGeo, iceMat);
    m.position.copy(cellPos(c, r)).setZ(-0.025);
    board.add(m);
    return m;
  }));
  select = null;
  state = 'playing';
  refreshButtons();
  setStatus(mode === 'levels' ? `第 ${levelIdx + 1} 关：${lv.moves} 步内完成目标` : '无尽模式：随便换，看能拿多少分');
  sfx.click();
}

// 让某一格的样子和盘面状态一致（颜色、特殊星石变了就换一个）
function syncLook(c, r) {
  const p = S0.grid[c][r];
  const m = meshes[c][r];
  if (!p) return;
  if (m && m.userData.color === p.color && m.userData.special === p.special) return;
  const n = makePieceMesh(p);
  n.position.copy(m ? m.position : cellPos(c, r));
  n.userData.target = cellPos(c, r);
  n.userData.pop = 0.25;
  if (m) board.remove(m);
  board.add(n);
  meshes[c][r] = n;
}
function syncAll() { for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) syncLook(c, r); }

const wait = (s) => new Promise((res) => setTimeout(res, s * 1000));

// 交换两颗：消不掉就换回来；消得掉就一轮一轮消、往下掉，直到停下来
async function doSwap(a, b) {
  if (state !== 'playing' || !adjacent(a, b)) return;
  state = 'busy';
  const ma = meshes[a[0]][a[1]], mb = meshes[b[0]][b[1]];
  const res = trySwap(S0, a, b);
  ma.userData.target = cellPos(...b);
  mb.userData.target = cellPos(...a);
  sfx.click();
  await wait(0.16);
  if (!res.ok) {
    ma.userData.target = cellPos(...a);
    mb.userData.target = cellPos(...b);
    sfx.warn();
    app.pulseAll(0.4, 60);
    setStatus('这样换消不掉，换回去了');
    await wait(0.18);
    state = 'playing';
    return;
  }
  meshes[a[0]][a[1]] = mb;
  meshes[b[0]][b[1]] = ma;
  let round = 0;
  for (;;) {
    const st = resolveStep(S0);
    if (!st) break;
    round++;
    for (const x of st.cleared) {
      const m = meshes[x.c][x.r];
      meshes[x.c][x.r] = null;
      if (m) vanish(m, x.color);
      if (x.special === 'bomb') { sfx.boom(); app.pulseAll(1, 150); }
      if (x.special === 'row' || x.special === 'col') sfx.whoosh?.();
    }
    for (const [c, r] of st.ice) { const m = iceMeshes[c][r]; iceMeshes[c][r] = null; if (m) crack(m); }
    for (const x of st.created) syncLook(x.c, x.r);
    if (st.created.some((x) => x.special === 'rainbow')) sfx.bonus();
    sfx.perfect(Math.min(3, round));
    app.pulseAll(Math.min(1, 0.3 + st.cleared.length * 0.04), 60);
    popup(`+${st.gained}${round > 1 ? `  连锁 ×${round}` : ''}`, st.cleared[0] || st.created[0]);
    await wait(0.22);
    // 往下掉、补新的
    const { falls, spawns } = gravity(S0);
    for (const f of falls) {
      const m = meshes[f.c][f.from];
      meshes[f.c][f.from] = null;
      meshes[f.c][f.to] = m;
      if (m) m.userData.target = cellPos(f.c, f.to);
    }
    for (const sp of spawns) {
      const m = makePieceMesh(S0.grid[sp.c][sp.r]);
      m.position.copy(cellPos(sp.c, ROWS + sp.above + 0.5));
      m.userData.target = cellPos(sp.c, sp.r);
      board.add(m);
      meshes[sp.c][sp.r] = m;
    }
    drawPanel();
    await wait(0.28);
  }
  if (!hasMove(S0)) { reshuffle(S0); syncAll(); setStatus('没有能换的了，重新洗一下'); }
  state = 'playing';
  if (mode === 'endless' && S0.score > best) { best = S0.score; savePref('swap-best-endless', String(best)); }
  if (lv) checkLevel();
  drawPanel();
}

function checkLevel() {
  if (goalsDone(S0)) {
    state = 'won';
    const stars = S0.moves >= lv.moves * 0.3 ? 3 : S0.moves >= lv.moves * 0.1 ? 2 : 1;
    const key = `swap-stars-${levelIdx}`;
    if (stars > (Number(loadPref(key, '0')) || 0)) savePref(key, String(stars));
    sfx.win();
    app.pulseAll(0.7, 200);
    setStatus(`过关！${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  马上进入下一关…`);
    const mine = levelIdx;
    if (levelIdx >= LEVEL_COUNT - 1) { setStatus(`全部 ${LEVEL_COUNT} 关都过了！${'★'.repeat(stars)}`); return; }
    setTimeout(() => { if (mode === 'levels' && levelIdx === mine && state === 'won') gotoLevel(levelIdx + 1); }, 3200);
  } else if (S0.moves <= 0) {
    state = 'lost';
    sfx.boom();
    setStatus('步数用完了！按 A/X 再试一次');
  }
}
function gotoLevel(i) {
  levelIdx = Math.max(0, Math.min(i, maxUnlocked(), LEVEL_COUNT - 1));
  savePref('swap-level', String(levelIdx));
  newGame('levels');
}
function maxUnlocked() {
  let i = 0;
  while ((Number(loadPref(`swap-stars-${i}`, '0')) || 0) > 0) i++;
  return i;
}

// ================= 特效 =================
function addEffect(life, update, done) { effects.push({ t: 0, life, update, done }); }
const sparkGeo = new THREE.OctahedronGeometry(0.008, 0);
function vanish(m, color) {
  const s0 = m.scale.x;
  addEffect(0.2, (k) => m.scale.setScalar(s0 * (1 + k * 0.4) * (1 - k)), () => board.remove(m));
  const mat = new THREE.MeshBasicMaterial({ color: color >= 0 ? KINDS[color].color : '#ffffff', transparent: true });
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(sparkGeo, mat);
    p.position.copy(m.position);
    const v = new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.2) * 0.6, Math.random() * 0.3);
    board.add(p);
    addEffect(0.45, (k, dt) => { p.position.addScaledVector(v, dt); v.y -= dt * 1.5; mat.opacity = 1 - k; }, () => board.remove(p));
  }
}
function crack(m) {
  addEffect(0.3, (k) => { m.scale.setScalar(1 + k * 0.4); }, () => board.remove(m));
  sfx.smash();
}
function popup(text, at) {
  if (!at) return;
  const p = makeCanvasPlane(0.4, 0.09, 700);
  p.redraw((g, w, h) => {
    g.font = `800 ${Math.round(h * 0.62)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeText(text, w / 2, h / 2);
    g.fillStyle = '#ffe066'; g.fillText(text, w / 2, h / 2);
  });
  p.mesh.position.copy(cellPos(at.c, at.r)).setZ(0.06);
  p.mesh.renderOrder = 20;
  board.add(p.mesh);
  addEffect(1.0, (k) => { p.mesh.position.y += 0.002; p.mesh.material.opacity = 1 - k * k; }, () => { board.remove(p.mesh); p.tex.dispose(); p.mesh.material.dispose(); p.mesh.geometry.dispose(); });
}

// ================= 面板（在左边，稍微转过来对着你）=================
const panelGroup = new THREE.Group();
panelGroup.rotation.y = 0.55;
rig.add(panelGroup);
const panel = makeCanvasPlane(0.6, 0.38, 1100);
panel.mesh.position.y = 0.06;
panelGroup.add(panel.mesh);
const uiButtons = [];
const mk = (label, x, y, color, onClick, w = 0.28) => {
  const b = makeButton(label, { width: w, height: 0.065, color, onClick });
  b.position.set(x, y, 0);
  panelGroup.add(b);
  uiButtons.push(b);
  return b;
};
const levelsBtn = mk('闯关', -0.145, -0.2, '#2f3f6e', () => newGame('levels'));
const endlessBtn = mk('无尽', 0.145, -0.2, '#2f3f6e', () => newGame('endless'));
const prevBtn = mk('◀ 上一关', -0.145, -0.275, '#2f3f6e', () => gotoLevel(levelIdx - 1));
const nextBtn = mk('下一关 ▶', 0.145, -0.275, '#2f3f6e', () => gotoLevel(levelIdx + 1));
mk('重新开始 A/X', -0.145, -0.35, '#3a5bd9', () => newGame());
mk('移到面前 B/Y', 0.145, -0.35, '#3a5bd9', () => placeInFront());
// 摆放（试玩反馈）：默认离你 1 米、面板下三分之一和眼睛平齐；摇杆前后推 = 拉远/拉近；面板下面的滑条 = 放大/缩小。都会记住。
const wall = createWallBoard(app, {
  rig, board, width: BOARD_W, height: BOARD_H, key: 'swap', dist: 1.0,
  onLayout: (k, w) => panelGroup.position.set(-w / 2 - 0.36, -0.12, 0.12),
});
const envButton = mk('背景：… ▶', -0.07, -0.425, '#5a4a2e', () => envs.next(), 0.43);
if (envs.label) envButton.userData.ui.setLabel(`背景：${envs.label} ▶`);
{
  const exitButton = makeExitButton(app, { width: 0.13, height: 0.065 });
  exitButton.position.set(0.222, -0.425, 0);
  panelGroup.add(exitButton);
  uiButtons.push(exitButton);
}
function refreshButtons() {
  levelsBtn.userData.ui.setActive(mode === 'levels');
  endlessBtn.userData.ui.setActive(mode === 'endless');
  prevBtn.userData.ui.setDisabled(mode !== 'levels' || levelIdx === 0);
  nextBtn.userData.ui.setDisabled(mode !== 'levels' || levelIdx >= maxUnlocked() || levelIdx >= LEVEL_COUNT - 1);
}
function drawPanel() {
  panel.redraw((ctx, w, h) => {
    roundRect(ctx, 4, 4, w - 8, h - 8, 36);
    ctx.fillStyle = 'rgba(18, 25, 44, 0.9)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = state === 'won' ? '#5cffb0' : state === 'lost' ? '#ff6b6b' : '#3b4a78';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#eef2fb';
    ctx.font = `800 58px ${FONT}`;
    ctx.fillText('星石三连', 40, 70);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f5b941';
    ctx.font = `800 76px ${FONT}`;
    ctx.fillText(String(S0?.score ?? 0), w - 40, 74);
    ctx.textAlign = 'left';
    ctx.font = `600 38px ${FONT}`;
    ctx.fillStyle = '#c9d3ea';
    if (mode === 'levels' && S0) {
      ctx.fillText(`第 ${levelIdx + 1} 关`, 40, 160);
      ctx.fillStyle = S0.moves <= 3 ? '#ff6b6b' : '#c9d3ea';
      ctx.fillText(`剩 ${S0.moves} 步`, 230, 160);
      // 目标
      let x = 40;
      for (const [k, v] of Object.entries(S0.goals)) {
        if (k === 'ice') { ctx.fillStyle = '#bfe9ff'; ctx.fillRect(x, 222, 40, 40); }
        else if (k === 'score') { ctx.fillStyle = '#f5b941'; ctx.font = `700 34px ${FONT}`; ctx.fillText('分', x + 4, 244); }
        else { ctx.fillStyle = KINDS[k].color; ctx.beginPath(); ctx.arc(x + 20, 242, 20, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = v <= 0 ? '#5cffb0' : '#eef2fb';
        ctx.font = `700 38px ${FONT}`;
        ctx.fillText(v <= 0 ? '✓' : String(v), x + 50, 244);
        x += k === 'score' ? 200 : 150;
      }
    } else {
      ctx.fillText(`无尽模式 · 最佳 ${best}`, 40, 160);
    }
    ctx.font = `700 36px ${FONT}`;
    ctx.fillStyle = state === 'lost' ? '#ff8a8a' : '#eef2fb';
    ctx.fillText(statusText, 40, 330);
    ctx.font = `500 26px ${FONT}`;
    ctx.fillStyle = '#7f8aa8';
    ctx.fillText('4 连=横扫/竖扫 · L/T 形=炸弹 · 5 连=彩虹', 40, 390);
  });
}
function setStatus(t) { statusText = t; drawPanel(); }

// 面板最底边在胸口高度，离你一臂远
let placeAfter = -1;
function placeInFront() {
  wall.place();
  sfx.click();
}

// ================= 操作：按住一颗，往旁边拖 =================
// select = { cell, by: controller|'mouse', from: 墙面上按下的位置, dragged }
let select = null;
const selRing = new THREE.Mesh(new THREE.RingGeometry(S * 1.35, S * 1.6, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
selRing.visible = false;
board.add(selRing);
const tips = app.controllers.map(() => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  m.visible = false;
  scene.add(m);
  return m;
});
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function tipWorld(c, target) {
  target.setFromMatrixPosition(c.ray.matrixWorld);
  tmpV.set(0, 0, -1).applyQuaternion(c.ray.getWorldQuaternion(tmpQ));
  return target.addScaledVector(tmpV, TIP);
}
// 手柄指着墙上的哪一点（墙坐标）：尖端贴近墙面就用尖端，否则用射线
const plane = new THREE.Plane();
const ray = new THREE.Ray();
function boardPoint(c) {
  const tip = board.worldToLocal(tipWorld(c, new THREE.Vector3()));
  if (Math.abs(tip.z) < TOUCH_Z && Math.abs(tip.x) < BOARD_W / 2 && Math.abs(tip.y) < BOARD_H / 2) return { p: tip, touch: true };
  ray.origin.setFromMatrixPosition(c.ray.matrixWorld);
  ray.direction.set(0, 0, -1).applyQuaternion(c.ray.getWorldQuaternion(tmpQ));
  board.updateWorldMatrix(true, false);
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(board.getWorldQuaternion(new THREE.Quaternion()));
  plane.setFromNormalAndCoplanarPoint(n, board.getWorldPosition(new THREE.Vector3()));
  const hit = ray.intersectPlane(plane, new THREE.Vector3());
  if (!hit) return null;
  const l = board.worldToLocal(hit);
  if (Math.abs(l.x) > BOARD_W / 2 + 0.05 || Math.abs(l.y) > BOARD_H / 2 + 0.05) return null;
  return { p: l, touch: false };
}
function press(by, point) {
  if (state !== 'playing' || !point) return;
  const cell = cellAt(point.x, point.y);
  if (!cell) return;
  // 先点了一颗、再点旁边那颗 = 交换
  if (select && !select.held && adjacent(select.cell, cell)) { const a = select.cell; clearSelect(); doSwap(a, cell); return; }
  select = { cell, by, from: point.clone(), held: true };
  selRing.visible = true;
  selRing.position.copy(cellPos(...cell)).setZ(0.045);
  sfx.tick();
}
function dragTo(by, point) {
  if (!select || select.by !== by || !select.held || !point) return;
  const c0 = cellPos(...select.cell);
  const dx = point.x - c0.x, dy = point.y - c0.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < GAP * DRAG) return;
  const nb = ax > ay ? [select.cell[0] + Math.sign(dx), select.cell[1]] : [select.cell[0], select.cell[1] + Math.sign(dy)];
  const a = select.cell;
  clearSelect();
  if (nb[0] < 0 || nb[1] < 0 || nb[0] >= COLS || nb[1] >= ROWS) return;
  doSwap(a, nb);
}
function release(by) {
  if (select && select.by === by) select.held = false; // 没拖：留着选中，等你点旁边那颗
}
function clearSelect() { select = null; selRing.visible = false; }

function updatePointers() {
  const hovered = new Set();
  app.controllers.forEach((c, n) => {
    const tip = tips[n];
    if (!c.inputSource) { tip.visible = false; return; }
    tip.visible = true;
    tipWorld(c, tip.position);
    const hit = app.pointAt(c, [...uiButtons, wall.hitMesh], 4);
    c.hover = hit ? hit.object : null;
    if (c.hover) hovered.add(c.hover);
    const bp = wall.dragging ? null : boardPoint(c);
    c.bp = bp;
    c.line.visible = !!hit || (bp && !bp.touch);
    tip.material.color.set(select?.by === c ? '#ffd23f' : bp?.touch ? '#5cffb0' : '#ffffff');
    if (bp) dragTo(c, bp.p);
  });
  for (const b of uiButtons) b.userData.ui.setHover(hovered.has(b));
}
app.on('select', (c) => {
  initAudio();
  if (c.hover?.userData.ui) { app.pulse(c, 0.4, 30); c.hover.userData.ui.onClick?.(); return; }
  if (wall.press(c)) { app.pulse(c, 0.3, 25); return; }
  if (state === 'lost' || state === 'won') return;
  const bp = boardPoint(c);
  if (bp) { press(c, bp.p); app.pulse(c, 0.3, 25); }
});
app.on('selectend', (c) => { wall.release(c); release(c); });

// ================= 每一帧 =================
function onFrame(dt) {
  envs.update(dt);
  wall.update(dt);
  if (app.presenting) {
    if (placeAfter > 0) { placeAfter -= dt; if (placeAfter <= 0) placeInFront(); }
    updatePointers();
    app.pollButtons((c, bi) => {
      if (bi === 4) newGame();
      if (bi === 5) placeInFront();
    });
  } else {
    controls.update();
  }
  // 星石滑到目标位置、慢慢转
  for (const col of meshes) for (const m of col) {
    if (!m) continue;
    const t = m.userData.target;
    if (t) {
      const d = m.position.distanceTo(t);
      if (d > 0.0005) m.position.lerp(t, Math.min(1, dt * (d > GAP * 2 ? 9 : 16)));
      else m.position.copy(t);
    }
    m.userData.spin += dt;
    m.userData.body.rotation.y = Math.sin(m.userData.spin * 0.8) * 0.22;
    if (m.userData.color === RAINBOW) m.userData.body.material.emissive.setHSL((performance.now() / 2000) % 1, 0.9, 0.5);
    if (m.userData.pop > 0) { m.userData.pop -= dt; m.scale.setScalar(1 + Math.max(0, m.userData.pop) * 1.6); }
  }
  if (selRing.visible) selRing.material.opacity = 0.6 + 0.35 * Math.sin(performance.now() / 120);
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    const k = Math.min(e.t / e.life, 1);
    e.update(k, dt);
    if (k >= 1) { e.done?.(); effects.splice(i, 1); }
  }
}

// ================= 电脑上预览：按住拖动，或者点一颗再点旁边那颗 =================
camera.position.set(0, 1.65, 0.35);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6 + BOARD_H / 6, -1.0);
controls.enableDamping = true;
const mouse = new THREE.Vector2();
const mouseRay = new THREE.Raycaster();
function mousePoint(e) {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  mouseRay.setFromCamera(mouse, camera);
  board.updateWorldMatrix(true, false);
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(board.getWorldQuaternion(new THREE.Quaternion()));
  plane.setFromNormalAndCoplanarPoint(n, board.getWorldPosition(new THREE.Vector3()));
  const hit = mouseRay.ray.intersectPlane(plane, new THREE.Vector3());
  return hit ? board.worldToLocal(hit) : null;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (app.presenting) return;
  initAudio();
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  mouseRay.setFromCamera(mouse, camera);
  const ui = mouseRay.intersectObjects(uiButtons, false)[0];
  if (ui) { ui.object.userData.ui.onClick?.(); return; }
  if (wall.press('mouse', mouseRay)) { controls.enabled = false; return; }
  const p = mousePoint(e);
  if (p && cellAt(p.x, p.y)) { controls.enabled = false; press('mouse', p); }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!app.presenting && wall.dragging) { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); mouseRay.setFromCamera(mouse, camera); wall.drag('mouse', mouseRay); return; }
  if (app.presenting || !select?.held) return;
  dragTo('mouse', mousePoint(e));
});
window.addEventListener('pointerup', () => { wall.release('mouse'); release('mouse'); controls.enabled = true; });
window.addEventListener('keydown', (e) => { if (e.code === 'KeyR' && !app.presenting) newGame(); });

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
mode = loadPref('swap-mode', 'levels') === 'endless' ? 'endless' : 'levels';
levelIdx = Math.min(Number(loadPref('swap-level', '0')) || 0, maxUnlocked(), LEVEL_COUNT - 1);
modeSelect.value = mode;
modeSelect.addEventListener('change', () => newGame(modeSelect.value));

(async () => {
  const [vr, ar] = await Promise.all([app.supports('immersive-vr'), app.supports('immersive-ar')]);
  btnVR.hidden = !vr;
  btnAR.hidden = !ar;
  if (!vr && !ar) note.textContent = '这台设备不支持 VR。可以先在电脑上预览：按住一颗星石往旁边拖，或者点一颗再点旁边那颗。';
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

newGame(mode);

// 调试用
window.swapgame = {
  get state() { return state; }, get S() { return S0; }, get levelIdx() { return levelIdx; },
  newGame, gotoLevel, doSwap, camera, controls, envs, rig, wall,
};
