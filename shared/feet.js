// 卡通脚：显示在你头部正下方的地面上，朝向跟着你的头转，让你知道自己站在哪里。
// 头显只知道头的位置，不知道脚的位置，所以脚画在“脖子正下方”（见 app.footPosition）。
import * as THREE from 'three';

function shoe(color, accent) {
  const g = new THREE.Group();
  const toon = (c) => new THREE.MeshToonMaterial({ color: c });
  // 鞋底
  const sole = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.15, 6, 16), toon('#f4f1ea'));
  sole.rotation.x = Math.PI / 2;
  sole.scale.set(1, 1, 0.32);
  sole.position.y = 0.016;
  // 鞋面（圆鼓鼓的）
  const upper = new THREE.Mesh(new THREE.SphereGeometry(0.06, 18, 12), toon(color));
  upper.scale.set(0.85, 0.62, 1.75);
  upper.position.set(0, 0.045, 0.015);
  // 鞋头一圈白边 + 鞋带
  const toe = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), toon('#ffffff'));
  toe.scale.set(1, 0.55, 0.9);
  toe.position.set(0, 0.032, 0.085);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.007, 6, 18, Math.PI), toon(accent));
  stripe.rotation.set(0, Math.PI / 2, 0);
  stripe.position.set(0, 0.05, -0.01);
  stripe.scale.set(1, 0.7, 1);
  for (let i = 0; i < 3; i++) {
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.006, 0.008), toon('#ffffff'));
    lace.position.set(0, 0.078, 0.045 - i * 0.022);
    g.add(lace);
  }
  // 脚踝开口
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 6, 16), toon(accent));
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, 0.075, -0.05);
  g.add(sole, upper, toe, stripe, cuff);
  return g;
}

export function createFeet({ color = '#ff6b6b', accent = '#3a86ff' } = {}) {
  const group = new THREE.Group();
  const left = shoe(color, accent), right = shoe(color, accent);
  left.position.x = -0.09;
  right.position.x = 0.09;
  left.rotation.y = 0.08;
  right.rotation.y = -0.08;
  // 脚下一圈淡淡的影子
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 32),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.003;
  shadow.scale.set(1.1, 1, 1.3);
  group.add(shadow, left, right);
  group.visible = false;
  let yaw = 0;
  let init = false;
  const fwd = new THREE.Vector3();

  return {
    object: group,
    // footWorld：脚的世界坐标（app.footPosition()）；forward：头朝向（水平）；floorY：地面高度
    update(footWorld, forward, floorY = 0, dt = 0.016) {
      group.visible = true;
      fwd.copy(forward).setY(0).normalize();
      const want = Math.atan2(fwd.x, fwd.z);
      if (!init) { yaw = want; init = true; }
      let d = want - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 6); // 转头时脚慢慢跟着转
      group.position.set(footWorld.x, floorY + 0.002, footWorld.z);
      group.rotation.y = yaw;
    },
    hide() { group.visible = false; },
  };
}
