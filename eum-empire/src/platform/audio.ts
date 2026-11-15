// 효과음: Web Audio로 직접 합성(외부 음원 파일 없음)
let ctx: AudioContext | null = null;

type Name = 'build' | 'sale' | 'month' | 'error' | 'click' | 'complete';
const PATTERNS: Record<Name, [number, number, number][]> = {
  // [주파수 Hz, 시작 초, 길이 초]
  click: [[880, 0, 0.05]],
  build: [[330, 0, 0.08], [440, 0.09, 0.1]],
  complete: [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.18]],
  sale: [[988, 0, 0.07], [1319, 0.08, 0.14]],
  month: [[392, 0, 0.12], [523, 0.13, 0.12], [659, 0.26, 0.2]],
  error: [[220, 0, 0.12], [180, 0.13, 0.16]],
};

export function playSound(name: Name, volume: number): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    for (const [f, t, d] of PATTERNS[name]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = name === 'error' ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, now + t);
      g.gain.linearRampToValueAtTime(0.15 * volume, now + t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + d);
      o.connect(g).connect(ctx.destination);
      o.start(now + t);
      o.stop(now + t + d + 0.02);
    }
  } catch {
    /* 오디오 불가 환경 */
  }
}
