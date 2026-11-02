// 所有游戏共用的 VR 基础设置：渲染器、场景、相机、两只手柄、进入 VR / 混合现实。
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

export function createXRApp({ onFrame } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  // local-floor：坐标原点在地板上、你开始游戏时站的位置
  renderer.xr.setReferenceSpaceType('local-floor');
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.03, 200);
  scene.add(camera);

  // 简单的事件系统
  const listeners = {};
  const on = (name, fn) => (listeners[name] ||= []).push(fn);
  const emit = (name, ...args) => (listeners[name] || []).forEach((fn) => fn(...args));

  // ---- 手柄 ----
  const controllers = [];
  const modelFactory = new XRControllerModelFactory();
  for (let i = 0; i < 2; i++) {
    const ray = renderer.xr.getController(i); // 射线方向
    const grip = renderer.xr.getControllerGrip(i); // 手柄模型位置
    grip.add(modelFactory.createControllerModel(grip));

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
    );
    line.scale.z = 3;
    ray.add(line);

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    dot.visible = false;
    scene.add(dot);

    const c = { index: i, ray, grip, line, dot, inputSource: null, prevButtons: [], hover: null };
    ray.addEventListener('connected', (e) => {
      c.inputSource = e.data;
      line.visible = e.data.targetRayMode !== 'gaze';
    });
    ray.addEventListener('disconnected', () => {
      c.inputSource = null;
      c.hover = null;
      dot.visible = false;
    });
    ray.addEventListener('selectstart', () => emit('select', c));
    scene.add(ray, grip);
    controllers.push(c);
  }

  // 手柄震动
  function pulse(c, intensity = 0.5, ms = 50) {
    try {
      c.inputSource?.gamepad?.hapticActuators?.[0]?.pulse(intensity, ms);
    } catch (_) { /* 有些设备不支持震动 */ }
  }
  const pulseAll = (intensity, ms) => controllers.forEach((c) => pulse(c, intensity, ms));

  // 检测按键"刚按下"的瞬间。xr-standard 布局：0 扳机，1 握把，3 摇杆按下，4 A/X，5 B/Y
  function pollButtons(handler) {
    for (const c of controllers) {
      const gp = c.inputSource?.gamepad;
      if (!gp) continue;
      gp.buttons.forEach((b, bi) => {
        if (b.pressed && !c.prevButtons[bi]) handler(c, bi);
        c.prevButtons[bi] = b.pressed;
      });
    }
  }

  // ---- 射线检测 ----
  const raycaster = new THREE.Raycaster();
  const rot = new THREE.Matrix4();
  function pointAt(c, targets, maxLen = 4) {
    rot.identity().extractRotation(c.ray.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(c.ray.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rot);
    raycaster.far = maxLen;
    const hit = raycaster.intersectObjects(targets, false)[0] || null;
    c.line.scale.z = hit ? hit.distance : maxLen;
    c.dot.visible = !!hit;
    if (hit) c.dot.position.copy(hit.point);
    return hit;
  }

  // ---- 进入 VR / 混合现实 ----
  let mode = 'desktop';
  async function supports(sessionMode) {
    try {
      return !!navigator.xr && (await navigator.xr.isSessionSupported(sessionMode));
    } catch (_) {
      return false;
    }
  }
  async function enter(sessionMode) {
    const session = await navigator.xr.requestSession(sessionMode, {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    await renderer.xr.setSession(session);
  }
  renderer.xr.addEventListener('sessionstart', () => {
    const s = renderer.xr.getSession();
    mode = s.environmentBlendMode && s.environmentBlendMode !== 'opaque' ? 'ar' : 'vr';
    emit('modechange', mode);
  });
  renderer.xr.addEventListener('sessionend', () => {
    mode = 'desktop';
    emit('modechange', mode);
  });

  // ---- 头部位置 / 朝向 ----
  function headPosition(target = new THREE.Vector3()) {
    return camera.getWorldPosition(target);
  }
  function headForward(target = new THREE.Vector3()) {
    camera.getWorldDirection(target);
    target.y = 0;
    if (target.lengthSq() < 1e-6) target.set(0, 0, -1);
    return target.normalize();
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop((time) => {
    const dt = Math.min(clock.getDelta(), 0.1);
    onFrame?.(dt, time);
    renderer.render(scene, camera);
  });

  return {
    renderer, scene, camera, controllers,
    on, pulse, pulseAll, pollButtons, pointAt,
    supports, enter, headPosition, headForward,
    get mode() { return mode; },
    get presenting() { return renderer.xr.isPresenting; },
  };
}
