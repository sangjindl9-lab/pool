// 게임 시계: 실제 경과 시간(ms)을 게임 일수로 변환. 경제 계산은 하루 단위로만 진행되며 배속은 "하루를 얼마나 빨리 처리하는가"만 바꿉니다.
export type Speed = 0 | 1 | 2 | 4;

/** 1배속에서 하루가 걸리는 실제 시간(ms) */
export const MS_PER_DAY_1X = 1200;
/** 한 프레임에서 최대 처리 일수(느린 PC에서 렌더링이 멈추지 않도록) */
export const MAX_DAYS_PER_FRAME = 4;

export interface ClockState {
  speed: Speed;
  /** 0~1: 현재 날짜 안에서 진행된 비율(배송 트럭 위치 보간용, 경제 계산에는 쓰지 않음) */
  fraction: number;
}

/** dtMs만큼 시간이 흐를 때 처리할 일수를 돌려주고 fraction을 갱신 */
export function tickClock(clock: ClockState, dtMs: number): number {
  if (clock.speed === 0) return 0;
  const dt = Math.min(dtMs, 250); // 탭 전환 등 큰 공백은 잘라냄
  clock.fraction += (dt * clock.speed) / MS_PER_DAY_1X;
  let days = Math.floor(clock.fraction);
  if (days > MAX_DAYS_PER_FRAME) {
    days = MAX_DAYS_PER_FRAME;
    clock.fraction = MAX_DAYS_PER_FRAME;
  }
  clock.fraction -= days;
  return days;
}
