// 把一块长方形场地放进安全边界（Guardian）里面。
// poly：安全边界多边形 [[x,z],...]（已经往里缩过）；rect：场地在它自己坐标里的范围
// {x0,x1,z0,z1}（-z 是“前方”）；prefer：尽量靠近的位置 [x,z]；forward：尽量朝向的方向 [fx,fz]。
// 返回 { x, z, yaw }（yaw 用法：group.rotation.y = yaw），放不下返回 null。
import { pointInPolygon } from './geometry2d.js';

function corners(rect, x, z, yaw, step = 0.25) {
  const pts = [];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const add = (lx, lz) => pts.push([x + lx * c + lz * s, z - lx * s + lz * c]);
  const nx = Math.max(1, Math.ceil((rect.x1 - rect.x0) / step)), nz = Math.max(1, Math.ceil((rect.z1 - rect.z0) / step));
  for (let i = 0; i <= nx; i++) { const lx = rect.x0 + (rect.x1 - rect.x0) * i / nx; add(lx, rect.z0); add(lx, rect.z1); }
  for (let j = 1; j < nz; j++) { const lz = rect.z0 + (rect.z1 - rect.z0) * j / nz; add(rect.x0, lz); add(rect.x1, lz); }
  return pts;
}

export function rectFits(poly, rect, x, z, yaw) {
  return corners(rect, x, z, yaw).every((p) => pointInPolygon(p, poly));
}

export function fitRect(poly, rect, { prefer = [0, 0], forward = [0, -1], step = 0.1 } = {}) {
  if (!poly || poly.length < 3) return null;
  const fYaw = Math.atan2(-forward[0], -forward[1]);
  // 候选朝向：你面对的方向，以及和安全边界每条边平行/垂直的方向（矩形房间用这个最省地方）
  const yaws = [fYaw];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const e = Math.atan2(b[0] - a[0], b[1] - a[1]);
    for (let k = 0; k < 4; k++) yaws.push(e + k * Math.PI / 2);
  }
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  let best = null;
  for (const yaw of yaws) {
    const dYaw = Math.abs(Math.atan2(Math.sin(yaw - fYaw), Math.cos(yaw - fYaw)));
    for (let x = minX; x <= maxX + 1e-6; x += step) {
      for (let z = minZ; z <= maxZ + 1e-6; z += step) {
        const score = Math.hypot(x - prefer[0], z - prefer[1]) + dYaw * 0.6;
        if (best && score >= best.score) continue;
        if (!rectFits(poly, rect, x, z, yaw)) continue;
        best = { x, z, yaw, score };
      }
    }
  }
  return best;
}
