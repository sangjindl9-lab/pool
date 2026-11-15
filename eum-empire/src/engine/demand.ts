// 수요와 판매.
// 1) 지역(동)별 상품 총수요 = 인구 × 1인당 수요 × 소득지수^소득탄력성 → 소수점 이월 누적으로 정수화
// 2) 매장 매력도 = 접근성 × 가격요인 × 품질요인 × 브랜드요인 × 서비스요인. 외부 선택지(시외 구매·구매 포기) 매력도와 함께 로짓 배분
// 3) 정수 배분(최대 잔여법). 매장 판매량 = min(배분 수요, 재고)
// 4) 품절로 못 판 수요의 일부(spillFraction)는 재고가 남은 다른 매장으로 이동(거리 감쇠), 나머지는 소멸
// 보장: 판매량 ≤ 재고, 총판매량 ≤ 지역 총수요 합. 자기 가격만 올리면 자기 매력도만 감소하므로 판매량이 늘지 않음.
import { BALANCE } from './data/balance';
import { CONSUMER_PRODUCTS, PRODUCTS, type ProductId } from './data/products';
import { removeStock } from './inventory';
import { postEntry } from './ledger';
import { buildingCenter } from './map';
import { getCompany, todayStat } from './state';
import type { Building, District, GameState, MarketDay } from './types';

const D = BALANCE.demand;

export function districtDemand(d: District, p: ProductId): number {
  const def = PRODUCTS[p];
  return d.population * def.perCapitaDaily * Math.pow(d.income, def.incomeElasticity);
}

export interface StoreOffer {
  b: Building;
  price: number;
  quality: number;
  brand: number;
  service: number;
  stock: number;
  x: number;
  y: number;
}

export function priceFactor(p: ProductId, price: number, sensitivity: number): number {
  const def = PRODUCTS[p];
  return Math.pow(def.refPrice / Math.max(1, price), def.priceElasticity * sensitivity);
}

export function qualityFactor(p: ProductId, quality: number, pref: number): number {
  return Math.exp((PRODUCTS[p].qualityWeight * pref * (quality - D.qualityPivot)) / 50);
}

export function attraction(o: StoreOffer, d: District, p: ProductId): number {
  const dist = Math.abs(o.x - d.cx) + Math.abs(o.y - d.cy);
  return Math.exp(-dist / D.distanceDecay)
    * priceFactor(p, o.price, d.priceSensitivity)
    * qualityFactor(p, o.quality, d.qualityPref)
    * (1 + (D.brandMaxBonus * d.brandPref * o.brand) / 100)
    * o.service;
}

/** 최대 잔여법 정수 배분. 가중치 합이 0이면 모두 0. */
export function apportion(total: number, weights: number[]): number[] {
  const out = new Array(weights.length).fill(0);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return out;
  const fr: { i: number; f: number }[] = [];
  let used = 0;
  for (let i = 0; i < weights.length; i++) {
    const x = (total * weights[i]) / sum;
    out[i] = Math.floor(x);
    used += out[i];
    fr.push({ i, f: x - out[i] });
  }
  fr.sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; k < total - used; k++) out[fr[k % fr.length].i]++;
  return out;
}

export function collectOffers(state: GameState, p: ProductId): StoreOffer[] {
  const offers: StoreOffer[] = [];
  for (const b of state.buildings) {
    if (b.type !== 'store' || b.status !== 'active') continue;
    const l = b.listings[p];
    if (!l || !l.enabled) continue;
    const c = getCompany(state, b.owner);
    if (c.bankrupt) continue;
    const lot = b.inv[p];
    const pos = buildingCenter(b);
    offers.push({
      b,
      price: l.price,
      quality: lot && lot.quality > 0 ? lot.quality : 40,
      brand: c.brand[p] ?? 0,
      service: D.serviceFactor[b.staffLevel - 1],
      stock: lot?.qty ?? 0,
      x: pos.x,
      y: pos.y,
    });
  }
  return offers;
}

/** 하루 처리 6단계: 소매 판매 */
export function processSales(state: GameState): void {
  for (const p of CONSUMER_PRODUCTS) {
    const def = PRODUCTS[p];
    const offers = collectOffers(state, p);
    const n = offers.length;
    const demand = new Array(n).fill(0);
    let potential = 0;
    for (const d of state.districts) {
      const key = `${d.id}:${p}`;
      const raw = districtDemand(d, p) + (state.demandCarry[key] ?? 0);
      const units = Math.floor(raw);
      state.demandCarry[key] = raw - units;
      potential += units;
      if (n === 0 || units === 0) continue;
      const w = offers.map((o) => attraction(o, d, p));
      w.push(def.outsideAttraction);
      const alloc = apportion(units, w);
      for (let i = 0; i < n; i++) demand[i] += alloc[i];
    }
    const sold = offers.map((o, i) => Math.min(o.stock, demand[i]));
    const received = new Array(n).fill(0);
    // 품절 수요 이동
    for (let i = 0; i < n; i++) {
      const unmet = demand[i] - sold[i];
      if (unmet <= 0) continue;
      const spill = Math.floor(unmet * D.spillFraction);
      if (spill <= 0) continue;
      const home = offers[i];
      const district = state.districts[state.map.district[Math.floor(home.y) * state.map.size + Math.floor(home.x)]] ?? state.districts[0];
      const w = offers.map((o, j) => {
        if (j === i || o.stock - sold[j] <= 0) return 0;
        const dist = Math.abs(o.x - home.x) + Math.abs(o.y - home.y);
        return Math.exp(-dist / D.spillDecay) * priceFactor(p, o.price, district.priceSensitivity) * qualityFactor(p, o.quality, district.qualityPref) * o.service;
      });
      w.push(def.outsideAttraction);
      const alloc = apportion(spill, w);
      for (let j = 0; j < n; j++) {
        if (alloc[j] <= 0) continue;
        const take = Math.min(alloc[j], offers[j].stock - sold[j]);
        sold[j] += take;
        received[j] += alloc[j];
      }
    }
    // 판매 기록 및 회계 처리
    const md: MarketDay = { day: state.day, potential, sold: 0, lost: 0, byCompany: {}, revenueByCompany: {} };
    for (let i = 0; i < n; i++) {
      const o = offers[i];
      const stat = todayStat(state, o.b);
      const want = demand[i] + received[i];
      stat.demand[p] = want;
      stat.sold[p] = sold[i];
      stat.lost[p] = want - sold[i];
      if (sold[i] <= 0) continue;
      const revenue = sold[i] * o.price;
      const { cost } = removeStock(o.b, p, sold[i]);
      const company = getCompany(state, o.b.owner);
      postEntry(state, company, `${o.b.name} ${def.name} ${sold[i]}개 판매`, [
        { account: 'cash', amount: revenue }, { account: 'revenue', amount: -revenue },
        { account: 'cogs', amount: cost }, { account: 'inventory', amount: -cost },
      ], { cf: 'operating', buildingId: o.b.id });
      stat.revenue += revenue;
      md.sold += sold[i];
      md.byCompany[company.id] = (md.byCompany[company.id] ?? 0) + sold[i];
      md.revenueByCompany[company.id] = (md.revenueByCompany[company.id] ?? 0) + revenue;
    }
    md.lost = demand.reduce((a, b) => a + b, 0) - md.sold;
    const arr = state.market[p] ?? (state.market[p] = []);
    arr.push(md);
    if (arr.length > 60) arr.shift();
  }
}

/** 지도 오버레이·시장조사용: 특정 칸에 가상의 기준 매장이 있을 때 하루 기대 고객 수 */
export function catchmentAt(state: GameState, p: ProductId, x: number, y: number): number {
  let s = 0;
  for (const d of state.districts) {
    const dist = Math.abs(x - d.cx) + Math.abs(y - d.cy);
    s += districtDemand(d, p) * Math.exp(-dist / D.distanceDecay);
  }
  return s;
}

export function marketShare(state: GameState, p: ProductId, days = 30): { potential: number; sold: number; byCompany: Record<string, number> } {
  const arr = (state.market[p] ?? []).slice(-days);
  const byCompany: Record<string, number> = {};
  let potential = 0, sold = 0;
  for (const m of arr) {
    potential += m.potential;
    sold += m.sold;
    for (const [k, v] of Object.entries(m.byCompany)) byCompany[k] = (byCompany[k] ?? 0) + v;
  }
  return { potential, sold, byCompany };
}
