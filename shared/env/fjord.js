// 峡湾：你站在岸边的岩石平台上，两侧是陡峭的雪顶山崖，前方是深蓝的海湾。
// 时不时会有座头鲸、虎鲸和海豚群跃出海面。
import * as C from './common.js';
const { THREE, mergeGeometries } = C;

// 用基本形状拼一只海洋哺乳动物。身体沿 +z 方向，长度 = 1（之后整体缩放）
function makeAnimal(kind) {
  const body = new THREE.SphereGeometry(0.5, 24, 16);
  body.scale(0.28, 0.24, 1);
  const pal = {
    whale: { back: '#2f3640', belly: '#9aa3ad' },
    orca: { back: '#111214', belly: '#f4f6f8' },
    dolphin: { back: '#6c7a89', belly: '#d9dee4' },
  }[kind];
  const back = new THREE.Color(pal.back), belly = new THREE.Color(pal.belly);
  const p = body.attributes.position;
  const cols = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let c = y < -0.04 ? belly : back;
    if (kind === 'orca' && y > 0.0 && y < 0.09 && z > 0.18 && z < 0.34 && Math.abs(x) > 0.08) c = belly; // 眼后白斑
    if (kind === 'whale' && y < -0.06) c = belly.clone().lerp(back, (Math.sin(z * 60) * 0.5 + 0.5) * 0.4); // 腹部褶皱
    cols.push(c.r, c.g, c.b);
  }
  body.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  body.deleteAttribute('uv'); // 鳍没有 uv，合并前要保持属性一致

  const parts = [body];
  const colorize = (g, c) => {
    const n = g.attributes.position.count, arr = [];
    for (let i = 0; i < n; i++) arr.push(c.r, c.g, c.b);
    g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
    return g;
  };
  const tri = (pts) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.computeVertexNormals();
    return g;
  };
  // 背鳍
  const finH = kind === 'orca' ? 0.22 : kind === 'dolphin' ? 0.1 : 0.04;
  parts.push(colorize(tri([0, 0.1, 0.05, 0, 0.1, -0.12, 0, 0.1 + finH, -0.1 - finH * 0.4]), back));
  // 尾鳍（水平）
  parts.push(colorize(tri([0, 0, -0.45, -0.2, 0, -0.62, 0, 0, -0.55, 0, 0, -0.45, 0, 0, -0.55, 0.2, 0, -0.62]), back));
  // 胸鳍（座头鲸的特别长、白色）
  const pecL = kind === 'whale' ? 0.32 : 0.12;
  const pecC = kind === 'whale' ? belly : back;
  parts.push(colorize(tri([0.12, -0.06, 0.2, 0.12, -0.06, 0.1, 0.12 + pecL, -0.12, 0.08]), pecC));
  parts.push(colorize(tri([-0.12, -0.06, 0.2, -0.12 - pecL, -0.12, 0.08, -0.12, -0.06, 0.1]), pecC));
  const geo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

export function create() {
  const b = C.createBuilder(88);
  const sunDir = new THREE.Vector3(0.4, 0.55, -0.7).normalize();
  const sunAz = Math.atan2(sunDir.z, sunDir.x);
  const fogColor = '#d6e5ef';
  const WATER_Y = -0.35;

  C.addLights(b, { sky: '#e7f2ff', ground: '#4a5a50', hemi: 1.2, sun: '#fff6e0', sunIntensity: 1.8, sunDir });
  C.addSky(b, { top: '#2f6fb3', mid: '#86b7e0', horizon: '#dbe9f2', sunDir, sunColor: '#fff6dd', sun: 0.8 });
  C.addClouds(b, { sunAz, tint: '#ffffff', count: 16, minH: 20, maxH: 40 });

  // 两侧陡峭的山崖：正前方（-z）是海湾出口，山很低；其他方向是高耸的雪山
  const front = -Math.PI / 2;
  C.addMountains(b, {
    colors: ['#a9bccb', '#7f95a8', '#5a6f7f', '#3f5a4c'], radius: 80, step: 11, peak: 34, base: 6,
    haze: fogColor, snow: '#f6f9fc', snowLine: 0.62, seed: 501,
    shape: (a) => 0.06 + 0.94 * THREE.MathUtils.smoothstep(C.angDiff(a, front), 0.28, 0.9),
  });

  C.addWater(b, { shape: 'rect', width: 400, depth: 400, y: WATER_Y, deep: '#0f3b55', sky: '#9cc6e6', warm: '#e3eef6', sun: '#ffffff', fog: fogColor, fogNear: 30, fogFar: 92, wave: 1.4, edge: false, opacity: 1 });

  // 岸边的岩石平台：中间平，边缘斜着没入水中
  const ra = new THREE.Color('#6b6f62'), rb = new THREE.Color('#7c8a63');
  C.addGround(b, {
    radius: 16,
    hills: null,
    colorAt: (x, z) => ra.clone().lerp(rb, THREE.MathUtils.clamp(0.5 + 0.4 * Math.sin(x * 0.8) * Math.sin(z * 0.7), 0, 1)),
    heightAt: (x, z, r) => {
      const back = THREE.MathUtils.smoothstep(z, -2, 12); // 背后的岸更宽
      const edge = 6.5 + back * 7;
      return r < edge ? 0 : -(r - edge) * 0.6;
    },
  });
  C.addRocks(b, { spots: C.scatter(b, 26, 5, 11, (x, z) => z > -6), color: '#6e7166', size: [0.4, 1.6] });
  C.addGrass(b, { spots: C.scatter(b, 900, 4.5, 11, (x, z, a, r) => r < 6 + THREE.MathUtils.smoothstep(z, -2, 12) * 7 - 0.4), colors: ['#6f8a4a', '#87995a'], height: [0.3, 0.9] });

  // ---- 跃出水面的动物 ----
  const pools = {
    whale: [makeAnimal('whale')],
    orca: [makeAnimal('orca'), makeAnimal('orca')],
    dolphin: [0, 1, 2, 3].map(() => makeAnimal('dolphin')),
  };
  const sizes = { whale: 13, orca: 7, dolphin: 2.4 };
  for (const [k, arr] of Object.entries(pools)) for (const m of arr) { m.scale.setScalar(sizes[k]); m.visible = false; b.add(m); }

  // 溅起的水花
  const SPL = 400;
  const sPos = new Float32Array(SPL * 3), sVel = new Float32Array(SPL * 3), sLife = new Float32Array(SPL);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const splash = new THREE.Points(sGeo, new THREE.PointsMaterial({ map: C.softDotTexture(), size: 0.5, color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }));
  b.add(splash);
  let sIdx = 0;
  function burst(x, z, n, power) {
    for (let i = 0; i < n; i++) {
      const k = sIdx = (sIdx + 1) % SPL;
      const a = Math.random() * Math.PI * 2, s = Math.random() * power;
      sPos[k * 3] = x; sPos[k * 3 + 1] = WATER_Y; sPos[k * 3 + 2] = z;
      sVel[k * 3] = Math.cos(a) * s * 0.4; sVel[k * 3 + 1] = power * (0.6 + Math.random() * 0.8); sVel[k * 3 + 2] = Math.sin(a) * s * 0.4;
      sLife[k] = 2.5;
    }
  }

  const active = [];
  function launch(kind, opts = {}) {
    const mesh = pools[kind].find((m) => !m.userData.busy);
    if (!mesh) return;
    mesh.userData.busy = true;
    const ang = opts.angle ?? front + (Math.random() - 0.5) * 1.6;
    const dist = opts.dist ?? { whale: 40 + Math.random() * 20, orca: 18 + Math.random() * 18, dolphin: 12 + Math.random() * 12 }[kind];
    const heading = opts.heading ?? Math.random() * Math.PI * 2;
    const spec = {
      whale: { v: 6, up: 12, g: 9.8, dur: 2.2, spin: 1.2 },
      orca: { v: 7, up: 9.5, g: 9.8, dur: 2.0, spin: 0 },
      dolphin: { v: 7, up: 6.5, g: 9.8, dur: 1.35, spin: 0 },
    }[kind];
    const L = sizes[kind];
    const start = new THREE.Vector3(Math.cos(ang) * dist, WATER_Y - L * 0.35, Math.sin(ang) * dist);
    mesh.visible = true;
    active.push({ mesh, kind, start, heading, t: 0, spec, L, splashed: false, hops: opts.hops ?? 0, delay: opts.delay ?? 0 });
  }

  let nextEvent = 2;
  b.onUpdate((dt, time) => {
    nextEvent -= dt;
    if (nextEvent <= 0) {
      const r = Math.random();
      if (r < 0.3) launch('whale');
      else if (r < 0.6) {
        const ang = front + (Math.random() - 0.5) * 1.4, heading = Math.random() * Math.PI * 2;
        launch('orca', { angle: ang, heading });
        if (Math.random() < 0.6) launch('orca', { angle: ang + 0.08, heading, delay: 0.5 });
      } else {
        // 海豚群：几只一起，前后错开，连续跳好几次
        const ang = front + (Math.random() - 0.5) * 1.6, dist = 12 + Math.random() * 12, heading = Math.random() * Math.PI * 2;
        for (let i = 0; i < 3 + Math.floor(Math.random() * 2); i++) {
          launch('dolphin', { angle: ang + (Math.random() - 0.5) * 0.12, dist: dist + (Math.random() - 0.5) * 3, heading, hops: 2, delay: i * 0.25 });
        }
      }
      nextEvent = 4 + Math.random() * 5;
    }

    for (let i = active.length - 1; i >= 0; i--) {
      const a = active[i];
      if (a.delay > 0) { a.delay -= dt; a.mesh.visible = false; continue; }
      a.mesh.visible = true;
      a.t += dt;
      const { v, up, g, spin } = a.spec;
      const t = a.t;
      const fx = Math.sin(a.heading), fz = Math.cos(a.heading);
      const y = a.start.y + up * t - 0.5 * g * t * t;
      const vy = up - g * t;
      a.mesh.position.set(a.start.x + fx * v * t, y, a.start.z + fz * v * t);
      a.mesh.rotation.set(-Math.atan2(vy, v), a.heading, a.kind === 'whale' ? Math.min(t * spin, 1.4) : 0, 'YXZ');
      if (!a.splashed && y > WATER_Y) { a.splashed = true; burst(a.mesh.position.x, a.mesh.position.z, a.kind === 'dolphin' ? 25 : 60, a.kind === 'whale' ? 7 : 4); }
      if (t > 0.5 && y < WATER_Y && vy < 0 && !a.reentered) {
        a.reentered = true;
        burst(a.mesh.position.x, a.mesh.position.z, a.kind === 'dolphin' ? 30 : a.kind === 'whale' ? 160 : 80, a.kind === 'whale' ? 9 : 4.5);
      }
      if (y < a.start.y - 1) {
        if (a.hops > 0) {
          // 海豚再跳一次
          a.hops--;
          a.start.set(a.mesh.position.x, a.start.y, a.mesh.position.z);
          a.t = -0.3; a.splashed = false; a.reentered = false;
        } else {
          a.mesh.visible = false;
          a.mesh.userData.busy = false;
          active.splice(i, 1);
        }
      }
    }

    for (let k = 0; k < SPL; k++) {
      if (sLife[k] <= 0) { sPos[k * 3 + 1] = -50; continue; }
      sLife[k] -= dt;
      sVel[k * 3 + 1] -= 9.8 * dt;
      sPos[k * 3] += sVel[k * 3] * dt;
      sPos[k * 3 + 1] += sVel[k * 3 + 1] * dt;
      sPos[k * 3 + 2] += sVel[k * 3 + 2] * dt;
      if (sPos[k * 3 + 1] < WATER_Y) sLife[k] = 0;
    }
    sGeo.attributes.position.needsUpdate = true;
  });

  return b.finish({ fog: new THREE.Fog(fogColor, 35, 120) });
}
