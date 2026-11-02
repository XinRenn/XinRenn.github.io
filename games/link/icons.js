// 方块上的图案：全部用 canvas 画出来（不依赖表情字体）。每种图案有自己的底色，方便区分。
import * as THREE from 'three';

const ICONS = [
  { name: 'star', bg: '#ffd166', fg: '#e76f00' },
  { name: 'heart', bg: '#ffadc6', fg: '#e5383b' },
  { name: 'moon', bg: '#3d5a80', fg: '#ffe8a3' },
  { name: 'sun', bg: '#ffb703', fg: '#fff3b0' },
  { name: 'leaf', bg: '#b7e4c7', fg: '#2d6a4f' },
  { name: 'drop', bg: '#a2d2ff', fg: '#1d4e89' },
  { name: 'flower', bg: '#e0c3fc', fg: '#7b2cbf' },
  { name: 'fish', bg: '#90e0ef', fg: '#f77f00' },
  { name: 'bolt', bg: '#2b2d42', fg: '#ffd60a' },
  { name: 'note', bg: '#f1faee', fg: '#1d3557' },
  { name: 'crown', bg: '#7209b7', fg: '#ffd166' },
  { name: 'cherry', bg: '#fcd5ce', fg: '#c1121f' },
  { name: 'diamond', bg: '#caf0f8', fg: '#0077b6' },
  { name: 'cloud', bg: '#4ea8de', fg: '#ffffff' },
  { name: 'mushroom', bg: '#d8f3dc', fg: '#d00000' },
  { name: 'tree', bg: '#ffe5b4', fg: '#386641' },
];
export const ICON_COUNT = ICONS.length;

function star(g, cx, cy, r1, r2, n = 5) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1, a = -Math.PI / 2 + (i * Math.PI) / n;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
}

const DRAW = {
  star: (g) => star(g, 64, 68, 44, 18),
  heart: (g) => {
    g.beginPath();
    g.moveTo(64, 104);
    g.bezierCurveTo(10, 66, 22, 18, 64, 42);
    g.bezierCurveTo(106, 18, 118, 66, 64, 104);
    g.fill();
  },
  moon: (g, bg) => {
    g.beginPath(); g.arc(60, 64, 40, 0, Math.PI * 2); g.fill();
    g.fillStyle = bg; g.beginPath(); g.arc(80, 52, 36, 0, Math.PI * 2); g.fill();
  },
  sun: (g) => {
    g.beginPath(); g.arc(64, 64, 24, 0, Math.PI * 2); g.fill();
    g.lineWidth = 8; g.lineCap = 'round'; g.strokeStyle = g.fillStyle;
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; g.beginPath(); g.moveTo(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34); g.lineTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50); g.stroke(); }
  },
  leaf: (g) => {
    g.beginPath(); g.moveTo(26, 102); g.quadraticCurveTo(20, 24, 104, 22); g.quadraticCurveTo(104, 104, 26, 102); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 5; g.beginPath(); g.moveTo(30, 98); g.lineTo(96, 30); g.stroke();
  },
  drop: (g) => { g.beginPath(); g.moveTo(64, 16); g.bezierCurveTo(70, 40, 100, 62, 100, 82); g.arc(64, 82, 36, 0, Math.PI); g.bezierCurveTo(28, 62, 58, 40, 64, 16); g.fill(); },
  flower: (g) => {
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; g.beginPath(); g.ellipse(64 + Math.cos(a) * 24, 64 + Math.sin(a) * 24, 18, 14, a, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#ffd166'; g.beginPath(); g.arc(64, 64, 14, 0, Math.PI * 2); g.fill();
  },
  fish: (g) => {
    g.beginPath(); g.ellipse(58, 64, 36, 22, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(88, 64); g.lineTo(114, 42); g.lineTo(114, 86); g.closePath(); g.fill();
    g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(40, 58, 5, 0, Math.PI * 2); g.fill();
  },
  bolt: (g) => { g.beginPath(); g.moveTo(74, 12); g.lineTo(30, 72); g.lineTo(60, 72); g.lineTo(50, 116); g.lineTo(98, 52); g.lineTo(66, 52); g.closePath(); g.fill(); },
  note: (g) => {
    g.beginPath(); g.ellipse(46, 92, 16, 12, -0.4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(90, 82, 16, 12, -0.4, 0, Math.PI * 2); g.fill();
    g.fillRect(56, 30, 8, 62); g.fillRect(100, 20, 8, 62);
    g.beginPath(); g.moveTo(56, 30); g.lineTo(108, 20); g.lineTo(108, 36); g.lineTo(56, 46); g.fill();
  },
  crown: (g) => { g.beginPath(); g.moveTo(22, 96); g.lineTo(18, 40); g.lineTo(44, 66); g.lineTo(64, 30); g.lineTo(84, 66); g.lineTo(110, 40); g.lineTo(106, 96); g.closePath(); g.fill(); },
  cherry: (g) => {
    g.strokeStyle = '#2d6a4f'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(44, 80); g.quadraticCurveTo(54, 40, 82, 24); g.moveTo(86, 84); g.quadraticCurveTo(84, 50, 82, 24); g.stroke();
    g.beginPath(); g.arc(42, 88, 20, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(88, 90, 20, 0, Math.PI * 2); g.fill();
  },
  diamond: (g) => { g.beginPath(); g.moveTo(34, 46); g.lineTo(50, 26); g.lineTo(78, 26); g.lineTo(94, 46); g.lineTo(64, 106); g.closePath(); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(34, 46); g.lineTo(94, 46); g.moveTo(50, 26); g.lineTo(64, 106); g.moveTo(78, 26); g.lineTo(64, 106); g.stroke(); },
  cloud: (g) => { for (const [x, y, r] of [[44, 74, 22], [64, 58, 28], [88, 72, 22], [64, 82, 22]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); } },
  mushroom: (g) => {
    g.fillStyle = '#f5ebe0'; g.fillRect(52, 64, 24, 40);
    g.fillStyle = '#d00000'; g.beginPath(); g.arc(64, 68, 44, Math.PI, 0); g.fill();
    g.fillStyle = '#ffffff'; for (const [x, y] of [[44, 50], [70, 40], [88, 58]]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
  },
  tree: (g) => {
    g.fillStyle = '#8b5e34'; g.fillRect(58, 84, 12, 26);
    g.fillStyle = '#386641'; for (const [y, w] of [[20, 26], [42, 38], [64, 48]]) { g.beginPath(); g.moveTo(64, y); g.lineTo(64 - w, y + 30); g.lineTo(64 + w, y + 30); g.closePath(); g.fill(); }
  },
};

const cache = new Map();
export function iconMaterial(i) {
  if (cache.has(i)) return cache.get(i);
  const ic = ICONS[i % ICONS.length];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = ic.bg;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 6;
  g.strokeRect(5, 5, 118, 118);
  g.fillStyle = ic.fg;
  DRAW[ic.name](g, ic.bg);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: '#000000' });
  cache.set(i, m);
  return m;
}
