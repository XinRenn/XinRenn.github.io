// 蓄力跳台：面前一个小台子，台上的小角色往你面对的方向跳。周围很多方向都有跳台，想往哪边跳都行。
// 按住扳机蓄力：蹲得越深力越大，站起来就变小（随时可以反悔），松开扳机才起跳。
// 你和背景都不动（第一人称版容易晕，试玩后改回来了）。跳台的样子随背景变化，见 themes.js。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio, chargeTone } from '../../shared/sfx.js';
import { createEnvManager, ENVIRONMENTS, savedEnvKey } from '../../shared/env/index.js';
import { THEMES, makePawn, BASIN } from './themes.js';
import { makeExitButton } from '../../shared/exit.js';

// ================= 可调参数 =================
const CROUCH_START = 0.07;   // 头部下降多少米开始算蓄力
const CROUCH_FULL = 0.5;     // 下降多少米算满蓄力
const TRIGGER_FULL = 1.1;    // 扳机按住多少秒算满蓄力
const JUMP_MIN = 0.08, JUMP_MAX = 0.95; // 蓄力 0 → 1 对应的跳跃距离（米）
const PERFECT = 0.16;        // 落点离中心 < 跳台尺寸 × 这个比例 = 正中靶心
const TABLE_DROP = 0.75;     // 跳台比你站立时的头低多少米
const TABLE_AHEAD = 0.55;    // 跳台在你面前多远
const NEIGHBORS = 4;         // 脚下这个跳台周围保持几个跳得到的新跳台
const SPREAD = 1.75;         // 新跳台出现在“前方”左右多大角度内（弧度，约 ±100°）
const MR_ENV_OPACITY = 0.5;  // 混合现实里背景的可见度

// ================= 场景 =================
const app = createXRApp({ onFrame });
const { scene, camera, renderer } = app;
const uTime = { value: 0 };

const envs = createEnvManager(scene, {
  onChange: (def) => {
    envButton?.userData.ui.setLabel(`背景：${def.label} ▶`);
    if (envSelect) envSelect.value = def.key;
    applyTheme(def.key);
  },
});
envs.set(savedEnvKey());

let isAR = false;
app.on('modechange', (mode) => {
  isAR = mode === 'ar';
  envs.setAR(false); // 混合现实里背景不藏起来，而是变成半透明
  applyEnvOpacity();
  overlay.classList.toggle('hidden', mode !== 'desktop' || desktopPreview);
  backLink.style.display = mode === 'desktop' ? '' : 'none';
  hint.style.display = mode === 'desktop' && desktopPreview ? 'block' : 'none';
  if (mode !== 'desktop') { placeAfter = 0.8; headHist.length = 0; }
});

function loadPref(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } }
function savePref(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 无痕模式 */ } }

// rig：你面前的小场景（底座固定在这里）；course：跳台和角色（每次落地后平移，让当前跳台回到中间）
const rig = new THREE.Group();
scene.add(rig);
const course = new THREE.Group();
rig.add(course);
rig.position.set(0, 0.9, -TABLE_AHEAD);

const glowTex = (() => {
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

// ================= 主题 =================
let theme = null;
let themeKey = null;
let base = null;
let pawn = new THREE.Group();
course.add(pawn);

function applyTheme(key) {
  const t = THEMES[key] || THEMES.meadow;
  themeKey = THEMES[key] ? key : 'meadow';
  theme = t;
  if (base) { rig.remove(base.object); disposeTree(base.object); }
  base = t.base(uTime);
  rig.add(base.object);
  base.fit(rig.position.y);
  course.remove(pawn);
  disposeTree(pawn);
  pawn = makePawn(t.pawn);
  course.add(pawn);
  applyEnvOpacity();
  newGame();
}

// 混合现实：背景调成半透明，能透过去看到真实的房间；台子和跳台保持不透明
function applyEnvOpacity() {
  const k = isAR ? MR_ENV_OPACITY : 1;
  scene.fog = isAR ? null : envs.current?.fog || null;
  envs.current?.group.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (!m.userData.base) m.userData.base = { o: m.opacity, t: m.transparent, dw: m.depthWrite };
      const b = m.userData.base;
      m.transparent = k < 1 || b.t;
      m.opacity = b.o * k;
      m.depthWrite = k < 1 ? false : b.dw;
      m.needsUpdate = true;
    }
  });
}

function disposeTree(o) {
  o.traverse((m) => {
    if (!m.isSprite) m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    mats.forEach((x) => x.dispose());
  });
}

// 角色的影子（判断落点的重要参考）
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.026, 24),
  new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false })
);
shadow.rotation.x = -Math.PI / 2;
course.add(shadow);

// 蓄力圈
const chargeRing = new THREE.Mesh(
  new THREE.RingGeometry(0.034, 0.042, 48, 1, 0, 0.001),
  new THREE.MeshBasicMaterial({ color: '#5cffb0', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
);
chargeRing.rotation.x = -Math.PI / 2;
course.add(chargeRing);

// ================= 跳台 =================
let platforms = [];
let cur = null;

function buildPlatform(size, bonus = false) {
  const r = theme.platform(size, base.floorY);
  const p = {
    group: r.group, x: 0, z: 0, w: r.w, d: r.d, h: r.h + (r.top || 0), shape: r.shape, bonus,
    press: 0, pressV: 0, born: 0, dying: 0, coin: null,
  };
  const t = Math.min(p.w, p.d);
  // 靶心标记（淡淡的同心圆）
  const target = new THREE.Mesh(
    new THREE.RingGeometry(t * PERFECT * 0.6, t * PERFECT, 32),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, depthWrite: false })
  );
  target.rotation.x = -Math.PI / 2;
  target.position.y = p.h + 0.0015;
  r.group.add(target);
  // 金币：落到这个跳台上额外 +5
  if (bonus) {
    const coin = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 24), new THREE.MeshStandardMaterial({ color: '#ffcf3a', metalness: 0.8, roughness: 0.25, emissive: '#5a3a00' }));
    disc.rotation.x = Math.PI / 2;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2a8', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(0.07);
    coin.add(disc, glow);
    coin.position.y = p.h + 0.06;
    r.group.add(coin);
    p.coin = coin;
  }
  course.add(r.group);
  platforms.push(p);
  return p;
}
function place(p, x, z) {
  p.x = x; p.z = z;
  p.group.position.set(x, 0, z);
}
const extent = (p) => Math.max(p.w, p.d);
const surfaceY = (p) => p.h + p.group.position.y;

function contains(p, x, z) {
  const dx = x - p.x, dz = z - p.z;
  if (p.shape === 'box') return Math.abs(dx) <= p.w / 2 && Math.abs(dz) <= p.d / 2;
  return Math.hypot(dx, dz) <= p.w / 2;
}

// 跳台铺成一片：当前跳台周围（前方和左右）有好几个跳得到的新跳台，往哪边跳都行。
// 难度随分数增加：间距更大、跳台更小
const reachable = (p) => platforms.filter((q) => q !== p && !q.dying && !q.visited && Math.hypot(q.x - p.x, q.z - p.z) <= JUMP_MAX * 0.85);
function spawnAround(p, want) {
  for (let tries = 0; reachable(p).length < want && tries < 40; tries++) {
    const k = Math.min(score, 40) / 40;
    const size = THREE.MathUtils.lerp(0.17, 0.11, k) + Math.random() * THREE.MathUtils.lerp(0.07, 0.05, k);
    const q = buildPlatform(size, score > 2 && Math.random() < 0.1);
    const ang = (Math.random() - 0.5) * 2 * SPREAD;
    const minD = (extent(p) + extent(q)) * 0.62 + 0.04;
    const maxD = Math.max(minD + 0.05, THREE.MathUtils.lerp(0.5, 0.75, k));
    const d = minD + Math.random() * (maxD - minD);
    const x = p.x + Math.sin(ang) * d, z = p.z - Math.cos(ang) * d;
    // 留在台子上（相对当前跳台：左右 0.8 米、前 0.85 米、后 0.25 米以内），也不和别的跳台挤在一起
    const ok = Math.abs(x - cur.x) < 0.8 && z - cur.z < 0.25 && z - cur.z > -0.85 &&
      platforms.every((o) => o === q || o.dying || Math.hypot(o.x - x, o.z - z) >= (extent(o) + extent(q)) * 0.55 + 0.04);
    if (!ok) { course.remove(q.group); disposeTree(q.group); platforms.pop(); continue; }
    place(q, x, z);
    q.born = 0.001; // 触发出场动画
  }
}
function refreshField() {
  spawnAround(cur, NEIGHBORS);
  // 离得太远的、在后面的跳台沉下去
  for (const p of platforms) if (p !== cur && !p.dying && (Math.hypot(p.x - cur.x, p.z - cur.z) > 1.0 || p.z > cur.z + 0.3)) p.dying = 0.001;
}
// 离你最近、还没去过的跳台（电脑预览/测试用）
const nearestNext = () => reachable(cur).sort((a, b) => Math.hypot(a.x - cur.x, a.z - cur.z) - Math.hypot(b.x - cur.x, b.z - cur.z))[0] || null;

// ================= 游戏状态 =================
let state = 'idle';  // idle | charging | jumping | falling | over
let score = 0, best = Number(loadPref('jump-best', '0')) || 0, combo = 0;
let charge = 0, chargeMode = null, chargeT = 0, maxDepth = 0;
let tone = null;
let jump = null;
let pan = null;
let crouchEnabled = loadPref('jump-crouch', '1') === '1';
let statusText = '';
const effects = [];

function newGame() {
  if (!theme) return;
  for (const p of platforms) { course.remove(p.group); disposeTree(p.group); }
  platforms = [];
  course.position.set(0, 0, 0);
  pan = null;
  score = 0;
  combo = 0;
  cur = buildPlatform(0.2);
  place(cur, 0, 0);
  cur.visited = true;
  refreshField();
  for (const p of platforms) p.born = 0;
  pawn.position.set(0, cur.h, 0);
  pawn.rotation.set(0, 0, 0);
  pawn.scale.setScalar(1);
  pawn.visible = true;
  facePawn();
  state = 'idle';
  stopCharge(false);
  setStatus(crouchEnabled ? `${theme.name}：面向跳台，按住扳机蹲下，松开起跳` : `${theme.name}：按住扳机蓄力，松开起跳`);
  sfx.click();
}

// 你面对的方向（台子坐标里，水平）
function facingDir() {
  const f = app.presenting ? app.headForward(new THREE.Vector3()) : camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
  return f.applyAxisAngle(new THREE.Vector3(0, 1, 0), -rig.rotation.y).setY(0).normalize();
}
// 小角色朝着你面对的方向
function facePawn() {
  pawn.rotation.order = 'YXZ';
  const f = facingDir();
  pawn.rotation.y = Math.atan2(f.x, f.z);
}
const jumpDist = (power) => JUMP_MIN + power * (JUMP_MAX - JUMP_MIN);
function platformAt(x, z) {
  for (const p of platforms) if (!p.dying && contains(p, x, z)) return p;
  return null;
}

function startCharge(mode) {
  if (state !== 'idle') return;
  state = 'charging';
  chargeMode = mode;
  charge = 0;
  chargeT = 0;
  maxDepth = 0;
  tone = chargeTone();
}

function stopCharge(release = true) {
  tone?.stop();
  tone = null;
  if (state !== 'charging') return;
  if (release && charge > 0.02) doJump(charge);
  else state = 'idle';
  chargeMode = null;
}

function setCharge(v) {
  charge = THREE.MathUtils.clamp(v, 0, 1);
  tone?.set(charge);
}

// 往你面对的方向跳（朝错了就跳歪）
function doJump(power, dirOverride = null) {
  const from = pawn.position.clone();
  const dir = dirOverride ? dirOverride.clone().setY(0).normalize() : facingDir();
  pawn.rotation.y = Math.atan2(dir.x, dir.z);
  const dist = jumpDist(power);
  const land = from.clone().addScaledVector(dir, dist);
  const target = platformAt(land.x, land.z);
  const endY = target ? target.h : cur.h;
  const T = 0.42 + dist * 0.3;
  const peak = 0.06 + dist * 0.16;
  jump = { from, land, dir, endY, T, t: 0, peak, target, startY: from.y };
  state = 'jumping';
  cur.pressV = -2.5; // 跳台回弹
  sfx.jump();
  app.pulseAll(0.5, 40);
}

function finishLanding() {
  const t = jump.target;
  pawn.position.set(jump.land.x, t.h, jump.land.z);
  pawn.rotation.x = 0;
  sfx.land();
  app.pulseAll(0.6, 60);
  t.pressV = 1.2;
  if (t !== cur && t.visited) {
    combo = 0;
    cur = t;
    refreshField();
    startPan();
    setStatus('跳回了去过的跳台（不加分）');
  } else if (t !== cur) {
    t.visited = true;
    const off = Math.hypot(jump.land.x - t.x, jump.land.z - t.z);
    let gained = 1;
    let label = '+1';
    if (off <= Math.min(t.w, t.d) * PERFECT) {
      combo++;
      gained = 2 * combo;
      label = combo > 1 ? `靶心 ×${combo}  +${gained}` : `靶心 +${gained}`;
      sfx.perfect(combo);
      ripple(t.x, surfaceY(t) + 0.003, t.z);
    } else {
      combo = 0;
    }
    if (t.bonus && t.coin) { gained += 5; label += '  金币 +5'; sfx.bonus(); collectCoin(t); }
    score += gained;
    popup(label, t);
    cur = t;
    refreshField();
    startPan();
    setStatus(combo > 1 ? `连续靶心 ${combo} 次！` : '漂亮！继续');
  } else {
    setStatus('跳近了，再来一次');
  }
  facePawn();
  state = 'idle';
  jump = null;
}

// 掉下去：水里溅起水花、水族箱里慢慢沉下去、城市里摔到街上
function insideBasin(x, z) {
  const lx = x + course.position.x, lz = z + course.position.z - BASIN.cz;
  return Math.abs(lx) < BASIN.w / 2 - 0.05 && Math.abs(lz) < BASIN.d / 2 - 0.05;
}
function startFall() {
  state = 'falling';
  jump.fall = { v: jump.dir.clone().multiplyScalar(0.5), vy: -0.2, splashed: false };
  sfx.fall();
  combo = 0;
}
function updateFall(dt) {
  const f = jump.fall;
  const p = pawn.position;
  const kind = insideBasin(p.x, p.z) ? theme.fall : 'floor';
  if (kind === 'sink') {
    f.vy = Math.max(f.vy - 1.2 * dt, -0.25); // 在水里下沉得慢
    f.v.multiplyScalar(1 - dt * 2);
    if (Math.random() < dt * 25) bubble(p.x, p.y + 0.04, p.z);
  } else if (kind === 'water' && f.splashed) {
    f.vy = -0.06;
    f.v.multiplyScalar(1 - dt * 4);
  } else {
    f.vy -= 9.8 * dt;
  }
  p.addScaledVector(f.v, dt);
  p.y += f.vy * dt;
  pawn.rotation.x += dt * (kind === 'sink' ? 2 : 8);
  pawn.rotation.z += dt * (kind === 'sink' ? 1 : 3);
  if (kind === 'water' && !f.splashed && p.y <= 0) {
    f.splashed = true;
    splash(p.x, p.z);
    f.until = 0.7;
  }
  if (kind === 'water' && f.splashed) {
    f.until -= dt;
    if (f.until <= 0) { pawn.visible = false; gameOver(); }
    return;
  }
  const floorY = kind === 'floor' ? -rig.position.y + 0.005 : base.floorY + 0.005;
  if (p.y <= floorY) { p.y = floorY; gameOver(); }
}

function gameOver() {
  state = 'over';
  if (theme.fall !== 'water') sfx.thud();
  app.pulseAll(1, 300);
  const record = score > best;
  if (record) { best = score; savePref('jump-best', String(best)); }
  setStatus(record ? `新纪录 ${score} 分！按 A/X 再来` : `得分 ${score}，按 A/X 再来`);
}

function startPan() {
  pan = { from: course.position.clone(), to: new THREE.Vector3(-cur.x, 0, -cur.z), t: 0 };
}

// ================= 特效 =================
function addEffect(obj, life, update) {
  course.add(obj);
  effects.push({ obj, t: 0, life, update });
}
function ripple(x, y, z, color = '#ffffff') {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.01, 0.014, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  addEffect(m, 0.7, (k) => { m.scale.setScalar(1 + k * 9); m.material.opacity = 0.9 * (1 - k); });
}
function splash(x, z) {
  sfx.thud();
  ripple(x, 0.002, z);
  setTimeout(() => ripple(x, 0.002, z), 150);
  const n = 40;
  const pos = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) {
    pos.set([x, 0.005, z], i * 3);
    const a = Math.random() * Math.PI * 2, s = 0.15 + Math.random() * 0.35;
    vel.push([Math.cos(a) * s * 0.4, 0.5 + Math.random() * 0.6, Math.sin(a) * s * 0.4]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTex, size: 0.018, color: '#e8f8ff', transparent: true, depthWrite: false }));
  let last = 0;
  addEffect(pts, 0.9, (k, t) => {
    const dt = t - last; last = t;
    for (let i = 0; i < n; i++) {
      vel[i][1] -= 3 * dt;
      pos[i * 3] += vel[i][0] * dt;
      pos[i * 3 + 1] = Math.max(0, pos[i * 3 + 1] + vel[i][1] * dt);
      pos[i * 3 + 2] += vel[i][2] * dt;
    }
    geo.attributes.position.needsUpdate = true;
    pts.material.opacity = 1 - k;
  });
}
function bubble(x, y, z) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#dffcff', transparent: true, opacity: 0.8, depthWrite: false }));
  s.scale.setScalar(0.008 + Math.random() * 0.008);
  s.position.set(x + (Math.random() - 0.5) * 0.03, y, z + (Math.random() - 0.5) * 0.03);
  const y0 = s.position.y;
  addEffect(s, 1.6, (k) => { s.position.y = y0 + k * 0.35; s.material.opacity = 0.8 * (1 - k); });
}
function collectCoin(p) {
  const coin = p.coin;
  p.coin = null;
  const y0 = coin.position.y;
  effects.push({ obj: null, t: 0, life: 0.6, update: (k) => { coin.position.y = y0 + k * 0.15; coin.scale.setScalar(1 + k); coin.rotation.y += 0.5; if (k >= 1) coin.visible = false; } });
}
function popup(text, p) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = `800 72px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.strokeText(text, 256, 64);
  g.fillStyle = text.includes('靶心') ? '#ffe066' : '#ffffff';
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(0.24, 0.06, 1);
  const y0 = p.h + 0.12;
  s.position.set(p.x, y0, p.z);
  addEffect(s, 1.1, (k) => { s.position.y = y0 + k * 0.08; s.material.opacity = 1 - Math.max(0, k - 0.6) / 0.4; });
}

// ================= 面板 =================
const panelGroup = new THREE.Group();
panelGroup.position.set(0, 0.72, -1.7);
rig.add(panelGroup);
const panel = makeCanvasPlane(1.1, 0.42, 1000);
panelGroup.add(panel.mesh);
const uiButtons = [];
const restartButton = makeButton('重新开始  A/X', { width: 0.52, height: 0.1, color: '#3a5bd9', onClick: () => newGame() });
restartButton.position.set(-0.28, -0.3, 0);
const moveButton = makeButton('移到面前  B/Y', { width: 0.52, height: 0.1, color: '#3a5bd9', onClick: () => placeInFront() });
moveButton.position.set(0.28, -0.3, 0);
const crouchButton = makeButton('', { width: 0.52, height: 0.1, color: '#2e5a46', onClick: () => toggleCrouch() });
crouchButton.position.set(-0.28, -0.42, 0);
const envButton = makeButton('背景：… ▶', { width: 0.52, height: 0.1, color: '#5a4a2e', onClick: () => envs.next() });
envButton.position.set(0.28, -0.42, 0);
let aimHelp = loadPref('jump-aim', '1') === '1';
const aimButton = makeButton('', { width: 0.52, height: 0.1, color: '#2e5a46', onClick: () => { aimHelp = !aimHelp; savePref('jump-aim', aimHelp ? '1' : '0'); refreshCrouchButton(); } });
aimButton.position.set(-0.28, -0.54, 0);
const exitButton = makeExitButton(app, { width: 0.52, height: 0.1 });
exitButton.position.set(0.28, -0.54, 0);
panelGroup.add(restartButton, moveButton, crouchButton, envButton, aimButton, exitButton);
uiButtons.push(restartButton, moveButton, crouchButton, envButton, aimButton, exitButton);
if (envs.label) envButton.userData.ui.setLabel(`背景：${envs.label} ▶`);

function toggleCrouch() {
  crouchEnabled = !crouchEnabled;
  savePref('jump-crouch', crouchEnabled ? '1' : '0');
  refreshCrouchButton();
  if (state === 'idle') setStatus(crouchEnabled ? '按住扳机蹲下蓄力，松开起跳' : '按住扳机蓄力，松开起跳');
}
function refreshCrouchButton() {
  crouchButton.userData.ui.setLabel(crouchEnabled ? '蹲下蓄力：开' : '蹲下蓄力：关');
  aimButton.userData.ui.setLabel(aimHelp ? '落点提示：开' : '落点提示：关');
}
refreshCrouchButton();

function drawPanel() {
  panel.redraw((ctx, w, h) => {
    roundRect(ctx, 4, 4, w - 8, h - 8, 36);
    ctx.fillStyle = 'rgba(18, 25, 44, 0.9)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = state === 'over' ? '#ff6b6b' : '#3b4a78';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#eef2fb';
    ctx.font = `800 64px ${FONT}`;
    ctx.fillText('蓄力跳台', 46, 76);
    ctx.font = `600 36px ${FONT}`;
    ctx.fillStyle = '#9fb0d6';
    ctx.fillText(theme ? `· ${theme.name}` : '', 330, 82);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f5b941';
    ctx.font = `800 96px ${FONT}`;
    ctx.fillText(String(score), w - 46, 92);
    ctx.textAlign = 'left';
    ctx.font = `600 42px ${FONT}`;
    ctx.fillStyle = '#c9d3ea';
    ctx.fillText(`最佳 ${best}`, 46, 190);
    ctx.fillText(combo > 0 ? `靶心连击 ×${combo}` : '', 360, 190);
    ctx.font = `700 44px ${FONT}`;
    ctx.fillStyle = state === 'over' ? '#ff8a8a' : '#eef2fb';
    ctx.fillText(statusText, 46, 300);
  });
}
function setStatus(t) { statusText = t; drawPanel(); }

// 把小场景放到你面前：高度 = 你站直时的头高 - TABLE_DROP
let placeAfter = -1;
function placeInFront() {
  const head = app.headPosition(new THREE.Vector3());
  const f = app.headForward(new THREE.Vector3());
  const standY = app.presenting ? Math.max(standHeight(), head.y) : 1.6;
  rig.position.set(head.x + f.x * TABLE_AHEAD, THREE.MathUtils.clamp(standY - TABLE_DROP, 0.5, 1.3), head.z + f.z * TABLE_AHEAD);
  rig.rotation.y = Math.atan2(-f.x, -f.z);
  base?.fit(rig.position.y);
  sfx.click();
}

// ================= 蹲下检测 =================
// 记录最近 2.5 秒的头部高度，最高值 = 你站直时的高度
const headHist = [];
let clockT = 0;
function standHeight() {
  return headHist.length ? Math.max(...headHist.map((h) => h[1])) : 1.6;
}
// 按住扳机时：力度一直等于“现在蹲了多深”，蹲深变大、站起来变小（不记最低点，可以反悔）；松开扳机才起跳
function updateCrouch(headY, dt) {
  clockT += dt;
  if (state !== 'charging') {
    headHist.push([clockT, headY]);
    while (headHist.length && clockT - headHist[0][0] > 2.5) headHist.shift();
  }
  if (state === 'charging' && chargeMode === 'crouch') {
    const depth = standHeight() - headY;
    setCharge((depth - CROUCH_START) / (CROUCH_FULL - CROUCH_START));
  }
}

// ================= 每一帧 =================
const tmpHead = new THREE.Vector3();
function onFrame(dt) {
  uTime.value += dt;
  envs.update(dt);
  if (!theme) return;

  if (app.presenting) {
    if (placeAfter > 0) { placeAfter -= dt; if (placeAfter <= 0) placeInFront(); }
    updateCrouch(app.headPosition(tmpHead).y, dt);
    updatePointers();
    app.pollButtons((c, bi) => {
      if (bi === 4) newGame();
      if (bi === 5) placeInFront();
    });
  } else {
    controls.update();
  }

  if (state === 'idle' || state === 'charging') facePawn();
  updateAim();
  if (state === 'charging' && chargeMode !== 'crouch') {
    chargeT += dt;
    setCharge(chargeT / TRIGGER_FULL);
  }
  if (state === 'charging' && Math.random() < dt * 20) app.pulseAll(0.1 + charge * 0.5, 20);

  // 跳台：蓄力时被压下去，起跳/落地时弹一下；新跳台从上面落下来；旧跳台沉下去
  const squash = state === 'charging' ? charge : 0;
  for (let i = platforms.length - 1; i >= 0; i--) {
    const p = platforms[i];
    const target = p === cur ? 0.035 * squash : 0;
    // 弹簧：分成小步计算，帧率低时也不会失控
    const steps = Math.ceil(dt / (1 / 120));
    for (let s = 0; s < steps; s++) {
      const h = dt / steps;
      p.pressV += (target - p.press) * 220 * h - p.pressV * 14 * h;
      p.press += p.pressV * h;
    }
    let y = -p.press;
    if (p.born > 0) {
      p.born += dt;
      const k = Math.min(p.born / 0.35, 1);
      y += (1 - k) * 0.25 + Math.sin(k * Math.PI) * 0.02;
      if (k >= 1) p.born = 0;
    }
    if (p.dying > 0) {
      // 旧跳台缩小、往下沉一点，然后消失（不会掉出底座）
      p.dying += dt;
      const k = Math.min(p.dying / 0.6, 1);
      y -= k * 0.04;
      p.group.scale.setScalar(Math.max(0.001, 1 - k * k));
      if (k >= 1) { course.remove(p.group); disposeTree(p.group); platforms.splice(i, 1); continue; }
    }
    p.group.position.y = y;
    if (p.coin) p.coin.rotation.y += dt * 3;
  }
  if (state === 'idle' || state === 'charging') {
    pawn.scale.set(1 + 0.18 * squash, 1 - 0.42 * squash, 1 + 0.18 * squash);
    pawn.position.y = surfaceY(cur);
  }

  if (state === 'jumping') {
    jump.t += dt;
    const k = Math.min(jump.t / jump.T, 1);
    pawn.scale.set(1, 1, 1);
    pawn.position.x = jump.from.x + (jump.land.x - jump.from.x) * k;
    pawn.position.z = jump.from.z + (jump.land.z - jump.from.z) * k;
    pawn.position.y = THREE.MathUtils.lerp(jump.startY, jump.endY, k) + 4 * jump.peak * k * (1 - k);
    pawn.rotation.x = k * Math.PI * 2; // 空中翻一圈
    if (k >= 1) {
      if (jump.target) finishLanding();
      else startFall();
    }
  } else if (state === 'falling') {
    updateFall(dt);
  }

  // 影子：投在角色正下方的跳台上；下面没有跳台时投在水面/地面上
  const under = platforms.find((p) => !p.dying && contains(p, pawn.position.x, pawn.position.z));
  const groundY = theme.fall === 'water' ? 0.001 : base.floorY + 0.002;
  const sy = under ? surfaceY(under) + 0.002 : groundY;
  shadow.visible = pawn.visible && state !== 'over' && pawn.position.y > sy - 0.01;
  shadow.position.set(pawn.position.x, sy, pawn.position.z);
  const hgt = Math.max(0, pawn.position.y - sy);
  shadow.scale.setScalar(1 / (1 + hgt * 6));
  shadow.material.opacity = 0.35 / (1 + hgt * 4);

  // 蓄力圈
  chargeRing.visible = state === 'charging';
  if (chargeRing.visible) {
    chargeRing.geometry.dispose();
    chargeRing.geometry = new THREE.RingGeometry(0.034, 0.042, 48, 1, Math.PI / 2, Math.max(0.001, charge * Math.PI * 2));
    chargeRing.position.set(pawn.position.x, pawn.position.y + 0.002, pawn.position.z);
    chargeRing.material.color.setHSL(0.38 - charge * 0.38, 0.9, 0.6);
  }

  // 平移跳台组，让当前跳台回到中间
  if (pan) {
    pan.t += dt / 0.5;
    const k = Math.min(pan.t, 1);
    course.position.lerpVectors(pan.from, pan.to, 1 - Math.pow(1 - k, 3));
    if (k >= 1) pan = null;
  }

  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    const k = Math.min(e.t / e.life, 1);
    e.update(k, e.t);
    if (k >= 1) {
      if (e.obj) {
        course.remove(e.obj);
        if (!e.obj.isSprite) e.obj.geometry?.dispose();
        if (e.obj.material.map && e.obj.material.map !== glowTex) e.obj.material.map.dispose(); // 共用贴图不释放
        e.obj.material.dispose();
      }
      effects.splice(i, 1);
    }
  }
}

function updatePointers() {
  const hovered = new Set();
  for (const c of app.controllers) {
    if (!c.inputSource) continue;
    const hit = app.pointAt(c, uiButtons, 4);
    c.hover = hit ? hit.object : null;
    if (c.hover) hovered.add(c.hover);
  }
  for (const b of uiButtons) b.userData.ui.setHover(hovered.has(b));
}

// 扳机：指着按钮 = 点按钮；否则 = 按住蓄力
app.on('select', (c) => {
  initAudio();
  if (c.hover?.userData.ui) {
    app.pulse(c, 0.4, 30);
    c.hover.userData.ui.onClick?.();
    return;
  }
  if (state === 'over') { newGame(); return; }
  c.charging = true;
  startCharge(crouchEnabled && app.presenting ? 'crouch' : 'trigger');
});
app.on('selectend', (c) => {
  if (c.charging && (chargeMode === 'trigger' || chargeMode === 'crouch')) {
    if (chargeMode === 'crouch' && charge <= 0.02) { stopCharge(false); setStatus('没蹲下去：按住扳机、蹲下，再松开'); }
    else stopCharge(true);
  }
  c.charging = false;
});

// 落点提示：从小角色脚下沿你面对的方向画一条虚线，蓄力时线头的圆圈就是会落到的地方
const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.02, gapSize: 0.014, transparent: true, opacity: 0.8, depthWrite: false }));
course.add(aimLine);
const aimSpot = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.024, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
aimSpot.rotation.x = -Math.PI / 2;
course.add(aimSpot);
function updateAim() {
  const show = aimHelp && (state === 'idle' || state === 'charging') && !!cur;
  aimLine.visible = show;
  aimSpot.visible = show && state === 'charging';
  if (!show) return;
  const dir = facingDir();
  const len = state === 'charging' ? jumpDist(charge) : 0.25;
  const y = surfaceY(cur) + 0.004;
  const a = pawn.position.clone().setY(y).addScaledVector(dir, 0.03);
  const b = pawn.position.clone().setY(y).addScaledVector(dir, len);
  const t = platformAt(b.x, b.z);
  b.y = t ? surfaceY(t) + 0.004 : y;
  aimLine.geometry.setFromPoints([a, b]);
  aimLine.computeLineDistances();
  aimSpot.position.copy(b);
}

// ================= 电脑上预览 =================
camera.position.set(0, 1.85, 0.75);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, -1.0);
controls.enableDamping = true;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && !app.presenting) {
    e.preventDefault();
    initAudio();
    if (state === 'over') newGame();
    else startCharge('key');
  }
  if (e.key === 'Enter') newGame();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && chargeMode === 'key') stopCharge(true);
});
const mouse = new THREE.Vector2();
const mouseRay = new THREE.Raycaster();
renderer.domElement.addEventListener('click', (e) => {
  if (app.presenting) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  mouseRay.setFromCamera(mouse, camera);
  const hit = mouseRay.intersectObjects(uiButtons, false)[0];
  if (hit) { initAudio(); hit.object.userData.ui.onClick?.(); }
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
  if (!vr && !ar) note.textContent = '这台设备不支持 VR。可以先在电脑上预览：按住空格蓄力，松开起跳。';
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

// 调试用
window.jumpgame = {
  get state() { return state; }, get score() { return score; }, get combo() { return combo; },
  get cur() { return cur; }, get next() { return nearestNext(); }, get pawn() { return pawn; }, get platforms() { return platforms; },
  get charge() { return charge; }, get theme() { return themeKey; },
  startCharge, stopCharge, setCharge, newGame, updateCrouch, doJump, camera, controls, envs, rig, reachable,
  setAR(v) { isAR = v; applyEnvOpacity(); },
  jumpTo(p, power) { const d = new THREE.Vector3(p.x - pawn.position.x, 0, p.z - pawn.position.z); doJump(power ?? (d.length() - JUMP_MIN) / (JUMP_MAX - JUMP_MIN), d); },
  idealPower() {
    const n = nearestNext();
    const d = Math.hypot(n.x - pawn.position.x, n.z - pawn.position.z);
    return (d - JUMP_MIN) / (JUMP_MAX - JUMP_MIN);
  },
};
