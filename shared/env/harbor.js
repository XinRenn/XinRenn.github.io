// 秋日港口：你站在木码头上，脚下铺满落叶；岸上是仓库和金黄的秋树，
// 海上停着小渔船，远处有灯塔，海鸥在头顶盘旋。低低的夕阳洒下光柱。
import * as C from './common.js';
const { THREE } = C;

const LEAF_COLORS = ['#e8742c', '#d9481f', '#f2b134', '#b5541f', '#f08a24', '#a8321a'];

function leafGeometry(size = 0.09) {
  const s = new THREE.Shape();
  s.moveTo(0, -size);
  s.quadraticCurveTo(size * 0.9, -size * 0.2, 0, size);
  s.quadraticCurveTo(-size * 0.9, -size * 0.2, 0, -size);
  const g = new THREE.ShapeGeometry(s, 3);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function create() {
  const b = C.createBuilder(55);
  const sunDir = new THREE.Vector3(-0.5, 0.2, -0.85).normalize();
  const sunAz = Math.atan2(sunDir.z, sunDir.x);
  const fogColor = '#f2d6ad';
  const WATER_Y = -0.45;
  const LAND_Z = 6;

  C.addLights(b, { sky: '#ffe2b8', ground: '#7a5a3a', hemi: 1.1, sun: '#ffcf86', sunIntensity: 2.4, sunDir });
  C.addSky(b, { top: '#4f86c6', mid: '#a9cdea', horizon: '#ffdca8', sunDir, sunColor: '#ffd27a', sun: 1.2 });
  C.addSunGlow(b, { dir: sunDir, color: '#ffd88f', size: 34, opacity: 0.55 });
  C.addClouds(b, { sunAz, tint: '#ffb06b', count: 12, opacity: 0.8 });
  C.addMountains(b, {
    colors: ['#d8b9a8', '#b89c94', '#8f8a84', '#6f7a63'], haze: fogColor, peak: 12, base: 2,
    shape: (a) => 0.15 + 0.85 * THREE.MathUtils.smoothstep(C.angDiff(a, -Math.PI / 2), 0.6, 1.6), // 海的方向几乎没有山
  });

  // 大海
  C.addWater(b, { shape: 'rect', width: 400, depth: 400, y: WATER_Y, deep: '#1e5470', sky: '#9cc4dd', warm: '#ffd09a', sun: '#ffdd99', fog: fogColor, fogNear: 25, fogFar: 92, sparkle: 0.9, edge: false, opacity: 1 });

  // 岸（码头后面的陆地），海里的部分沉到水下
  const ga = new THREE.Color('#9a7b45'), gb = new THREE.Color('#b8893f');
  C.addGround(b, {
    colorAt: (x, z) => ga.clone().lerp(gb, THREE.MathUtils.clamp(0.5 + 0.3 * Math.sin(x * 0.4) * Math.sin(z * 0.3), 0, 1)),
    heightAt: (x, z) => -3 * (1 - THREE.MathUtils.smoothstep(z, LAND_Z - 0.5, LAND_Z + 0.5)),
    hills: { start: 40, end: 85, height: 4, seed: 9 },
  });

  // 木码头：一块块木板 + 下面的木桩
  {
    const W = 12, z0 = -10, z1 = LAND_Z + 0.5, pw = 0.3;
    const n = Math.floor((z1 - z0) / pw);
    const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(W, 0.08, pw * 0.92), new THREE.MeshLambertMaterial(), n);
    const pc = ['#8a6a4a', '#7b5b3d', '#946f4b', '#6f5034'].map((h) => new THREE.Color(h));
    C.placeInstances(planks, Array.from({ length: n }, (_, i) => ({ x: 0, y: -0.04, z: z0 + pw * (i + 0.5) })), (d, p, i) => {
      d.position.x = (b.rand() - 0.5) * 0.15;
      planks.setColorAt(i, pc[i % pc.length].clone().multiplyScalar(0.9 + b.rand() * 0.2));
    });
    b.add(planks);
    const posts = [];
    for (let z = z0; z <= z1; z += 2) for (const x of [-W / 2, W / 2]) posts.push({ x, z });
    for (let x = -W / 2 + 2; x < W / 2; x += 2) posts.push({ x, z: z0 });
    const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.17, 1.6, 8), new THREE.MeshLambertMaterial({ color: '#4d3826' }), posts.length);
    C.placeInstances(postMesh, posts, (d) => { d.position.y = -0.55; });
    b.add(postMesh);
    // 系船柱
    const bollards = [{ x: -5.5, z: -9.5 }, { x: 5.5, z: -9.5 }, { x: 5.6, z: -3 }, { x: -5.6, z: -6 }];
    const bm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.18, 0.45, 10), new THREE.MeshLambertMaterial({ color: '#2b2b30' }), bollards.length);
    C.placeInstances(bm, bollards, (d) => { d.position.y = 0.22; });
    b.add(bm);
  }

  // 岸上的仓库
  {
    const colors = ['#b5523b', '#3f7f7a', '#e2cfa6', '#8b4a3a', '#5d6f8f', '#c98e4b'];
    for (let i = 0; i < 9; i++) {
      const w = 6 + b.rand() * 3, h = 4 + b.rand() * 3, d = 7;
      const x = -30 + i * 7.2 + (b.rand() - 0.5);
      if (Math.abs(x) < 7) continue; // 码头正后方留出空地
      const z = 14 + b.rand() * 3;
      const house = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: colors[i % colors.length] }));
      body.position.y = h / 2;
      const roofShape = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.3, 0), new THREE.Vector2(w / 2 + 0.3, 0), new THREE.Vector2(0, 2)]);
      const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: d + 0.4, bevelEnabled: false });
      roofGeo.translate(0, h, -d / 2 - 0.2);
      const roof = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: '#5a3a2e' }));
      const door = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.4, h * 0.55), new THREE.MeshLambertMaterial({ color: '#3a2c22' }));
      door.position.set(0, h * 0.275, -d / 2 - 0.01);
      door.rotation.y = Math.PI;
      house.add(body, roof, door);
      house.position.set(x, 0, z);
      b.add(house);
    }
  }

  // 秋天的树（金黄、橙红）
  const yAt = (p) => THREE.MathUtils.smoothstep(p.r, 40, 85) * 2.4;
  C.addRoundTrees(b, { spots: C.scatter(b, 70, 9, 45, (x, z) => z > 9.5), colors: ['#e8742c', '#d9481f', '#f2b134', '#c9a23a', '#b5541f'], yAt, canopy: 1.5 });
  C.addPines(b, { spots: C.scatter(b, 30, 20, 60, (x, z) => z > 18), colors: ['#3a5a3a', '#4a6b3d'], yAt });

  // 小渔船，随波浪轻轻摇晃
  {
    const hullShape = new THREE.Shape([
      new THREE.Vector2(-1, -2.4), new THREE.Vector2(1, -2.4), new THREE.Vector2(1.05, 1.1),
      new THREE.Vector2(0, 2.7), new THREE.Vector2(-1.05, 1.1),
    ]);
    const boats = [
      { x: 8.6, z: -3, rot: 0.1, color: '#f4f1ea', trim: '#2f5d8a' },
      { x: -8.8, z: -6.5, rot: -0.15, color: '#2f5d8a', trim: '#f4f1ea' },
      { x: 9.2, z: -9.5, rot: 0.3, color: '#b8432f', trim: '#f4f1ea' },
    ];
    for (const s of boats) {
      const boat = new THREE.Group();
      const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 0.9, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1 });
      hullGeo.rotateX(Math.PI / 2);
      hullGeo.translate(0, 0.6, 0);
      const hull = new THREE.Mesh(hullGeo, new THREE.MeshLambertMaterial({ color: s.color }));
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1, 1.4), new THREE.MeshLambertMaterial({ color: s.trim }));
      cabin.position.set(0, 1.1, -0.6);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4, 6), new THREE.MeshLambertMaterial({ color: '#6b4a32' }));
      mast.position.set(0, 2.5, 0.6);
      boat.add(hull, cabin, mast);
      boat.position.set(s.x, WATER_Y - 0.25, s.z);
      boat.rotation.y = s.rot;
      b.add(boat);
      const ph = b.rand() * 6;
      b.onUpdate((dt, t) => {
        boat.position.y = WATER_Y - 0.25 + Math.sin(t * 0.9 + ph) * 0.06;
        boat.rotation.z = Math.sin(t * 0.7 + ph) * 0.04;
        boat.rotation.x = Math.sin(t * 0.5 + ph * 2) * 0.03;
      });
    }
  }

  // 远处小岛上的灯塔
  {
    const lh = new THREE.Group();
    const island = new THREE.Mesh(new THREE.DodecahedronGeometry(5, 0), new THREE.MeshLambertMaterial({ color: '#6d6a62', flatShading: true }));
    island.scale.set(1.4, 0.35, 1);
    lh.add(island);
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(1.1 - i * 0.12, 1.22 - i * 0.12, 2.6, 16), new THREE.MeshLambertMaterial({ color: i % 2 ? '#c8342c' : '#f5f2ea' }));
      seg.position.y = 1.3 + i * 2.6;
      lh.add(seg);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: '#fff3c4' }));
    lamp.position.y = 11.3;
    lh.add(lamp);
    lh.position.set(-34, WATER_Y, -62);
    b.add(lh);
  }

  // 满地落叶（静止）+ 正在飘落的叶子
  {
    const geo = leafGeometry(0.075);
    const cs = LEAF_COLORS.map((h) => new THREE.Color(h));
    const ground = C.scatter(b, 1100, 0, 15, (x, z) => (Math.abs(x) < 6 && z < LAND_Z + 0.5 && z > -10) || z > LAND_Z);
    const lay = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), ground.length);
    C.placeInstances(lay, ground, (d, p, i) => {
      d.position.y = 0.006 + b.rand() * 0.01;
      d.rotation.set((b.rand() - 0.5) * 0.3, b.rand() * Math.PI * 2, (b.rand() - 0.5) * 0.3);
      d.scale.setScalar(0.7 + b.rand() * 0.8);
      lay.setColorAt(i, cs[Math.floor(b.rand() * cs.length)].clone().multiplyScalar(0.8 + b.rand() * 0.3));
    });
    b.add(lay);

    const N = 180;
    const fall = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), N);
    const leaves = Array.from({ length: N }, (_, i) => {
      fall.setColorAt(i, cs[i % cs.length]);
      const a = b.rand() * Math.PI * 2, r = Math.sqrt(b.rand()) * 13;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: b.rand() * 8, v: 0.4 + b.rand() * 0.5, p: b.rand() * 10, s: 0.8 + b.rand() * 0.8 };
    });
    const d = new THREE.Object3D();
    b.add(fall);
    b.onUpdate((dt, t) => {
      for (let i = 0; i < N; i++) {
        const l = leaves[i];
        l.y -= l.v * dt;
        l.x += 0.35 * dt; // 微风
        if (l.y < 0) {
          l.y = 8;
          const a = b.rand() * Math.PI * 2, r = Math.sqrt(b.rand()) * 13;
          l.x = Math.cos(a) * r - 3; l.z = Math.sin(a) * r;
        }
        d.position.set(l.x + Math.sin(t * 1.5 + l.p) * 0.4, l.y, l.z + Math.cos(t * 1.1 + l.p) * 0.3);
        d.rotation.set(Math.sin(t * 2.3 + l.p) * 1.2, t * 0.8 + l.p, Math.cos(t * 1.9 + l.p) * 1.2);
        d.scale.setScalar(l.s);
        d.updateMatrix();
        fall.setMatrixAt(i, d.matrix);
      }
      fall.instanceMatrix.needsUpdate = true;
    });
  }

  // 海鸥
  {
    const wing = new THREE.PlaneGeometry(0.6, 0.18);
    wing.translate(0.3, 0, 0);
    const mat = new THREE.MeshLambertMaterial({ color: '#f4f4f4', side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) {
      const bird = new THREE.Group();
      const L = new THREE.Mesh(wing, mat), R = new THREE.Mesh(wing, mat);
      R.scale.x = -1;
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat);
      body.scale.set(0.8, 0.8, 2.2);
      bird.add(L, R, body);
      b.add(bird);
      const R0 = 15 + b.rand() * 18, h = 9 + b.rand() * 8, sp = (0.08 + b.rand() * 0.08) * (b.rand() < 0.5 ? 1 : -1), ph = b.rand() * 6;
      const cx = (b.rand() - 0.5) * 20, cz = -15 - b.rand() * 15;
      b.onUpdate((dt, t) => {
        const a = ph + t * sp;
        bird.position.set(cx + Math.cos(a) * R0, h + Math.sin(t * 0.5 + ph) * 1.5, cz + Math.sin(a) * R0);
        bird.rotation.set(0, Math.atan2(-Math.sin(a) * Math.sign(sp), Math.cos(a) * Math.sign(sp)), Math.sign(sp) * -0.25);
        const flap = Math.sin(t * 5 + ph) * 0.45;
        L.rotation.z = flap;
        R.rotation.z = -flap;
      });
    }
  }

  // 阳光：斜射的光柱 + 金色浮尘
  C.addLightShafts(b, { dir: new THREE.Vector3(sunDir.x, 0.55, sunDir.z), count: 12, color: '#ffd98a', length: 30, width: [1, 2.6], opacity: 0.12, area: 13, minR: 2 });
  C.addParticles(b, { count: 150, radius: 12, minR: 2, yMin: 0.3, yMax: 4, size: 0.06, additive: true, texture: C.softDotTexture('rgba(255,236,180,1)', 'rgba(255,200,120,0)'), velocity: [0.05, 0.02, 0], sway: 0.4, swaySpeed: 0.5 });

  return b.finish({ fog: new THREE.Fog(fogColor, 25, 95) });
}
