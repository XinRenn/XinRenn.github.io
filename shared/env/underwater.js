// 海底世界：沙地、海藻、珊瑚、鱼群、一只滑翔的蝠鲼、气泡、从水面射下来的光柱和水波光斑。
import * as C from './common.js';
const { THREE, mergeGeometries } = C;

export function create() {
  const b = C.createBuilder(21);
  const fogColor = '#0f5f7a';
  const up = new THREE.Vector3(0.25, 1, 0.15).normalize();

  C.addLights(b, { sky: '#a6f0ff', ground: '#2b5d6b', hemi: 1.4, sun: '#c8f7ff', sunIntensity: 1.3, sunDir: up });
  C.addSky(b, { top: '#7fe0f0', mid: '#1f8fae', horizon: fogColor, bottom: '#06303f', sunDir: up, sunColor: '#d8ffff', sun: 0.8 });

  // 沙地，远处有起伏的沙丘
  C.addGround(b, { colors: ['#b9a878', '#d4c596'], hills: { start: 12, end: 50, height: 4, seed: 41 } });

  // 地面上晃动的水波光斑（焦散）
  {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(26, 64),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: b.uTime },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec3 vWorld;
          void main() {
            vec2 p = vWorld.xz * 1.4;
            float t = uTime * 0.45;
            vec2 q = p + vec2(sin(p.y * 0.9 + t), cos(p.x * 0.8 - t * 1.1));
            q += vec2(sin(q.y * 1.7 - t * 0.7), cos(q.x * 1.5 + t * 0.9)) * 0.6;
            float v = abs(sin(q.x * 2.0) + sin(q.y * 2.0)) * 0.5;
            float c = pow(1.0 - v, 12.0);
            float fade = 1.0 - smoothstep(6.0, 24.0, length(vWorld.xz));
            gl_FragColor = vec4(vec3(0.7, 1.0, 1.0) * c * 0.28 * fade, 1.0);
          }`,
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.006;
    b.add(m);
  }

  C.addLightShafts(b, { dir: up, count: 14, color: '#aef6ff', length: 34, width: [1, 3], opacity: 0.1, area: 22, minR: 2 });

  // 海藻（很高的草，摆得慢）
  const keep = (x, z, a, r) => r > 5;
  C.addGrass(b, { spots: C.scatter(b, 320, 5, 26, keep), colors: ['#3f7d3a', '#5b8f2e', '#2f6b4a', '#7a8f2a'], height: [0.6, 1.4], width: 0.22, bladeH: 2.6, sway: 0.5, swaySpeed: 0.5, clearRadius: 5 });

  // 珊瑚：分叉珊瑚、脑珊瑚、扇形珊瑚
  {
    const spots = C.scatter(b, 140, 4.6, 20);
    const branch = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.CylinderGeometry(0.03, 0.05, 0.5 + (i % 3) * 0.15, 5);
      g.translate(0, 0.25, 0);
      g.rotateZ((i - 2.5) * 0.25);
      g.rotateY(i * 1.1);
      branch.push(g);
    }
    const kinds = [
      mergeGeometries(branch),
      (() => { const g = new THREE.SphereGeometry(0.35, 12, 8); g.scale(1, 0.6, 1); g.translate(0, 0.15, 0); return g; })(),
      (() => { const g = new THREE.CircleGeometry(0.45, 10, 0, Math.PI); g.translate(0, 0.05, 0); return g; })(),
    ];
    const colors = ['#ff6f91', '#ff9f43', '#c56cf0', '#ffd166', '#ff4d6d', '#4dd0e1'].map((h) => new THREE.Color(h));
    kinds.forEach((geo, k) => {
      const mine = spots.filter((_, i) => i % 3 === k);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, flatShading: k === 1 }), mine.length);
      C.placeInstances(mesh, mine, (d, p, i) => {
        d.rotation.y = b.rand() * Math.PI * 2;
        d.scale.setScalar(0.6 + b.rand() * 1.2);
        mesh.setColorAt(i, colors[Math.floor(b.rand() * colors.length)]);
      });
      b.add(mesh);
    });
  }
  C.addRocks(b, { spots: C.scatter(b, 45, 5, 30), color: '#6d6a7d', size: [0.4, 1.8] });

  // 鱼群：三群小鱼绕着你游
  {
    const body = new THREE.SphereGeometry(0.09, 8, 6);
    body.scale(0.5, 0.6, 1.4);
    const tail = new THREE.ConeGeometry(0.07, 0.1, 4);
    tail.rotateX(-Math.PI / 2);
    tail.translate(0, 0, -0.16);
    const fishGeo = mergeGeometries([body, tail]);
    const schools = [
      { color: '#ffa94d', n: 28, R: 8, y: 2.2, speed: 0.22, dir: 1 },
      { color: '#ffe066', n: 24, R: 11, y: 3.4, speed: 0.16, dir: -1 },
      { color: '#74c0fc', n: 30, R: 6.5, y: 1.4, speed: 0.28, dir: 1 },
    ];
    for (const s of schools) {
      const mesh = new THREE.InstancedMesh(fishGeo, new THREE.MeshLambertMaterial({ color: s.color }), s.n);
      const offs = Array.from({ length: s.n }, () => [(b.rand() - 0.5) * 2, (b.rand() - 0.5) * 1, (b.rand() - 0.5) * 2, b.rand() * 6]);
      const phase = b.rand() * 6;
      const d = new THREE.Object3D();
      b.add(mesh);
      b.onUpdate((dt, t) => {
        const a = phase + t * s.speed * s.dir;
        const cx = Math.cos(a) * s.R, cz = Math.sin(a) * s.R;
        const heading = Math.atan2(-Math.sin(a) * s.dir, Math.cos(a) * s.dir); // 切线方向
        for (let i = 0; i < s.n; i++) {
          const o = offs[i];
          d.position.set(cx + o[0] + Math.sin(t + o[3]) * 0.3, s.y + o[1] + Math.sin(t * 1.3 + o[3]) * 0.15, cz + o[2]);
          d.rotation.set(0, heading + Math.sin(t * 8 + o[3]) * 0.15, 0);
          d.updateMatrix();
          mesh.setMatrixAt(i, d.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      });
    }
  }

  // 蝠鲼：在远处慢慢绕圈滑翔，翅膀上下扇动
  {
    const v = [
      0, 0.1, 0.9,   -1.4, 0, -0.1,   0, 0.14, 0,
      0, 0.1, 0.9,   0, 0.14, 0,      1.4, 0, -0.1,
      -1.4, 0, -0.1, 0, 0, -0.7,      0, 0.14, 0,
      1.4, 0, -0.1,  0, 0.14, 0,      0, 0, -0.7,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: '#2d3a4a', side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = b.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(uTime * 1.6) * pow(abs(position.x), 1.5) * 0.35;');
    };
    const manta = new THREE.Mesh(geo, mat);
    const tailGeo = new THREE.CylinderGeometry(0.01, 0.02, 1.2, 4);
    tailGeo.rotateX(Math.PI / 2);
    tailGeo.translate(0, 0, -1.3);
    manta.add(new THREE.Mesh(tailGeo, new THREE.MeshLambertMaterial({ color: '#2d3a4a' })));
    manta.scale.setScalar(1.8);
    b.add(manta);
    b.onUpdate((dt, t) => {
      const a = t * 0.06;
      manta.position.set(Math.cos(a) * 18, 6 + Math.sin(t * 0.3) * 1.2, Math.sin(a) * 18);
      manta.rotation.set(0, -a, Math.sin(t * 0.3) * 0.1);
    });
  }

  // 往上冒的气泡 + 漂浮的微粒
  C.addParticles(b, { count: 220, radius: 13, minR: 3, yMin: 0, yMax: 9, size: 0.07, color: '#e8ffff', opacity: 0.7, velocity: [0, 0.7, 0], sway: 0.15, swaySpeed: 2 });
  C.addParticles(b, { count: 260, radius: 12, yMin: 0.3, yMax: 6, size: 0.035, color: '#cfffff', opacity: 0.5, additive: true, velocity: [0.05, -0.03, 0.02], sway: 0.3, swaySpeed: 0.4 });

  return b.finish({ fog: new THREE.Fog(fogColor, 4, 42) });
}
