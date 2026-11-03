// 音效：全部用代码实时合成，不需要任何音频文件（也就没有版权问题）。
let ctx = null;
let master = null;

// 浏览器要求音频必须在用户点击之后才能启动，所以在"进入 VR"按钮里调用它。
export function initAudio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (_) { /* 没有声音也能玩 */ }
}

function tone({ freq = 440, to = null, dur = 0.12, type = 'sine', vol = 0.2, delay = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise({ dur = 1, vol = 0.8, cutoff = 1200, delay = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, t0);
  filter.frequency.exponentialRampToValueAtTime(60, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
}

// 持续的蓄力音：音调随 level(0~1) 升高。返回 { set(level), stop() }
export function chargeTone() {
  if (!ctx) return { set() {}, stop() {} };
  const o = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o2.type = 'sine';
  o.frequency.value = 180;
  o2.frequency.value = 360;
  g.gain.value = 0.0001;
  g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.05);
  o.connect(g); o2.connect(g); g.connect(master);
  o.start(); o2.start();
  let stopped = false;
  return {
    set(level) {
      if (stopped) return;
      const f = 180 + level * 520;
      o.frequency.setTargetAtTime(f, ctx.currentTime, 0.03);
      o2.frequency.setTargetAtTime(f * 2.01, ctx.currentTime, 0.03);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03);
      o.stop(ctx.currentTime + 0.2);
      o2.stop(ctx.currentTime + 0.2);
    },
  };
}

// 青蛙叫：低沉的锯齿波 + 快速的音量抖动（“呱——呱”）
function croakOnce(delay = 0, pitch = 1) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(150 * pitch, t0);
  o.frequency.linearRampToValueAtTime(115 * pitch, t0 + 0.2);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700 * pitch;
  bp.Q.value = 3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  // 每秒 32 次的颤动，让声音“咕噜咕噜”
  const lfo = ctx.createOscillator();
  const lg = ctx.createGain();
  lfo.frequency.value = 32;
  lg.gain.value = 0.35;
  lfo.connect(lg).connect(g.gain);
  o.connect(bp).connect(g).connect(master);
  o.start(t0); lfo.start(t0);
  o.stop(t0 + 0.25); lfo.stop(t0 + 0.25);
}

export const sfx = {
  croak: (pitch = 1) => { croakOnce(0, pitch); croakOnce(0.27, pitch * 0.96); },
  jump: () => tone({ freq: 300, to: 700, dur: 0.18, type: 'square', vol: 0.07 }),
  land: () => { tone({ freq: 140, to: 90, dur: 0.12, vol: 0.35 }); tone({ freq: 500, dur: 0.06, type: 'triangle', vol: 0.08 }); },
  perfect: (n = 1) => [660, 880, 1320].slice(0, 1 + Math.min(2, n)).forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.16, delay: i * 0.07 })),
  bonus: () => [784, 988, 1175, 1568].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'sine', vol: 0.15, delay: i * 0.06 })),
  fall: () => tone({ freq: 700, to: 120, dur: 0.9, type: 'sine', vol: 0.18 }),
  thud: () => noise({ dur: 0.3, vol: 0.4, cutoff: 600 }),
  tick: () => tone({ freq: 880, dur: 0.05, type: 'square', vol: 0.05 }),
  reveal: (big) => {
    tone({ freq: 520, to: 780, dur: 0.12, type: 'triangle', vol: 0.2 });
    if (big) tone({ freq: 780, to: 1170, dur: 0.18, type: 'triangle', vol: 0.15, delay: 0.07 });
  },
  flag: () => tone({ freq: 300, to: 620, dur: 0.09, type: 'square', vol: 0.08 }),
  unflag: () => tone({ freq: 620, to: 300, dur: 0.09, type: 'square', vol: 0.08 }),
  click: () => tone({ freq: 1200, dur: 0.04, vol: 0.12 }),
  warn: () => tone({ freq: 200, dur: 0.12, type: 'sawtooth', vol: 0.05 }),
  boom: () => {
    noise({ dur: 1.3, vol: 0.9, cutoff: 1500 });
    tone({ freq: 120, to: 35, dur: 0.9, vol: 0.6 });
  },
  win: () =>
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone({ freq: f, dur: 0.28, type: 'triangle', vol: 0.18, delay: i * 0.1 })
    ),
};
