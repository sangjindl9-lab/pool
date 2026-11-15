export { formatWon, formatWonExact } from '../engine/money';
export { formatDate, formatMonth } from '../engine/calendar';

export function num(x: number, digits = 0): string {
  return x.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}
export function signClass(x: number): string {
  return x > 0 ? 'pos' : x < 0 ? 'neg' : '';
}
