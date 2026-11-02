// 冬日雪地：雪原、积雪的松树和雪山、结冰的湖、冒烟的小木屋、雪人、漫天飘雪。
import * as C from './common.js';
const { THREE } = C;

export function create() {
  const b = C.createBuilder(33);
  const sunDir = new THREE.Vector3(0.6, 0.28, -0.75).normalize();
  const sunAz = Math.atan2(sunDir.z, sunDir.x);
  const fogColor = '#e4ebf3';

  C.addLights(b, { sky: '#eef4ff', ground: '#b9c7d8', hemi: 1.35, sun: '#fff1d6', sunIntensity: 1.4, sunDir });
  C.addSky(b, { top: '#7fa6d1', mid: '#c4d8ec', horizon: '#eef2f7', sunDir, sunColor: '#fff4dc', sun: 0.7 });
  C.addClouds(b, { sunAz, color: '#ffffff', tint: '#fff0e0', opacity: 0.9, count: 18 });
  C.addMountains(b, { colors: ['#cdd8e6', '#b3c3d8', '#97abc4', '#7f95b0'], haze: fogColor, snow: '#ffffff', snowLine: 0.55, peak: 22 });

  const lake = { x: -14, z: 6, r: 9 };
  const inLake = (x, z, pad = 0) => Math.hypot(x - lake.x, z - lake.z) < lake.r + pad;
  // 冰面：反光强、波纹很慢
  C.addWater(b, { shape: 'circle', radius: lake.r, x: lake.x, z: lake.z, deep: '#8fb8cf', sky: '#eaf3fb', warm: '#fff6ea', sun: '#ffffff', fog: fogColor, wave: 4, sparkle: 0.9, opacity: 0.97 });
  const sa = new THREE.Color('#e3eaf3'), sb = new THREE.Color('#ffffff');
  C.addGround(b, {
    colorAt: (x, z) => sa.clone().lerp(sb, THREE.MathUtils.clamp(0.5 + 0.3 * Math.sin(x * 0.31) * Math.sin(z * 0.27), 0, 1)),
    heightAt: (x, z) => (inLake(x, z, 1) ? -0.05 : 0.06 * Math.sin(x * 0.7) * Math.sin(z * 0.6) * THREE.MathUtils.smoothstep(Math.hypot(x, z), 5, 9)),
    hills: { start: 25, end: 80, height: 6, seed: 77 },
  });

  const vista = (a, r) => C.angDiff(a, -Math.PI / 2) < 0.45 && r < 38;
  const yAt = (p) => THREE.MathUtils.smoothstep(p.r, 25, 80) * 3.6;
  C.addPines(b, { spots: C.scatter(b, 260, 10, 62, (x, z, a, r) => !inLake(x, z, 2) && !vista(a, r)), colors: ['#24473a', '#2c5243', '#1f3d33'], snow: '#f4f8ff', yAt });
  C.addRocks(b, { spots: C.scatter(b, 30, 6, 30, (x, z) => !inLake(x, z, 0.5)), color: '#c9d2dc', yAt });

  // 小木屋（窗户透出暖光，烟囱冒烟）
  {
    const cabin = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: '#7a4f33' });
    const walls = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), wood);
    walls.position.y = 1.5;
    const roofShape = new THREE.Shape([new THREE.Vector2(-2.9, 0), new THREE.Vector2(2.9, 0), new THREE.Vector2(0, 2.2)]);
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 4.6, bevelEnabled: false });
    roofGeo.translate(0, 3, -2.3);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: '#f6f9ff' }));
    const winMat = new THREE.MeshBasicMaterial({ color: '#ffc66b' });
    for (const x of [-1.3, 1.3]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.8), winMat);
      w.position.set(x, 1.7, 2.01);
      cabin.add(w);
    }
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8), new THREE.MeshLambertMaterial({ color: '#4a2f1f' }));
    door.position.set(0, 0.9, 2.01);
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), new THREE.MeshLambertMaterial({ color: '#6d6d72' }));
    chimney.position.set(1.4, 4.6, -0.6);
    cabin.add(walls, roof, door, chimney);
    cabin.position.set(-9, 0, -16);
    cabin.rotation.y = 0.5;
    b.add(cabin);
    const top = new THREE.Vector3(1.4, 5.5, -0.6).applyEuler(cabin.rotation).add(cabin.position);
    C.addParticles(b, { count: 40, radius: 0.6, center: [top.x, top.z], yMin: top.y, yMax: top.y + 6, size: 0.9, color: '#d7dde6', opacity: 0.35, velocity: [0.25, 0.6, 0], sway: 0.4, swaySpeed: 0.3 });
  }

  // 雪人
  {
    const snowMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const man = new THREE.Group();
    [[0.45, 0.42], [0.32, 1.08], [0.22, 1.55]].forEach(([r, y]) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), snowMat);
      s.position.y = y;
      man.add(s);
    });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22, 8), new THREE.MeshLambertMaterial({ color: '#ff8a2b' }));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.55, 0.3);
    const coal = new THREE.MeshLambertMaterial({ color: '#222' });
    for (const x of [-0.08, 0.08]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), coal);
      e.position.set(x, 1.62, 0.19);
      man.add(e);
    }
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 20), new THREE.MeshLambertMaterial({ color: '#d93a3a' }));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 1.36;
    const stickMat = new THREE.MeshLambertMaterial({ color: '#5a3b24' });
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.7, 5), stickMat);
      arm.position.set(s * 0.5, 1.2, 0);
      arm.rotation.z = s * -1.0;
      man.add(arm);
    }
    man.add(nose, scarf);
    man.position.set(4.2, 0, -3.8);
    man.rotation.y = -0.7;
    b.add(man);
  }

  // 雪花
  C.addParticles(b, { count: 900, radius: 14, yMin: 0, yMax: 9, size: 0.07, color: '#ffffff', opacity: 0.9, velocity: [0.15, -0.6, 0.05], sway: 0.35, swaySpeed: 0.8 });

  return b.finish({ fog: new THREE.Fog(fogColor, 15, 80) });
}
