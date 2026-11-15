// 시드 기반 난수(mulberry32). 상태는 GameState.rng 정수 하나로 저장되어 저장·불러오기 후에도 같은 수열이 이어집니다.
import type { GameState } from './types';

export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(state: GameState | { rng: number }, min: number, max: number): number {
  return min + Math.floor(nextRandom(state) * (max - min + 1));
}

/** 렌더링·장식 전용 독립 난수(경제 상태와 무관) */
export function makeLocalRng(seed: number): () => number {
  const s = { rng: seed >>> 0 };
  return () => nextRandom(s);
}
