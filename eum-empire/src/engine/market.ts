// 외부 시장 참여자(도매 공급자·매입처). 무한 재고가 아니라 보유 재고와 하루 공급(소비)능력을 가집니다.
import { BALANCE } from './data/balance';
import { roundWon } from './money';
import { PRODUCTS } from './data/products';
import type { ExternalParty, GameState, ProductId } from './types';

type ExtSeed = Omit<ExternalParty, 'id' | 'stock'> & { stockRatio: number };

export const EXTERNAL_SEEDS: ExtSeed[] = [
  { name: '한빛 곡물상사', role: 'seller', product: 'wheat', x: -5, y: 14, basePrice: 900, quality: 45, ratePerDay: 1500, maxStock: 20000, stockRatio: 0.7 },
  { name: '대륙 제분 도매', role: 'seller', product: 'flour', x: 20, y: -5, basePrice: 3500, quality: 50, ratePerDay: 600, maxStock: 8000, stockRatio: 0.7 },
  { name: '새벽 베이커리 도매', role: 'seller', product: 'bread', x: 53, y: 18, basePrice: 1750, quality: 42, ratePerDay: 2200, maxStock: 15000, stockRatio: 0.7 },
  { name: '라움 제과 유통', role: 'seller', product: 'bread', x: 30, y: -5, basePrice: 2250, quality: 70, ratePerDay: 550, maxStock: 4000, stockRatio: 0.7 },
  { name: '남해 면화 수입', role: 'seller', product: 'cotton', x: 14, y: 53, basePrice: 1500, quality: 50, ratePerDay: 1200, maxStock: 15000, stockRatio: 0.7 },
  { name: '동방 섬유', role: 'seller', product: 'fabric', x: 53, y: 34, basePrice: 7000, quality: 50, ratePerDay: 300, maxStock: 4000, stockRatio: 0.7 },
  { name: '모던 의류 도매', role: 'seller', product: 'clothing', x: 53, y: 26, basePrice: 20000, quality: 45, ratePerDay: 260, maxStock: 3000, stockRatio: 0.7 },
  { name: '아틀리에 패션 유통', role: 'seller', product: 'clothing', x: 38, y: -5, basePrice: 27000, quality: 75, ratePerDay: 95, maxStock: 1200, stockRatio: 0.7 },
  { name: '광역 제과유통(매입)', role: 'buyer', product: 'bread', x: 53, y: 42, basePrice: 1500, quality: 0, ratePerDay: 900, maxStock: 9000, stockRatio: 0.3 },
  { name: '아울렛 의류유통(매입)', role: 'buyer', product: 'clothing', x: -5, y: 22, basePrice: 16000, quality: 0, ratePerDay: 90, maxStock: 1200, stockRatio: 0.3 },
  { name: '서부 제분 조합(매입)', role: 'buyer', product: 'wheat', x: -5, y: 30, basePrice: 800, quality: 0, ratePerDay: 900, maxStock: 9000, stockRatio: 0.3 },
  { name: '광역 식품가공(매입)', role: 'buyer', product: 'flour', x: 26, y: 53, basePrice: 3100, quality: 0, ratePerDay: 450, maxStock: 5000, stockRatio: 0.3 },
  { name: '수출 섬유상사(매입)', role: 'buyer', product: 'cotton', x: -5, y: 40, basePrice: 1300, quality: 0, ratePerDay: 700, maxStock: 8000, stockRatio: 0.3 },
  { name: '광역 의류제조(매입)', role: 'buyer', product: 'fabric', x: 40, y: 53, basePrice: 6200, quality: 0, ratePerDay: 250, maxStock: 3000, stockRatio: 0.3 },
];

export function createExternals(state: GameState): ExternalParty[] {
  return EXTERNAL_SEEDS.map((s) => {
    const { stockRatio, ...rest } = s;
    return { ...rest, id: state.nextId++, stock: Math.round(s.maxStock * stockRatio) };
  });
}

/** 외부 공급자 현재 판매 단가: 재고가 줄수록 오릅니다. */
export function sellerPrice(e: ExternalParty): number {
  const ratio = e.maxStock > 0 ? e.stock / e.maxStock : 0;
  return roundWon(e.basePrice * (1 + BALANCE.market.sellerScarcity * (1 - ratio)));
}

/** 외부 매입처 현재 매입 단가: 재고가 쌓일수록 내려갑니다. */
export function buyerPrice(e: ExternalParty): number {
  const ratio = e.maxStock > 0 ? e.stock / e.maxStock : 1;
  return roundWon(e.basePrice * (1 - BALANCE.market.buyerGlut * ratio));
}

/** 대량 매입 할인율: 1회 출하량이 트럭 2대분 이상 5%, 5대분 이상 9% */
export function bulkDiscount(product: ProductId, qty: number): number {
  const truck = PRODUCTS[product].truckCapacity;
  if (qty >= truck * 5) return BALANCE.market.bulkDiscountLarge;
  if (qty >= truck * 2) return BALANCE.market.bulkDiscountSmall;
  return 0;
}

export function sellerUnitPrice(e: ExternalParty, qty: number): number {
  return roundWon(sellerPrice(e) * (1 - bulkDiscount(e.product, qty)));
}

export function externalPrice(e: ExternalParty): number {
  return e.role === 'seller' ? sellerPrice(e) : buyerPrice(e);
}

/** 하루 처리 2단계: 외부 공급자 재고 보충, 매입처 재고 소비 */
export function updateExternals(state: GameState): void {
  for (const e of state.externals) {
    if (e.role === 'seller') e.stock = Math.min(e.maxStock, e.stock + e.ratePerDay);
    else e.stock = Math.max(0, e.stock - e.ratePerDay);
  }
}
