// 경제 엔진 성능 측정(렌더링 제외). 기준: 4개 회사 + 플레이어 매장 N개, 1년(360일) 처리.
import { expect, it } from 'vitest';
import { applyCommand } from '../src/engine/commands';
import { checkPlacement } from '../src/engine/map';
import { advanceDay, newGame } from '../src/engine/sim';
import { seller } from './helpers';

it('경제 엔진 1년 처리 시간 측정', () => {
  const s = newGame({ seed: 99, mode: 'free', difficulty: 'normal', companyName: '성능', capital: 2_000_000_000 });
  // 플레이어 매장 12개 + 각 매장 빵·의류 일일 계약
  let stores = 0;
  for (let y = 0; y < 48 && stores < 12; y += 1) for (let x = 0; x < 48 && stores < 12; x += 1) {
    if (!checkPlacement(s, 'store', x, y, 'lease').ok) continue;
    const r = applyCommand(s, 'player', { type: 'build', building: 'store', x, y, tenure: 'lease' });
    if (!r.ok) continue;
    stores++;
    applyCommand(s, 'player', { type: 'createContract', seller: { kind: 'external', id: seller(s, 'bread').id }, buyer: { kind: 'building', id: r.id! }, product: 'bread', qty: 200, intervalDays: 1, payment: 'ship', shortage: 'partial' });
    applyCommand(s, 'player', { type: 'createContract', seller: { kind: 'external', id: seller(s, 'clothing').id }, buyer: { kind: 'building', id: r.id! }, product: 'clothing', qty: 20, intervalDays: 1, payment: 'ship', shortage: 'partial' });
  }
  const t0 = performance.now();
  let worst = 0;
  for (let d = 0; d < 360; d++) {
    const a = performance.now();
    advanceDay(s);
    worst = Math.max(worst, performance.now() - a);
  }
  const ms = performance.now() - t0;
  console.log(`[성능] 건물 ${s.buildings.length}개, 계약 ${s.contracts.length}건, 1년 ${ms.toFixed(0)}ms, 평균 ${(ms / 360).toFixed(2)}ms/일, 최악 ${worst.toFixed(1)}ms/일`);
  expect(stores).toBe(12);
  // 4배속(초당 약 3.3일)에서도 프레임 예산(16ms)에 여유가 있어야 함
  expect(ms / 360).toBeLessThan(16);
});
