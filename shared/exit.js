// 所有游戏共用的“退出”按钮：结束 VR，回到网页大厅。
import { makeButton } from './ui3d.js';

export async function exitToLobby(app) {
  try { await app.renderer.xr.getSession()?.end(); } catch (_) { /* 已经结束了 */ }
  location.href = new URL('../../', location.href).href;
}

export function makeExitButton(app, { width = 0.26, height = 0.1 } = {}) {
  return makeButton('✕ 退出', { width, height, color: '#b8323a', onClick: () => exitToLobby(app) });
}
