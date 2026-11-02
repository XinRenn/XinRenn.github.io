// 雨中的伦敦街头（傍晚）：你站在宽阔的石板广场上，一侧是连排的砖砌联排房屋，
// 另一侧是马路和对面的房子，红色双层巴士不时驶过。下着雨，地上有积水和涟漪，
// 维多利亚式路灯亮着暖光，撑伞的行人匆匆走过。
import * as C from './common.js';
const { THREE } = C;

export function create() {
  const b = C.createBuilder(99);
  const fogColor = '#6f7985';
  const LEN = 70;
  const ROAD_X0 = -15, ROAD_X1 = -8; // 马路的范围（在你左边）
  const EAST = 8;                     // 右边那排房子的正面

  C.addLights(b, { sky: '#aab5c3', ground: '#3a3f47', hemi: 1.05, sun: '#c9d3de', sunIntensity: 0.5, sunDir: new THREE.Vector3(0.2, 1, 0.3) });
  C.addSky(b, { top: '#3f4956', mid: '#5f6a78', horizon: '#8a939e', sun: 0 });
  C.addClouds(b, { color: '#7c8592', tint: '#7c8592', count: 22, minH: 14, maxH: 24, radius: 40, opacity: 0.9, width: [30, 50] });

  // ---- 地面：石板广场 + 马路（湿漉漉的反光）----
  {
    const slabs = C.canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#5b5f66';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const l = 82 + Math.random() * 18;
        g.fillStyle = `hsl(215, 6%, ${l / 2.6}%)`;
        g.fillRect(x * 64 + (y % 2) * 32 + 2, y * 64 + 2, 60, 60);
      }
    });
    slabs.wrapS = slabs.wrapT = THREE.RepeatWrapping;
    slabs.repeat.set(10, 70);
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(EAST - ROAD_X1, LEN * 2), new THREE.MeshStandardMaterial({ map: slabs, roughness: 0.35, metalness: 0.1 }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set((EAST + ROAD_X1) / 2, -0.005, 0);
    b.add(plaza);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_X1 - ROAD_X0 + 30, LEN * 2), new THREE.MeshStandardMaterial({ color: '#25282d', roughness: 0.2, metalness: 0.15 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set((ROAD_X0 - 30 + ROAD_X1) / 2, -0.12, 0);
    b.add(road);
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, LEN * 2), new THREE.MeshLambertMaterial({ color: '#8b8f96' }));
    kerb.position.set(ROAD_X1 + 0.15, -0.06, 0);
    b.add(kerb);
    // 路边的双黄线和中间的白色虚线
    const yellow = new THREE.MeshBasicMaterial({ color: '#d9b23a' });
    for (const dx of [0.35, 0.55]) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.1, LEN * 2), yellow);
      l.rotation.x = -Math.PI / 2;
      l.position.set(ROAD_X1 - dx, -0.115, 0);
      b.add(l);
    }
    const white = new THREE.MeshBasicMaterial({ color: '#cfd2d6' });
    for (let z = -LEN; z < LEN; z += 6) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 3), white);
      l.rotation.x = -Math.PI / 2;
      l.position.set((ROAD_X0 + ROAD_X1) / 2, -0.115, z);
      b.add(l);
    }
  }

  // ---- 积水：雨点落下的涟漪 ----
  {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: b.uTime },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        void main() {
          vec2 p = vUv - 0.5;
          float edge = smoothstep(0.5, 0.38, length(p));
          vec2 g = vUv * 6.0;
          float rip = 0.0;
          for (int k = 0; k < 2; k++) {
            vec2 cell = floor(g + float(k) * 0.5);
            vec2 c = cell + vec2(h(cell), h(cell + 3.1)) - float(k) * 0.5;
            float t = fract(uTime * 0.8 + h(cell + 7.7));
            float d = length(g - c);
            rip += smoothstep(0.06, 0.0, abs(d - t * 0.6)) * (1.0 - t);
          }
          vec3 col = vec3(0.36, 0.4, 0.46) + rip * 0.35;
          gl_FragColor = vec4(col, edge * 0.75);
          #include <colorspace_fragment>
        }`,
    });
    const spots = [[5.5, -6, 2.4, 1.4], [-5.6, 5, 2, 1.2], [6, 7, 1.6, 1], [-4.5, -8, 2.8, 1.5], [-11.5, -4, 3, 1.4], [-10.5, 9, 2.4, 1.2]];
    for (const [x, z, w, d] of spots) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, x < ROAD_X1 ? -0.11 : 0.003, z);
      b.add(m);
    }
  }

  // ---- 联排房屋 ----
  const facade = (style) => C.canvasTexture(256, 512, (g, w, h) => {
    const r = C.rng(style * 13 + 5);
    const bricks = ['#7a4a35', '#8a5a3c', '#a8835a', '#6e4434'][style % 4];
    g.fillStyle = bricks;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      for (let x = (y / 8) % 2 ? -8 : 0; x < w; x += 16) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.15})`;
        g.fillRect(x + 1, y + 1, 14, 6);
      }
    }
    if (style % 2 === 0) { g.fillStyle = '#e8e4da'; g.fillRect(0, h - 150, w, 150); } // 一楼刷白
    for (let floor = 0; floor < 3; floor++) {
      const y = 40 + floor * 125;
      for (const x of [40, 150]) {
        const lit = r() < 0.4;
        g.fillStyle = '#f2efe8';
        g.fillRect(x - 6, y - 6, 78, 106);
        g.fillStyle = lit ? '#ffcf7a' : '#2b3036';
        g.fillRect(x, y, 66, 94);
        g.fillStyle = '#f2efe8';
        g.fillRect(x, y + 44, 66, 6);
        g.fillRect(x + 30, y, 6, 94);
      }
    }
    const doorColors = ['#1f4f8a', '#b8322a', '#2f6b45', '#1b1b1b'];
    g.fillStyle = '#f2efe8';
    g.fillRect(36, h - 140, 74, 140);
    g.fillStyle = doorColors[style % doorColors.length];
    g.fillRect(44, h - 118, 58, 118);
    g.fillStyle = '#ffd98a';
    g.beginPath();
    g.arc(73, h - 118, 29, Math.PI, 0);
    g.fill();
  });
  const facades = [0, 1, 2, 3, 4, 5].map(facade);
  function terrace(xFront, dir) {
    let z = -LEN;
    let i = 0;
    while (z < LEN) {
      const w = 5, h = 10 + (b.rand() < 0.3 ? 1.5 : 0), d = 9;
      const tex = facades[(i + (dir > 0 ? 0 : 3)) % facades.length];
      const front = new THREE.MeshLambertMaterial({ map: tex });
      const plain = new THREE.MeshLambertMaterial({ color: '#6e4a38' });
      const mats = dir < 0 ? [plain, front, plain, plain, plain, plain] : [front, plain, plain, plain, plain, plain];
      const house = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), mats);
      house.position.set(xFront - dir * d / 2, h / 2, z + w / 2);
      b.add(house);
      // 屋顶烟囱
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 1.6), new THREE.MeshLambertMaterial({ color: '#5e3c2e' }));
      ch.position.set(house.position.x, h + 0.7, z + 0.4);
      b.add(ch);
      z += w;
      i++;
    }
  }
  terrace(EAST, -1);          // 右边：正面朝 -x
  terrace(ROAD_X0 - 2, 1);    // 马路对面：正面朝 +x

  // 右边房子前面的黑色铁栏杆
  {
    const spots = [];
    for (let z = -40; z < 40; z += 0.25) spots.push({ x: EAST - 1.2, z });
    const bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 4), new THREE.MeshLambertMaterial({ color: '#141414' }), spots.length);
    C.placeInstances(bars, spots, (d) => { d.position.y = 0.5; });
    b.add(bars);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 80), new THREE.MeshLambertMaterial({ color: '#141414' }));
    rail.position.set(EAST - 1.2, 1, 0);
    b.add(rail);
  }

  // ---- 维多利亚式路灯 ----
  const glowTex = C.softDotTexture('rgba(255,220,160,0.9)', 'rgba(255,200,120,0)');
  for (const x of [ROAD_X1 + 0.8, EAST - 2]) {
    for (let z = -48; z <= 48; z += 12) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 4, 8), new THREE.MeshLambertMaterial({ color: '#1a1d1f' }));
      pole.position.y = 2;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.6, 6), new THREE.MeshBasicMaterial({ color: '#ffd28a' }));
      head.position.y = 4.3;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.3, 6), new THREE.MeshLambertMaterial({ color: '#1a1d1f' }));
      cap.position.y = 4.75;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.y = 4.3;
      glow.scale.setScalar(2.2);
      g.add(pole, head, cap, glow);
      g.position.set(x, 0, z + (x < 0 ? 6 : 0));
      b.add(g);
    }
  }
  // 照亮游戏区域的两盏暖光（湿地面上会有反光）
  for (const [x, z] of [[EAST - 2, 0], [ROAD_X1 + 0.8, 6]]) {
    const l = new THREE.PointLight('#ffcf8a', 14, 16, 1.5);
    l.position.set(x, 4.2, z);
    b.lights.push(l);
  }

  // ---- 红色邮筒 ----
  {
    const box = new THREE.Group();
    const red = new THREE.MeshLambertMaterial({ color: '#c8102e' });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 1.3, 20), red);
    body.position.y = 0.65;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.31, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), red);
    top.position.y = 1.3;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: '#111' }));
    slot.position.set(0, 1.08, 0.29);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.1, 20), new THREE.MeshLambertMaterial({ color: '#111' }));
    base.position.y = 0.05;
    box.add(body, top, slot, base);
    box.position.set(-6.4, 0, -4.5);
    box.rotation.y = Math.PI / 2;
    b.add(box);
  }

  // ---- 红色双层巴士：沿着马路开过去 ----
  {
    const bus = new THREE.Group();
    const L = 10, W = 2.5, H = 4.3;
    const side = C.canvasTexture(512, 256, (g, w, h) => {
      g.fillStyle = '#c8102e';
      g.fillRect(0, 0, w, h);
      for (const y of [30, 140]) {
        g.fillStyle = '#ffe2a8';
        g.fillRect(20, y, w - 40, 62);
        g.fillStyle = '#c8102e';
        for (let x = 20; x < w - 20; x += 70) g.fillRect(x, y, 6, 62);
      }
      g.fillStyle = '#f2f2f2';
      g.fillRect(0, 118, w, 8);
    });
    const sideMat = new THREE.MeshLambertMaterial({ map: side, emissive: '#331100', emissiveMap: side, emissiveIntensity: 0.4 });
    const red = new THREE.MeshLambertMaterial({ color: '#c8102e' });
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), [sideMat, sideMat, red, red, red, red]);
    body.position.y = H / 2 + 0.35;
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshLambertMaterial({ color: '#111' });
    for (const zz of [-3.4, 3.4]) for (const xx of [-1.2, 1.2]) {
      const wh = new THREE.Mesh(wheelGeo, wheelMat);
      wh.position.set(xx, 0.5, zz);
      bus.add(wh);
    }
    for (const xx of [-0.8, 0.8]) {
      const hl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff6d8', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      hl.position.set(xx, 0.9, -L / 2 - 0.05);
      hl.scale.setScalar(1.2);
      bus.add(hl);
    }
    bus.add(body);
    b.add(bus);
    const laneX = (ROAD_X0 + ROAD_X1) / 2 + 1.6;
    let t0 = 0;
    b.onUpdate((dt) => {
      t0 += dt;
      const period = 22, travel = 14;
      const k = (t0 % period) / travel;
      bus.visible = k <= 1;
      bus.position.set(laneX, -0.12, THREE.MathUtils.lerp(LEN, -LEN, Math.min(k, 1)));
    });
  }

  // ---- 撑伞的行人 ----
  {
    const N = 18;
    const bodyGeo = new THREE.CapsuleGeometry(0.2, 1.05, 4, 8);
    bodyGeo.translate(0, 0.72, 0);
    const umbGeo = new THREE.ConeGeometry(0.55, 0.25, 10, 1, true);
    umbGeo.translate(0, 1.95, 0);
    const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial(), N);
    const umbs = new THREE.InstancedMesh(umbGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), N);
    const coats = ['#2b2d31', '#5a4a3a', '#3b4a5a', '#7a2e2e', '#bba68a'].map((h) => new THREE.Color(h));
    const umbC = ['#111111', '#1f3f6f', '#b8322a', '#2f2f2f', '#e0c040'].map((h) => new THREE.Color(h));
    const walkers = Array.from({ length: N }, (_, i) => {
      bodies.setColorAt(i, coats[i % coats.length]);
      umbs.setColorAt(i, umbC[(i * 3) % umbC.length]);
      const lane = i % 2 ? EAST - 0.6 : -6.6 - (i % 3) * 0.2;
      return { x: lane, z: (b.rand() - 0.5) * LEN * 1.6, v: (1 + b.rand() * 0.6) * (b.rand() < 0.5 ? 1 : -1), p: b.rand() * 6 };
    });
    const d = new THREE.Object3D();
    b.add(bodies, umbs);
    b.onUpdate((dt, t) => {
      for (let i = 0; i < N; i++) {
        const w = walkers[i];
        w.z += w.v * dt;
        if (w.z > LEN * 0.8) w.z = -LEN * 0.8;
        if (w.z < -LEN * 0.8) w.z = LEN * 0.8;
        d.position.set(w.x, Math.abs(Math.sin(t * 7 + w.p)) * 0.04, w.z);
        d.rotation.set(0, w.v > 0 ? 0 : Math.PI, 0);
        d.updateMatrix();
        bodies.setMatrixAt(i, d.matrix);
        umbs.setMatrixAt(i, d.matrix);
      }
      bodies.instanceMatrix.needsUpdate = true;
      umbs.instanceMatrix.needsUpdate = true;
    });
  }

  // ---- 雨 ----
  C.addRain(b, { count: 1600, radius: 13, height: 9, speed: 9.5, length: 0.4, color: '#c3cfdc', opacity: 0.4 });

  return b.finish({ fog: new THREE.Fog(fogColor, 10, 58) });
}
