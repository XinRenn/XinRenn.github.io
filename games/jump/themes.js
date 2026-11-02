// 蓄力跳台的主题：每个背景配一套跳台、一个小场景底座、一个角色和掉下去的方式。
// 所有尺寸单位是米。平台的“顶面”在 y = h；底座的水面/地面在 y = 0（城市主题的街道在 floor）。
import * as THREE from 'three';

// ---------- 小工具 ----------
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
function tex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const cache = {};
const once = (k, f) => (cache[k] ||= f());

// 让圆柱/石头不那么规整：顶点随机抖动（保留顶面平整）
function jitter(geo, amt, keepTopY = null) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (keepTopY !== null && Math.abs(p.getY(i) - keepTopY) < 1e-4) continue;
    p.setX(i, p.getX(i) * (1 + (Math.random() - 0.5) * amt));
    p.setZ(i, p.getZ(i) * (1 + (Math.random() - 0.5) * amt));
  }
  geo.computeVertexNormals();
  return geo;
}
function cyl(rTop, rBot, y0, y1, seg, mat) {
  const g = new THREE.CylinderGeometry(rTop, rBot, y1 - y0, seg);
  g.translate(0, (y0 + y1) / 2, 0);
  return new THREE.Mesh(g, mat);
}
function box(w, d, y0, y1, mat) {
  const g = new THREE.BoxGeometry(w, y1 - y0, d);
  g.translate(0, (y0 + y1) / 2, 0);
  return new THREE.Mesh(g, mat);
}

// ---------- 贴图 ----------
const ringsTex = () => once('rings', () => tex(128, 128, (g, w, h) => {
  g.fillStyle = '#c99a62'; g.fillRect(0, 0, w, h);
  for (let r = 60; r > 2; r -= 5 + Math.random() * 3) {
    g.strokeStyle = `rgba(110,70,35,${0.35 + Math.random() * 0.3})`;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(64 + Math.random() * 2, 64 + Math.random() * 2, r, 0, Math.PI * 2); g.stroke();
  }
}));
const barkTex = () => once('bark', () => tex(64, 64, (g, w, h) => {
  g.fillStyle = '#6b4a32'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(30,18,10,${Math.random() * 0.5})`; g.fillRect(Math.random() * w, 0, 1 + Math.random() * 2, h); }
}));
const planksTex = () => once('planks', () => tex(128, 128, (g, w, h) => {
  g.fillStyle = '#a07040'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) { g.fillStyle = 'rgba(50,30,15,0.7)'; g.fillRect(0, y, w, 3); for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(60,35,15,${Math.random() * 0.25})`; g.fillRect(0, y + 4 + Math.random() * 26, w, 1); } }
  g.strokeStyle = 'rgba(50,30,15,0.8)'; g.lineWidth = 6; g.strokeRect(0, 0, w, h);
}));
const windowsTex = (seed) => once('win' + seed, () => tex(64, 128, (g, w, h) => {
  g.fillStyle = '#1e1d27'; g.fillRect(0, 0, w, h);
  for (let y = 6; y < h - 4; y += 12) for (let x = 5; x < w - 4; x += 11) {
    g.fillStyle = Math.random() < 0.55 ? (Math.random() < 0.7 ? '#ffd9a0' : '#bfe3ff') : '#2c2b36';
    g.fillRect(x, y, 7, 8);
  }
}));
const brickTex = () => once('brick', () => tex(128, 128, (g, w, h) => {
  g.fillStyle = '#6a4030'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 10) for (let x = (y / 10) % 2 ? -10 : 0; x < w; x += 20) {
    g.fillStyle = ['#8a5038', '#7a4632', '#985a3e'][Math.floor(Math.random() * 3)];
    g.fillRect(x + 1, y + 1, 18, 8);
  }
}));
const streetTex = () => once('street', () => tex(256, 256, (g, w, h) => {
  g.fillStyle = '#26262c'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#d8c060';
  for (let y = 0; y < h; y += 40) g.fillRect(w / 2 - 2, y, 4, 22);
  g.fillStyle = '#d8d8d8';
  for (let x = 0; x < w; x += 24) g.fillRect(x, 20, 12, 30);
}));

// ---------- 水面 ----------
function waterMat({ deep = '#1d4a63', light = '#9fc4df', flow = 0, opacity = 0.9 } = {}, uTime) {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime, deep: { value: new THREE.Color(deep) }, light: { value: new THREE.Color(light) }, flow: { value: flow }, opacity: { value: opacity } },
    vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, flow, opacity; uniform vec3 deep, light; varying vec3 vW;
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float f = pow(1.0 - max(V.y, 0.0), 2.0);
        vec2 p = vW.xz * 18.0 + vec2(0.0, uTime * flow * 6.0);
        float r = sin(p.x + uTime * 1.3) * sin(p.y * 1.2 - uTime) + 0.5 * sin((p.x + p.y) * 2.1 + uTime * 2.0);
        vec3 c = mix(deep, light, 0.25 + 0.5 * f) + pow(max(r, 0.0) / 1.5, 8.0) * 0.35;
        gl_FragColor = vec4(c, opacity);
        #include <colorspace_fragment>
      }`,
  });
}

// ---------- 底座 ----------
// 圆角矩形的小场景：前方（-z）宽一点，因为下一块平台总是出现在前方
export const BASIN = { w: 1.8, d: 1.25, cz: -0.3 };
function roundedShape(w, d, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -d / 2);
  s.lineTo(w / 2 - r, -d / 2); s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r); s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  s.lineTo(-w / 2 + r, d / 2); s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  s.lineTo(-w / 2, -d / 2 + r); s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  return s;
}
function flat(shape, y, mat) {
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

// kind: 'water' | 'aquarium' | 'city'
function makeBase({ kind, rim, pedestal, water, floorMat, decor }, uTime) {
  const g = new THREE.Group();
  const { w, d, cz } = BASIN;
  const shape = roundedShape(w, d, 0.18);
  const inner = roundedShape(w - 0.1, d - 0.1, 0.14);
  const floorY = kind === 'water' ? -0.08 : kind === 'aquarium' ? -0.38 : -0.5;
  // 边框：外形减去内形，挤出成一圈
  const ring = roundedShape(w, d, 0.18);
  ring.holes.push(new THREE.Path(inner.getPoints(12).reverse()));
  const rimTop = kind === 'aquarium' ? floorY + 0.04 : kind === 'city' ? -0.02 : 0.03;
  const rimGeo = new THREE.ExtrudeGeometry(ring, { depth: rimTop - floorY + 0.03, bevelEnabled: false, curveSegments: 8 });
  rimGeo.rotateX(Math.PI / 2);
  rimGeo.translate(0, rimTop, 0);
  const rimMesh = new THREE.Mesh(rimGeo, rim);
  g.add(rimMesh);
  if (kind === 'water') {
    g.add(flat(inner, 0, waterMat(water, uTime)));
    g.add(flat(inner, floorY, std(water.bed || '#3b4a3a')));
  } else {
    g.add(flat(inner, floorY, floorMat));
  }
  if (kind === 'aquarium') {
    // 玻璃缸：四面透明的玻璃 + 淡淡的水色
    const glassGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.62, bevelEnabled: false, curveSegments: 10 });
    glassGeo.rotateX(Math.PI / 2);
    glassGeo.translate(0, floorY + 0.62, 0);
    const glass = new THREE.Mesh(glassGeo, new THREE.MeshStandardMaterial({ color: '#9fe7ff', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }));
    g.add(glass);
    const surface = flat(inner, floorY + 0.58, waterMat({ deep: '#3aa7c7', light: '#c8f6ff', opacity: 0.35 }, uTime));
    g.add(surface);
  }
  // 底座柱子：一直延伸到地板（高度在 fit() 里设置）
  const ped = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedShape(w * 0.82, d * 0.72, 0.12), { depth: 1, bevelEnabled: false }), pedestal);
  ped.geometry.rotateX(Math.PI / 2);
  g.add(ped);
  if (decor) decor(g, floorY);
  g.position.z = cz;
  return {
    object: g,
    floorY,
    fit(rigY) {
      // 柱子从底座下面一直到真实地板
      const top = floorY - 0.03;
      ped.scale.y = Math.max(0.01, rigY + top);
      ped.position.y = top;
    },
  };
}

// ---------- 角色 ----------
export function makePawn(kind) {
  const g = new THREE.Group();
  if (kind === 'frog') {
    const green = std('#4caf50', { roughness: 0.5 });
    const belly = std('#c5e1a5');
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), green);
    body.scale.set(1, 0.7, 1.15);
    body.position.y = 0.022;
    const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 10), belly);
    tummy.scale.set(1, 0.6, 1);
    tummy.position.set(0, 0.016, 0.01);
    g.add(body, tummy);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 8), green);
      eye.position.set(s * 0.014, 0.044, 0.016);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 6), std('#111'));
      pupil.position.set(s * 0.015, 0.047, 0.025);
      const leg = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), green);
      leg.scale.set(0.7, 0.5, 1.4);
      leg.position.set(s * 0.026, 0.008, -0.012);
      g.add(eye, pupil, leg);
    }
  } else if (kind === 'penguin') {
    const black = std('#1e2230', { roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.026, 20, 14), black);
    body.scale.set(1, 1.5, 0.95);
    body.position.y = 0.04;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.021, 16, 12), std('#f4f6f8'));
    belly.scale.set(0.9, 1.4, 0.7);
    belly.position.set(0, 0.036, 0.009);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.014, 8), std('#ff9f1c'));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.062, 0.026);
    g.add(body, belly, beak);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), std('#fff'));
      eye.position.set(s * 0.009, 0.068, 0.02);
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), black);
      wing.scale.set(0.35, 1.5, 0.8);
      wing.position.set(s * 0.026, 0.038, 0);
      wing.rotation.z = s * 0.25;
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), std('#ff9f1c'));
      foot.scale.set(1, 0.3, 1.5);
      foot.position.set(s * 0.01, 0.002, 0.01);
      g.add(eye, wing, foot);
    }
  } else {
    const colors = { runner: ['#3a86ff', '#ffd6a5'], sailor: ['#1d3557', '#f1faee'], clown: ['#ff7f2a', '#ffffff'], umbrella: ['#4a4e69', '#ffd6a5'] }[kind] || ['#ff6b6b', '#ff6b6b'];
    const prof = [[0, 0], [0.024, 0], [0.027, 0.006], [0.022, 0.022], [0.014, 0.045], [0.011, 0.056], [0.017, 0.062], [0, 0.064]].map(([r, y]) => new THREE.Vector2(r, y));
    const bodyMat = std(colors[0], { roughness: 0.45 });
    g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 24), bodyMat));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.019, 20, 14), std(colors[1], { roughness: 0.5 }));
    head.position.y = 0.08;
    g.add(head);
    for (const x of [-0.007, 0.007]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), new THREE.MeshBasicMaterial({ color: '#1b1b1b' }));
      e.position.set(x, 0.083, 0.017);
      g.add(e);
    }
    if (kind === 'sailor') {
      const hat = cyl(0.016, 0.018, 0.094, 0.104, 16, std('#ffffff'));
      g.add(hat);
      for (const y of [0.02, 0.034]) g.add(cyl(0.0255 - y * 0.25, 0.0255 - y * 0.25, y, y + 0.005, 20, std('#f1faee')));
    }
    if (kind === 'runner') {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.021, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), bodyMat);
      hood.position.set(0, 0.081, -0.003);
      hood.rotation.x = -0.4;
      g.add(hood);
    }
    if (kind === 'clown') {
      for (const y of [0.012, 0.04]) g.add(cyl(0.026 - y * 0.3, 0.026 - y * 0.3, y, y + 0.007, 20, std('#ffffff')));
    }
    if (kind === 'umbrella') {
      const stick = cyl(0.0015, 0.0015, 0.06, 0.14, 6, std('#222'));
      stick.position.x = 0.02;
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.02, 8, 1, true), std('#b8322a', { side: THREE.DoubleSide }));
      canopy.position.set(0.02, 0.142, 0);
      g.add(stick, canopy);
    }
  }
  return g;
}

// ---------- 各种跳台 ----------
// 每个函数返回 { group, shape: 'circle'|'box', w, d }，顶面在 y = h
const P = {
  lily(s, h) {
    const g = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(s / 2, s / 2, 0.008, 28, 1, false, 0.35, Math.PI * 2 - 0.35), std(Math.random() < 0.5 ? '#6cc24a' : '#82d152', { side: THREE.DoubleSide, roughness: 0.45 }));
    pad.position.y = h - 0.004;
    pad.rotation.y = Math.random() * Math.PI * 2;
    g.add(pad);
    if (Math.random() < 0.4) {
      const fl = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const pet = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.022, 4), std(i % 2 ? '#ffc8dd' : '#ffafcc'));
        pet.rotation.z = 0.9;
        pet.rotation.y = (i / 6) * Math.PI * 2;
        pet.position.y = 0.008;
        fl.add(pet);
      }
      fl.position.set(s * 0.32, h, s * 0.12);
      g.add(fl);
    }
    return { h, group: g, shape: 'circle', w: s, d: s };
  },
  stone(s, h, floor, color = '#8a8a82', moss = '#6f8a4a') {
    const g = new THREE.Group();
    const body = cyl(s / 2 * 0.86, s / 2, floor - 0.02, h, 9, std(color, { flatShading: true }));
    jitter(body.geometry, 0.18, h); // 顶面保持平整
    const top = cyl(s / 2 * 0.8, s / 2 * 0.86, h - 0.004, h, 9, std(moss, { flatShading: true }));
    g.add(body, top);
    return { h, group: g, shape: 'circle', w: s * 0.9, d: s * 0.9 };
  },
  stump(s, h, floor, snow = false) {
    const g = new THREE.Group();
    const side = cyl(s / 2, s / 2 * 1.12, floor - 0.02, h, 18, std('#ffffff', { map: barkTex() }));
    const top = new THREE.Mesh(new THREE.CircleGeometry(s / 2, 24), std('#ffffff', { map: ringsTex() }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = h + 0.0005;
    g.add(side, top);
    if (snow) {
      const cap = cyl(s / 2 * 1.02, s / 2 * 1.02, h, h + 0.012, 18, std('#f6f9ff'));
      g.add(cap);
      return { h, group: g, shape: 'circle', w: s, d: s, top: 0.012 };
    }
    return { h, group: g, shape: 'circle', w: s, d: s };
  },
  mushroom(s, h, floor) {
    const g = new THREE.Group();
    g.add(cyl(s * 0.14, s * 0.18, floor - 0.02, h - 0.02, 10, std('#f2e8d5')));
    const cap = cyl(s / 2, s / 2 * 0.92, h - 0.025, h, 24, std('#e63946'));
    g.add(cap);
    for (let i = 0; i < 5; i++) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(s * 0.05, 10), std('#ffffff'));
      dot.rotation.x = -Math.PI / 2;
      const a = Math.random() * Math.PI * 2, r = s * (0.25 + Math.random() * 0.17);
      dot.position.set(Math.cos(a) * r, h + 0.0006, Math.sin(a) * r);
      g.add(dot);
    }
    return { h, group: g, shape: 'circle', w: s, d: s };
  },
  log(s, h, floor) {
    const g = new THREE.Group();
    const r = s * 0.28;
    const geo = new THREE.CylinderGeometry(r, r, s * 1.3, 14);
    geo.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(geo, std('#ffffff', { map: barkTex() }));
    m.position.y = h - r;
    g.add(m);
    for (const sx of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.CircleGeometry(r, 14), std('#ffffff', { map: ringsTex() }));
      end.rotation.y = sx * Math.PI / 2;
      end.position.set(sx * s * 0.65, h - r, 0);
      g.add(end);
    }
    return { h, group: g, shape: 'box', w: s * 1.25, d: r * 1.3 };
  },
  clam(s, h, floor) {
    const g = new THREE.Group();
    g.add(cyl(s * 0.2, s * 0.3, floor, h - 0.03, 8, std('#7a6d8c', { flatShading: true })));
    const shellMat = std('#c9a0dc', { side: THREE.DoubleSide, roughness: 0.4 });
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(s / 2, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shellMat);
    bowl.scale.y = 0.35;
    bowl.position.y = h;
    const lid = new THREE.Mesh(new THREE.SphereGeometry(s / 2, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
    lid.scale.y = 0.35;
    lid.position.set(0, h, -s * 0.42);
    lid.rotation.x = -1.1;
    const flesh = new THREE.Mesh(new THREE.CircleGeometry(s / 2 * 0.95, 20), std('#ffd1dc', { roughness: 0.3 }));
    flesh.rotation.x = -Math.PI / 2;
    flesh.position.y = h - 0.002;
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(s * 0.06, 12, 8), std('#ffffff', { roughness: 0.1, metalness: 0.3 }));
    pearl.position.set(s * 0.25, h + s * 0.04, -s * 0.15);
    g.add(bowl, lid, flesh, pearl);
    return { h, group: g, shape: 'circle', w: s * 0.9, d: s * 0.9 };
  },
  sponge(s, h, floor) {
    const g = new THREE.Group();
    const c = ['#ff9f43', '#ffd166', '#ef476f', '#c77dff'][Math.floor(Math.random() * 4)];
    g.add(cyl(s / 2, s / 2 * 0.8, floor, h, 14, std(c, { roughness: 0.9 })));
    const hole = new THREE.Mesh(new THREE.RingGeometry(s * 0.1, s / 2, 20), std(c, { roughness: 0.9 }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = h + 0.0005;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(s * 0.1, 12), std('#3a2a20'));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = h + 0.001;
    g.add(hole, inner);
    return { h, group: g, shape: 'circle', w: s, d: s };
  },
  brain(s, h, floor) {
    const g = new THREE.Group();
    g.add(cyl(s / 2 * 0.9, s / 2 * 0.7, floor, h - s * 0.12, 12, std('#7a6d8c', { flatShading: true })));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(s / 2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(Math.random() < 0.5 ? '#f4a261' : '#e9c46a', { roughness: 0.9, flatShading: true }));
    dome.scale.y = 0.24;
    dome.position.y = h - s * 0.12;
    g.add(dome);
    return { h, group: g, shape: 'circle', w: s * 0.8, d: s * 0.8 };
  },
  floe(s, h, color = '#eef6fb') {
    const pts = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = s / 2 * (0.88 + Math.random() * 0.22);
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    }
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: h + 0.03, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -0.03, 0);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, std(color, { roughness: 0.25, flatShading: true })));
    return { h, group: g, shape: 'circle', w: s * 0.88, d: s * 0.88, top: 0.004 };
  },
  iceBlock(s, h, floor) {
    const g = new THREE.Group();
    g.add(box(s, s, floor - 0.02, h, std('#bfe3f5', { roughness: 0.15, transparent: true, opacity: 0.92 })));
    return { h, group: g, shape: 'box', w: s, d: s };
  },
  piling(s, h, floor) {
    const g = new THREE.Group();
    const r = s / 2;
    g.add(cyl(r, r * 1.05, floor - 0.3, h, 14, std('#ffffff', { map: barkTex(), color: '#5a4030' })));
    const top = new THREE.Mesh(new THREE.CircleGeometry(r, 18), std('#ffffff', { map: ringsTex(), color: '#8a6a4a' }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = h + 0.0005;
    const rope = new THREE.Mesh(new THREE.TorusGeometry(r * 1.05, 0.005, 6, 20), std('#d9c8a0'));
    rope.rotation.x = Math.PI / 2;
    rope.position.y = h - 0.025;
    g.add(top, rope);
    return { h, group: g, shape: 'circle', w: s, d: s };
  },
  barrel(s, h, floor) {
    const g = new THREE.Group();
    const r = s / 2;
    const geo = new THREE.CylinderGeometry(r * 0.92, r * 0.92, h - floor + 0.02, 16, 4);
    const p = geo.attributes.position;
    const half = (h - floor + 0.02) / 2;
    for (let i = 0; i < p.count; i++) { const k = 1 + 0.1 * (1 - Math.pow(p.getY(i) / half, 2)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    geo.computeVertexNormals();
    geo.translate(0, (h + floor - 0.02) / 2, 0);
    g.add(new THREE.Mesh(geo, std('#9a6a3a')));
    for (const y of [h - 0.012, floor + (h - floor) * 0.5]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * (y > h - 0.02 ? 0.93 : 1.01), 0.0035, 6, 22), std('#3a3a40', { metalness: 0.6 }));
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      g.add(band);
    }
    const lid = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 16), std('#ffffff', { map: planksTex(), color: '#b08050' }));
    lid.rotation.x = -Math.PI / 2;
    lid.position.y = h + 0.0005;
    g.add(lid);
    return { h, group: g, shape: 'circle', w: s * 0.9, d: s * 0.9 };
  },
  crate(s, h, floor) {
    const g = new THREE.Group();
    g.add(box(s, s, floor - 0.02, h, std('#ffffff', { map: planksTex() })));
    return { h, group: g, shape: 'box', w: s, d: s };
  },
  buoy(s, h, floor) {
    const g = new THREE.Group();
    const r = s / 2;
    for (let i = 0; i < 3; i++) {
      const y0 = floor - 0.02 + ((h - floor + 0.02) / 3) * i, y1 = y0 + (h - floor + 0.02) / 3;
      g.add(cyl(r, r, y0, y1, 18, std(i % 2 ? '#f1faee' : '#e63946')));
    }
    return { h, group: g, shape: 'circle', w: s, d: s };
  },
  building(s, h, floor, style = 'tokyo') {
    const g = new THREE.Group();
    const w = s, d = s * (0.9 + Math.random() * 0.25);
    const sideMat = style === 'tokyo'
      ? std('#2a2833', { emissive: '#ffffff', emissiveMap: windowsTex(Math.floor(Math.random() * 3)), emissiveIntensity: 0.6 })
      : std('#ffffff', { map: brickTex() });
    const body = box(w, d, floor, h - 0.01, sideMat);
    const roof = box(w, d, h - 0.01, h, std(style === 'tokyo' ? '#4a4852' : '#55575c'));
    g.add(body, roof);
    // 女儿墙（屋顶边上一圈矮墙）
    const lip = std(style === 'tokyo' ? '#3a3842' : '#6a4030');
    for (const [bw, bd, x, z] of [[w, 0.006, 0, d / 2], [w, 0.006, 0, -d / 2], [0.006, d, w / 2, 0], [0.006, d, -w / 2, 0]]) {
      const m = box(bw, bd, h, h + 0.008, lip);
      m.position.set(x, 0, z);
      g.add(m);
    }
    if (style === 'tokyo') {
      // 屋顶角落的水箱 + 侧面的霓虹招牌
      const tank = cyl(s * 0.08, s * 0.08, h + 0.012, h + 0.04, 10, std('#9aa0a8', { metalness: 0.4 }));
      tank.position.set(w / 2 - s * 0.12, 0, -d / 2 + s * 0.12);
      const neon = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.5, 0.03), new THREE.MeshBasicMaterial({ color: ['#ff3d7f', '#33e1ff', '#ffe14d', '#7dff6a'][Math.floor(Math.random() * 4)] }));
      neon.position.set(0, h - 0.035, d / 2 + 0.001);
      g.add(tank, neon);
    } else {
      // 烟囱
      const ch = box(s * 0.22, s * 0.14, h, h + 0.04, std('#ffffff', { map: brickTex() }));
      ch.position.set(-w / 2 + s * 0.14, 0, -d / 2 + s * 0.1);
      for (const dx of [-0.014, 0.014]) {
        const pot = cyl(0.006, 0.008, h + 0.04, h + 0.056, 8, std('#b5651d'));
        pot.position.set(-w / 2 + s * 0.14 + dx, 0, -d / 2 + s * 0.1);
        g.add(pot);
      }
      g.add(ch);
    }
    return { h, group: g, shape: 'box', w, d };
  },
  postbox(s, h, floor) {
    const g = new THREE.Group();
    const r = s * 0.38;
    g.add(cyl(r, r * 1.05, floor, h - 0.008, 20, std('#c8102e')));
    g.add(cyl(r * 1.05, r * 1.05, h - 0.008, h, 20, std('#c8102e')));
    const slot = box(r * 0.9, 0.004, h - 0.04, h - 0.034, new THREE.MeshBasicMaterial({ color: '#111' }));
    slot.position.z = r * 1.02;
    g.add(slot);
    return { h, group: g, shape: 'circle', w: r * 2, d: r * 2 };
  },
};

// 随机选一种跳台
function pick(list) {
  let total = list.reduce((s, [, w]) => s + w, 0), r = Math.random() * total;
  for (const [f, w] of list) { if ((r -= w) <= 0) return f; }
  return list[0][0];
}

// ---------- 主题 ----------
const reeds = (color = '#6f8a3a') => (g, floorY) => {
  const { w, d } = BASIN;
  const mat = std(color);
  const head = std('#5a3a22');
  for (let i = 0; i < 40; i++) {
    const t = Math.random();
    const edge = Math.floor(Math.random() * 4);
    const x = edge < 2 ? (t - 0.5) * (w - 0.16) : (edge === 2 ? -1 : 1) * (w / 2 - 0.08);
    const z = edge >= 2 ? (t - 0.5) * (d - 0.16) : (edge === 0 ? -1 : 1) * (d / 2 - 0.08);
    if (z > 0.2 && Math.abs(x) < 0.4) continue; // 你站的那一边不放，免得挡视线
    const hgt = 0.12 + Math.random() * 0.14;
    const stalk = cyl(0.0025, 0.003, floorY, hgt, 5, mat);
    stalk.position.set(x, 0, z);
    stalk.rotation.z = (Math.random() - 0.5) * 0.2;
    g.add(stalk);
    if (Math.random() < 0.4) {
      const c = cyl(0.007, 0.007, hgt - 0.04, hgt - 0.005, 6, head);
      c.position.set(x, 0, z);
      g.add(c);
    }
  }
};

export const THEMES = {
  meadow: {
    name: '池塘踏石', pawn: 'frog', fall: 'water',
    base: (u) => makeBase({ kind: 'water', rim: std('#8d8a80', { flatShading: true }), pedestal: std('#7a776d'), water: { deep: '#1f4558', light: '#8db8cc', bed: '#2a3a30' }, decor: reeds() }, u),
    platform: (s, floor) => pick([[(s2) => P.lily(s2, 0.006), 4], [(s2) => P.stone(s2, 0.03 + Math.random() * 0.04, floor), 3], [(s2) => P.stump(s2, 0.05 + Math.random() * 0.07, floor), 2], [(s2) => P.mushroom(s2, 0.07 + Math.random() * 0.06, floor), 1.5]])(s),
  },
  waterfall: {
    name: '溪流过河', pawn: 'frog', fall: 'water',
    base: (u) => makeBase({ kind: 'water', rim: std('#6e6a62', { flatShading: true }), pedestal: std('#5f5b54'), water: { deep: '#1f5560', light: '#b5e0e8', bed: '#4a5040', flow: 1 }, decor: reeds('#5f8a3a') }, u),
    platform: (s, floor) => pick([[(s2) => P.stone(s2, 0.02 + Math.random() * 0.05, floor, '#7a7a72', '#5f8a3e'), 4], [(s2) => P.log(s2, 0.03, floor), 2], [(s2) => P.lily(s2, 0.006), 2]])(s),
  },
  underwater: {
    name: '水族箱', pawn: 'clown', fall: 'sink',
    base: (u) => makeBase({
      kind: 'aquarium', rim: std('#3a3f4a', { metalness: 0.5 }), pedestal: std('#2f3540'), floorMat: std('#d8c8a0'),
      decor: (g, floorY) => {
        const cols = ['#3f7d3a', '#5b8f2e'];
        for (let i = 0; i < 24; i++) {
          const x = (Math.random() - 0.5) * 1.6, z = (Math.random() - 0.5) * 1.1;
          if (Math.abs(x) < 0.6 && z > -0.5 && z < 0.4) continue;
          const kelp = cyl(0.004, 0.008, floorY, floorY + 0.2 + Math.random() * 0.25, 4, std(cols[i % 2]));
          kelp.position.set(x, 0, z);
          g.add(kelp);
        }
      },
    }, u),
    platform: (s, floor) => pick([[(s2) => P.clam(s2, 0.03 + Math.random() * 0.08, floor), 2], [(s2) => P.sponge(s2, 0.02 + Math.random() * 0.1, floor), 3], [(s2) => P.brain(s2, 0.02 + Math.random() * 0.06, floor), 2], [(s2) => P.stone(s2, Math.random() * 0.06, floor, '#6d6a7d', '#ff7f6a'), 2]])(s),
  },
  winter: {
    name: '冰湖浮冰', pawn: 'penguin', fall: 'water',
    base: (u) => makeBase({ kind: 'water', rim: std('#f2f6fb'), pedestal: std('#c9d6e3'), water: { deep: '#1d3a52', light: '#a9c8dd', bed: '#1a2a38' } }, u),
    platform: (s, floor) => pick([[(s2) => P.floe(s2, 0.012 + Math.random() * 0.02), 4], [(s2) => P.stump(s2, 0.05 + Math.random() * 0.06, floor, true), 2], [(s2) => P.iceBlock(s2 * 0.85, 0.04 + Math.random() * 0.07, floor), 2]])(s),
  },
  harbor: {
    name: '码头木桩', pawn: 'sailor', fall: 'water',
    base: (u) => makeBase({ kind: 'water', rim: std('#ffffff', { map: planksTex() }), pedestal: std('#6b4a32'), water: { deep: '#1e5470', light: '#9cc4dd', bed: '#24343c' } }, u),
    platform: (s, floor) => pick([[(s2) => P.piling(s2 * 0.75, 0.06 + Math.random() * 0.1, floor), 4], [(s2) => P.barrel(s2, 0.04 + Math.random() * 0.05, floor), 2], [(s2) => P.crate(s2 * 0.9, 0.03 + Math.random() * 0.06, floor), 2]])(s),
  },
  fjord: {
    name: '海湾浮冰', pawn: 'sailor', fall: 'water',
    base: (u) => makeBase({ kind: 'water', rim: std('#5f6560', { flatShading: true }), pedestal: std('#4f5550'), water: { deep: '#0f3b55', light: '#9cc6e6', bed: '#14262f' } }, u),
    platform: (s, floor) => pick([[(s2) => P.floe(s2, 0.015 + Math.random() * 0.02), 3], [(s2) => P.stone(s2, 0.03 + Math.random() * 0.06, floor, '#5a5f5c', '#6a7a58'), 3], [(s2) => P.buoy(s2 * 0.7, 0.04 + Math.random() * 0.05, floor), 1.5]])(s),
  },
  japan: {
    name: '屋顶跑酷', pawn: 'runner', fall: 'ground',
    base: (u) => makeBase({ kind: 'city', rim: std('#3a3842'), pedestal: std('#2a2833'), floorMat: std('#ffffff', { map: streetTex() }) }, u),
    platform: (s, floor) => P.building(s, 0.0 + Math.random() * 0.14, floor, 'tokyo'),
  },
  london: {
    name: '伦敦屋顶', pawn: 'umbrella', fall: 'ground',
    base: (u) => makeBase({ kind: 'city', rim: std('#ffffff', { map: brickTex() }), pedestal: std('#4a3a30'), floorMat: std('#2e3238', { roughness: 0.25, metalness: 0.2 }) }, u),
    platform: (s, floor) => pick([[(s2) => P.building(s2, Math.random() * 0.12, floor, 'london'), 4], [(s2) => P.postbox(s2, 0.02 + Math.random() * 0.06, floor), 1]])(s),
  },
};
