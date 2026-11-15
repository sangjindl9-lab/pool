// 문제 진단: 판매 부진·생산 차질의 원인을 실제 시뮬레이션 기록에서 찾아 설명합니다.
import { BUILDINGS } from './data/buildings';
import { PRODUCTS, type ProductId } from './data/products';
import { catchmentAt } from './demand';
import { unitCost } from './inventory';
import { buildingCenter } from './map';
import type { Building, GameState, NavTarget } from './types';

export interface Issue {
  severity: 'high' | 'mid' | 'low';
  code: string;
  text: string;
  nav?: NavTarget;
}

function sum(b: Building, key: 'demand' | 'sold' | 'lost', p: ProductId, days: number): number {
  return b.hist.slice(-days).reduce((s, d) => s + (d[key][p] ?? 0), 0);
}

export function rivalStats(state: GameState, b: Building, p: ProductId, radius = 16) {
  const c = buildingCenter(b);
  let wSum = 0, priceSum = 0, qSum = 0, n = 0;
  for (const o of state.buildings) {
    if (o.type !== 'store' || o.owner === b.owner || o.status !== 'active' || !o.listings[p]?.enabled) continue;
    const oc = buildingCenter(o);
    const d = Math.abs(oc.x - c.x) + Math.abs(oc.y - c.y);
    if (d > radius) continue;
    const w = Math.exp(-d / 8);
    wSum += w;
    priceSum += w * o.listings[p]!.price;
    qSum += w * (o.inv[p]?.quality || 40);
    n++;
  }
  return n ? { count: n, avgPrice: priceSum / wSum, avgQuality: qSum / wSum } : null;
}

export function averageStoreCatchment(state: GameState, p: ProductId): number {
  const stores = state.buildings.filter((b) => b.type === 'store');
  if (!stores.length) return 0;
  return stores.reduce((s, b) => s + catchmentAt(state, p, b.x + 1, b.y + 1), 0) / stores.length;
}

export function diagnoseStoreProduct(state: GameState, b: Building, p: ProductId): Issue[] {
  const out: Issue[] = [];
  const name = PRODUCTS[p].name;
  const l = b.listings[p];
  const toPrice: NavTarget = { panel: 'building', buildingId: b.id, product: p };
  const toSupply: NavTarget = { panel: 'supply', buildingId: b.id, product: p };
  if (!l || !l.enabled) return [{ severity: 'low', code: 'notListed', text: `${name}을(를) 판매하지 않도록 설정되어 있습니다`, nav: toPrice }];
  if (b.status !== 'active') return [{ severity: 'low', code: 'construction', text: '건설 중입니다' }];
  const contracts = state.contracts.filter((k) => k.active && k.buyer.kind === 'building' && k.buyer.id === b.id && k.product === p);
  const stock = b.inv[p]?.qty ?? 0;
  const inbound = state.shipments.filter((s) => s.to.kind === 'building' && s.to.id === b.id && s.product === p).reduce((s, x) => s + x.qty, 0);
  if (!contracts.length && stock === 0 && inbound === 0) {
    out.push({ severity: 'high', code: 'noSupply', text: `${name} 공급 계약이 없어 팔 물건이 없습니다`, nav: toSupply });
  }
  const dem = sum(b, 'demand', p, 7), lost = sum(b, 'lost', p, 7), sold = sum(b, 'sold', p, 7);
  if (dem > 0 && lost / dem > 0.1) {
    out.push({ severity: lost / dem > 0.3 ? 'high' : 'mid', code: 'stockout', text: `품절로 최근 7일 ${lost.toLocaleString()}${PRODUCTS[p].unit}의 판매 기회를 놓쳤습니다(수요의 ${Math.round((lost / dem) * 100)}%). 계약 수량을 늘리거나 주기를 줄이세요`, nav: toSupply });
  }
  if (contracts.some((k) => state.day - k.lastShortageDay <= 7)) {
    out.push({ severity: 'mid', code: 'supplierShort', text: '원재료(상품) 부족: 공급자 재고가 계약량보다 적어 일부만 출하되고 있습니다. 다른 공급자를 추가하세요', nav: toSupply });
  }
  const r = rivalStats(state, b, p);
  if (r && l.price > r.avgPrice * 1.08) {
    out.push({ severity: l.price > r.avgPrice * 1.25 ? 'high' : 'mid', code: 'priceHigh', text: `경쟁사보다 높은 가격: 주변 경쟁 매장 평균 ${Math.round(r.avgPrice).toLocaleString()}원보다 ${Math.round((l.price / r.avgPrice - 1) * 100)}% 비쌉니다`, nav: toPrice });
  }
  if (r && (b.inv[p]?.quality ?? 40) < r.avgQuality - 10) {
    out.push({ severity: 'mid', code: 'qualityLow', text: `품질 열세: 내 상품 품질 ${Math.round(b.inv[p]?.quality ?? 40)} vs 경쟁 ${Math.round(r.avgQuality)}. 고품질 공급자나 연구개발을 검토하세요`, nav: toSupply });
  }
  const uc = unitCost(b, p);
  if (uc > 0 && l.price < uc) {
    out.push({ severity: 'high', code: 'belowCost', text: `판매가(${l.price.toLocaleString()}원)가 단위 원가(${Math.round(uc).toLocaleString()}원)보다 낮아 팔수록 손해입니다`, nav: toPrice });
  }
  const avgC = averageStoreCatchment(state, p);
  const myC = catchmentAt(state, p, b.x + 1, b.y + 1);
  if (avgC > 0 && myC < avgC * 0.6) {
    out.push({ severity: 'mid', code: 'lowTraffic', text: `낮은 상권 수요: 이 입지의 잠재 고객은 도시 매장 평균의 ${Math.round((myC / avgC) * 100)}%입니다`, nav: { panel: 'market', product: p } });
  }
  const pl = b.plLast ?? b.plMonth;
  const rev = -(pl.revenue ?? 0);
  if (rev > 0 && (pl.transport ?? 0) / rev > 0.12) {
    out.push({ severity: 'mid', code: 'freightHigh', text: `과도한 운송비: 운송비가 매출의 ${Math.round(((pl.transport ?? 0) / rev) * 100)}%입니다. 가까운 공급자·물류센터·대량 주문(트럭 적재율)을 검토하세요`, nav: toSupply });
  }
  if (rev > 0 && (pl.rent ?? 0) / rev > 0.25) {
    out.push({ severity: 'low', code: 'rentHigh', text: `임대료 부담: 임대료가 매출의 ${Math.round(((pl.rent ?? 0) / rev) * 100)}%입니다`, nav: { panel: 'building', buildingId: b.id } });
  }
  const avg = sold / 7;
  if (avg > 0 && stock / avg > 12) {
    out.push({ severity: 'low', code: 'overstock', text: `재고 과다: 현재 재고는 약 ${Math.round(stock / avg)}일 판매분입니다. 주문량을 줄이거나 가격을 낮추세요`, nav: toSupply });
  }
  if (dem > 0 && sold === 0 && stock > 0) {
    out.push({ severity: 'high', code: 'noSales', text: '재고가 있는데도 팔리지 않습니다. 가격·품질을 경쟁사와 비교하세요', nav: toPrice });
  }
  return out;
}

export function diagnoseBuilding(state: GameState, b: Building): Issue[] {
  const def = BUILDINGS[b.type];
  if (b.type === 'store') {
    return Object.keys(b.listings).flatMap((p) => diagnoseStoreProduct(state, b, p as ProductId));
  }
  const out: Issue[] = [];
  if (b.status !== 'active') return out;
  if (def.recipe) {
    const recent = b.hist.slice(-7);
    const inputDays = recent.filter((h) => h.limit === 'input').length;
    const spaceDays = recent.filter((h) => h.limit === 'space').length;
    if (inputDays >= 2) {
      out.push({ severity: 'high', code: 'inputShort', text: `원재료 부족: 최근 7일 중 ${inputDays}일 원재료가 모자라 생산이 줄었습니다`, nav: { panel: 'supply', buildingId: b.id } });
    }
    if (spaceDays >= 2) {
      out.push({ severity: 'high', code: 'full', text: '보관 공간 부족: 완제품이 쌓여 생산이 멈췄습니다. 출하 계약을 추가하거나 가동률을 낮추세요', nav: { panel: 'supply', buildingId: b.id } });
    }
    const hasOut = state.contracts.some((k) => k.seller.kind === 'building' && k.seller.id === b.id);
    if (!hasOut) out.push({ severity: 'mid', code: 'noOutlet', text: '출하 계약이 없습니다. 생산품을 보낼 곳(자사 공장·매장·외부 매입처)을 지정하세요', nav: { panel: 'supply', buildingId: b.id } });
  }
  return out;
}
