// 手腕地图：像看手表一样抬起左手，左手柄上方就弹出一块小屏幕；手放下就收起来。
// 用法：const wrist = createWristMap(app, { draw(ctx, w, h) {...} }); 每帧 wrist.update(dt)。
import * as THREE from 'three';
import { makeCanvasPlane } from './ui3d.js';

export function createWristMap(app, { size = 0.2, px = 1400, draw, enabled = true } = {}) {
  const p = makeCanvasPlane(size, size, px);
  p.mesh.material.opacity = 0;
  p.mesh.material.depthTest = true;
  p.mesh.renderOrder = 50;
  p.mesh.visible = false;
  p.mesh.userData.headLocked = true; // 重新居中时不要挪它（它每帧都跟着手）
  app.scene.add(p.mesh);
  let on = enabled;
  let shown = 0;          // 0~1 渐显
  let redrawT = 0;
  const head = new THREE.Vector3(), hand = new THREE.Vector3(), q = new THREE.Quaternion();

  function leftController() {
    return app.controllers.find((c) => c.inputSource?.handedness === 'left') || null;
  }
  // 抬手看表：手在眼睛前下方 15~55 厘米、离头不到 55 厘米。手垂在腰边或伸直去指东西时都不算。
  function raised(c) {
    c.grip.getWorldPosition(hand);
    app.headPosition(head);
    const dy = head.y - hand.y;
    return hand.distanceTo(head) < 0.55 && dy > 0.12 && dy < 0.6;
  }

  return {
    mesh: p.mesh,
    get enabled() { return on; },
    set enabled(v) { on = v; },
    get visible() { return shown > 0.05; },
    redraw() { if (draw) p.redraw(draw); },
    update(dt) {
      const c = app.presenting && on ? leftController() : null;
      const want = c && raised(c) ? 1 : 0;
      shown += (want - shown) * Math.min(1, dt * 10);
      p.mesh.visible = shown > 0.02;
      p.mesh.material.opacity = shown;
      if (!p.mesh.visible || !c) return;
      // 放在手柄上方一点，正对着眼睛
      c.grip.getWorldPosition(hand);
      app.headPosition(head);
      p.mesh.position.copy(hand).add(new THREE.Vector3(0, 0.1 + 0.02 * shown, 0)).lerp(head, 0.15);
      p.mesh.lookAt(head);
      p.mesh.scale.setScalar(0.85 + 0.15 * shown);
      redrawT -= dt;
      if (redrawT <= 0 && draw) { redrawT = 0.12; p.redraw(draw); }
    },
  };
}
