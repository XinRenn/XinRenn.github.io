// 方塔消消的方块图案主题：全部用 canvas 画的原创卡通形象（不用任何现成的图片或角色）。
// 每个主题 12 种图案，每种有自己的底色，远远看也分得清。
import * as THREE from 'three';
import { iconMaterial } from '../link/icons.js';

export const TILE_THEMES = {
  classic: '经典图案',
  cats: '小猫',
  dogs: '小狗',
  forest: '森林小动物',
  ocean: '海洋小动物',
  sweets: '水果甜点',
};
// 跟随背景时用哪个主题
export const THEME_FOR_ENV = {
  meadow: 'forest', waterfall: 'forest', underwater: 'ocean', fjord: 'ocean',
  winter: 'sweets', harbor: 'dogs', london: 'dogs', japan: 'cats',
};

// 12 种底色（色相均匀分开）
const BG = ['#ffb3ba', '#ffdfba', '#fff5ba', '#c9f7c5', '#baffea', '#bae1ff', '#c7c3ff', '#f1c3ff', '#ffc9de', '#d8c3a5', '#b8e0d2', '#e2e2e2'];

// ---------- 画图小工具 ----------
function circ(g, x, y, r, c) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function ell(g, x, y, rx, ry, c, rot = 0) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); }
function tri(g, a, b, c, col) { g.fillStyle = col; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.lineTo(...c); g.closePath(); g.fill(); }
function eyes(g, x, y, sp, style = 'dot', r = 11) {
  for (const s of [-1, 1]) {
    const ex = x + s * sp;
    if (style === 'happy') {
      g.strokeStyle = '#2b2118'; g.lineWidth = 7; g.lineCap = 'round';
      g.beginPath(); g.arc(ex, y + 4, r * 0.9, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    } else if (style === 'big') {
      circ(g, ex, y, r * 1.9, '#ffffff'); circ(g, ex, y + 2, r * 1.15, '#2b2118'); circ(g, ex + 4, y - 3, r * 0.45, '#ffffff');
    } else {
      circ(g, ex, y, r, '#2b2118'); circ(g, ex + r * 0.35, y - r * 0.35, r * 0.38, '#ffffff');
    }
  }
}
function blush(g, x, y, sp) { for (const s of [-1, 1]) ell(g, x + s * sp, y, 14, 8, 'rgba(255,120,140,0.55)'); }
function catMouth(g, x, y) {
  g.strokeStyle = '#2b2118'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.arc(x - 9, y, 9, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
  g.beginPath(); g.arc(x + 9, y, 9, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
}
function smile(g, x, y, w = 16) { g.strokeStyle = '#2b2118'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.arc(x, y - w * 0.4, w, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); }
function nose(g, x, y, c = '#3a2a22', w = 12) { g.fillStyle = c; g.beginPath(); g.moveTo(x - w, y - 5); g.quadraticCurveTo(x, y - 9, x + w, y - 5); g.quadraticCurveTo(x + 2, y + 9, x, y + 9); g.quadraticCurveTo(x - 2, y + 9, x - w, y - 5); g.fill(); }

// ---------- 通用动物脸 ----------
// o: { face, ear, earIn, muzzle, mark, markC, eye, noseC, extra, mouth }
function face(g, o) {
  const X = 128, Y = 140, R = 74;
  const fc = o.face;
  // 耳朵（画在脸后面）
  const e = o.ear;
  if (e === 'cat' || e === 'fox' || e === 'big') {
    const w = e === 'big' ? 40 : e === 'fox' ? 34 : 30, hgt = e === 'big' ? 78 : e === 'fox' ? 72 : 60, spread = e === 'big' ? 70 : 52;
    for (const s of [-1, 1]) {
      const bx = X + s * spread, by = Y - 44;
      tri(g, [bx - w, by + 18], [bx + s * (e === 'big' ? 34 : 10), by - hgt], [bx + w, by + 18], fc);
      tri(g, [bx - w * 0.5, by + 10], [bx + s * (e === 'big' ? 26 : 8), by - hgt * 0.72], [bx + w * 0.5, by + 10], o.earIn || '#ffb3c1');
      if (e === 'fox') tri(g, [bx - w * 0.28 + s * 4, by - hgt * 0.6], [bx + s * 10, by - hgt], [bx + w * 0.28 + s * 8, by - hgt * 0.6], '#3a2a22');
    }
  } else if (e === 'round') {
    for (const s of [-1, 1]) { circ(g, X + s * 58, Y - 58, 26, o.earC || fc); circ(g, X + s * 58, Y - 58, 14, o.earIn || '#e8a0a0'); }
  } else if (e === 'mouse') {
    for (const s of [-1, 1]) { circ(g, X + s * 64, Y - 56, 36, fc); circ(g, X + s * 64, Y - 56, 22, o.earIn || '#ffb3c1'); }
  } else if (e === 'floppy') {
    for (const s of [-1, 1]) ell(g, X + s * 70, Y - 6, 22, 46, o.earC || fc, s * 0.35);
  } else if (e === 'long') {
    for (const s of [-1, 1]) { ell(g, X + s * 28, Y - 92, 18, 52, fc, s * 0.12); ell(g, X + s * 28, Y - 88, 9, 38, o.earIn || '#ffb3c1', s * 0.12); }
  } else if (e === 'antler') {
    g.strokeStyle = '#8a5a34'; g.lineWidth = 9; g.lineCap = 'round';
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(X + s * 30, Y - 60); g.lineTo(X + s * 46, Y - 112); g.moveTo(X + s * 40, Y - 92); g.lineTo(X + s * 66, Y - 104); g.stroke();
      ell(g, X + s * 68, Y - 40, 24, 12, fc, s * -0.4);
    }
  } else if (e === 'tuft') {
    for (const s of [-1, 1]) tri(g, [X + s * 30, Y - 60], [X + s * 66, Y - 98], [X + s * 66, Y - 46], o.earC || fc);
  } else if (e === 'frog') {
    for (const s of [-1, 1]) circ(g, X + s * 40, Y - 62, 30, fc);
  }
  if (o.extra === 'spikes') {
    g.fillStyle = '#7a5a3c';
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * (0.95 + i * 1.1 / 13);
      const x1 = X + Math.cos(a - 0.12) * R, y1 = Y + Math.sin(a - 0.12) * R, x2 = X + Math.cos(a + 0.12) * R, y2 = Y + Math.sin(a + 0.12) * R;
      tri(g, [x1, y1], [X + Math.cos(a) * (R + 30), Y + Math.sin(a) * (R + 30)], [x2, y2], '#7a5a3c');
    }
  }
  // 脸
  ell(g, X, Y, R, R * 0.9, fc);
  // 花纹（只画在脸里面）
  g.save(); g.beginPath(); g.ellipse(X, Y, R, R * 0.9, 0, 0, Math.PI * 2); g.clip();
  const mc = o.markC || '#3a2a22';
  if (o.mark === 'stripes') { g.strokeStyle = mc; g.lineWidth = 8; g.lineCap = 'round'; for (const dx of [-16, 0, 16]) { g.beginPath(); g.moveTo(X + dx, Y - 64); g.lineTo(X + dx, Y - 40); g.stroke(); } for (const s of [-1, 1]) { g.beginPath(); g.moveTo(X + s * 74, Y - 4); g.lineTo(X + s * 52, Y); g.stroke(); } }
  if (o.mark === 'patch') ell(g, X + 34, Y - 30, 42, 36, mc, 0.4);
  if (o.mark === 'patch2') { ell(g, X - 40, Y - 40, 44, 34, mc, -0.3); ell(g, X + 50, Y - 30, 34, 30, o.markC2 || '#3a2a22', 0.3); }
  if (o.mark === 'mask') ell(g, X, Y - 4, R, 26, mc);
  if (o.mark === 'lower') ell(g, X, Y + 46, R * 0.9, 52, mc);
  if (o.mark === 'blaze') { ell(g, X, Y + 40, 52, 46, mc); ell(g, X, Y - 30, 12, 40, mc); }
  if (o.mark === 'spots') for (const [dx, dy, r] of [[-40, -40, 12], [36, -50, 9], [50, 10, 11], [-56, 16, 8], [10, -66, 7], [-20, 50, 8]]) circ(g, X + dx, Y + dy, r, mc);
  if (o.mark === 'cap') ell(g, X, Y - 70, R, 44, mc);
  g.restore();
  if (o.mark === 'panda') for (const s of [-1, 1]) ell(g, X + s * 30, Y - 8, 20, 26, '#2b2118', s * -0.5);
  if (o.mark === 'owl') for (const s of [-1, 1]) circ(g, X + s * 30, Y - 10, 30, o.markC || '#fff4e0');
  // 嘴巴周围
  if (o.muzzle) ell(g, X, Y + 26, 34, 26, o.muzzle);
  // 眼睛
  eyes(g, X, Y - 10, o.eyeSp || 30, o.eye || 'dot', o.eyeR || 11);
  if (o.mark === 'panda') for (const s of [-1, 1]) circ(g, X + s * 30 + 3, Y - 13, 4, '#ffffff');
  if (!o.noBlush) blush(g, X, Y + 18, 50);
  // 鼻子 / 嘴
  if (o.beak) tri(g, [X - 12, Y + 10], [X + 12, Y + 10], [X, Y + 32], o.beak);
  else if (o.mouth === 'frog') smile(g, X, Y + 24, 34);
  else {
    nose(g, X, Y + 14, o.noseC || '#3a2a22', o.noseW || 11);
    if (o.mouth === 'cat') catMouth(g, X, Y + 24);
    else smile(g, X, Y + 30, 12);
  }
  if (o.extra === 'tongue') ell(g, X, Y + 44, 9, 12, '#ff7b9c');
  if (o.extra === 'whiskers') { g.strokeStyle = '#2b2118'; g.lineWidth = 3; for (const s of [-1, 1]) for (const dy of [-6, 6]) { g.beginPath(); g.moveTo(X + s * 30, Y + 22 + dy); g.lineTo(X + s * 70, Y + 18 + dy * 2); g.stroke(); } }
  if (o.extra === 'beard') ell(g, X, Y + 50, 30, 22, o.beardC || '#d9d9d9');
  if (o.extra === 'bow') { tri(g, [X + 40, Y - 64], [X + 74, Y - 84], [X + 74, Y - 44], '#ff5d8f'); tri(g, [X + 40, Y - 64], [X + 6, Y - 84], [X + 6, Y - 44], '#ff5d8f'); circ(g, X + 40, Y - 64, 10, '#ff3d77'); }
  if (o.extra === 'bell') { g.fillStyle = '#e63946'; g.fillRect(X - 50, Y + 58, 100, 12); circ(g, X, Y + 76, 13, '#ffd166'); g.fillStyle = '#7a5a00'; g.fillRect(X - 7, Y + 76, 14, 3); }
  if (o.extra === 'collar') { g.fillStyle = '#3a86ff'; g.fillRect(X - 50, Y + 60, 100, 12); circ(g, X, Y + 76, 11, '#ffd166'); }
  if (o.extra === 'fluff') for (let i = 0; i < 7; i++) circ(g, X - 48 + i * 16, Y - 70, 16, fc);
  if (o.extra === 'leaf') { ell(g, X + 14, Y - 82, 14, 8, '#5aa469', -0.6); }
  if (o.extra === 'crest') { tri(g, [X - 8, Y - 64], [X + 2, Y - 98], [X + 8, Y - 64], fc); tri(g, [X + 2, Y - 66], [X + 22, Y - 92], [X + 16, Y - 62], fc); }
}

const CATS = [
  { face: '#f4a259', mark: 'stripes', markC: '#d17a2a', mouth: 'cat', extra: 'whiskers', ear: 'cat' },
  { face: '#9aa0a8', mark: 'stripes', markC: '#6c727a', mouth: 'cat', extra: 'bell', ear: 'cat' },
  { face: '#ffffff', mouth: 'cat', extra: 'bow', ear: 'cat', eye: 'big' },
  { face: '#2f2f35', muzzle: '#ffffff', mouth: 'cat', ear: 'cat', earIn: '#ff9fb3', noseC: '#ff8fa3' },
  { face: '#fff6e8', mark: 'patch2', markC: '#f4a259', markC2: '#2f2f35', mouth: 'cat', ear: 'cat' },
  { face: '#f3e3c3', mark: 'mask', markC: '#7a5a44', mouth: 'cat', ear: 'cat', earIn: '#7a5a44', eye: 'big' },
  { face: '#c8a27a', mouth: 'cat', eye: 'happy', ear: 'cat', extra: 'whiskers' },
  { face: '#2f2f35', mouth: 'cat', ear: 'cat', earIn: '#555', eye: 'big', noseC: '#ff8fa3', noBlush: true },
  { face: '#e9e9ee', mark: 'patch', markC: '#9aa0a8', mouth: 'cat', ear: 'cat', extra: 'collar' },
  { face: '#f7c59f', mouth: 'cat', ear: 'cat', eye: 'happy', extra: 'bow' },
  { face: '#8d6e63', mark: 'stripes', markC: '#5d4037', mouth: 'cat', ear: 'cat', eye: 'big' },
  { face: '#ffe8a3', muzzle: '#ffffff', mouth: 'cat', ear: 'cat', extra: 'bell', eye: 'happy' },
];
const DOGS = [
  { face: '#e8964a', mark: 'lower', markC: '#ffffff', ear: 'cat', earIn: '#ffffff', extra: 'tongue' },             // 柴犬样
  { face: '#d9b48f', mark: 'mask', markC: '#3a2a22', ear: 'floppy', earC: '#3a2a22', eye: 'big' },                // 八哥样
  { face: '#ffffff', mark: 'spots', ear: 'floppy', earC: '#2b2118', extra: 'collar' },                              // 斑点
  { face: '#8f98a3', mark: 'lower', markC: '#ffffff', ear: 'cat', earIn: '#ffffff', eye: 'big' },                  // 雪橇犬样
  { face: '#c6863e', mark: 'blaze', markC: '#ffffff', ear: 'floppy', earC: '#5b3a20', extra: 'tongue' },           // 小猎犬样
  { face: '#f1e4d3', ear: 'round', earC: '#f1e4d3', earIn: '#f1e4d3', extra: 'fluff', eye: 'happy' },               // 卷毛
  { face: '#e8b765', ear: 'floppy', earC: '#d39a3f', extra: 'tongue', eye: 'happy' },                               // 金毛样
  { face: '#3a3a40', ear: 'floppy', earC: '#2b2b30', muzzle: '#55555c', extra: 'collar', noBlush: true },           // 黑狗
  { face: '#e6c49f', ear: 'big', earIn: '#f4a7b9', eye: 'big' },                                                    // 大耳朵小狗
  { face: '#9ea3a8', ear: 'floppy', earC: '#6e7378', extra: 'beard', beardC: '#e6e6e6' },                           // 胡子狗
  { face: '#ffffff', mark: 'patch', markC: '#c6863e', ear: 'floppy', earC: '#c6863e', muzzle: '#ffe0e6' },          // 白底花斑
  { face: '#fbfbfb', ear: 'cat', earIn: '#ffd6e0', extra: 'fluff', eye: 'happy', mouth: 'cat' },                     // 白色大毛团
];
const FOREST = [
  { face: '#a0714f', ear: 'round', muzzle: '#e3c4a8' },                                                            // 熊
  { face: '#f08a3c', ear: 'fox', earIn: '#ffffff', mark: 'lower', markC: '#ffffff', eye: 'happy' },                // 狐狸
  { face: '#f3eee8', ear: 'long', eye: 'big', mouth: 'cat' },                                                       // 兔子
  { face: '#9c7b5c', ear: 'tuft', mark: 'owl', markC: '#f6e7c8', eye: 'big', eyeR: 10, beak: '#f4a259', noBlush: true }, // 猫头鹰
  { face: '#7ccf6a', ear: 'frog', mouth: 'frog', eyeSp: 40, eye: 'big' },                                           // 青蛙
  { face: '#9aa0a8', ear: 'cat', earIn: '#3a3a40', mark: 'mask', markC: '#3a3a40', muzzle: '#ffffff' },            // 浣熊
  { face: '#c8925a', ear: 'antler', muzzle: '#f2dcc3', eye: 'big' },                                                // 小鹿
  { face: '#f0d9bf', extra: 'spikes', ear: 'none', eye: 'dot' },                                                    // 刺猬
  { face: '#d0773a', ear: 'tuft', earC: '#d0773a', muzzle: '#f6dcc0', extra: 'leaf' },                              // 松鼠
  { face: '#b9b9c2', ear: 'mouse', extra: 'whiskers', eye: 'big', noseC: '#ff8fa3', noseW: 8 },                    // 小老鼠
  { face: '#ffffff', ear: 'round', earC: '#2b2118', earIn: '#2b2118', mark: 'panda' },                              // 熊猫
  { face: '#ffd84d', ear: 'none', beak: '#f08a3c', extra: 'crest', eye: 'dot' },                                     // 小鸡
];

// ---------- 海洋 ----------
const OCEAN = [
  (g) => { ell(g, 118, 132, 64, 44, '#ff9f43'); tri(g, [176, 132], [222, 96], [222, 168], '#ff9f43'); g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.beginPath(); g.moveTo(130, 96); g.lineTo(130, 168); g.stroke(); eyes(g, 92, 122, 0.1, 'dot', 11); smile(g, 80, 148, 8); }, // 小鱼
  (g) => { for (let i = 0; i < 6; i++) { const x = 68 + i * 24; ell(g, x, 180, 11, 34, '#c77dff', (i - 2.5) * 0.15); } circ(g, 128, 112, 62, '#c77dff'); eyes(g, 128, 112, 24, 'big', 9); blush(g, 128, 136, 42); smile(g, 128, 146, 10); }, // 章鱼
  (g) => { ell(g, 128, 148, 66, 46, '#ff595e'); for (const s of [-1, 1]) { circ(g, 128 + s * 74, 92, 26, '#ff595e'); tri(g, [128 + s * 74, 92], [128 + s * 100, 64], [128 + s * 92, 98], BG[2]); g.strokeStyle = '#ff595e'; g.lineWidth = 9; g.beginPath(); g.moveTo(128 + s * 50, 128); g.lineTo(128 + s * 70, 110); g.stroke(); for (const k of [0, 1, 2]) { g.beginPath(); g.moveTo(128 + s * 50, 160 + k * 10); g.lineTo(128 + s * 92, 176 + k * 14); g.stroke(); } } eyes(g, 128, 126, 22, 'dot', 10); blush(g, 128, 150, 40); smile(g, 128, 160, 10); }, // 螃蟹
  (g) => { ell(g, 124, 138, 80, 56, '#4d96ff'); ell(g, 124, 160, 60, 30, '#a5d8ff'); tri(g, [196, 130], [232, 100], [226, 150], '#4d96ff'); g.strokeStyle = '#a5d8ff'; g.lineWidth = 6; g.beginPath(); g.moveTo(112, 80); g.quadraticCurveTo(104, 52, 92, 60); g.moveTo(112, 80); g.quadraticCurveTo(120, 50, 132, 58); g.stroke(); eyes(g, 92, 128, 0.1, 'dot', 10); blush(g, 100, 150, 0.1); }, // 鲸鱼
  (g) => { for (const [x, y] of [[74, 178], [182, 178], [74, 104], [182, 104]]) ell(g, x, y, 22, 14, '#8bd17c'); circ(g, 216, 140, 26, '#8bd17c'); ell(g, 128, 140, 70, 54, '#6a994e'); for (const [x, y] of [[104, 124], [152, 124], [128, 160], [104, 156], [152, 156], [128, 118]]) circ(g, x, y, 12, '#90be6d'); eyes(g, 224, 134, 0.1, 'dot', 7); }, // 海龟
  (g) => { g.fillStyle = '#ffb703'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 36 : 86, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(128 + Math.cos(a) * r, 140 + Math.sin(a) * r); } g.closePath(); g.fill(); eyes(g, 128, 132, 16, 'dot', 8); blush(g, 128, 150, 30); smile(g, 128, 156, 8); }, // 海星
  (g) => { g.fillStyle = '#ff8fab'; g.beginPath(); g.arc(128, 120, 66, Math.PI, 0); g.closePath(); g.fill(); g.strokeStyle = '#ff8fab'; g.lineWidth = 8; g.lineCap = 'round'; for (let i = 0; i < 5; i++) { const x = 82 + i * 23; g.beginPath(); g.moveTo(x, 122); g.quadraticCurveTo(x + 12, 160, x - 4, 210); g.stroke(); } eyes(g, 128, 98, 22, 'happy', 10); blush(g, 128, 112, 40); }, // 水母
  (g) => { circ(g, 128, 136, 70, '#ffd166'); g.fillStyle = '#e09f3e'; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; tri(g, [128 + Math.cos(a - 0.12) * 68, 136 + Math.sin(a - 0.12) * 68], [128 + Math.cos(a) * 88, 136 + Math.sin(a) * 88], [128 + Math.cos(a + 0.12) * 68, 136 + Math.sin(a + 0.12) * 68], '#e09f3e'); } eyes(g, 128, 124, 26, 'big', 9); ell(g, 128, 160, 12, 9, '#e07a5f'); }, // 河豚
  (g) => { g.fillStyle = '#fffaf5'; g.beginPath(); g.moveTo(128, 196); for (let i = 0; i <= 8; i++) { const a = Math.PI + i * Math.PI / 8; g.lineTo(128 + Math.cos(a) * 86, 150 + Math.sin(a) * 90); } g.closePath(); g.fill(); g.strokeStyle = '#f497b6'; g.lineWidth = 6; for (let i = 1; i < 8; i++) { const a = Math.PI + i * Math.PI / 8; g.beginPath(); g.moveTo(128, 192); g.lineTo(128 + Math.cos(a) * 80, 150 + Math.sin(a) * 84); g.stroke(); } circ(g, 128, 120, 15, '#bde0fe'); circ(g, 124, 116, 5, '#ffffff'); }, // 贝壳+珍珠
  (g) => { ell(g, 128, 150, 72, 58, '#adb5bd'); ell(g, 128, 168, 34, 22, '#dee2e6'); eyes(g, 128, 136, 30, 'big', 9); nose(g, 128, 162, '#343a40', 10); g.strokeStyle = '#495057'; g.lineWidth = 3; for (const s of [-1, 1]) for (const dy of [-5, 5]) { g.beginPath(); g.moveTo(128 + s * 24, 170 + dy); g.lineTo(128 + s * 60, 166 + dy * 2); g.stroke(); } }, // 海豹
  (g) => { ell(g, 128, 146, 64, 74, '#2b2d42'); ell(g, 128, 160, 44, 56, '#ffffff'); eyes(g, 128, 120, 20, 'dot', 9); tri(g, [116, 138], [140, 138], [128, 152], '#ffb703'); for (const s of [-1, 1]) ell(g, 128 + s * 26, 220, 16, 8, '#ffb703'); blush(g, 128, 142, 34); }, // 企鹅
  (g) => { g.fillStyle = '#5fa8d3'; g.beginPath(); g.moveTo(40, 160); g.quadraticCurveTo(80, 70, 180, 104); g.quadraticCurveTo(230, 118, 220, 140); g.quadraticCurveTo(190, 150, 150, 166); g.quadraticCurveTo(100, 186, 40, 160); g.fill(); tri(g, [120, 100], [150, 60], [154, 104], '#5fa8d3'); tri(g, [52, 156], [24, 124], [30, 182], '#5fa8d3'); ell(g, 160, 150, 40, 12, '#cae9ff'); eyes(g, 182, 124, 0.1, 'dot', 8); smile(g, 204, 140, 10); }, // 海豚
];

// ---------- 水果甜点 ----------
function cuteFace(g, x, y, sp = 18, r = 8) { eyes(g, x, y, sp, 'dot', r); blush(g, x, y + 14, sp + 14); smile(g, x, y + 18, 7); }
const SWEETS = [
  (g) => { g.fillStyle = '#ff4d6d'; g.beginPath(); g.moveTo(128, 214); g.bezierCurveTo(40, 160, 50, 70, 128, 80); g.bezierCurveTo(206, 70, 216, 160, 128, 214); g.fill(); for (const [x, y] of [[100, 120], [150, 116], [124, 150], [92, 160], [162, 158], [128, 186]]) ell(g, x, y, 4, 6, '#fff3b0'); for (let i = 0; i < 5; i++) ell(g, 128 + (i - 2) * 20, 80, 22, 10, '#52b788', (i - 2) * 0.5); cuteFace(g, 128, 128); }, // 草莓
  (g) => { g.strokeStyle = '#2d6a4f'; g.lineWidth = 7; g.beginPath(); g.moveTo(96, 150); g.quadraticCurveTo(120, 60, 150, 50); g.moveTo(166, 156); g.quadraticCurveTo(160, 90, 150, 50); g.stroke(); ell(g, 156, 52, 24, 10, '#52b788', -0.4); circ(g, 92, 168, 40, '#d00000'); circ(g, 168, 172, 40, '#d00000'); cuteFace(g, 92, 166, 14, 6); cuteFace(g, 168, 170, 14, 6); }, // 樱桃
  (g) => { g.fillStyle = '#2d6a4f'; g.beginPath(); g.arc(128, 96, 100, 0.15 * Math.PI, 0.85 * Math.PI); g.closePath(); g.fill(); g.fillStyle = '#ff6b6b'; g.beginPath(); g.arc(128, 96, 86, 0.15 * Math.PI, 0.85 * Math.PI); g.closePath(); g.fill(); for (const [x, y] of [[96, 140], [128, 150], [160, 140], [112, 168], [146, 168]]) ell(g, x, y, 4, 7, '#2b2118'); cuteFace(g, 128, 118, 22, 8); }, // 西瓜
  (g) => { circ(g, 128, 136, 78, '#e9b872'); g.fillStyle = '#ff8fab'; g.beginPath(); for (let i = 0; i <= 24; i++) { const a = i * Math.PI / 12, r = 66 + (i % 2) * 8; g.lineTo(128 + Math.cos(a) * r, 136 + Math.sin(a) * r * 0.95); } g.closePath(); g.fill(); circ(g, 128, 136, 26, BG[3]); for (const [x, y, c] of [[90, 100, '#ffd166'], [160, 96, '#4dabf7'], [176, 150, '#52b788'], [96, 176, '#ffffff'], [140, 186, '#ffd166'], [72, 140, '#4dabf7']]) { g.fillStyle = c; g.save(); g.translate(x, y); g.rotate(x * 0.1); g.fillRect(-9, -3, 18, 6); g.restore(); } }, // 甜甜圈
  (g) => { g.fillStyle = '#e9b872'; g.beginPath(); g.moveTo(66, 140); g.lineTo(190, 140); g.lineTo(172, 214); g.lineTo(84, 214); g.closePath(); g.fill(); g.strokeStyle = '#c99652'; g.lineWidth = 5; for (let x = 92; x < 180; x += 20) { g.beginPath(); g.moveTo(x, 144); g.lineTo(x - 4 + (x - 128) * 0.12, 210); g.stroke(); } for (const [x, y, r] of [[96, 130, 34], [160, 130, 34], [128, 108, 40], [128, 80, 26]]) circ(g, x, y, r, '#ffc8dd'); circ(g, 128, 54, 14, '#d00000'); cuteFace(g, 128, 120, 20, 7); }, // 纸杯蛋糕
  (g) => { tri(g, [84, 128], [172, 128], [128, 226], '#e9b872'); g.strokeStyle = '#c99652'; g.lineWidth = 4; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(92 + i * 22, 128); g.lineTo(128 + (i - 1.5) * 6, 210); g.stroke(); } circ(g, 128, 104, 52, '#bde0fe'); circ(g, 128, 64, 34, '#ffafcc'); cuteFace(g, 128, 104, 18, 7); }, // 冰淇淋
  (g) => { g.fillStyle = '#ffe5b4'; g.beginPath(); g.moveTo(40, 180); g.lineTo(200, 120); g.lineTo(212, 160); g.lineTo(212, 200); g.lineTo(40, 210); g.closePath(); g.fill(); g.fillStyle = '#ff8fab'; g.beginPath(); g.moveTo(40, 180); g.lineTo(200, 120); g.lineTo(206, 140); g.lineTo(40, 196); g.closePath(); g.fill(); g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(40, 172); g.lineTo(200, 108); g.lineTo(200, 124); g.lineTo(40, 184); g.closePath(); g.fill(); circ(g, 180, 98, 14, '#d00000'); cuteFace(g, 130, 172, 18, 7); }, // 蛋糕
  (g) => { g.fillStyle = '#f4f1de'; g.fillRect(122, 140, 12, 90); circ(g, 128, 112, 64, '#ffffff'); g.lineWidth = 14; const cs = ['#ff4d6d', '#4dabf7', '#ffd166', '#52b788']; for (let i = 0; i < 4; i++) { g.strokeStyle = cs[i]; g.beginPath(); g.arc(128, 112, 14 + i * 14, i, i + 4.2); g.stroke(); } }, // 棒棒糖
  (g) => { ell(g, 128, 94, 74, 34, '#b8f2e6'); ell(g, 128, 176, 74, 34, '#b8f2e6'); g.fillStyle = '#fff1e6'; g.fillRect(58, 120, 140, 30); ell(g, 128, 120, 70, 12, '#fff1e6'); cuteFace(g, 128, 168, 20, 7); }, // 马卡龙
  (g) => { g.fillStyle = '#ffd166'; g.beginPath(); g.moveTo(70, 210); g.lineTo(90, 92); g.lineTo(166, 92); g.lineTo(186, 210); g.closePath(); g.fill(); ell(g, 128, 92, 38, 14, '#7f4f24'); g.fillStyle = '#7f4f24'; g.beginPath(); g.moveTo(90, 92); g.quadraticCurveTo(84, 120, 96, 118); g.quadraticCurveTo(110, 130, 120, 104); g.lineTo(166, 92); g.closePath(); g.fill(); ell(g, 128, 212, 64, 10, '#ffffff'); cuteFace(g, 128, 156, 20, 8); }, // 布丁
  (g) => { circ(g, 128, 136, 84, '#ff9f1c'); circ(g, 128, 136, 72, '#ffd6a5'); g.strokeStyle = '#ffffff'; g.lineWidth = 5; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(128, 136); g.lineTo(128 + Math.cos(a) * 70, 136 + Math.sin(a) * 70); g.stroke(); } circ(g, 128, 136, 34, '#ffbf69'); cuteFace(g, 128, 130, 14, 6); }, // 橙子片
  (g) => { g.strokeStyle = '#6a4c2c'; g.lineWidth = 7; g.beginPath(); g.moveTo(128, 70); g.lineTo(128, 46); g.stroke(); ell(g, 148, 52, 20, 9, '#52b788', -0.3); for (const [x, y] of [[100, 84], [128, 80], [156, 84], [86, 114], [114, 112], [142, 112], [170, 114], [100, 142], [128, 142], [156, 142], [114, 170], [142, 170], [128, 198]]) circ(g, x, y, 17, '#8e44ad'); for (const [x, y] of [[96, 80], [124, 76], [152, 80]]) circ(g, x, y, 4, 'rgba(255,255,255,0.6)'); cuteFace(g, 128, 136, 18, 7); }, // 葡萄
];

const DRAWERS = {
  cats: (g, i) => face(g, CATS[i % CATS.length]),
  dogs: (g, i) => face(g, DOGS[i % DOGS.length]),
  forest: (g, i) => face(g, FOREST[i % FOREST.length]),
  ocean: (g, i) => OCEAN[i % OCEAN.length](g),
  sweets: (g, i) => SWEETS[i % SWEETS.length](g),
};

const cache = new Map();
export function themeMaterial(theme, i) {
  if (theme === 'classic' || !DRAWERS[theme]) return iconMaterial(i);
  const k = theme + i;
  if (cache.has(k)) return cache.get(k);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = BG[i % BG.length];
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 12;
  g.strokeRect(10, 10, 236, 236);
  g.lineJoin = 'round';
  DRAWERS[theme](g, i);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: '#000000' });
  cache.set(k, m);
  return m;
}
