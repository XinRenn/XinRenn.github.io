// 蓄力跳台：蹲下蓄力、站起起跳，让小人跳到下一块平台上。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio, chargeTone } from '../../shared/sfx.js';
import { createEnvManager, ENVIRONMENTS, savedEnvKey } from '../../shared/env/index.js';

// ================= 可调参数 =================
const CROUCH_START = 0.07;   // 头部下降多少米开始算蓄力
const CROUCH_FULL = 0.5;     // 下降多少米算满蓄力
const TRIGGER_FULL = 1.1;    // 扳机按住多少秒算满蓄力
const JUMP_MIN = 0.08, JUMP_MAX = 0.95; // 蓄力 0 → 1 对应的跳跃距离（米）
const PERFECT = 0.16;        // 落点离中心 < 平台尺寸 × 这个比例 = 正中靶心
const TABLE_DROP = 0.75;     // 平台比你站立时的头低多少米
const TABLE_AHEAD = 0.55;    // 平台在你面前多远
const PALETTE = ['#7cc6fe', '#ff9f80', '#a0e7a0', '#ffd6a5', '#cdb4ff', '#9bf6ff', '#ffadad', '#fdffb6'];

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
  if (mode !== 'desktop') { placeAfter = 0.8; headHist.length = 0; }
});

function loadPref(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } }
function savePref(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 无痕模式 */ } }

// rig：放在你面前的“桌面”，course：所有平台和小人（每次落地后平移，让当前平台回到中间）
const rig = new THREE.Group();
scene.add(rig);
const course = new THREE.Group();
rig.add(course);
rig.position.set(0, 0.9, -TABLE_AHEAD);

// ================= 小人 =================
function makePawn() {
  const g = new THREE.Group();
  const prof = [[0, 0], [0.024, 0], [0.027, 0.006], [0.022, 0.022], [0.014, 0.045], [0.011, 0.056], [0.017, 0.062], [0, 0.064]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const mat = new THREE.MeshStandardMaterial({ color: '#ff6b6b', roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), mat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.019, 20, 14), mat);
  head.position.y = 0.08;
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#1b1b1b' });
  for (const x of [-0.007, 0.007]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), eyeMat);
    e.position.set(x, 0.083, 0.017);
    g.add(e);
  }
  g.add(body, head);
  return g;
}
const pawn = makePawn();
course.add(pawn);

// 小人的影子（落点判断的重要参考）
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

// ================= 平台 =================
let platforms = [];
let cur = null, next = null;

function makePlatform(x, z, size, h, shape, bonus = false) {
  const g = new THREE.Group();
  const color = bonus ? new THREE.Color('#ffcf3a') : new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
  const sideMat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), roughness: 0.6, emissive: bonus ? '#5a3a00' : '#000000' });
  const topMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: bonus ? '#6a4a00' : '#000000' });
  let bodyGeo, topGeo;
  if (shape === 'box') {
    bodyGeo = new THREE.BoxGeometry(size, h, size);
    topGeo = new THREE.BoxGeometry(size * 1.02, 0.008, size * 1.02);
  } else {
    const seg = shape === 'hex' ? 6 : 36;
    bodyGeo = new THREE.CylinderGeometry(size / 2, size / 2, h, seg);
    topGeo = new THREE.CylinderGeometry(size / 2 * 1.02, size / 2 * 1.02, 0.008, seg);
  }
  bodyGeo.translate(0, h / 2, 0);
  topGeo.translate(0, h - 0.004, 0);
  const body = new THREE.Mesh(bodyGeo, sideMat);
  const top = new THREE.Mesh(topGeo, topMat);
  // 底下一小块岩石，让它看起来像悬浮的小岛
  const rock = new THREE.Mesh(new THREE.ConeGeometry(size * 0.48, size * 0.55, shape === 'hex' ? 6 : 7), new THREE.MeshStandardMaterial({ color: '#7a6a5a', roughness: 1, flatShading: true }));
  rock.rotation.x = Math.PI;
  rock.position.y = -size * 0.275;
  // 靶心标记（淡淡的同心圆）
  const target = new THREE.Mesh(
    new THREE.RingGeometry(size * PERFECT * 0.6, size * PERFECT, 32),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false })
  );
  target.rotation.x = -Math.PI / 2;
  target.position.y = h + 0.001;
  g.add(body, top, rock, target);
  if (bonus) {
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2a8', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    spark.position.y = h + 0.05;
    spark.scale.setScalar(size * 1.4);
    g.add(spark);
  }
  g.position.set(x, 0, z);
  course.add(g);
  const p = { group: g, body, top, x, z, size, h, shape, bonus, born: 0, squash: 1, springV: 0 };
  platforms.push(p);
  return p;
}

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

function contains(p, x, z, margin = 0) {
  const dx = x - p.x, dz = z - p.z;
  if (p.shape === 'box') return Math.abs(dx) <= p.size / 2 + margin && Math.abs(dz) <= p.size / 2 + margin;
  return Math.hypot(dx, dz) <= p.size / 2 + margin;
}

// 难度随分数增加：间距更大、平台更小
function spawnNext() {
  const k = Math.min(score, 40) / 40;
  const size = THREE.MathUtils.lerp(0.17, 0.11, k) + Math.random() * THREE.MathUtils.lerp(0.07, 0.05, k);
  const h = 0.07 + Math.random() * 0.09;
  const shape = ['box', 'cyl', 'hex'][Math.floor(Math.random() * 3)];
  const side = Math.random() < 0.5 ? -1 : 1;
  const ang = Math.PI / 4 + (Math.random() - 0.5) * 0.25;
  const dir = [Math.sin(ang) * side, -Math.cos(ang)];
  const minD = (cur.size + size) * 0.75 + 0.04;
  const maxD = Math.max(minD + 0.05, THREE.MathUtils.lerp(0.48, 0.74, k));
  const d = minD + Math.random() * (maxD - minD);
  const bonus = score > 2 && Math.random() < 0.1;
  next = makePlatform(cur.x + dir[0] * d, cur.z + dir[1] * d, size, h, shape, bonus);
  next.born = 0.001; // 触发落下来的出场动画
}

// ================= 游戏状态 =================
let state = 'idle';  // idle | charging | jumping | falling | over
let score = 0, best = Number(loadPref('jump-best', '0')) || 0, combo = 0;
let charge = 0, chargeMode = null, chargeT = 0, maxDepth = 0;
let tone = null;
let jump = null;
let pan = null;
let crouchEnabled = loadPref('jump-crouch', '1') === '1';
let statusText = '';
const popups = [];

function newGame() {
  for (const p of platforms) {
    course.remove(p.group);
    p.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  }
  platforms = [];
  course.position.set(0, 0, 0);
  pan = null;
  score = 0;
  combo = 0;
  cur = makePlatform(0, 0, 0.2, 0.12, 'cyl');
  spawnNext();
  next.born = 0;
  pawn.position.set(0, cur.h, 0);
  pawn.rotation.set(0, 0, 0);
  pawn.scale.setScalar(1);
  facePawn();
  state = 'idle';
  stopCharge(false);
  setStatus(crouchEnabled ? '站直，然后蹲下蓄力' : '按住扳机蓄力，松开起跳');
  sfx.click();
}

function facePawn() {
  const dx = next.x - pawn.position.x, dz = next.z - pawn.position.z;
  pawn.rotation.y = Math.atan2(dx, dz);
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

function doJump(power) {
  const from = pawn.position.clone();
  const dir = new THREE.Vector3(next.x - from.x, 0, next.z - from.z).normalize();
  const dist = JUMP_MIN + power * (JUMP_MAX - JUMP_MIN);
  const land = from.clone().addScaledVector(dir, dist);
  let target = null;
  if (contains(next, land.x, land.z)) target = next;
  else if (contains(cur, land.x, land.z)) target = cur;
  const endY = target ? target.h : Math.min(cur.h, next.h);
  const T = 0.42 + dist * 0.3;
  const peak = 0.06 + dist * 0.16;
  jump = { from, land, dir, endY, T, t: 0, peak, target, startY: from.y };
  state = 'jumping';
  cur.springV = 6; // 平台回弹
  sfx.jump();
  app.pulseAll(0.5, 40);
}

function finishLanding() {
  const t = jump.target;
  pawn.position.set(jump.land.x, t.h, jump.land.z);
  pawn.rotation.x = 0;
  sfx.land();
  app.pulseAll(0.6, 60);
  t.springV = -5;
  if (t === next) {
    const off = Math.hypot(jump.land.x - t.x, jump.land.z - t.z);
    let gained = 1;
    let label = '+1';
    if (off <= t.size * PERFECT) {
      combo++;
      gained = 2 * combo;
      label = combo > 1 ? `靶心 ×${combo}  +${gained}` : `靶心 +${gained}`;
      sfx.perfect(combo);
      ripple(t);
    } else {
      combo = 0;
    }
    if (t.bonus) { gained += 5; label += '  金色 +5'; sfx.bonus(); }
    score += gained;
    popup(label, t);
    cur = t;
    spawnNext();
    startPan();
    setStatus(combo > 1 ? `连续靶心 ${combo} 次！` : '漂亮！继续');
  } else {
    setStatus('跳近了，再来一次');
  }
  facePawn();
  state = 'idle';
  jump = null;
}

function startFall() {
  state = 'falling';
  const v = jump.dir.clone().multiplyScalar(0.6);
  jump.fall = { v, vy: 0, spin: 0 };
  sfx.fall();
  combo = 0;
}

function gameOver() {
  state = 'over';
  sfx.thud();
  app.pulseAll(1, 300);
  const record = score > best;
  if (record) { best = score; savePref('jump-best', String(best)); }
  setStatus(record ? `新纪录 ${score} 分！按 A/X 再来` : `得分 ${score}，按 A/X 再来`);
}

function startPan() {
  pan = { from: course.position.clone(), to: new THREE.Vector3(-cur.x, 0, -cur.z), t: 0 };
  // 太远的旧平台删掉
  while (platforms.length > 5) {
    const old = platforms.shift();
    course.remove(old.group);
    old.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  }
}

// ================= 特效 =================
function ripple(p) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.01, 0.014, 40),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(p.x, p.h + 0.003, p.z);
  course.add(m);
  popups.push({ obj: m, t: 0, life: 0.6, update(k) { m.scale.setScalar(1 + k * 9); m.material.opacity = 0.9 * (1 - k); } });
}

function popup(text, p) {
  const tex = (() => {
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
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(0.24, 0.06, 1);
  s.position.set(p.x, p.h + 0.12, p.z);
  course.add(s);
  popups.push({ obj: s, t: 0, life: 1.1, update(k) { s.position.y = p.h + 0.12 + k * 0.08; s.material.opacity = 1 - Math.max(0, k - 0.6) / 0.4; } });
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
panelGroup.add(restartButton, moveButton, crouchButton, envButton);
uiButtons.push(restartButton, moveButton, crouchButton, envButton);
if (envs.label) envButton.userData.ui.setLabel(`背景：${envs.label} ▶`);

function toggleCrouch() {
  crouchEnabled = !crouchEnabled;
  savePref('jump-crouch', crouchEnabled ? '1' : '0');
  refreshCrouchButton();
  if (state === 'idle') setStatus(crouchEnabled ? '站直，然后蹲下蓄力' : '按住扳机蓄力，松开起跳');
}
function refreshCrouchButton() {
  crouchButton.userData.ui.setLabel(crouchEnabled ? '蹲下蓄力：开' : '蹲下蓄力：关');
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

// 把平台放到你面前：高度 = 你站直时的头高 - TABLE_DROP
let placeAfter = -1;
function placeInFront() {
  const head = app.headPosition(new THREE.Vector3());
  const f = app.headForward(new THREE.Vector3());
  const standY = app.presenting ? Math.max(standHeight(), head.y) : 1.6;
  rig.position.set(head.x + f.x * TABLE_AHEAD, THREE.MathUtils.clamp(standY - TABLE_DROP, 0.5, 1.3), head.z + f.z * TABLE_AHEAD);
  rig.rotation.y = Math.atan2(-f.x, -f.z);
  sfx.click();
}

// ================= 蹲下检测 =================
// 记录最近 2.5 秒的头部高度，最高值 = 你站直时的高度
const headHist = [];
let clockT = 0;
let crouchArmed = true;
function standHeight() {
  return headHist.length ? Math.max(...headHist.map((h) => h[1])) : 1.6;
}
function updateCrouch(headY, dt) {
  clockT += dt;
  if (state !== 'charging') {
    headHist.push([clockT, headY]);
    while (headHist.length && clockT - headHist[0][0] > 2.5) headHist.shift();
  }
  if (!crouchEnabled || headHist.length < 20) return;
  const depth = standHeight() - headY;
  if (depth < CROUCH_START * 0.6) crouchArmed = true; // 站直之后才允许下一次蹲下蓄力
  if (state === 'idle' && crouchArmed && depth > CROUCH_START) { crouchArmed = false; startCharge('crouch'); }
  if (state === 'charging' && chargeMode === 'crouch') {
    maxDepth = Math.max(maxDepth, depth);
    setCharge((maxDepth - CROUCH_START) / (CROUCH_FULL - CROUCH_START));
    // 从最低点站起来一段距离就起跳
    if (depth < maxDepth - Math.max(0.08, maxDepth * 0.4) || depth < CROUCH_START * 0.5) stopCharge(true);
  }
}

// ================= 每一帧 =================
const tmpHead = new THREE.Vector3();
function onFrame(dt) {
  envs.update(dt);

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

  if (state === 'charging' && chargeMode !== 'crouch') {
    chargeT += dt;
    setCharge(chargeT / TRIGGER_FULL);
  }
  if (state === 'charging') {
    if (Math.random() < dt * 20) app.pulseAll(0.1 + charge * 0.5, 20);
  }

  // 蓄力时小人被压扁、平台被压下去
  const squash = state === 'charging' ? charge : 0;
  if (cur) {
    // 平台回弹（弹簧）
    for (const p of platforms) {
      const targetS = p === cur ? 1 - 0.28 * squash : 1;
      p.springV += (targetS - p.squash) * 180 * dt - p.springV * 12 * dt;
      p.squash += p.springV * dt;
      p.body.scale.y = p.squash;
      p.top.position.y = (p.squash - 1) * p.h;
      if (p.born > 0) {
        p.born += dt;
        const k = Math.min(p.born / 0.35, 1);
        p.group.position.y = (1 - k) * 0.25 + Math.sin(k * Math.PI) * 0.02;
        if (k >= 1) p.born = 0;
      }
    }
  }
  if (state === 'idle' || state === 'charging') {
    pawn.scale.set(1 + 0.18 * squash, 1 - 0.42 * squash, 1 + 0.18 * squash);
    pawn.position.y = cur.h * cur.squash;
  }

  if (state === 'jumping') {
    jump.t += dt;
    const k = Math.min(jump.t / jump.T, 1);
    pawn.scale.set(1, 1, 1);
    pawn.position.x = jump.from.x + (jump.land.x - jump.from.x) * k;
    pawn.position.z = jump.from.z + (jump.land.z - jump.from.z) * k;
    pawn.position.y = THREE.MathUtils.lerp(jump.startY, jump.endY, k) + 4 * jump.peak * k * (1 - k);
    pawn.rotation.order = 'YXZ';
    pawn.rotation.x = k * Math.PI * 2; // 空中翻一圈
    if (k >= 1) {
      if (jump.target) finishLanding();
      else startFall();
    }
  } else if (state === 'falling') {
    const f = jump.fall;
    f.vy -= 9.8 * dt;
    pawn.position.addScaledVector(f.v, dt);
    pawn.position.y += f.vy * dt;
    pawn.rotation.x += dt * 8;
    pawn.rotation.z += dt * 3;
    const floorY = -rig.position.y + 0.03;
    if (pawn.position.y <= floorY) { pawn.position.y = floorY; gameOver(); }
  }

  // 影子：投在小人正下方的平台上
  const under = platforms.find((p) => contains(p, pawn.position.x, pawn.position.z));
  shadow.visible = !!under && state !== 'over';
  if (under) {
    shadow.position.set(pawn.position.x, under.h * under.squash + 0.002, pawn.position.z);
    const hgt = Math.max(0, pawn.position.y - under.h);
    shadow.scale.setScalar(1 / (1 + hgt * 6));
    shadow.material.opacity = 0.35 / (1 + hgt * 4);
  }

  // 蓄力圈
  chargeRing.visible = state === 'charging';
  if (chargeRing.visible) {
    chargeRing.geometry.dispose();
    chargeRing.geometry = new THREE.RingGeometry(0.034, 0.042, 48, 1, Math.PI / 2, Math.max(0.001, charge * Math.PI * 2));
    chargeRing.position.set(pawn.position.x, pawn.position.y + 0.002, pawn.position.z);
    chargeRing.material.color.setHSL(0.38 - charge * 0.38, 0.9, 0.6);
  }

  // 镜头跟随：平移整个平台组，让当前平台回到中间
  if (pan) {
    pan.t += dt / 0.5;
    const k = Math.min(pan.t, 1);
    const e = 1 - Math.pow(1 - k, 3);
    course.position.lerpVectors(pan.from, pan.to, e);
    if (k >= 1) pan = null;
  }

  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.t += dt;
    const k = Math.min(p.t / p.life, 1);
    p.update(k);
    if (k >= 1) {
      course.remove(p.obj);
      if (!p.obj.isSprite) p.obj.geometry?.dispose(); // 精灵共用同一个几何体，不能释放
      p.obj.material.map?.dispose();
      p.obj.material.dispose();
      popups.splice(i, 1);
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
  if (state === 'over') return;
  c.charging = true;
  startCharge('trigger');
});
app.on('selectend', (c) => {
  if (c.charging && chargeMode === 'trigger') stopCharge(true);
  c.charging = false;
});

// ================= 电脑上预览 =================
camera.position.set(0, 1.85, 0.75);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.05, -1.05);
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

newGame();

// 调试用
window.jumpgame = {
  get state() { return state; }, get score() { return score; }, get combo() { return combo; },
  get cur() { return cur; }, get next() { return next; }, get pawn() { return pawn; },
  get charge() { return charge; },
  startCharge, stopCharge, setCharge, newGame, updateCrouch, doJump, camera, controls, envs, rig,
  idealPower() {
    const d = Math.hypot(next.x - pawn.position.x, next.z - pawn.position.z);
    return (d - JUMP_MIN) / (JUMP_MAX - JUMP_MIN);
  },
};
