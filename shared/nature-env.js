// 大自然风光背景：黄昏时分的草地、远山、松林、湖泊、云朵和飘浮的光点。
// 所有东西都由代码生成，不需要任何图片或模型文件。为了在 Quest 上流畅运行，
// 树和草都用 InstancedMesh（一次绘制成百上千个）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PALETTE = {
  skyTop: '#3a6db5',
  skyMid: '#8db6dd',
  horizon: '#ffd3a3',
  sun: '#ffcf8a',
  fog: '#efcfaa',
  mountains: ['#cdb7bb', '#a59cae', '#7a8798', '#56706d'], // 远 → 近
  grass: ['#6f9b4a', '#86ad55', '#5c8a3f', '#7fa34c'],
  foliage: ['#2f5d3a', '#3a6b3d', '#46773f', '#2a5236'],
  roundFoliage: ['#5f8f3c', '#77a043', '#8aa63f', '#c9a64a'],
  trunk: '#6b4a32',
  rock: '#8d8a84',
  flowers: ['#ffffff', '#ffe066', '#ff9ec7', '#b99cff', '#ff8a5c'],
};

// 小工具：可重复的随机数，让每次打开场景都长一样
function rng(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

// 首尾相接的一维"噪声"（用整数频率的正弦叠加），用来生成山脊和起伏
function ringNoise(rand, octaves = 6) {
  const waves = [];
  for (let i = 0; i < octaves; i++) {
    const f = Math.round(2 + Math.pow(2, i) * (1 + rand()));
    waves.push({ f, p: rand() * Math.PI * 2, a: 1 / Math.pow(1.7, i) });
  }
  const total = waves.reduce((s, w) => s + w.a, 0);
  return (angle) => waves.reduce((s, w) => s + w.a * Math.sin(angle * w.f + w.p), 0) / total;
}

export function createNatureEnv({ seed = 7, clearRadius = 4 } = {}) {
  const rand = rng(seed);
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 } };

  const sunDir = new THREE.Vector3(-0.85, 0.2, -0.75).normalize();
  const sunAz = Math.atan2(sunDir.z, sunDir.x);
  const fog = new THREE.Fog(PALETTE.fog, 18, 85);

  // ---------- 灯光 ----------
  // 灯光单独返回，不放进 group：混合现实模式下隐藏风景，但游戏物体仍需要照明
  const hemi = new THREE.HemisphereLight('#ffe9cc', '#4a6b35', 1.15);
  const sun = new THREE.DirectionalLight('#ffd9a6', 2.2);
  sun.position.copy(sunDir).multiplyScalar(10);
  const lights = [hemi, sun];

  // ---------- 天空 ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(95, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(PALETTE.skyTop) },
        mid: { value: new THREE.Color(PALETTE.skyMid) },
        horizon: { value: new THREE.Color(PALETTE.horizon) },
        sunColor: { value: new THREE.Color(PALETTE.sun) },
        sunDir: { value: sunDir },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // 永远在最远处
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top, mid, horizon, sunColor, sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.28, h));
          col = mix(col, top, smoothstep(0.28, 0.95, h));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 40.0) * 0.45 + pow(s, 6.0) * 0.22);
          // 太阳一侧的地平线更暖
          col += vec3(0.25, 0.1, 0.0) * pow(s, 2.0) * (1.0 - smoothstep(0.0, 0.35, abs(h)));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    })
  );
  sky.renderOrder = -10;
  group.add(sky);

  // ---------- 云 ----------
  const cloudTex = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    const r = rng(seed + 11);
    for (let i = 0; i < 26; i++) {
      const x = 40 + r() * 176, y = 50 + r() * 40, rad = 18 + r() * 34;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const clouds = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const r = 60 + rand() * 22;
    const towardSun = Math.max(0, Math.cos(a - sunAz));
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: cloudTex, transparent: true, depthWrite: false, fog: false,
        color: new THREE.Color('#ffffff').lerp(new THREE.Color('#ffb98a'), towardSun * 0.8),
        opacity: 0.75 + rand() * 0.25,
      })
    );
    s.position.set(Math.cos(a) * r, 16 + rand() * 20, Math.sin(a) * r);
    const w = 22 + rand() * 20;
    s.scale.set(w, w * 0.42, 1);
    clouds.add(s);
  }
  group.add(clouds);

  // ---------- 远山（几层，越远越淡）----------
  PALETTE.mountains.forEach((hex, layer) => {
    const radius = 88 - layer * 9;
    const n = ringNoise(rng(seed + 100 + layer * 17));
    const peak = 19 - layer * 3;
    const seg = 256;
    const pos = [], col = [], idx = [];
    const top = new THREE.Color(hex);
    const haze = new THREE.Color(PALETTE.fog);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      let h = 4 + (n(a) * 0.5 + 0.5) * peak;
      // 太阳方向的山低一点，留出夕阳的景观
      h *= 1 - 0.45 * Math.pow(Math.max(0, Math.cos(a - sunAz)), 4);
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      pos.push(x, -1, z, x, h, z);
      const base = haze.clone().lerp(top, 0.35);
      col.push(base.r, base.g, base.b, top.r, top.g, top.b);
      if (i < seg) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -9 + layer;
    group.add(m);
  });

  // ---------- 湖 ----------
  const lake = { x: 15, z: 9, r: 8 };
  {
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(lake.r, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: {
          uTime: uniforms.uTime,
          deep: { value: new THREE.Color('#1d4a63') },
          skyCol: { value: new THREE.Color('#9fc4df') },
          warm: { value: new THREE.Color('#ffc999') },
          sunColor: { value: new THREE.Color(PALETTE.sun) },
          center: { value: new THREE.Vector2(lake.x, lake.z) },
          radius: { value: lake.r },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, radius;
          uniform vec3 deep, skyCol, warm, sunColor;
          uniform vec2 center;
          varying vec3 vWorld;
          void main() {
            vec3 V = normalize(cameraPosition - vWorld);
            float fres = pow(1.0 - max(V.y, 0.0), 2.5);
            vec3 col = mix(deep, skyCol, 0.15 + 0.6 * fres);
            col = mix(col, warm, 0.25 * fres * fres);
            float r = sin(vWorld.x * 2.3 + uTime * 1.2) * sin(vWorld.z * 2.9 - uTime * 0.9)
                    + 0.5 * sin((vWorld.x + vWorld.z) * 5.0 + uTime * 2.0);
            col += sunColor * pow(max(r, 0.0) / 1.5, 10.0) * 0.6;
            float edge = smoothstep(radius, radius - 0.6, distance(vWorld.xz, center));
            gl_FragColor = vec4(col, 0.92 * edge);
            #include <colorspace_fragment>
          }`,
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(lake.x, 0.02, lake.z);
    group.add(water);
  }
  const inLake = (x, z, pad = 0) => Math.hypot(x - lake.x, z - lake.z) < lake.r + pad;

  // ---------- 地面：近处平坦，远处起伏成丘陵 ----------
  {
    const hill = ringNoise(rng(seed + 300), 5);
    const rings = 70, seg = 120, maxR = 92;
    const pos = [], col = [], idx = [];
    const grass = PALETTE.grass.map((h) => new THREE.Color(h));
    const shore = new THREE.Color('#8c8a5a');
    pos.push(0, 0, 0);
    col.push(grass[0].r, grass[0].g, grass[0].b);
    for (let i = 1; i <= rings; i++) {
      const r = Math.pow(i / rings, 1.6) * maxR;
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const far = THREE.MathUtils.smoothstep(r, 30, 80);
        let y = far * (3 + hill(a + r * 0.02) * 5);
        if (inLake(x, z, 1.5)) y = Math.min(y, -0.05);
        pos.push(x, y, z);
        // 平滑变化的草色（不用逐点随机，避免出现放射状条纹）
        const t = THREE.MathUtils.clamp(
          0.5 + 0.22 * (Math.sin(x * 0.23) + Math.sin(z * 0.19 + 1.3)) + 0.12 * Math.sin((x - z) * 0.6), 0, 1);
        const c = grass[2].clone().lerp(grass[1], t);
        if (inLake(x, z, 1.8)) c.lerp(shore, 0.6);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
    for (let i = 1; i < rings; i++) {
      for (let j = 0; j < seg; j++) {
        const a = 1 + (i - 1) * seg + j;
        const b = 1 + (i - 1) * seg + ((j + 1) % seg);
        const c = a + seg, d = b + seg;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.position.y = -0.004;
    group.add(ground);
  }

  // ---------- 摆放工具 ----------
  const dummy = new THREE.Object3D();
  function scatter(count, minR, maxR, accept) {
    const out = [];
    let tries = 0;
    while (out.length < count && tries++ < count * 30) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(minR * minR + rand() * (maxR * maxR - minR * minR));
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (accept && !accept(x, z, a, r)) continue;
      out.push({ x, z, a, r });
    }
    return out;
  }
  // 给夕阳那边留一条视野走廊
  const vista = (a, r) => {
    let d = Math.abs(a - sunAz) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d < 0.32 && r < 50) return true;
    // 正前方（-z，雷区和面板所在的方向）也留出开阔草地，树长在两边
    let f = Math.abs(a - Math.PI * 1.5) % (Math.PI * 2);
    if (f > Math.PI) f = Math.PI * 2 - f;
    return f < 0.45 && r < 38;
  };
  const groundY = (r) => THREE.MathUtils.smoothstep(r, 30, 80) * 3;

  // ---------- 松树 ----------
  {
    const cones = [];
    for (let k = 0; k < 3; k++) {
      const g = new THREE.ConeGeometry(1.5 - k * 0.38, 2.2 - k * 0.3, 7);
      g.translate(0, 1.6 + k * 1.15, 0);
      cones.push(g);
    }
    const foliageGeo = mergeGeometries(cones);
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.4, 6);
    trunkGeo.translate(0, 0.7, 0);
    const spots = scatter(240, 11, 60, (x, z, a, r) => !inLake(x, z, 2) && !vista(a, r));
    const foliage = new THREE.InstancedMesh(foliageGeo, new THREE.MeshLambertMaterial({ flatShading: true }), spots.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: PALETTE.trunk }), spots.length);
    const colors = PALETTE.foliage.map((h) => new THREE.Color(h));
    spots.forEach((p, i) => {
      const s = 0.8 + rand() * 0.9;
      dummy.position.set(p.x, groundY(p.r) - 0.05, p.z);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.set(s, s * (0.9 + rand() * 0.4), s);
      dummy.updateMatrix();
      foliage.setMatrixAt(i, dummy.matrix);
      trunks.setMatrixAt(i, dummy.matrix);
      foliage.setColorAt(i, colors[i % colors.length].clone().multiplyScalar(0.85 + rand() * 0.3));
    });
    group.add(foliage, trunks);
  }

  // ---------- 圆冠树 ----------
  {
    const canopyGeo = new THREE.IcosahedronGeometry(1.3, 1);
    canopyGeo.translate(0, 2.6, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 2, 6);
    trunkGeo.translate(0, 1, 0);
    const spots = scatter(70, 10, 40, (x, z, a, r) => !inLake(x, z, 2) && !vista(a, r));
    const canopy = new THREE.InstancedMesh(canopyGeo, new THREE.MeshLambertMaterial({ flatShading: true }), spots.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: PALETTE.trunk }), spots.length);
    const colors = PALETTE.roundFoliage.map((h) => new THREE.Color(h));
    spots.forEach((p, i) => {
      const s = 0.8 + rand() * 0.6;
      dummy.position.set(p.x, groundY(p.r) - 0.05, p.z);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      canopy.setMatrixAt(i, dummy.matrix);
      trunks.setMatrixAt(i, dummy.matrix);
      canopy.setColorAt(i, colors[Math.floor(rand() * colors.length)]);
    });
    group.add(canopy, trunks);
  }

  // ---------- 石头 ----------
  {
    const spots = scatter(40, clearRadius + 2, 35, (x, z) => !inLake(x, z, 0.5));
    const lakeRocks = Array.from({ length: 10 }, () => {
      const a = rand() * Math.PI * 2;
      return { x: lake.x + Math.cos(a) * (lake.r + 0.3), z: lake.z + Math.sin(a) * (lake.r + 0.3), r: 15 };
    });
    const all = spots.concat(lakeRocks);
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.5, 0),
      new THREE.MeshLambertMaterial({ color: PALETTE.rock, flatShading: true }),
      all.length
    );
    all.forEach((p, i) => {
      const s = 0.3 + rand() * 1.1;
      dummy.position.set(p.x, groundY(p.r) + s * 0.15, p.z);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      dummy.scale.set(s * (1 + rand() * 0.6), s * 0.6, s);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    });
    group.add(rocks);
  }

  // 让草和花随风摆动：在标准材质的顶点着色器里加一段偏移
  function addWind(material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 root = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
          #else
            vec3 root = vec3(0.0);
          #endif
          float bend = position.y * position.y;
          float gust = sin(uTime * 1.6 + root.x * 0.35 + root.z * 0.22) * 0.6
                     + sin(uTime * 2.7 + root.x * 0.9) * 0.25;
          transformed.x += gust * bend * 0.8;
          transformed.z += gust * bend * 0.4;`
        );
    };
  }

  // ---------- 草 ----------
  {
    const blade = new THREE.PlaneGeometry(0.05, 0.4, 1, 3);
    const p = blade.attributes.position;
    const cols = [];
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 0.2; // 底部移到 y=0
      const taper = 1 - y / 0.4;
      p.setX(i, p.getX(i) * taper);
      p.setY(i, y);
      const shade = 0.55 + 0.45 * (y / 0.4);
      cols.push(shade, shade, shade);
    }
    blade.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    blade.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    addWind(mat);
    const spots = scatter(5000, clearRadius, 20, (x, z) => !inLake(x, z, 0.3));
    const grass = new THREE.InstancedMesh(blade, mat, spots.length);
    const colors = PALETTE.grass.map((h) => new THREE.Color(h));
    spots.forEach((s, i) => {
      const edge = THREE.MathUtils.smoothstep(s.r, clearRadius, clearRadius + 1.5);
      const h = (0.5 + rand() * 0.9) * (0.35 + 0.65 * edge);
      dummy.position.set(s.x, 0, s.z);
      dummy.rotation.set((rand() - 0.5) * 0.4, rand() * Math.PI, (rand() - 0.5) * 0.4);
      dummy.scale.set(1 + rand(), h, 1);
      dummy.updateMatrix();
      grass.setMatrixAt(i, dummy.matrix);
      grass.setColorAt(i, colors[Math.floor(rand() * colors.length)].clone().multiplyScalar(1.05 + rand() * 0.25));
    });
    group.add(grass);
  }

  // ---------- 野花 ----------
  {
    const head = new THREE.IcosahedronGeometry(0.035, 0);
    head.translate(0, 0.28, 0);
    const stem = new THREE.CylinderGeometry(0.004, 0.004, 0.28, 3);
    stem.translate(0, 0.14, 0);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    addWind(mat);
    const stemMat = new THREE.MeshLambertMaterial({ color: '#4f7a35' });
    addWind(stemMat);
    const spots = scatter(500, clearRadius + 0.5, 16, (x, z) => !inLake(x, z, 0.5));
    const heads = new THREE.InstancedMesh(head, mat, spots.length);
    const stems = new THREE.InstancedMesh(stem, stemMat, spots.length);
    const colors = PALETTE.flowers.map((h) => new THREE.Color(h));
    spots.forEach((s, i) => {
      const sc = 0.7 + rand() * 0.8;
      dummy.position.set(s.x, 0, s.z);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      stems.setMatrixAt(i, dummy.matrix);
      heads.setColorAt(i, colors[Math.floor(rand() * colors.length)]);
    });
    group.add(heads, stems);
  }

  // ---------- 飘浮的金色光点 ----------
  const motes = (() => {
    const n = 160;
    const pos = new Float32Array(n * 3);
    const base = [];
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = 2.5 + rand() * 12;
      base.push({ x: Math.cos(a) * r, y: 0.4 + rand() * 2.8, z: Math.sin(a) * r, p: rand() * 10, s: 0.3 + rand() * 0.6 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,240,190,1)');
    grad.addColorStop(0.3, 'rgba(255,215,130,0.6)');
    grad.addColorStop(1, 'rgba(255,200,100,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ map: tex, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    );
    return {
      object: pts,
      update(t) {
        for (let i = 0; i < n; i++) {
          const b = base[i];
          pos[i * 3] = b.x + Math.sin(t * b.s + b.p) * 0.6;
          pos[i * 3 + 1] = b.y + Math.sin(t * b.s * 1.3 + b.p * 2) * 0.35;
          pos[i * 3 + 2] = b.z + Math.cos(t * b.s * 0.8 + b.p) * 0.6;
        }
        geo.attributes.position.needsUpdate = true;
      },
    };
  })();
  group.add(motes.object);

  let time = 0;
  function update(dt) {
    time += dt;
    uniforms.uTime.value = time;
    clouds.rotation.y += dt * 0.003;
    motes.update(time);
  }

  return { group, lights, fog, update };
}
