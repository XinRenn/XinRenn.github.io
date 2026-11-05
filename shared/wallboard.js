// 竖在面前的“墙面板”（空中连线、星石三连共用）：摆放、摇杆拉远拉近、面板下面的滑条放大缩小。
// 摆放：面板下三分之一和眼睛平齐，离你 dist 米；设置会记住。
import * as THREE from 'three';
import { makeCanvasPlane, FONT } from './ui3d.js';

const DIST_MIN = 0.4, DIST_MAX = 2.2, SCALE_MIN = 0.6, SCALE_MAX = 1.6;
const TRACK = 0.5; // 滑条长度（米）

function loadNum(k, d) { try { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : d; } catch (_) { return d; } }
function saveNum(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) { /* 无痕模式 */ } }

export function createWallBoard(app, { rig, board, width, height, key, dist = 1.0, onLayout } = {}) {
  let D = THREE.MathUtils.clamp(loadNum(`${key}-dist`, dist), DIST_MIN, DIST_MAX);
  let K = THREE.MathUtils.clamp(loadNum(`${key}-scale`, 1), SCALE_MIN, SCALE_MAX);
  const head0 = new THREE.Vector3(0, 1.6, 0), dir0 = new THREE.Vector3(0, 0, -1);
  let saveT = 0;

  // ---- 滑条 ----
  const slider = new THREE.Group();
  rig.add(slider);
  const track = new THREE.Mesh(new THREE.BoxGeometry(TRACK, 0.014, 0.008), new THREE.MeshBasicMaterial({ color: '#8a96bd' }));
  const fill = new THREE.Mesh(new THREE.BoxGeometry(1, 0.016, 0.009), new THREE.MeshBasicMaterial({ color: '#5cffb0' }));
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 14), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#5cffb0', emissiveIntensity: 0.3, roughness: 0.3 }));
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(TRACK + 0.12, 0.08), new THREE.MeshBasicMaterial({ visible: false }));
  const label = makeCanvasPlane(0.16, 0.05, 900);
  label.redraw((g, w, h) => {
    g.fillStyle = '#c9d3ea'; g.font = `700 ${Math.round(h * 0.6)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('大小', w / 2, h / 2);
  });
  label.mesh.position.set(-TRACK / 2 - 0.1, 0, 0);
  const small = makeCanvasPlane(0.05, 0.05, 900), big = makeCanvasPlane(0.05, 0.05, 900);
  small.redraw((g, w, h) => { g.fillStyle = '#c9d3ea'; g.font = `800 ${Math.round(h * 0.55)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('−', w / 2, h / 2); });
  big.redraw((g, w, h) => { g.fillStyle = '#c9d3ea'; g.font = `800 ${Math.round(h * 0.55)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('+', w / 2, h / 2); });
  small.mesh.position.set(-TRACK / 2 - 0.035, 0, 0);
  big.mesh.position.set(TRACK / 2 + 0.035, 0, 0);
  slider.add(track, fill, handle, hit, label.mesh, small.mesh, big.mesh);

  const kToX = (k) => ((k - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) - 0.5) * TRACK;
  const xToK = (x) => THREE.MathUtils.clamp((x / TRACK + 0.5) * (SCALE_MAX - SCALE_MIN) + SCALE_MIN, SCALE_MIN, SCALE_MAX);

  function layout() {
    board.scale.setScalar(K);
    rig.position.set(head0.x + dir0.x * D, head0.y + (height * K) / 6, head0.z + dir0.z * D);
    rig.rotation.y = Math.atan2(-dir0.x, -dir0.z);
    slider.position.set(0, -(height * K) / 2 - 0.07, 0.02);
    const hx = kToX(K);
    handle.position.x = hx;
    fill.scale.x = hx + TRACK / 2 + 0.0001;
    fill.position.x = -TRACK / 2 + (hx + TRACK / 2) / 2;
    onLayout?.(K, width * K, height * K);
  }

  // 摆到面前（B/Y、进入 VR 时）
  function place() {
    const head = app.headPosition(new THREE.Vector3());
    const f = app.headForward(new THREE.Vector3());
    if (!app.presenting) { head.set(0, 1.6, 0); f.set(0, 0, -1); }
    head0.copy(head); dir0.copy(f);
    layout();
  }

  // ---- 拖滑条：射线（或手柄尖端）按住滑条左右拖 ----
  const ray = new THREE.Raycaster();
  const tmpQ = new THREE.Quaternion();
  let dragBy = null;
  function rayFrom(c) {
    ray.ray.origin.setFromMatrixPosition(c.ray.matrixWorld);
    ray.ray.direction.set(0, 0, -1).applyQuaternion(c.ray.getWorldQuaternion(tmpQ));
    return ray;
  }
  function sliderX(r) {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).applyQuaternion(slider.getWorldQuaternion(tmpQ)), slider.getWorldPosition(new THREE.Vector3()));
    const p = r.ray.intersectPlane(plane, new THREE.Vector3());
    return p ? slider.worldToLocal(p).x : null;
  }
  // by：手柄（用它的射线）或 'mouse'（传入 Raycaster）
  function press(by, raycaster = null) {
    const r = raycaster || rayFrom(by);
    if (!r.intersectObject(hit, false).length) return false;
    dragBy = by;
    drag(by, raycaster);
    return true;
  }
  function drag(by, raycaster = null) {
    if (dragBy !== by) return;
    const x = sliderX(raycaster || rayFrom(by));
    if (x === null) return;
    K = xToK(x);
    layout();
    saveT = 0.4;
  }
  function release(by) { if (dragBy === by) dragBy = null; }
  const hovered = (c) => rayFrom(c).intersectObject(hit, false).length > 0;

  // 每帧：摇杆前后推 = 拉远/拉近；正在拖滑条就跟着手走
  function update(dt) {
    if (app.presenting) {
      for (const c of app.controllers) {
        const ax = c.inputSource?.gamepad?.axes;
        if (ax && ax.length >= 4 && Math.abs(ax[3]) > 0.3) {
          D = THREE.MathUtils.clamp(D - ax[3] * 0.5 * dt, DIST_MIN, DIST_MAX);
          layout();
          saveT = 0.4;
        }
      }
      if (dragBy && dragBy !== 'mouse') drag(dragBy);
    }
    handle.material.emissiveIntensity = dragBy ? 0.9 : 0.3;
    if (saveT > 0) { saveT -= dt; if (saveT <= 0) { saveNum(`${key}-dist`, D.toFixed(2)); saveNum(`${key}-scale`, K.toFixed(2)); } }
  }

  layout();
  return {
    place, update, press, drag, release, hovered, slider, hitMesh: hit,
    get dist() { return D; }, get scale() { return K; }, get dragging() { return !!dragBy; },
    setDist(v) { D = THREE.MathUtils.clamp(v, DIST_MIN, DIST_MAX); layout(); saveT = 0.4; },
    setScale(v) { K = THREE.MathUtils.clamp(v, SCALE_MIN, SCALE_MAX); layout(); saveT = 0.4; },
  };
}
