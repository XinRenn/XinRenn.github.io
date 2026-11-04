// 蓄力跳台（第一人称跑酷版）：你站在一根真实大小的“梅花桩”上，周围很多方向都有跳台。
// 按住握把、蹲下蓄力（蹲得越深跳得越远，站起来就减少，可以反悔），松开握把就往你面对的方向跳——
// 你本人不动，整个世界往后退，就像真的跳了过去。没踩中就显示“你掉下去了”。
// 跳台的样子随背景变化（荷叶、石头、浮冰、木桩、屋顶……），造型来自 themes.js。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createXRApp } from '../../shared/xr-app.js';
import { makeCanvasPlane, makeButton, roundRect, FONT } from '../../shared/ui3d.js';
import { sfx, initAudio, chargeTone } from '../../shared/sfx.js';
import { createEnvManager, ENVIRONMENTS, savedEnvKey } from '../../shared/env/index.js';
import { createFeet } from '../../shared/feet.js';
import { makeExitButton } from '../../shared/exit.js';
import { THEMES } from './themes.js';

// ================= 可调参数 =================
const K = 5.5;               // 跳台放大倍数（themes.js 里是桌面小模型的尺寸）
const CROUCH_START = 0.07;   // 头部下降多少米开始算蓄力
const CROUCH_FULL = 0.5;     // 下降多少米算满蓄力
const TRIGGER_FULL = 1.1;    // 扳机按住多少秒算满蓄力
const JUMP_MIN = 0.3, JUMP_MAX = 3.2; // 蓄力 0 → 1 对应的跳跃距离（米）
const PERFECT = 0.16;        // 落点离中心 < 跳台尺寸 × 这个比例 = 正中靶心
const NEIGHBORS = 4;         // 脚下这个跳台周围保持几个跳得到的新跳台
const SPREAD = 1.95;         // 新跳台出现在“前方”左右多大角度内（弧度，约 ±110°）
const LANE = 5.5;            // 跳台离中线最远多少米（背景里这条带子是空的）
const MR_ENV_OPACITY = 0.5;  // 混合现实里背景的可见度
const BASE = { water: -0.08, sink: -0.38, ground: -0.5 }; // 各主题“底面”的高度（小模型单位）
const WRAP = { default: 26, waterfall: 9 };               // 背景跟着往后退多远之后悄悄挪回来

// ================= 场景 =================
const app = createXRApp({ onFrame });
const { scene, camera, renderer } = app;
const uTime = { value: 0 };

// world：放在你脚下、朝你面对的方向。里面有背景、跳台和面板
const world = new THREE.Group();
scene.add(world);
const envHolder = new THREE.Group();
world.add(envHolder);
const course = new THREE.Group();   // 跳台：起跳时整体往后退
world.add(course);
const hud = new THREE.Group();      // 面板：跟着你，不动
world.add(hud);

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
  envs.setAR(false); // 混合现实里背景不藏起来，而是变成半透明（见 applyEnvOpacity）
  applyEnvOpacity();
  overlay.classList.toggle('hidden', mode !== 'desktop' || desktopPreview);
  backLink.style.display = mode === 'desktop' ? '' : 'none';
  hint.style.display = mode === 'desktop' && desktopPreview ? 'block' : 'none';
  if (mode !== 'desktop') { placeAfter = 0.8; headHist.length = 0; }
});

function loadPref(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } }
function savePref(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 无痕模式 */ } }

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

// ---- 防晕：起跳时视野四周变暗（缩小视野能明显减轻眩晕）----
const vignette = (() => {
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.15)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    return t;
  })();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  m.position.z = -0.12;
  m.renderOrder = 1000;
  camera.add(m);
  const black = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  black.position.z = -0.11;
  black.renderOrder = 1001;
  camera.add(black);
  return { m, black };
})();
let comfort = loadPref('jump-comfort', '1') === '1';

// 卡通脚：站在跳台上看得见自己的脚
const feet = createFeet({ color: '#ff9f1c', accent: '#2ec4b6' });
scene.add(feet.object);

// ================= 主题 =================
let theme = null, themeKey = 'meadow', baseY = 0, surfaceY = 0; // baseY：水底/沙地/街道；surfaceY：水面（水主题）或地面
let baseStrip = null;
let croakTimer = 3;

function applyTheme(key) {
  themeKey = THEMES[key] ? key : 'meadow';
  theme = THEMES[themeKey];
  baseY = BASE[theme.fall] * K;
  surfaceY = theme.fall === 'water' ? 0 : baseY;
  // 背景挪到 world 里，跟着跳台一起移动；中间的通道清空（树、草、石头不挡路）
  const env = envs.current;
  if (env) {
    envHolder.add(env.group);
    clearCorridor(env.group);
  }
  buildBase();
  applyEnvOpacity();
  newGame();
}

// 混合现实：背景和水面调成半透明，能透过去看到真实的房间；跳台保持不透明
function applyEnvOpacity() {
  const k = isAR ? MR_ENV_OPACITY : 1;
  scene.fog = isAR ? null : envs.current?.fog || null;
  const groups = [envs.current?.group, baseStrip].filter(Boolean);
  for (const g of groups) g.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (!m.userData.base) m.userData.base = { o: m.opacity, t: m.transparent, dw: m.depthWrite };
      const b = m.userData.base;
      m.transparent = k < 1 || b.t;
      m.opacity = b.o * k;
      m.depthWrite = k < 1 ? false : b.dw;
      if (m.uniforms?.opacityK) m.uniforms.opacityK.value = k;
      m.needsUpdate = true;
    }
  });
}

// 把背景里落在通道（|x| < 4.5 米）内的树、草、石头等批量物体隐藏起来
function clearCorridor(group) {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (Math.abs(p.x) < LANE + 2 && p.z < 12) o.setMatrixAt(i, zero);
    }
    o.instanceMatrix.needsUpdate = true;
  });
}

// 跳台下面的水面 / 沙地 / 街道：一条长长的带子，跟着跳台一起后退
function buildBase() {
  if (baseStrip) { course.remove(baseStrip); baseStrip.geometry.dispose(); baseStrip.material.dispose(); }
  const kind = theme.fall;
  const colors = {
    meadow: ['#1f4558', '#8db8cc'], waterfall: ['#1f5560', '#b5e0e8'], winter: ['#1d3a52', '#a9c8dd'],
    harbor: ['#1e5470', '#9cc4dd'], fjord: ['#0f3b55', '#9cc6e6'], underwater: ['#c9b98a', '#e2d5aa'],
    japan: ['#26262c', '#3a3a44'], london: ['#24272c', '#3a3f47'],
  }[themeKey] || ['#1f4558', '#8db8cc'];
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime, opacityK: { value: 1 }, deep: { value: new THREE.Color(colors[0]) }, light: { value: new THREE.Color(colors[1]) }, water: { value: kind === 'water' ? 1 : 0 }, street: { value: kind === 'ground' ? 1 : 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec2 vL;
      void main() { vL = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, water, street, opacityK; uniform vec3 deep, light; varying vec3 vW; varying vec2 vL;
      void main() {
        vec3 c;
        if (water > 0.5) {
          vec3 V = normalize(cameraPosition - vW);
          float f = pow(1.0 - max(V.y, 0.0), 2.0);
          vec2 p = vL * 3.0;
          float r = sin(p.x * 1.7 + uTime * 1.3) * sin(p.y * 1.3 - uTime) + 0.5 * sin((p.x + p.y) * 2.3 + uTime * 2.0);
          c = mix(deep, light, 0.2 + 0.55 * f) + pow(max(r, 0.0) / 1.5, 8.0) * 0.3;
        } else if (street > 0.5) {
          c = deep;
          float lane = step(abs(vL.x), 0.06) * step(fract(vL.y / 3.0), 0.5);
          c = mix(c, vec3(0.85, 0.75, 0.35), lane);
        } else {
          c = mix(deep, light, 0.5 + 0.5 * sin(vL.x * 1.3) * sin(vL.y * 0.9));
        }
        float edge = smoothstep(7.2, 6.2, abs(vL.x));
        gl_FragColor = vec4(c, (water > 0.5 ? 0.93 : 1.0) * edge * opacityK);
        #include <colorspace_fragment>
      }`,
  });
  baseStrip = new THREE.Mesh(new THREE.PlaneGeometry(14.4, 600), mat);
  baseStrip.rotation.x = -Math.PI / 2;
  baseStrip.position.set(0, surfaceY + 0.005, -280);
  course.add(baseStrip);
}

// ================= 跳台 =================
let platforms = [];
let cur = null;
let pos = new THREE.Vector3(); // 你在跳台坐标里的位置（脚下）

function buildPlatform(size, bonus = false) {
  const r = theme.platform(size, BASE[theme.fall]);
  r.group.scale.setScalar(K);
  const p = { group: r.group, x: 0, z: 0, w: r.w * K, d: r.d * K, h: (r.h + (r.top || 0)) * K, shape: r.shape, bonus, born: 0, dying: 0, coin: null };
  const t = Math.min(r.w, r.d);
  const target = new THREE.Mesh(
    new THREE.RingGeometry(t * PERFECT * 0.6, t * PERFECT, 32),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false })
  );
  target.rotation.x = -Math.PI / 2;
  target.position.y = r.h + (r.top || 0) + 0.0015;
  r.group.add(target);
  if (bonus) {
    const coin = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 24), new THREE.MeshStandardMaterial({ color: '#ffcf3a', metalness: 0.8, roughness: 0.25, emissive: '#5a3a00' }));
    disc.rotation.x = Math.PI / 2;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2a8', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(0.07);
    coin.add(disc, glow);
    coin.position.y = r.h + 0.06;
    r.group.add(coin);
    p.coin = coin;
  }
  course.add(r.group);
  platforms.push(p);
  return p;
}
function place(p, x, z) { p.x = x; p.z = z; p.group.position.set(x, 0, z); }
const extent = (p) => Math.max(p.w, p.d);
function contains(p, x, z) {
  const dx = x - p.x, dz = z - p.z;
  if (p.shape === 'box') return Math.abs(dx) <= p.w / 2 && Math.abs(dz) <= p.d / 2;
  return Math.hypot(dx, dz) <= p.w / 2;
}

// 跳台铺成一片：每个跳台周围（前方和左右，大约 ±110°）都有几个跳得到的新跳台，往哪边跳都行
const reachable = (p) => platforms.filter((q) => q !== p && !q.dying && !q.visited && Math.hypot(q.x - p.x, q.z - p.z) <= JUMP_MAX * 0.92);
function spawnAround(p, want) {
  for (let tries = 0; reachable(p).length < want && tries < 40; tries++) {
    const k = Math.min(score, 40) / 40;
    const size = THREE.MathUtils.lerp(0.18, 0.12, k) + Math.random() * 0.05;
    const q = buildPlatform(size, score > 2 && Math.random() < 0.1);
    const ang = (Math.random() - 0.5) * 2 * SPREAD;
    const minD = (extent(p) + extent(q)) * 0.55 + 0.3;
    const maxD = Math.max(minD + 0.3, THREE.MathUtils.lerp(2.2, 2.85, k));
    const d = minD + Math.random() * (maxD - minD);
    const x = p.x + Math.sin(ang) * d, z = p.z - Math.cos(ang) * d;
    const ok = Math.abs(x) < LANE && z < cur.z + 1.5 &&
      platforms.every((o) => o === q || o.dying || Math.hypot(o.x - x, o.z - z) >= (extent(o) + extent(q)) * 0.55 + 0.35);
    if (!ok) { course.remove(q.group); disposeTree(q.group); platforms.pop(); continue; }
    place(q, x, z);
    q.born = 0.001;
  }
}
function refreshField() {
  spawnAround(cur, NEIGHBORS);
  for (const q of reachable(cur)) spawnAround(q, 2);
  // 离得太远的、在身后的跳台沉下去
  for (const p of platforms) if (p !== cur && !p.dying && (Math.hypot(p.x - cur.x, p.z - cur.z) > 9 || p.z > cur.z + 4)) p.dying = 0.001;
}
// 离你最近、还没去过的跳台（电脑预览/测试用）
const nextPlatform = () => reachable(cur).sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z))[0] || null;

// ================= 游戏状态 =================
let state = 'idle';  // idle | charging | jumping | over
let score = 0, best = Number(loadPref('jump-best2', '0')) || 0, combo = 0;
let charge = 0, chargeMode = null, chargeT = 0, maxDepth = 0;
let tone = null;
let jump = null;
let crouchEnabled = loadPref('jump-crouch', '1') === '1';
let statusText = '';
let envWrap = new THREE.Vector3();
const effects = [];

function newGame() {
  if (!theme) return;
  for (const p of platforms) { course.remove(p.group); disposeTree(p.group); }
  platforms = [];
  score = 0; combo = 0;
  cur = buildPlatform(0.24);
  place(cur, 0, 0);
  cur.visited = true;
  pos.set(0, cur.h, 0);
  refreshField();
  for (const p of platforms) p.born = 0;
  overMsg.mesh.visible = false;
  envWrap.set(0, 0, 0);
  state = 'idle';
  stopCharge(false);
  jump = null;
  vignette.black.material.opacity = 0;
  updateWorld(0, 0);
  setStatus(crouchEnabled ? `${theme.name}：按住握把蹲下蓄力，松开起跳` : `${theme.name}：按住扳机蓄力`);
  sfx.click();
}
function disposeTree(o) {
  o.traverse((m) => {
    if (!m.isSprite) m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    mats.forEach((x) => x.dispose());
  });
}

// 让 pos（你在跳台坐标里的位置）对准你脚下：跳台组反向平移；背景也跟着动
function updateWorld(lift = 0, extraY = 0) {
  course.position.set(-pos.x, -pos.y + lift + extraY, -pos.z);
  envHolder.position.set(course.position.x + envWrap.x, course.position.y + surfaceY - 0.03, course.position.z + envWrap.z);
}

function startCharge(mode) {
  if (state !== 'idle') return;
  state = 'charging';
  chargeMode = mode;
  charge = 0; chargeT = 0; maxDepth = 0;
  tone = chargeTone();
}
function stopCharge(release = true) {
  tone?.stop();
  tone = null;
  if (state !== 'charging') return;
  if (release && charge > 0.02) doJump(charge);
  else { state = 'idle'; if (release && chargeMode === 'grip') setStatus('没蹲下去：按住握把、蹲下，再松开'); }
  chargeMode = null;
}
// 你面对的方向（跳台坐标里，水平）
function facingDir() {
  const f = app.presenting ? app.headForward(new THREE.Vector3()) : camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
  return f.applyAxisAngle(new THREE.Vector3(0, 1, 0), -world.rotation.y).setY(0).normalize();
}
const jumpDist = (power) => JUMP_MIN + power * (JUMP_MAX - JUMP_MIN);
function platformAt(x, z) {
  for (const p of platforms) if (!p.dying && contains(p, x, z)) return p;
  return null;
}
function setCharge(v) { charge = THREE.MathUtils.clamp(v, 0, 1); tone?.set(charge); }

// 往你面对的方向跳（试玩反馈：朝错了方向就会跳错）
function doJump(power, dirOverride = null) {
  const from = pos.clone();
  const dir = dirOverride ? dirOverride.clone().setY(0).normalize() : facingDir();
  const dist = jumpDist(power);
  const land = from.clone().addScaledVector(dir, dist);
  const target = platformAt(land.x, land.z);
  const next = target;
  const endY = target ? target.h : from.y;
  const T = 0.5 + dist * 0.07;
  const peak = 0.3 + dist * 0.12;
  // 背景往后退了很远：这次跳到最高点时眼前黑一下，悄悄把背景挪回来
  const wrapAt = WRAP[themeKey] || WRAP.default;
  const needWrap = Math.hypot(pos.x + envWrap.x, pos.z + envWrap.z) > wrapAt;
  jump = { from, land, dir, endY, T, t: 0, peak, target, next, needWrap, wrapped: false };
  state = 'jumping';
  if (theme.pawn === 'frog') sfx.croak(1.15); else sfx.jump();
  app.pulseAll(0.5, 40);
}

function finishLanding() {
  const t = jump.target;
  pos.set(jump.land.x, t.h, jump.land.z);
  sfx.land();
  app.pulseAll(0.7, 70);
  if (t !== cur && t.visited) {
    combo = 0;
    cur = t;
    refreshField();
    setStatus('跳回了去过的跳台（不加分）');
  } else if (t !== cur) {
    t.visited = true;
    const off = Math.hypot(jump.land.x - t.x, jump.land.z - t.z);
    let gained = 1, label = '+1';
    if (off <= Math.min(t.w, t.d) * PERFECT) {
      combo++;
      gained = 2 * combo;
      label = combo > 1 ? `靶心 ×${combo}  +${gained}` : `靶心 +${gained}`;
      sfx.perfect(combo);
      ripple(t.x, t.h + 0.01, t.z);
    } else combo = 0;
    if (t.bonus && t.coin) { gained += 5; label += '  金币 +5'; sfx.bonus(); t.coin.visible = false; t.coin = null; }
    score += gained;
    popup(label);
    cur = t;
    refreshField();
    setStatus(combo > 1 ? `连续靶心 ${combo} 次！` : '漂亮！继续');
  } else {
    setStatus('跳近了，还在原来的跳台上');
  }
  state = 'idle';
  jump = null;
}

// 没踩中：不放下坠动画（试玩反馈：太吓人），视野变暗，直接显示“你掉下去了”
function startFall() {
  combo = 0;
  state = 'over';
  jump = null;
  sfx.thud();
  app.pulseAll(0.6, 150);
  const record = score > best;
  if (record) { best = score; savePref('jump-best2', String(best)); }
  overMsg.redraw((ctx, w, h) => {
    roundRect(ctx, 6, 6, w - 12, h - 12, 50);
    ctx.fillStyle = 'rgba(18, 25, 44, 0.95)'; ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = '#ff8a8a'; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff'; ctx.font = `800 110px ${FONT}`;
    ctx.fillText('你掉下去了', w / 2, h * 0.32);
    ctx.fillStyle = '#f5b941'; ctx.font = `700 64px ${FONT}`;
    ctx.fillText(record ? `新纪录 ${score} 分！` : `得分 ${score} · 最佳 ${best}`, w / 2, h * 0.58);
    ctx.fillStyle = '#c9d3ea'; ctx.font = `600 46px ${FONT}`;
    ctx.fillText('按 A/X 或扳机再来一局', w / 2, h * 0.8);
  });
  overMsg.mesh.visible = true;
  setStatus(record ? `新纪录 ${score} 分！按 A/X 再来` : `掉下去了！得分 ${score}，按 A/X 再来`);
}
const overMsg = makeCanvasPlane(1.0, 0.5, 1000);
overMsg.mesh.position.set(0, 1.5, -1.3);
overMsg.mesh.material.depthTest = false;
overMsg.mesh.renderOrder = 1002;
overMsg.mesh.visible = false;
hud.add(overMsg.mesh);

// ================= 特效 =================
function ripple(x, y, z) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.08, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  course.add(m);
  effects.push({ t: 0, life: 0.7, update: (k) => { m.scale.setScalar(1 + k * 8); m.material.opacity = 0.9 * (1 - k); }, done: () => { course.remove(m); m.geometry.dispose(); m.material.dispose(); } });
}
function splashFx() {
  const n = 60, posA = new Float32Array(n * 3), vel = [];
  const c = new THREE.Vector3(jump.land.x, surfaceY + 0.02, jump.land.z);
  for (let i = 0; i < n; i++) {
    posA[i * 3] = c.x; posA[i * 3 + 1] = c.y; posA[i * 3 + 2] = c.z;
    const a = Math.random() * Math.PI * 2, s = Math.random() * 1.2;
    vel.push(new THREE.Vector3(Math.cos(a) * s, 2 + Math.random() * 2.5, Math.sin(a) * s));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTex, size: 0.12, color: '#e8f8ff', transparent: true, depthWrite: false }));
  course.add(pts);
  let last = 0;
  effects.push({
    t: 0, life: 1.2,
    update: (k, t) => {
      const dt = t - last; last = t;
      for (let i = 0; i < n; i++) { vel[i].y -= 9.8 * dt; posA[i * 3] += vel[i].x * dt; posA[i * 3 + 1] += vel[i].y * dt; posA[i * 3 + 2] += vel[i].z * dt; }
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = 1 - k;
    },
    done: () => { course.remove(pts); geo.dispose(); pts.material.dispose(); },
  });
}
function popup(text) {
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
  s.scale.set(0.8, 0.2, 1);
  s.position.set(0, 1.9, -1.6);
  hud.add(s);
  effects.push({ t: 0, life: 1.2, update: (k) => { s.position.y = 1.9 + k * 0.25; s.material.opacity = 1 - Math.max(0, k - 0.6) / 0.4; }, done: () => { hud.remove(s); tex.dispose(); s.material.dispose(); } });
}

// ================= 面板（在你左前方，不挡前面的跳台）=================
const panelGroup = new THREE.Group();
panelGroup.position.set(-1.1, 1.45, -1.3);
panelGroup.rotation.y = 0.65;
hud.add(panelGroup);
const panel = makeCanvasPlane(0.9, 0.36, 1100);
panelGroup.add(panel.mesh);
const uiButtons = [];
const mk = (label, x, y, color, onClick, w = 0.43) => {
  const b = makeButton(label, { width: w, height: 0.085, color, onClick });
  b.position.set(x, y, 0);
  panelGroup.add(b);
  uiButtons.push(b);
  return b;
};
mk('重新开始  A/X', -0.225, -0.25, '#3a5bd9', () => newGame());
mk('对准前方  B/Y', 0.225, -0.25, '#3a5bd9', () => placeInFront());
const crouchButton = mk('', -0.225, -0.35, '#2e5a46', () => toggleCrouch());
const comfortButton = mk('', 0.225, -0.35, '#2e5a46', () => toggleComfort());
const envButton = mk('背景：… ▶', -0.225, -0.45, '#5a4a2e', () => envs.next());
if (envs.label) envButton.userData.ui.setLabel(`背景：${envs.label} ▶`);
const aimButton = mk('', 0.225, -0.45, '#2e5a46', () => { aimHelp = !aimHelp; savePref('jump-aim', aimHelp ? '1' : '0'); refreshToggles(); });
let aimHelp = loadPref('jump-aim', '1') === '1';
{
  const exitButton = makeExitButton(app, { width: 0.43, height: 0.085 });
  exitButton.position.set(0, -0.55, 0);
  panelGroup.add(exitButton);
  uiButtons.push(exitButton);
}
function toggleCrouch() {
  crouchEnabled = !crouchEnabled;
  savePref('jump-crouch', crouchEnabled ? '1' : '0');
  refreshToggles();
}
function toggleComfort() {
  comfort = !comfort;
  savePref('jump-comfort', comfort ? '1' : '0');
  refreshToggles();
}
function refreshToggles() {
  crouchButton.userData.ui.setLabel(crouchEnabled ? '握把+蹲下：开' : '握把+蹲下：关');
  comfortButton.userData.ui.setLabel(comfort ? '防晕暗角：开' : '防晕暗角：关');
  aimButton?.userData.ui.setLabel(aimHelp ? '落点提示：开' : '落点提示：关');
}
refreshToggles();

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

// 把整个世界对准你：你脚下 = 当前跳台，前方 = 你面对的方向
let placeAfter = -1;
function placeInFront() {
  const head = app.headPosition(new THREE.Vector3());
  const f = app.headForward(new THREE.Vector3());
  if (!app.presenting) { head.set(0, 1.6, 0); f.set(0, 0, -1); }
  world.position.set(head.x, 0, head.z);
  world.rotation.y = Math.atan2(-f.x, -f.z);
  sfx.click();
}

// ================= 蹲下检测 =================
const headHist = [];
let clockT = 0;
let crouchArmed = true;
function standHeight() { return headHist.length ? Math.max(...headHist.map((h) => h[1])) : 1.6; }
// 按住握把时：蹲得越深蓄力越大，站起来就变小（随时可以反悔）；两只手的握把都松开才起跳
function updateCrouch(headY, dt) {
  clockT += dt;
  if (state !== 'charging') {
    headHist.push([clockT, headY]);
    while (headHist.length && clockT - headHist[0][0] > 2.5) headHist.shift();
  }
  if (state === 'charging' && chargeMode === 'grip') {
    const depth = standHeight() - headY;
    setCharge((depth - CROUCH_START) / (CROUCH_FULL - CROUCH_START));
  }
}
const gripHeld = () => app.controllers.some((c) => c.gripHeld);
app.on('squeeze', (c) => {
  initAudio();
  c.gripHeld = true;
  if (state === 'over') return;
  if (crouchEnabled && state === 'idle') startCharge('grip');
});
app.on('squeezeend', (c) => {
  c.gripHeld = false;
  if (!gripHeld() && state === 'charging' && chargeMode === 'grip') stopCharge(true);
});

// 蓄力圈：画在脚下
const chargeRing = new THREE.Mesh(
  new THREE.RingGeometry(0.28, 0.33, 64, 1, 0, 0.001),
  new THREE.MeshBasicMaterial({ color: '#5cffb0', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
);
chargeRing.rotation.x = -Math.PI / 2;
scene.add(chargeRing);

// 落点提示：从脚下沿你面对的方向画一条虚线，蓄力时末端的圆圈就是会落到的地方（试玩反馈：判断距离）
const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.7, depthWrite: false }));
aimLine.computeLineDistances();
course.add(aimLine);
const aimSpot = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
aimSpot.rotation.x = -Math.PI / 2;
course.add(aimSpot);
function updateAim() {
  const show = aimHelp && (state === 'idle' || state === 'charging') && !!theme;
  aimLine.visible = show;
  aimSpot.visible = show && state === 'charging';
  if (!show) return;
  const dir = facingDir();
  const len = state === 'charging' ? jumpDist(charge) : JUMP_MIN + 0.5;
  const a = new THREE.Vector3(pos.x, pos.y + 0.02, pos.z).addScaledVector(dir, 0.25);
  const b = new THREE.Vector3(pos.x, pos.y + 0.02, pos.z).addScaledVector(dir, len);
  const t = platformAt(b.x, b.z);
  if (t) b.y = t.h + 0.02; else b.y = surfaceY + 0.02;
  aimLine.geometry.setFromPoints([a, b]);
  aimLine.computeLineDistances();
  aimSpot.position.copy(b);
}

// ================= 每一帧 =================
const tmpHead = new THREE.Vector3(), tmpF = new THREE.Vector3();
function onFrame(dt) {
  uTime.value += dt;
  envs.update(dt);
  if (!theme) return;
  app.headPosition(tmpHead);
  app.headForward(tmpF);

  if (app.presenting) {
    if (placeAfter > 0) { placeAfter -= dt; if (placeAfter <= 0) placeInFront(); }
    updateCrouch(tmpHead.y, dt);
    updatePointers();
    app.pollButtons((c, bi) => {
      if (bi === 4) newGame();
      if (bi === 5) placeInFront();
    });
    feet.update(app.footPosition(new THREE.Vector3()), tmpF, 0.005, dt);
  } else {
    feet.hide();
    controls.update();
  }

  if (state === 'charging' && chargeMode !== 'grip') { chargeT += dt; setCharge(chargeT / TRIGGER_FULL); }
  if (state === 'charging' && Math.random() < dt * 20) app.pulseAll(0.1 + charge * 0.5, 20);

  // 新跳台从上面落下来，旧跳台沉下去消失
  for (let i = platforms.length - 1; i >= 0; i--) {
    const p = platforms[i];
    let y = 0;
    if (p.born > 0) {
      p.born += dt;
      const k = Math.min(p.born / 0.45, 1);
      y += (1 - k) * 2.5;
      if (k >= 1) p.born = 0;
    }
    if (p.dying > 0) {
      p.dying += dt;
      const k = Math.min(p.dying / 0.8, 1);
      y -= k * k * 1.5;
      if (k >= 1) { course.remove(p.group); disposeTree(p.group); platforms.splice(i, 1); continue; }
    }
    p.group.position.y = y;
    if (p.coin) p.coin.rotation.y += dt * 3;
  }

  // 起跳：你不动，世界往后退（还有上下的弧线）
  if (state === 'jumping') {
    jump.t += dt;
    const k = Math.min(jump.t / jump.T, 1);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // 先加速后减速
    pos.set(
      jump.from.x + (jump.land.x - jump.from.x) * e,
      THREE.MathUtils.lerp(jump.from.y, jump.endY, e),
      jump.from.z + (jump.land.z - jump.from.z) * e
    );
    const arc = 4 * jump.peak * k * (1 - k);
    updateWorld(0, -arc); // 你往上跳 = 世界往下沉
    if (jump.needWrap && !jump.wrapped && k > 0.4) {
      vignette.black.material.opacity = 1;
      envWrap.set(-pos.x, 0, -pos.z); // 背景悄悄挪回原点附近
      jump.wrapped = true;
    }
    if (k >= 1) {
      if (jump.target) finishLanding();
      else startFall();
    }
  } else if (state === 'charging' || state === 'idle') {
    updateWorld(0, 0);
  }
  if (state === 'over') vignette.black.material.opacity = Math.min(0.7, vignette.black.material.opacity + dt * 3);
  else if (vignette.black.material.opacity > 0) vignette.black.material.opacity = Math.max(0, vignette.black.material.opacity - dt * 5);
  const vWant = comfort && state === 'jumping' ? 0.9 : 0;
  updateAim();
  vignette.m.material.opacity += (vWant - vignette.m.material.opacity) * Math.min(1, dt * 10);

  // 脚下的蓄力圈
  chargeRing.visible = state === 'charging';
  if (chargeRing.visible) {
    chargeRing.geometry.dispose();
    chargeRing.geometry = new THREE.RingGeometry(0.28, 0.33, 64, 1, Math.PI / 2, Math.max(0.001, charge * Math.PI * 2));
    const fp = app.presenting ? app.footPosition(new THREE.Vector3()) : tmpHead;
    chargeRing.position.set(fp.x, 0.01, fp.z);
    chargeRing.material.color.setHSL(0.38 - charge * 0.38, 0.9, 0.6);
  }

  // 池塘和溪流里，青蛙时不时叫两声
  if (theme.pawn === 'frog' && envs.current) {
    croakTimer -= dt;
    if (croakTimer <= 0) { sfx.croak(0.85 + Math.random() * 0.4); croakTimer = 2.5 + Math.random() * 4; }
  }

  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    const k = Math.min(e.t / e.life, 1);
    e.update(k, e.t);
    if (k >= 1) { e.done?.(); effects.splice(i, 1); }
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

app.on('select', (c) => {
  initAudio();
  if (c.hover?.userData.ui) { app.pulse(c, 0.4, 30); c.hover.userData.ui.onClick?.(); return; }
  if (state === 'over') { newGame(); return; }
  if (chargeMode === 'grip') return;
  c.charging = true;
  startCharge('trigger');
});
app.on('selectend', (c) => {
  if (c.charging && chargeMode === 'trigger') stopCharge(true);
  c.charging = false;
});

// ================= 电脑上预览：第一人称 =================
camera.position.set(0, 1.6, 0.01);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, -3);
controls.enableDamping = true;
controls.enableZoom = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && !app.presenting) {
    e.preventDefault();
    initAudio();
    if (state === 'over') newGame();
    else startCharge('key');
  }
  if (e.key === 'Enter') newGame();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space' && chargeMode === 'key') stopCharge(true); });
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
  get cur() { return cur; }, get next() { return nextPlatform(); }, get pos() { return pos; }, get theme() { return themeKey; },
  get charge() { return charge; }, get platforms() { return platforms; },
  startCharge, stopCharge, setCharge, newGame, updateCrouch, doJump, camera, controls, envs, world, reachable, applyEnvOpacity,
  setAR(v) { isAR = v; applyEnvOpacity(); },
  jumpTo(p, power) { const d = new THREE.Vector3(p.x - pos.x, 0, p.z - pos.z); const dist = d.length(); doJump(power ?? (dist - JUMP_MIN) / (JUMP_MAX - JUMP_MIN), d); },
  idealPower() {
    const n = nextPlatform();
    const d = Math.hypot(n.x - pos.x, n.z - pos.z);
    return (d - JUMP_MIN) / (JUMP_MAX - JUMP_MIN);
  },
};
