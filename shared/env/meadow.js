// 草地森林：黄昏时分的草地、远山、松林、湖泊、飘浮的金色光点。
import * as C from './common.js';
const { THREE } = C;

export function create() {
  const b = C.createBuilder(7);
  const sunDir = new THREE.Vector3(-0.85, 0.2, -0.75).normalize();
  const sunAz = Math.atan2(sunDir.z, sunDir.x);
  const fogColor = '#efcfaa';

  C.addLights(b, { sky: '#ffe9cc', ground: '#4a6b35', hemi: 1.15, sun: '#ffd9a6', sunIntensity: 2.2, sunDir });
  C.addSky(b, { top: '#3a6db5', mid: '#8db6dd', horizon: '#ffd3a3', sunDir, sunColor: '#ffcf8a' });
  C.addClouds(b, { sunAz });
  C.addMountains(b, {
    haze: fogColor,
    shape: (a) => 1 - 0.45 * Math.pow(Math.max(0, Math.cos(a - sunAz)), 4), // 夕阳方向的山低一些
  });

  const lake = { x: 15, z: 9, r: 8 };
  const inLake = (x, z, pad = 0) => Math.hypot(x - lake.x, z - lake.z) < lake.r + pad;
  C.addWater(b, { shape: 'circle', radius: lake.r, x: lake.x, z: lake.z, fog: fogColor });
  const shore = new THREE.Color('#8c8a5a');
  const ga = new THREE.Color('#5c8a3f'), gb = new THREE.Color('#86ad55');
  C.addGround(b, {
    colorAt: (x, z) => {
      const t = THREE.MathUtils.clamp(0.5 + 0.22 * (Math.sin(x * 0.23) + Math.sin(z * 0.19 + 1.3)) + 0.12 * Math.sin((x - z) * 0.6), 0, 1);
      const c = ga.clone().lerp(gb, t);
      return inLake(x, z, 1.8) ? c.lerp(shore, 0.6) : c;
    },
    heightAt: (x, z) => (inLake(x, z, 1.5) ? -0.05 : 0),
  });

  // 夕阳方向和正前方（-z）留出视野，树长在两边
  const vista = (a, r) => (C.angDiff(a, sunAz) < 0.32 && r < 50) || (C.angDiff(a, -Math.PI / 2) < 0.45 && r < 38);
  const yAt = (p) => THREE.MathUtils.smoothstep(p.r, 30, 80) * 3;
  C.addPines(b, { spots: C.scatter(b, 240, 11, 60, (x, z, a, r) => !inLake(x, z, 2) && !vista(a, r)), yAt });
  C.addRoundTrees(b, { spots: C.scatter(b, 70, 10, 40, (x, z, a, r) => !inLake(x, z, 2) && !vista(a, r)), colors: ['#5f8f3c', '#77a043', '#8aa63f', '#c9a64a'], yAt });
  const rockSpots = C.scatter(b, 40, 6, 35, (x, z) => !inLake(x, z, 0.5));
  for (let i = 0; i < 10; i++) {
    const a = b.rand() * Math.PI * 2;
    rockSpots.push({ x: lake.x + Math.cos(a) * (lake.r + 0.3), z: lake.z + Math.sin(a) * (lake.r + 0.3), r: 15 });
  }
  C.addRocks(b, { spots: rockSpots, yAt });
  C.addGrass(b, { spots: C.scatter(b, 5000, 4, 20, (x, z) => !inLake(x, z, 0.3)), colors: ['#6f9b4a', '#86ad55', '#5c8a3f', '#7fa34c'] });
  C.addFlowers(b, { spots: C.scatter(b, 500, 4.5, 16, (x, z) => !inLake(x, z, 0.5)) });
  C.addParticles(b, {
    count: 160, radius: 14, minR: 2.5, yMin: 0.4, yMax: 3.2, size: 0.09, additive: true,
    texture: C.softDotTexture('rgba(255,240,190,1)', 'rgba(255,200,100,0)'), velocity: [0, 0.05, 0], sway: 0.6, swaySpeed: 0.6,
  });

  return b.finish({ fog: new THREE.Fog(fogColor, 18, 85) });
}
