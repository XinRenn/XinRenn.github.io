// 日本闹市街头（夜晚）：两边是高低错落的楼，挂满霓虹招牌和红灯笼，
// 路边有发光的自动售货机，电线杆和电线交错，人行道上人来人往。你站在步行街正中间。
import * as C from './common.js';
const { THREE } = C;

const SIGN_WORDS = ['ラーメン', '居酒屋', 'カラオケ', '寿司', '焼き鳥', '喫茶', 'ゲーム', '薬', '書店', '花屋', '占い', 'うどん', '銭湯', '酒場', '古着', '餃子'];
const NEON = ['#ff3d7f', '#33e1ff', '#ffe14d', '#7dff6a', '#ff8a3d', '#c77dff', '#ffffff'];
const JP_FONT = '"Hiragino Sans","Noto Sans JP","Noto Sans CJK JP","Yu Gothic",sans-serif';

export function create() {
  const b = C.createBuilder(77);
  const fogColor = '#2a1f3d';
  const STREET = 5;    // 步行街半宽（含人行道）
  const LEN = 70;      // 街道两端延伸的长度

  C.addLights(b, { sky: '#7a6ea8', ground: '#1a1626', hemi: 0.9, sun: '#9fb4ff', sunIntensity: 0.4, sunDir: new THREE.Vector3(0.3, 1, 0.2) });
  const lamp = new THREE.PointLight('#ffd2a0', 18, 14, 1.4); // 头顶的暖色路灯，照亮游戏区域
  lamp.position.set(0, 5.5, 0);
  b.lights.push(lamp);
  C.addSky(b, { top: '#070a22', mid: '#16173f', horizon: '#4a2b5e', sun: 0, stars: 0.7 });
  C.addSunGlow(b, { dir: new THREE.Vector3(0.3, 0.6, -0.8), color: '#e8ecff', size: 7, opacity: 0.9 }); // 月亮

  // ---- 地面：柏油路 + 人行道 + 斑马线 ----
  {
    const road = C.canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#2b2a33';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(${150 + Math.random() * 60},${150 + Math.random() * 60},${160 + Math.random() * 60},${Math.random() * 0.08})`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    });
    road.wrapS = road.wrapT = THREE.RepeatWrapping;
    road.repeat.set(4, 40);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(STREET * 2 + 30, LEN * 2), new THREE.MeshLambertMaterial({ map: road }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.005;
    b.add(ground);
    for (const s of [-1, 1]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, LEN * 2), new THREE.MeshLambertMaterial({ color: '#4a4852' }));
      walk.position.set(s * (STREET + 1), 0.06, 0);
      b.add(walk);
    }
    // 斑马线（在你身后，不和石板重叠）
    const stripeMat = new THREE.MeshLambertMaterial({ color: '#d8d8d8' });
    for (let i = -4; i <= 4; i++) {
      const st = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 3), stripeMat);
      st.rotation.x = -Math.PI / 2;
      st.position.set(i * 1.0, 0.002, 8);
      b.add(st);
    }
  }

  // ---- 两侧的楼 ----
  const windowTex = (seed) => C.canvasTexture(128, 256, (g, w, h) => {
    const r = C.rng(seed);
    g.fillStyle = '#1b1a24';
    g.fillRect(0, 0, w, h);
    for (let y = 8; y < h - 8; y += 21) {
      for (let x = 8; x < w - 8; x += 20) {
        const on = r() < 0.55;
        g.fillStyle = on ? (r() < 0.7 ? '#ffd9a0' : '#bfe3ff') : '#2a2934';
        g.fillRect(x, y, 13, 14);
      }
    }
  });
  const winTexes = [1, 2, 3, 4].map(windowTex);
  // 店面：暖光的店内、深色门框、门口挂着短门帘
  const shopTex = (seed) => C.canvasTexture(256, 128, (g, w, h) => {
    const r = C.rng(seed);
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, ['#f7c07a', '#ffe2b0', '#e8a868', '#fbd59a'][seed % 4]);
    grad.addColorStop(1, '#6b4a30');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(40,30,25,0.85)';
    for (let x = 0; x <= w; x += 64) g.fillRect(x - 3, 0, 6, h);
    g.fillRect(0, 0, w, 8);
    const noren = ['#1f3a6b', '#7a1f1f', '#2b2b2b', '#e8e2d0'][Math.floor(r() * 4)];
    g.fillStyle = noren;
    for (let x = 24; x < w - 24; x += 34) g.fillRect(x, 10, 30, 40);
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(30,20,15,${0.3 + r() * 0.4})`; g.fillRect(20 + r() * (w - 60), 70 + r() * 30, 14 + r() * 20, 50); }
  });
  const shopTexes = [0, 1, 2, 3].map(shopTex);
  const signs = [];
  for (const side of [-1, 1]) {
    let z = -LEN;
    while (z < LEN) {
      const w = 5 + b.rand() * 5, h = 7 + b.rand() * 22, d = 8;
      const x = side * (STREET + 2 + d / 2);
      const tex = winTexes[Math.floor(b.rand() * winTexes.length)].clone();
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(1, Math.round(w / 1.6)), Math.max(1, Math.round((h - 3) / 2.8)));
      tex.offset.y = -3 / h; // 一楼是店面，不画窗户
      tex.needsUpdate = true;
      const front = new THREE.MeshLambertMaterial({ color: '#2a2833', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.7 });
      const plain = new THREE.MeshLambertMaterial({ color: '#24222c' });
      // 面向街道的那一面贴窗户
      const mats = side < 0 ? [front, plain, plain, plain, plain, plain] : [plain, front, plain, plain, plain, plain];
      const bld = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), mats);
      bld.position.set(x, h / 2, z + w / 2);
      b.add(bld);

      // 一楼店面：暖光的橱窗
      const shop = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, 2.4), new THREE.MeshBasicMaterial({ map: shopTexes[Math.floor(b.rand() * shopTexes.length)] }));
      shop.position.set(side * (STREET + 1.99), 1.4, z + w / 2);
      shop.rotation.y = -side * Math.PI / 2;
      b.add(shop);
      // 竖招牌
      if (b.rand() < 0.85 && Math.abs(z + w / 2) > 3) signs.push({ side, z: z + w / 2, h: Math.min(h - 1, 4 + b.rand() * 6) });
      z += w + 0.2;
    }
  }

  // ---- 霓虹招牌（竖排日文，带外发光，有的会闪）----
  const glowTex = C.softDotTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  const flickers = [];
  signs.forEach((s, i) => {
    const word = SIGN_WORDS[i % SIGN_WORDS.length];
    const color = NEON[Math.floor(b.rand() * NEON.length)];
    const chars = [...word];
    const tex = C.canvasTexture(128, 128 * chars.length + 40, (g, w, h) => {
      g.fillStyle = '#101018';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = color;
      g.lineWidth = 6;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.font = `900 96px ${JP_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = color;
      g.shadowBlur = 18;
      g.fillStyle = color;
      chars.forEach((ch, k) => g.fillText(ch, w / 2, 20 + 128 * k + 66));
    });
    const sh = 0.8 * chars.length + 0.3;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.14, sh, 0.8), [mat, mat, new THREE.MeshBasicMaterial({ color: '#101018' }), new THREE.MeshBasicMaterial({ color: '#101018' }), mat, mat]);
    sign.position.set(s.side * (STREET + 1.4), Math.max(s.h, 3.6 + sh / 2), s.z);
    b.add(sign);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.copy(sign.position);
    glow.scale.set(2.8, sh * 1.5, 1);
    b.add(glow);
    if (b.rand() < 0.25) flickers.push({ mat, glow, p: b.rand() * 10 });
  });
  b.onUpdate((dt, t) => {
    for (const f of flickers) {
      const on = Math.sin(t * 9 + f.p) + Math.sin(t * 23 + f.p * 3) > -1.2;
      f.mat.color.setScalar(on ? 1 : 0.25);
      f.glow.material.opacity = on ? 0.35 : 0.05;
    }
  });

  // ---- 红灯笼：沿着店面挂一排 ----
  {
    const spots = [];
    for (const side of [-1, 1]) for (let z = -40; z < 40; z += 1.6) if (Math.abs(z) > 2) spots.push({ x: side * (STREET + 1.6), z, y: 3.1 });
    const geo = new THREE.SphereGeometry(0.22, 12, 8);
    geo.scale(1, 1.3, 1);
    const lanterns = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ff4a2e' }), spots.length);
    C.placeInstances(lanterns, spots, (d, p) => { d.position.y = p.y; });
    b.add(lanterns);
    const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, color: '#ff6a3a', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }), spots.length);
    C.placeInstances(glows, spots, (d, p) => { d.position.y = p.y; d.rotation.y = p.x > 0 ? -Math.PI / 2 : Math.PI / 2; d.scale.setScalar(1.3); });
    b.add(glows);
  }

  // ---- 自动售货机 ----
  {
    const front = C.canvasTexture(128, 256, (g, w, h) => {
      g.fillStyle = '#f4f7fb';
      g.fillRect(0, 0, w, h);
      const cols = ['#e23b3b', '#2f7de1', '#f2b632', '#3bb36b', '#8a4be2', '#f07c2a'];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
        g.fillStyle = cols[(r * 5 + c) % cols.length];
        g.fillRect(10 + c * 22, 18 + r * 38, 16, 28);
      }
      g.fillStyle = '#222';
      g.fillRect(14, 190, 100, 40);
    });
    const spots = [{ x: -STREET - 1.6, z: -5.5 }, { x: -STREET - 1.6, z: -6.5 }, { x: STREET + 1.6, z: 4.5 }, { x: STREET + 1.6, z: -12 }, { x: -STREET - 1.6, z: 11 }];
    for (const p of spots) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.85, 0.9), [
        new THREE.MeshLambertMaterial({ color: '#d9dde3' }), new THREE.MeshLambertMaterial({ color: '#d9dde3' }),
        new THREE.MeshLambertMaterial({ color: '#cfd3d9' }), new THREE.MeshLambertMaterial({ color: '#cfd3d9' }),
        new THREE.MeshBasicMaterial({ map: front }), new THREE.MeshLambertMaterial({ color: '#d9dde3' }),
      ]);
      m.position.set(p.x, 0.12 + 0.925, p.z);
      m.rotation.y = p.x < 0 ? Math.PI / 2 : -Math.PI / 2;
      b.add(m);
    }
  }

  // ---- 电线杆和电线 ----
  {
    const poleMat = new THREE.MeshLambertMaterial({ color: '#6f6a64' });
    const tops = [];
    for (const side of [-1, 1]) {
      for (let z = -60; z <= 60; z += 15) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 9, 8), poleMat);
        pole.position.set(side * (STREET + 0.4), 4.5, z + side * 3);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), poleMat);
        bar.position.set(side * (STREET + 0.4), 8.2, z + side * 3);
        b.add(pole, bar);
        tops.push(new THREE.Vector3(side * (STREET + 0.4), 8.2, z + side * 3));
      }
    }
    const pts = [];
    const sag = (a, c, n = 10) => {
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const p0 = a.clone().lerp(c, t0), p1 = a.clone().lerp(c, t1);
        p0.y -= Math.sin(t0 * Math.PI) * 0.8;
        p1.y -= Math.sin(t1 * Math.PI) * 0.8;
        pts.push(p0, p1);
      }
    };
    const left = tops.filter((t) => t.x < 0), right = tops.filter((t) => t.x > 0);
    for (const row of [left, right]) for (let i = 0; i < row.length - 1; i++) for (const dy of [0, -0.35]) sag(row[i].clone().setY(row[i].y + dy), row[i + 1].clone().setY(row[i + 1].y + dy));
    for (let i = 0; i < left.length; i += 2) sag(left[i], right[Math.min(i, right.length - 1)]);
    b.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#141418' })));
  }

  // ---- 行人：在人行道上来来往往 ----
  {
    const N = 44;
    const geo = new THREE.CapsuleGeometry(0.2, 1.1, 4, 8);
    geo.translate(0, 0.75, 0);
    const people = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), N);
    const outfit = ['#2d3142', '#bfc0c0', '#4f5d75', '#ef8354', '#1b1b1e', '#7d5ba6', '#e0c097', '#3d5a80'].map((h) => new THREE.Color(h));
    const walkers = Array.from({ length: N }, (_, i) => {
      people.setColorAt(i, outfit[i % outfit.length]);
      const side = i % 2 ? 1 : -1;
      return { x: side * (STREET + 0.6 + b.rand() * 0.9), z: (b.rand() - 0.5) * LEN * 1.6, v: (0.9 + b.rand() * 0.6) * (b.rand() < 0.5 ? 1 : -1), p: b.rand() * 6, s: 0.9 + b.rand() * 0.2 };
    });
    const d = new THREE.Object3D();
    b.add(people);
    b.onUpdate((dt, t) => {
      for (let i = 0; i < N; i++) {
        const w = walkers[i];
        w.z += w.v * dt;
        if (w.z > LEN * 0.8) w.z = -LEN * 0.8;
        if (w.z < -LEN * 0.8) w.z = LEN * 0.8;
        d.position.set(w.x, 0.12 + Math.abs(Math.sin(t * 6 * Math.abs(w.v) + w.p)) * 0.05, w.z);
        d.rotation.set(0, w.v > 0 ? 0 : Math.PI, 0);
        d.scale.setScalar(w.s);
        d.updateMatrix();
        people.setMatrixAt(i, d.matrix);
      }
      people.instanceMatrix.needsUpdate = true;
    });
  }

  return b.finish({ fog: new THREE.Fog(fogColor, 12, 62) });
}
