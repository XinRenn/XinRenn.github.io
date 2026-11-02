// 各个背景场景共用的积木：天空、地面、水面、远山、云、树、草、粒子（雪/雨/落叶/气泡）、光柱……
// 全部由代码生成，不需要图片或模型文件。树和草等大量重复的东西用 InstancedMesh，Quest 上更流畅。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE, mergeGeometries };

// ---------- 随机数 / 噪声 ----------
export function rng(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}
// 首尾相接的一维噪声（绕一圈刚好接上），用于山脊和丘陵
export function ringNoise(rand, octaves = 6) {
  const waves = [];
  for (let i = 0; i < octaves; i++) {
    const f = Math.round(2 + Math.pow(2, i) * (1 + rand()));
    waves.push({ f, p: rand() * Math.PI * 2, a: 1 / Math.pow(1.7, i) });
  }
  const total = waves.reduce((s, w) => s + w.a, 0);
  return (angle) => waves.reduce((s, w) => s + w.a * Math.sin(angle * w.f + w.p), 0) / total;
}
export const angDiff = (a, b) => {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

// ---------- 场景构建器 ----------
export function createBuilder(seed = 7) {
  const b = {
    rand: rng(seed),
    group: new THREE.Group(),
    lights: [],
    uTime: { value: 0 },
    updaters: [],
  };
  b.add = (...objs) => { b.group.add(...objs); return objs[0]; };
  b.onUpdate = (fn) => b.updaters.push(fn);
  b.finish = ({ fog, ...extra } = {}) => ({
    group: b.group,
    lights: b.lights,
    fog,
    ...extra,
    update(dt) {
      b.uTime.value += dt;
      for (const f of b.updaters) f(dt, b.uTime.value);
    },
    dispose() { disposeTree(b.group); },
  });
  return b;
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of ['map', 'alphaMap', 'emissiveMap']) m[k]?.dispose?.();
      m.dispose();
    }
  });
}

// ---------- 贴图 ----------
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function softDotTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}

// ---------- 灯光 ----------
export function addLights(b, { sky = '#ffffff', ground = '#555555', hemi = 1, sun = '#ffffff', sunIntensity = 1.5, sunDir = new THREE.Vector3(0.3, 1, 0.2) } = {}) {
  const h = new THREE.HemisphereLight(sky, ground, hemi);
  const d = new THREE.DirectionalLight(sun, sunIntensity);
  d.position.copy(sunDir).normalize().multiplyScalar(10);
  b.lights.push(h, d);
  return { hemi: h, sun: d };
}

// ---------- 天空 ----------
export function addSky(b, {
  top = '#3a6db5', mid = '#8db6dd', horizon = '#ffd3a3', bottom = null,
  sunDir = new THREE.Vector3(0, 0.3, -1), sunColor = '#ffcf8a', sun = 1, stars = 0,
} = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) },
      horizon: { value: new THREE.Color(horizon) }, bottom: { value: new THREE.Color(bottom || horizon) },
      sunColor: { value: new THREE.Color(sunColor) }, sunDir: { value: sunDir.clone().normalize() },
      sunAmt: { value: sun }, stars: { value: stars },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top, mid, horizon, bottom, sunColor, sunDir;
      uniform float sunAmt, stars;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.28, h));
        col = mix(col, top, smoothstep(0.28, 0.95, h));
        col = mix(col, bottom, smoothstep(0.0, -0.25, h));
        float s = max(dot(d, sunDir), 0.0);
        col += sunAmt * sunColor * (pow(s, 900.0) * 3.0 + pow(s, 40.0) * 0.45 + pow(s, 6.0) * 0.22);
        col += sunAmt * vec3(0.25, 0.1, 0.0) * pow(s, 2.0) * (1.0 - smoothstep(0.0, 0.35, abs(h)));
        if (stars > 0.0 && h > 0.05) {
          vec3 cell = floor(d * 260.0);
          float st = step(0.996, hash(cell));
          col += vec3(st) * stars * smoothstep(0.05, 0.4, h);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(95, 48, 24), mat);
  sky.renderOrder = -10;
  return b.add(sky);
}

// 太阳/月亮的光晕
export function addSunGlow(b, { dir, color = '#fff2c8', size = 30, distance = 85, opacity = 0.8 } = {}) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
    color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  }));
  s.position.copy(dir).normalize().multiplyScalar(distance);
  s.scale.setScalar(size);
  return b.add(s);
}

// ---------- 云 ----------
export function addClouds(b, { count = 14, color = '#ffffff', tint = '#ffb98a', sunAz = 0, minH = 16, maxH = 36, radius = 60, spread = 22, opacity = 0.85, width = [22, 42], drift = 0.003 } = {}) {
  const r = b.rand;
  const tex = canvasTexture(256, 128, (g) => {
    const rr = rng(1234);
    for (let i = 0; i < 26; i++) {
      const x = 40 + rr() * 176, y = 50 + rr() * 40, rad = 18 + rr() * 34;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
    }
  });
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const rad = radius + r() * spread;
    const toward = Math.max(0, Math.cos(a - sunAz));
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, fog: false,
      color: new THREE.Color(color).lerp(new THREE.Color(tint), toward * 0.8),
      opacity: opacity * (0.8 + r() * 0.2),
    }));
    s.position.set(Math.cos(a) * rad, minH + r() * (maxH - minH), Math.sin(a) * rad);
    const w = width[0] + r() * (width[1] - width[0]);
    s.scale.set(w, w * 0.42, 1);
    group.add(s);
  }
  b.add(group);
  b.onUpdate((dt) => { group.rotation.y += dt * drift; });
  return group;
}

// ---------- 远山（多层，越远越淡）----------
// shape(a) 返回 0~1 的高度系数，可以用来做峡谷缺口等
export function addMountains(b, {
  colors = ['#cdb7bb', '#a59cae', '#7a8798', '#56706d'], radius = 88, step = 9, peak = 19, base = 4,
  haze = '#efcfaa', snow = null, snowLine = 0.75, shape = null, seed = 100, segments = 256,
} = {}) {
  const group = new THREE.Group();
  colors.forEach((hex, layer) => {
    const R = radius - layer * step;
    const n = ringNoise(rng(seed + layer * 17));
    const pk = peak - layer * (peak * 0.15);
    const pos = [], col = [], idx = [];
    const c = new THREE.Color(hex);
    const bottom = new THREE.Color(haze).lerp(c, 0.35);
    const snowC = snow ? new THREE.Color(snow) : null;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      let h = base + (n(a) * 0.5 + 0.5) * pk;
      if (shape) h *= shape(a, layer);
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      pos.push(x, -1, z, x, h * 0.7, z, x, h, z);
      const top = snowC && h > (base + pk) * snowLine ? snowC : c;
      col.push(bottom.r, bottom.g, bottom.b, c.r, c.g, c.b, top.r, top.g, top.b);
      if (i < segments) {
        const k = i * 3;
        idx.push(k, k + 3, k + 1, k + 1, k + 3, k + 4, k + 1, k + 4, k + 2, k + 2, k + 4, k + 5);
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
  return b.add(group);
}

// ---------- 地面：近处平坦，远处可以起伏 ----------
// colorAt(x, z, rand) 可选，返回 THREE.Color；heightAt(x, z, r) 可选，返回额外高度
export function addGround(b, { radius = 92, colors = ['#5c8a3f', '#86ad55'], hills = { start: 30, end: 80, height: 5, seed: 300 }, colorAt = null, heightAt = null, material = null } = {}) {
  const hill = hills ? ringNoise(rng(hills.seed || 300), 5) : null;
  const rings = 70, seg = 120;
  const pos = [], col = [], idx = [];
  const ca = new THREE.Color(colors[0]), cb = new THREE.Color(colors[1]);
  const defColor = (x, z) => {
    const t = THREE.MathUtils.clamp(0.5 + 0.22 * (Math.sin(x * 0.23) + Math.sin(z * 0.19 + 1.3)) + 0.12 * Math.sin((x - z) * 0.6), 0, 1);
    return ca.clone().lerp(cb, t);
  };
  const pushV = (x, z, r) => {
    let y = 0;
    if (hill) y = THREE.MathUtils.smoothstep(r, hills.start, hills.end) * (hills.height * 0.6 + hill(Math.atan2(z, x) + r * 0.02) * hills.height);
    if (heightAt) y += heightAt(x, z, r);
    pos.push(x, y, z);
    const c = colorAt ? colorAt(x, z, b.rand) : defColor(x, z);
    col.push(c.r, c.g, c.b);
  };
  pushV(0, 0, 0);
  for (let i = 1; i <= rings; i++) {
    const r = Math.pow(i / rings, 1.6) * radius;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pushV(Math.cos(a) * r, Math.sin(a) * r, r);
    }
  }
  for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = 1 + (i - 1) * seg + j, bb = 1 + (i - 1) * seg + ((j + 1) % seg);
      idx.push(a, bb, a + seg, bb, bb + seg, a + seg);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material || new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.position.y = -0.004;
  return b.add(mesh);
}

// ---------- 水面 ----------
export function addWater(b, {
  shape = 'circle', radius = 8, width = 200, depth = 200, x = 0, z = 0, y = 0.02,
  deep = '#1d4a63', sky = '#9fc4df', warm = '#ffc999', sun = '#ffcf8a',
  fog = '#efcfaa', fogNear = 30, fogFar = 90, wave = 1, opacity = 0.92, sparkle = 0.6, edge = true,
} = {}) {
  const geo = shape === 'circle' ? new THREE.CircleGeometry(radius, 64) : new THREE.PlaneGeometry(width, depth, 1, 1);
  const mat = new THREE.ShaderMaterial({
    transparent: opacity < 1 || edge,
    uniforms: {
      uTime: b.uTime, deep: { value: new THREE.Color(deep) }, skyCol: { value: new THREE.Color(sky) },
      warm: { value: new THREE.Color(warm) }, sunColor: { value: new THREE.Color(sun) },
      fogColor: { value: new THREE.Color(fog) }, fogNear: { value: fogNear }, fogFar: { value: fogFar },
      center: { value: new THREE.Vector2(x, z) }, radius: { value: shape === 'circle' && edge ? radius : 1e6 },
      wave: { value: wave }, opacity: { value: opacity }, sparkle: { value: sparkle },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, radius, fogNear, fogFar, wave, opacity, sparkle;
      uniform vec3 deep, skyCol, warm, sunColor, fogColor;
      uniform vec2 center;
      varying vec3 vWorld;
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(V.y, 0.0), 2.5);
        vec3 col = mix(deep, skyCol, 0.15 + 0.6 * fres);
        col = mix(col, warm, 0.25 * fres * fres);
        vec2 p = vWorld.xz / wave;
        float r = sin(p.x * 2.3 + uTime * 1.2) * sin(p.y * 2.9 - uTime * 0.9)
                + 0.5 * sin((p.x + p.y) * 5.0 + uTime * 2.0);
        col += sunColor * pow(max(r, 0.0) / 1.5, 10.0) * sparkle;
        float d = distance(cameraPosition.xz, vWorld.xz);
        col = mix(col, fogColor, smoothstep(fogNear, fogFar, d));
        float e = smoothstep(radius, radius - 0.6, distance(vWorld.xz, center));
        gl_FragColor = vec4(col, opacity * e);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  return b.add(m);
}

// ---------- 摆放工具 ----------
export function scatter(b, count, minR, maxR, accept) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 40) {
    const a = b.rand() * Math.PI * 2;
    const r = Math.sqrt(minR * minR + b.rand() * (maxR * maxR - minR * minR));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (accept && !accept(x, z, a, r)) continue;
    out.push({ x, z, a, r });
  }
  return out;
}
const dummy = new THREE.Object3D();
export function placeInstances(mesh, spots, fn) {
  spots.forEach((p, i) => {
    dummy.position.set(p.x, p.y || 0, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    fn?.(dummy, p, i);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// ---------- 树 ----------
export function addPines(b, { spots, colors = ['#2f5d3a', '#3a6b3d', '#46773f'], trunk = '#6b4a32', snow = null, scale = [0.8, 1.7], yAt = () => 0 } = {}) {
  const cones = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.ConeGeometry(1.5 - k * 0.38, 2.2 - k * 0.3, 7);
    g.translate(0, 1.6 + k * 1.15, 0);
    if (snow) {
      // 每层树冠的上半部分盖一层雪（用顶点颜色）
      const p = g.attributes.position, cols = [];
      const sc = new THREE.Color(snow);
      for (let i = 0; i < p.count; i++) {
        const top = p.getY(i) > 1.6 + k * 1.15 + 0.2;
        cols.push(...(top ? [sc.r, sc.g, sc.b] : [1, 1, 1]));
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    }
    cones.push(g);
  }
  const foliage = new THREE.InstancedMesh(mergeGeometries(cones), new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: !!snow }), spots.length);
  const tg = new THREE.CylinderGeometry(0.14, 0.22, 1.4, 6);
  tg.translate(0, 0.7, 0);
  const trunks = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: trunk }), spots.length);
  const cs = colors.map((h) => new THREE.Color(h));
  const mats = [];
  spots.forEach((p, i) => {
    const s = scale[0] + b.rand() * (scale[1] - scale[0]);
    dummy.position.set(p.x, yAt(p) - 0.05, p.z);
    dummy.rotation.set(0, b.rand() * Math.PI, 0);
    dummy.scale.set(s, s * (0.9 + b.rand() * 0.4), s);
    dummy.updateMatrix();
    foliage.setMatrixAt(i, dummy.matrix);
    trunks.setMatrixAt(i, dummy.matrix);
    foliage.setColorAt(i, cs[i % cs.length].clone().multiplyScalar(0.85 + b.rand() * 0.3));
    mats.push(dummy.matrix.clone());
  });
  b.add(foliage, trunks);
  return { foliage, trunks };
}

export function addRoundTrees(b, { spots, colors = ['#5f8f3c', '#77a043', '#8aa63f'], trunk = '#6b4a32', scale = [0.8, 1.4], yAt = () => 0, canopy = 1.3 } = {}) {
  const cg = new THREE.IcosahedronGeometry(canopy, 1);
  cg.translate(0, 2.6, 0);
  const tg = new THREE.CylinderGeometry(0.12, 0.18, 2, 6);
  tg.translate(0, 1, 0);
  const crowns = new THREE.InstancedMesh(cg, new THREE.MeshLambertMaterial({ flatShading: true }), spots.length);
  const trunks = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: trunk }), spots.length);
  const cs = colors.map((h) => new THREE.Color(h));
  spots.forEach((p, i) => {
    const s = scale[0] + b.rand() * (scale[1] - scale[0]);
    dummy.position.set(p.x, yAt(p) - 0.05, p.z);
    dummy.rotation.set(0, b.rand() * Math.PI, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    trunks.setMatrixAt(i, dummy.matrix);
    crowns.setColorAt(i, cs[Math.floor(b.rand() * cs.length)]);
  });
  b.add(crowns, trunks);
  return { crowns, trunks };
}

export function addRocks(b, { spots, color = '#8d8a84', size = [0.3, 1.4], yAt = () => 0, flat = 0.6 } = {}) {
  const m = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ color, flatShading: true }), spots.length);
  spots.forEach((p, i) => {
    const s = size[0] + b.rand() * (size[1] - size[0]);
    dummy.position.set(p.x, yAt(p) + s * 0.15, p.z);
    dummy.rotation.set(b.rand() * 3, b.rand() * 3, b.rand() * 3);
    dummy.scale.set(s * (1 + b.rand() * 0.6), s * flat, s);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
  });
  return b.add(m);
}

// 让东西随风（或水流）摆动：在顶点着色器里按高度加偏移
export function addSway(b, material, { amount = 0.8, speed = 1 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = b.uTime;
    shader.uniforms.uSway = { value: amount };
    shader.uniforms.uSpeed = { value: speed };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uSway; uniform float uSpeed;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 root = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        #else
          vec3 root = vec3(0.0);
        #endif
        float bend = position.y * position.y;
        float t = uTime * uSpeed;
        float gust = sin(t * 1.6 + root.x * 0.35 + root.z * 0.22) * 0.6 + sin(t * 2.7 + root.x * 0.9) * 0.25;
        transformed.x += gust * bend * uSway;
        transformed.z += gust * bend * uSway * 0.5;`
      );
  };
  material.customProgramCacheKey = () => 'sway';
  return material;
}

// 草（或水草）：细长的三角叶片
export function addGrass(b, { spots, colors = ['#5c8a3f', '#86ad55'], height = [0.5, 1.4], width = 0.05, bladeH = 0.4, sway = 0.8, swaySpeed = 1, clearRadius = 4 } = {}) {
  const blade = new THREE.PlaneGeometry(width, bladeH, 1, 3);
  const p = blade.attributes.position;
  const cols = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + bladeH / 2;
    p.setX(i, p.getX(i) * (1 - y / bladeH));
    p.setY(i, y);
    const shade = 0.55 + 0.45 * (y / bladeH);
    cols.push(shade, shade, shade);
  }
  blade.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  blade.computeVertexNormals();
  const mat = addSway(b, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { amount: sway / Math.max(1, bladeH / 0.4) ** 2, speed: swaySpeed });
  const mesh = new THREE.InstancedMesh(blade, mat, spots.length);
  const cs = colors.map((h) => new THREE.Color(h));
  spots.forEach((s, i) => {
    const edge = THREE.MathUtils.smoothstep(s.r, clearRadius, clearRadius + 1.5);
    const h = (height[0] + b.rand() * (height[1] - height[0])) * (0.35 + 0.65 * edge);
    dummy.position.set(s.x, s.y || 0, s.z);
    dummy.rotation.set((b.rand() - 0.5) * 0.4, b.rand() * Math.PI, (b.rand() - 0.5) * 0.4);
    dummy.scale.set(1 + b.rand(), h, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, cs[Math.floor(b.rand() * cs.length)].clone().multiplyScalar(1.05 + b.rand() * 0.25));
  });
  return b.add(mesh);
}

export function addFlowers(b, { spots, colors = ['#ffffff', '#ffe066', '#ff9ec7', '#b99cff', '#ff8a5c'] } = {}) {
  const head = new THREE.IcosahedronGeometry(0.035, 0);
  head.translate(0, 0.28, 0);
  const stem = new THREE.CylinderGeometry(0.004, 0.004, 0.28, 3);
  stem.translate(0, 0.14, 0);
  const heads = new THREE.InstancedMesh(head, addSway(b, new THREE.MeshLambertMaterial({ flatShading: true })), spots.length);
  const stems = new THREE.InstancedMesh(stem, addSway(b, new THREE.MeshLambertMaterial({ color: '#4f7a35' })), spots.length);
  const cs = colors.map((h) => new THREE.Color(h));
  spots.forEach((s, i) => {
    dummy.position.set(s.x, 0, s.z);
    dummy.rotation.set(0, b.rand() * Math.PI, 0);
    dummy.scale.setScalar(0.7 + b.rand() * 0.8);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    stems.setMatrixAt(i, dummy.matrix);
    heads.setColorAt(i, cs[Math.floor(b.rand() * cs.length)]);
  });
  b.add(heads, stems);
}

// ---------- 粒子：雪花、气泡、光点、水雾 ----------
// 在以原点为中心的圆柱范围内循环飘动
export function addParticles(b, {
  count = 300, radius = 14, minR = 0, yMin = 0, yMax = 6, size = 0.08, texture = null, color = '#ffffff',
  opacity = 1, additive = false, velocity = [0, -0.5, 0], sway = 0.3, swaySpeed = 1, center = [0, 0],
} = {}) {
  const pos = new Float32Array(count * 3);
  const base = [];
  for (let i = 0; i < count; i++) {
    const a = b.rand() * Math.PI * 2;
    const r = Math.sqrt(minR * minR + b.rand() * (radius * radius - minR * minR));
    base.push({ x: center[0] + Math.cos(a) * r, y: yMin + b.rand() * (yMax - yMin), z: center[1] + Math.sin(a) * r, p: b.rand() * 10, s: 0.5 + b.rand() });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    map: texture || softDotTexture(), size, color: new THREE.Color(color), transparent: true, opacity,
    depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  const span = yMax - yMin;
  b.onUpdate((dt, t) => {
    for (let i = 0; i < count; i++) {
      const q = base[i];
      q.x += velocity[0] * q.s * dt;
      q.y += velocity[1] * q.s * dt;
      q.z += velocity[2] * q.s * dt;
      if (q.y < yMin) q.y += span;
      if (q.y > yMax) q.y -= span;
      const dx = q.x - center[0], dz = q.z - center[1];
      if (dx * dx + dz * dz > radius * radius) { q.x = center[0] - dx * 0.98; q.z = center[1] - dz * 0.98; }
      pos[i * 3] = q.x + Math.sin(t * swaySpeed * q.s + q.p) * sway;
      pos[i * 3 + 1] = q.y;
      pos[i * 3 + 2] = q.z + Math.cos(t * swaySpeed * 0.8 * q.s + q.p) * sway;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return b.add(pts);
}

// ---------- 雨 ----------
export function addRain(b, { count = 1400, radius = 12, height = 9, speed = 9, length = 0.35, color = '#b8c6d8', opacity = 0.45, splashes = true } = {}) {
  const pos = new Float32Array(count * 6);
  const drops = [];
  for (let i = 0; i < count; i++) {
    const a = b.rand() * Math.PI * 2, r = Math.sqrt(b.rand()) * radius;
    drops.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: b.rand() * height, v: speed * (0.85 + b.rand() * 0.3) });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  b.add(lines);

  // 落地溅起的小水花
  let splashPts = null, sPos, sLife;
  const S = 120;
  if (splashes) {
    sPos = new Float32Array(S * 3);
    sLife = new Float32Array(S);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    splashPts = new THREE.Points(sg, new THREE.PointsMaterial({ map: softDotTexture(), size: 0.06, color, transparent: true, opacity: 0.7, depthWrite: false }));
    b.add(splashPts);
  }
  let si = 0;
  b.onUpdate((dt) => {
    for (let i = 0; i < count; i++) {
      const d = drops[i];
      d.y -= d.v * dt;
      if (d.y < 0) {
        if (splashes && b.rand() < 0.15) {
          sPos[si * 3] = d.x; sPos[si * 3 + 1] = 0.03; sPos[si * 3 + 2] = d.z; sLife[si] = 0.25;
          si = (si + 1) % S;
        }
        d.y += height;
        const a = b.rand() * Math.PI * 2, r = Math.sqrt(b.rand()) * radius;
        d.x = Math.cos(a) * r; d.z = Math.sin(a) * r;
      }
      const k = i * 6;
      pos[k] = d.x; pos[k + 1] = d.y; pos[k + 2] = d.z;
      pos[k + 3] = d.x + 0.02; pos[k + 4] = d.y + length; pos[k + 5] = d.z;
    }
    geo.attributes.position.needsUpdate = true;
    if (splashes) {
      for (let i = 0; i < S; i++) {
        sLife[i] -= dt;
        if (sLife[i] <= 0) sPos[i * 3 + 1] = -10;
      }
      splashPts.geometry.attributes.position.needsUpdate = true;
    }
  });
  return lines;
}

// ---------- 光柱（阳光透过树叶/水面射下来的光束）----------
export function addLightShafts(b, {
  dir = new THREE.Vector3(-0.6, 0.6, -0.5), count = 10, color = '#fff0c0', length = 26, width = [0.8, 2.2],
  opacity = 0.14, area = 14, center = [0, 0], minR = 3,
} = {}) {
  const tex = canvasTexture(64, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.85, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const side = g.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)');
    side.addColorStop(0.5, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = side;
    g.fillRect(0, 0, w, h);
  });
  const d = dir.clone().normalize();
  const group = new THREE.Group();
  const shafts = [];
  for (let i = 0; i < count; i++) {
    const a = b.rand() * Math.PI * 2;
    const r = minR + b.rand() * (area - minR);
    const ground = new THREE.Vector3(center[0] + Math.cos(a) * r, 0, center[1] + Math.sin(a) * r);
    const mid = ground.clone().addScaledVector(d, length * 0.5);
    const w = width[0] + b.rand() * (width[1] - width[0]);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: false,
    });
    for (let k = 0; k < 2; k++) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, length), mat);
      plane.position.copy(mid);
      plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      plane.rotateY(k * Math.PI / 2 + a);
      group.add(plane);
    }
    shafts.push({ mat, p: b.rand() * 10, base: opacity * (0.6 + b.rand() * 0.6) });
  }
  b.add(group);
  b.onUpdate((dt, t) => {
    for (const s of shafts) s.mat.opacity = s.base * (0.65 + 0.35 * Math.sin(t * 0.5 + s.p));
  });
  return group;
}
