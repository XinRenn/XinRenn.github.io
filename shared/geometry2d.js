// 地板上的二维几何工具。所有点都是 [x, z]（米）。
// 用来把任意形状的场地切成不规则的格子（Voronoi 分割）。

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 有符号面积：正数 = 逆时针（以 x 向右、z 向上看）
export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
export const area = (poly) => Math.abs(signedArea(poly));
export const ensureCCW = (poly) => (signedArea(poly) < 0 ? poly.slice().reverse() : poly.slice());

export function centroid(poly) {
  const A = signedArea(poly);
  if (Math.abs(A) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const f = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * f;
    cz += (a[1] + b[1]) * f;
  }
  return [cx / (6 * A), cz / (6 * A)];
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function distToSegment(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}
export function distToEdges(p, poly) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return m;
}

// 只保留满足 dot(n, p) <= c 的那一半
export function clipHalfPlane(poly, n, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = dot(n, a) - c, db = dot(n, b) - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
export function selfIntersects(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

// 去掉挨得太近或几乎在一条直线上的点
export function simplify(poly, tol = 0.05) {
  let pts = poly.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length], cur = pts[i], next = pts[(i + 1) % pts.length];
      if (dist(prev, cur) < tol || distToSegment(cur, prev, next) < tol * 0.5) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return pts;
}

// 把边界整体往里缩 d 米（离墙远一点更安全）
export function inset(poly, d) {
  const p = ensureCCW(poly);
  const n = p.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const len = dist(a, b) || 1;
    const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len; // 指向内侧
    lines.push({ a: [a[0] + nx * d, a[1] + nz * d], dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i - 1 + n) % n], L2 = lines[i];
    const cross = L1.dir[0] * L2.dir[1] - L1.dir[1] * L2.dir[0];
    if (Math.abs(cross) < 1e-6) { out.push(L2.a); continue; }
    const w = sub(L2.a, L1.a);
    const t = (w[0] * L2.dir[1] - w[1] * L2.dir[0]) / cross;
    let q = [L1.a[0] + L1.dir[0] * t, L1.a[1] + L1.dir[1] * t];
    // 尖角处限制一下，防止伸出去太远
    const orig = p[i];
    if (dist(q, orig) > d * 3) {
      const v = sub(q, orig), k = (d * 3) / dist(q, orig);
      q = [orig[0] + v[0] * k, orig[1] + v[1] * k];
    }
    out.push(q);
  }
  return out;
}

// 安全地往里缩：缩坏了就少缩一点
export function safeInset(poly, d) {
  const base = simplify(ensureCCW(poly), 0.06);
  for (const k of [1, 0.6, 0.3, 0]) {
    const r = k === 0 ? base : inset(base, d * k);
    if (signedArea(r) > area(base) * 0.25 && !selfIntersects(r)) return r;
  }
  return base;
}

export function roundedRect(w, d, r, segs = 5) {
  const pts = [];
  const corners = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, 90], [-w / 2 + r, -d / 2 + r, 180], [w / 2 - r, -d / 2 + r, 270]];
  for (const [cx, cz, start] of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = ((start + (90 * i) / segs) * Math.PI) / 180;
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return pts;
}

function bbox(poly) {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

// 计算每个点的 Voronoi 格子（限制在场地范围内），以及谁和谁相邻（共用一条边）
export function voronoi(sites, boundary) {
  const cells = sites.map((s, i) => {
    let poly = boundary;
    const cuts = [];
    for (let j = 0; j < sites.length && poly.length; j++) {
      if (j === i) continue;
      const o = sites[j];
      const nv = sub(o, s);
      const len = Math.hypot(nv[0], nv[1]) || 1e-9;
      const n = [nv[0] / len, nv[1] / len];
      const c = dot(n, [(s[0] + o[0]) / 2, (s[1] + o[1]) / 2]);
      poly = clipHalfPlane(poly, n, c);
      cuts.push({ j, n, c });
    }
    return { site: s, poly, cuts };
  });
  // 相邻判断：格子 i 有一条长度 > 3cm 的边落在 i 和 j 的中垂线上
  cells.forEach((cell) => {
    cell.neighbors = new Set();
    for (const { j, n, c } of cell.cuts) {
      const on = cell.poly.filter((p) => Math.abs(dot(n, p) - c) < 1e-6);
      if (on.length >= 2) {
        let maxD = 0;
        for (let a = 0; a < on.length; a++) for (let b = a + 1; b < on.length; b++) maxD = Math.max(maxD, dist(on[a], on[b]));
        if (maxD > 0.03) cell.neighbors.add(j);
      }
    }
    delete cell.cuts;
  });
  // 保证相邻关系是对称的
  cells.forEach((cell, i) => cell.neighbors.forEach((j) => cells[j].neighbors.add(i)));
  return cells;
}

// 在场地里撒点（点和点至少隔 size 米），再做几轮 Lloyd 松弛让格子大小均匀
export function makeCells(boundary, size, rand = Math.random) {
  const poly = ensureCCW(boundary);
  const b = bbox(poly);
  let sites = [];
  for (let k = 0; k < 6000; k++) {
    const p = [b.minX + rand() * (b.maxX - b.minX), b.minZ + rand() * (b.maxZ - b.minZ)];
    if (!pointInPolygon(p, poly)) continue;
    if (distToEdges(p, poly) < size * 0.3) continue;
    if (sites.every((s) => dist(s, p) >= size)) sites.push(p);
  }
  if (sites.length < 4) sites = [centroid(poly)];

  let cells = voronoi(sites, poly);
  for (let it = 0; it < 4; it++) {
    sites = cells.filter((c) => c.poly.length >= 3).map((c) => centroid(c.poly));
    cells = voronoi(sites, poly);
  }
  // 去掉太小的碎块（站不上去），重新分割
  const minArea = size * size * 0.3;
  for (let it = 0; it < 3; it++) {
    const keep = cells.filter((c) => c.poly.length >= 3 && area(c.poly) >= minArea);
    if (keep.length === cells.length) break;
    cells = voronoi(keep.map((c) => centroid(c.poly)), poly);
  }
  return cells.filter((c) => c.poly.length >= 3);
}
