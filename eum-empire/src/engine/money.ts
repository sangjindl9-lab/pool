// 화폐·수량 규칙
// - 금액은 원 단위 정수. 곱셈·비율 계산 결과는 roundWon(반올림, .5는 0에서 먼 쪽)으로 정수화.
// - 수량은 정수 단위. 생산·출하·판매 가능 수량은 항상 내림(floor)으로 계산.
export function roundWon(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`금액 계산 오류: ${x}`);
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

export function floorQty(x: number): number {
  return Math.max(0, Math.floor(x + 1e-9));
}

export function formatWon(x: number): string {
  const sign = x < 0 ? '-' : '';
  const a = Math.abs(x);
  if (a >= 100_000_000) {
    const eok = a / 100_000_000;
    return `${sign}${eok >= 100 ? eok.toFixed(0) : eok.toFixed(2)}억원`;
  }
  if (a >= 10_000) return `${sign}${Math.round(a / 10_000).toLocaleString('ko-KR')}만원`;
  return `${sign}${a.toLocaleString('ko-KR')}원`;
}

export function formatWonExact(x: number): string {
  return `${x.toLocaleString('ko-KR')}원`;
}
