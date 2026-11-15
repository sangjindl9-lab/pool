// 재고: 수량 + 총원가(이동평균) + 평균 품질. 원가 차감은 비례 계산 후 반올림하며, 전량 출고 시 잔여 원가를 모두 가져가 원가가 보존됩니다.
import { BUILDINGS } from './data/buildings';
import type { Building, ProductId } from './types';
import { roundWon } from './money';

export function invQty(b: Building, p: ProductId): number {
  return b.inv[p]?.qty ?? 0;
}

export function totalStored(b: Building): number {
  let s = 0;
  for (const k in b.inv) s += b.inv[k as ProductId]!.qty;
  return s;
}

export function freeSpace(b: Building): number {
  return Math.max(0, BUILDINGS[b.type].storage - totalStored(b));
}

export function addStock(b: Building, p: ProductId, qty: number, cost: number, quality: number): void {
  if (qty <= 0) return;
  if (!Number.isInteger(qty) || !Number.isInteger(cost)) throw new Error('재고 입고 값은 정수여야 합니다');
  const lot = b.inv[p] ?? { qty: 0, cost: 0, quality: 0 };
  const newQty = lot.qty + qty;
  lot.quality = (lot.quality * lot.qty + quality * qty) / newQty;
  lot.qty = newQty;
  lot.cost += cost;
  b.inv[p] = lot;
}

/** qty만큼 출고하고 출고분 원가와 품질을 반환합니다. 보유량보다 많이 요청하면 예외. */
export function removeStock(b: Building, p: ProductId, qty: number): { cost: number; quality: number } {
  const lot = b.inv[p];
  if (qty <= 0) return { cost: 0, quality: lot?.quality ?? 0 };
  if (!lot || lot.qty < qty) throw new Error(`재고 부족 출고 시도: ${b.name} ${p} ${qty}`);
  const cost = qty === lot.qty ? lot.cost : roundWon((lot.cost * qty) / lot.qty);
  lot.qty -= qty;
  lot.cost -= cost;
  const quality = lot.quality;
  if (lot.qty === 0) {
    lot.cost = 0;
  }
  return { cost, quality };
}

export function unitCost(b: Building, p: ProductId): number {
  const lot = b.inv[p];
  return lot && lot.qty > 0 ? lot.cost / lot.qty : 0;
}
