// 在 3D 空间里显示文字面板和按钮（用 canvas 画好，再贴到一块平面上）。
import * as THREE from 'three';

export const FONT =
  '"PingFang SC","Noto Sans SC","Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif';

export function makeCanvasPlane(widthM, heightM, pxPerM = 1000) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthM * pxPerM);
  canvas.height = Math.round(heightM * pxPerM);
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, heightM),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  function redraw(fn) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fn(ctx, canvas.width, canvas.height);
    tex.needsUpdate = true;
  }
  return { mesh, canvas, ctx, tex, redraw };
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 可以被手柄射线"点"的按钮。mesh.userData.ui 里有 onClick / setHover / setActive。
export function makeButton(label, { width = 0.3, height = 0.1, color = '#3a5bd9', onClick } = {}) {
  const p = makeCanvasPlane(width, height, 1200);
  let hover = false;
  let active = false;
  function draw() {
    p.redraw((ctx, w, h) => {
      roundRect(ctx, 6, 6, w - 12, h - 12, h * 0.28);
      ctx.fillStyle = active ? '#f5b941' : color;
      ctx.fill();
      if (hover) {
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      ctx.fillStyle = active ? '#1b1b1b' : '#ffffff';
      ctx.font = `700 ${Math.round(h * 0.42)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, w / 2, h / 2 + 2);
    });
  }
  p.mesh.userData.ui = {
    onClick,
    setHover(v) { if (v !== hover) { hover = v; draw(); } },
    setActive(v) { if (v !== active) { active = v; draw(); } },
    setLabel(l) { label = l; draw(); },
  };
  draw();
  return p.mesh;
}
