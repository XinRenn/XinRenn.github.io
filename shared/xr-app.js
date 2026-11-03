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
    ray.addEventListener('selectend', () => emit('selectend', c));
    ray.addEventListener('squeezestart', () => emit('squeeze', c));
    ray.addEventListener('squeezeend', () => emit('squeezeend', c));
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
  // 手柄射线（用来和地面求交点）
  function getRay(c, target = new THREE.Ray()) {
    rot.identity().extractRotation(c.ray.matrixWorld);
    target.origin.setFromMatrixPosition(c.ray.matrixWorld);
    target.direction.set(0, 0, -1).applyMatrix4(rot);
    return target;
  }

  // ---- 安全边界（Guardian）----
  // 浏览器通过 bounded-floor 参考空间提供边界的多边形。Quest 上通常是一个矩形，
  // 有时会晚几秒才有数据，所以每帧都试一下，拿到后发出 'bounds' 事件（点是 [x, z]）。
  let boundedSpace = null;
  let bounds = null;
  function tryReadBounds(frame) {
    if (!boundedSpace || bounds || !frame) return;
    const pts = boundedSpace.boundsGeometry;
    if (!pts || pts.length < 3) return;
    const pose = frame.getPose(boundedSpace, renderer.xr.getReferenceSpace());
    if (!pose) return;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    bounds = Array.from(pts).map((p) => {
      const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(m);
      return [v.x, v.z];
    });
    emit('bounds', bounds);
  }

  // 进入时优先用 bounded-floor（以安全边界为基准的坐标系）：长按 Home 键重新居中时它不会变，
  // 场地就一直固定在房间里原来的位置。不支持时退回 local-floor，并在“重置”事件里把场景反向挪回去。
  async function enter(sessionMode) {
    const session = await navigator.xr.requestSession(sessionMode, {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    let type = 'local-floor';
    try {
      await session.requestReferenceSpace('bounded-floor');
      type = 'bounded-floor';
    } catch (_) { /* 没有安全边界（比如原地模式），用 local-floor */ }
    renderer.xr.setReferenceSpaceType(type);
    await renderer.xr.setSession(session);
    referenceType = type;
    const space = renderer.xr.getReferenceSpace();
    space?.addEventListener?.('reset', (e) => {
      // transform = 新原点在旧坐标系里的位置；把场景里的东西乘上它的逆，就回到房间里原来的地方
      if (e.transform) {
        const inv = new THREE.Matrix4().fromArray(e.transform.matrix).invert();
        for (const o of scene.children) if (o !== camera && !o.userData.headLocked) o.applyMatrix4(inv);
      }
      emit('recenter', !!e.transform);
    });
  }
  let referenceType = 'local-floor';
  renderer.xr.addEventListener('sessionstart', () => {
    const s = renderer.xr.getSession();
    mode = s.environmentBlendMode && s.environmentBlendMode !== 'opaque' ? 'ar' : 'vr';
    bounds = null;
    boundedSpace = null;
    s.requestReferenceSpace('bounded-floor').then((sp) => { boundedSpace = sp; }).catch(() => {});
    emit('modechange', mode);
  });
  renderer.xr.addEventListener('sessionend', () => {
    mode = 'desktop';
    boundedSpace = null;
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
  renderer.setAnimationLoop((time, frame) => {
    const dt = Math.min(clock.getDelta(), 0.1);
    tryReadBounds(frame);
    onFrame?.(dt, time);
    renderer.render(scene, camera);
  });

  return {
    renderer, scene, camera, controllers,
    on, pulse, pulseAll, pollButtons, pointAt, getRay,
    get bounds() { return bounds; },
    supports, enter, headPosition, headForward,
    get mode() { return mode; },
    get referenceType() { return referenceType; },
    get presenting() { return renderer.xr.isPresenting; },
  };
}
