// 瀑布：正前方是一面弧形的高崖，瀑布从崖顶倾泻进深潭，底部水雾弥漫，水雾里挂着一道彩虹。
import * as C from './common.js';
const { THREE } = C;

export function create() {
  const b = C.createBuilder(64);
  const sunDir = new THREE.Vector3(0.25, 0.8, 0.55).normalize(); // 太阳在你背后，彩虹才看得见
  const sunAz = Math.atan2(sunDir.z, sunDir.x);
  const fogColor = '#d4e8ee';
  const CLIFF_R = 24, CLIFF_H = 28, ARC = 2.3; // 崖壁半径、高度、张角（弧度）

  C.addLights(b, { sky: '#f0fbff', ground: '#3f6a3a', hemi: 1.2, sun: '#fff7e6', sunIntensity: 1.8, sunDir });
  C.addSky(b, { top: '#3d7cc9', mid: '#9ccbe8', horizon: '#d7ecf3', sunDir, sunColor: '#fff6dd', sun: 0.6 });
  C.addClouds(b, { sunAz, count: 12 });
  C.addMountains(b, { colors: ['#b6c9d6', '#93aabb', '#6f8a7d', '#557a5a'], haze: fogColor, peak: 26, base: 8 });

  const pool = { x: 0, z: -16.5, r: 8.5 };
  const inPool = (x, z, pad = 0) => Math.hypot(x - pool.x, z - pool.z) < pool.r + pad;
  const inCliffZone = (x, z) => Math.hypot(x, z) > CLIFF_R - 2 && C.angDiff(Math.atan2(z, x), -Math.PI / 2) < ARC / 2 + 0.1;

  C.addWater(b, { shape: 'circle', radius: pool.r, x: pool.x, z: pool.z, y: -0.12, deep: '#13505a', sky: '#a9d6e3', warm: '#e9f6fa', sun: '#ffffff', fog: fogColor, wave: 0.8, sparkle: 0.7 });
  const ga = new THREE.Color('#4f8a3c'), gb = new THREE.Color('#78a94a'), wet = new THREE.Color('#5d6b58');
  C.addGround(b, {
    colorAt: (x, z) => {
      const c = ga.clone().lerp(gb, THREE.MathUtils.clamp(0.5 + 0.25 * (Math.sin(x * 0.27) + Math.sin(z * 0.21)), 0, 1));
      return inPool(x, z, 1.6) ? c.lerp(wet, 0.7) : c;
    },
    heightAt: (x, z) => (inPool(x, z, 1) ? -0.6 : 0),
    hills: { start: 30, end: 80, height: 6, seed: 12 },
  });

  // ---- 弧形崖壁 ----
  {
    const geo = new THREE.CylinderGeometry(CLIFF_R, CLIFF_R + 3, CLIFF_H, 60, 14, true, Math.PI - ARC / 2, ARC);
    geo.translate(0, CLIFF_H / 2 - 0.5, 0);
    const p = geo.attributes.position;
    const cols = [];
    const rock = new THREE.Color('#5f5a52'), dark = new THREE.Color('#3f3c38'), moss = new THREE.Color('#4f7a3a');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(x, z);
      const n = Math.sin(a * 23 + y * 0.7) * 0.6 + Math.sin(a * 51 - y * 1.3) * 0.35 + Math.sin(y * 2.1 + a * 9) * 0.3;
      const k = 1 + n * 0.035; // 向外/向内起伏，形成岩石感
      p.setX(i, x * k);
      p.setZ(i, z * k);
      let c = rock.clone().lerp(dark, THREE.MathUtils.clamp(0.5 + n * 0.5, 0, 1));
      if (y > CLIFF_H - 4 || (n > 0.55 && y > 4)) c = c.lerp(moss, 0.7); // 崖顶和岩架上长苔藓
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    b.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true })));
    // 崖顶的平地和树
    const top = new THREE.Mesh(
      new THREE.RingGeometry(CLIFF_R + 1, CLIFF_R + 26, 40, 1, -Math.PI / 2 - ARC / 2 - 0.05, ARC + 0.1),
      new THREE.MeshLambertMaterial({ color: '#557f3e', side: THREE.DoubleSide })
    );
    top.rotation.x = Math.PI / 2;
    top.position.y = CLIFF_H - 0.6;
    b.add(top);
    const treeSpots = [];
    for (let i = 0; i < 60; i++) {
      const a = -Math.PI / 2 + (b.rand() - 0.5) * ARC;
      if (Math.abs(a + Math.PI / 2) < 0.16) continue; // 瀑布口不种树
      const r = CLIFF_R + 2 + b.rand() * 14;
      treeSpots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: CLIFF_H - 0.6, r });
    }
    C.addPines(b, { spots: treeSpots, colors: ['#2c5a36', '#356b3c', '#24502f'], yAt: (q) => q.y + 0.05 });
  }

  // ---- 瀑布：向下流动的水流 + 底部白色水花 ----
  const fallMat = (bright = 1) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: b.uTime, bright: { value: bright } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, bright;
      varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec2 p = vec2(vUv.x * 18.0, vUv.y * 4.0 + uTime * 2.2);
        float v = n(p) * 0.55 + n(p * 2.3 + 7.0) * 0.3 + n(p * 5.1 - 3.0) * 0.15;
        vec3 col = mix(vec3(0.62, 0.8, 0.88), vec3(1.0), smoothstep(0.35, 0.8, v)) * bright;
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float a = edge * (0.55 + 0.45 * v);
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
  function addFall(angle, width, height, inset = 1.2) {
    const geo = new THREE.PlaneGeometry(width, height, 1, 12);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / height + 0.5; // 0 底 → 1 顶
      p.setX(i, p.getX(i) * (1 + (1 - y) * 0.45)); // 越往下越散开
      p.setZ(i, Math.pow(1 - y, 2) * 1.5);         // 下落时稍微往外鼓
    }
    const m = new THREE.Mesh(geo, fallMat());
    const r = CLIFF_R - inset;
    m.position.set(Math.cos(angle) * r, CLIFF_H - height / 2 - 0.6, Math.sin(angle) * r);
    m.rotation.y = Math.atan2(-Math.cos(angle), -Math.sin(angle));
    b.add(m);
    return m;
  }
  addFall(-Math.PI / 2, 6, CLIFF_H - 0.4);
  addFall(-Math.PI / 2 + 0.55, 1.6, CLIFF_H * 0.75, 1.0);

  // 瀑布底部的水雾和水花
  const baseX = 0, baseZ = -(CLIFF_R - 2.5);
  C.addParticles(b, { count: 70, radius: 4.5, center: [baseX, baseZ], yMin: -0.2, yMax: 7, size: 3.2, color: '#ffffff', opacity: 0.22, velocity: [0, 0.5, 0.15], sway: 0.6, swaySpeed: 0.4 });
  C.addParticles(b, { count: 160, radius: 3.5, center: [baseX, baseZ], yMin: 0, yMax: 3, size: 0.18, color: '#ffffff', opacity: 0.8, velocity: [0, 1.6, 0.3], sway: 0.5, swaySpeed: 2 });

  // 彩虹
  {
    const inner = 7.5, outer = 8.4;
    const geo = new THREE.RingGeometry(inner, outer, 64, 1, 0.15, Math.PI - 0.3);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { inner: { value: inner }, outer: { value: outer }, uTime: b.uTime },
      vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float inner, outer, uTime;
        varying vec2 vP;
        vec3 hue(float t) { return clamp(abs(mod(t * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
        void main() {
          float t = (length(vP) - inner) / (outer - inner);
          float a = sin(t * 3.14159) * 0.28 * (0.8 + 0.2 * sin(uTime * 0.7));
          float ends = smoothstep(0.0, 2.0, vP.y);
          gl_FragColor = vec4(hue(0.8 - t * 0.8) * a * ends, 1.0);
        }`,
    });
    const bow = new THREE.Mesh(geo, mat);
    bow.position.set(0, -1.5, -15);
    b.add(bow);
  }

  // 四周的植被
  const open = (x, z, a, r) => !inPool(x, z, 1.5) && !inCliffZone(x, z);
  const sides = (x, z, a, r) => open(x, z, a, r) && C.angDiff(a, -Math.PI / 2) > 0.55;
  C.addRoundTrees(b, { spots: C.scatter(b, 80, 9, 40, sides), colors: ['#3f7a34', '#4f8a3c', '#5f9a3e', '#356b2e'], canopy: 1.6 });
  C.addPines(b, { spots: C.scatter(b, 120, 14, 55, sides), colors: ['#2c5a36', '#356b3c'] });
  const rocks = C.scatter(b, 26, 5, 18, open);
  for (let i = 0; i < 18; i++) {
    const a = b.rand() * Math.PI * 2;
    rocks.push({ x: pool.x + Math.cos(a) * (pool.r + 0.4), z: pool.z + Math.sin(a) * (pool.r + 0.4) });
  }
  C.addRocks(b, { spots: rocks, color: '#77736b', size: [0.5, 1.8] });
  C.addGrass(b, { spots: C.scatter(b, 4000, 4, 20, open), colors: ['#4f8a3c', '#6f9f45', '#3f7a34'] });
  C.addFlowers(b, { spots: C.scatter(b, 300, 4.5, 15, open), colors: ['#ffffff', '#ffe066', '#ff8fb1'] });

  return b.finish({ fog: new THREE.Fog(fogColor, 25, 90) });
}
