// 경쟁사 AI. 모든 행동은 applyCommand(플레이어와 동일한 검증)로만 수행합니다. 무한 자금·무료 재고 없음.
import { BALANCE } from './data/balance';
import { BUILDINGS, type BuildingType } from './data/buildings';
import { CONSUMER_PRODUCTS, PRODUCTS, type ProductId } from './data/products';
import { applyCommand } from './commands';
import { contractQuote } from './contracts';
import { catchmentAt } from './demand';
import { creditLimit, dailyFixedCosts } from './finance';
import { incomeOf } from './ledger';
import { buildingCenter, checkPlacement } from './map';
import { sellerPrice } from './market';
import { addNews } from './state';
import { nextRandom } from './rng';
import { unitCost } from './inventory';
import type { Building, Company, Contract, GameState, PartyRef, Strategy } from './types';

interface StrategyProfile {
  label: string;
  markup: number;
  staff: 1 | 2 | 3;
  maxStores: number;
  marketingRate: number;
  products: ProductId[];
  prefersQuality: boolean;
  plan: BuildingType[];
  tenure: 'own' | 'lease';
}

export const STRATEGIES: Record<Strategy, StrategyProfile> = {
  lowcost: {
    label: '저가·대량 판매형', markup: 1.3, staff: 1, maxStores: 7, marketingRate: 0.01,
    products: ['bread', 'clothing'], prefersQuality: false, tenure: 'lease',
    plan: ['store', 'store', 'store', 'warehouse', 'store', 'store', 'store', 'store'],
  },
  premium: {
    label: '고품질·고마진형', markup: 1.65, staff: 3, maxStores: 5, marketingRate: 0.035,
    products: ['bread', 'clothing'], prefersQuality: true, tenure: 'lease',
    plan: ['store', 'store', 'store', 'store', 'store'],
  },
  vertical: {
    label: '수직계열화형', markup: 1.42, staff: 2, maxStores: 6, marketingRate: 0.02,
    products: ['bread', 'clothing'], prefersQuality: false, tenure: 'own',
    plan: ['store', 'store', 'store', 'bakery', 'store', 'store', 'mill', 'wheatFarm', 'sewing', 'store', 'spinning', 'cottonFarm'],
  },
};

function myBuildings(state: GameState, c: Company, type?: BuildingType): Building[] {
  return state.buildings.filter((b) => b.owner === c.id && (!type || b.type === type));
}

function dailyBurn(state: GameState, c: Company): number {
  let s = 0;
  for (const b of myBuildings(state, c)) {
    const f = dailyFixedCosts(b);
    s += f.wages + f.rent + f.maintenance + f.utilities;
    const def = BUILDINGS[b.type];
    if (def.recipe) s += def.workers * BALANCE.wages.factoryPerDay + def.powerPerDay * 0.5;
  }
  for (const p of CONSUMER_PRODUCTS) s += (c.marketing[p] ?? 0) / 30;
  return s;
}

function reserveCash(state: GameState, c: Company): number {
  return Math.max(60_000_000, dailyBurn(state, c) * 40);
}

function avgSold(b: Building, p: ProductId, days = 7): number {
  const h = b.hist.slice(-days);
  if (!h.length) return 0;
  return h.reduce((s, d) => s + (d.sold[p] ?? 0), 0) / h.length;
}
function sumOf(b: Building, key: 'demand' | 'lost' | 'sold', p: ProductId, days = 7): number {
  return b.hist.slice(-days).reduce((s, d) => s + (d[key][p] ?? 0), 0);
}

/** 매장 후보지 점수: 상권 수요 × 경쟁 밀도 보정 - 임대료 */
function storeSpotScore(state: GameState, c: Company, prof: StrategyProfile, x: number, y: number, leasePerDay: number): number {
  const cx = x + 1, cy = y + 1;
  let revenue = 0;
  for (const p of prof.products) revenue += catchmentAt(state, p, cx, cy) * PRODUCTS[p].refPrice * 0.25;
  let comp = 0;
  for (const b of state.buildings) {
    if (b.type !== 'store') continue;
    const bc = buildingCenter(b);
    const d = Math.abs(bc.x - cx) + Math.abs(bc.y - cy);
    comp += Math.exp(-d / 6) * (b.owner === c.id ? 1.6 : 1);
  }
  let incomeBias = 1;
  if (prof.prefersQuality) {
    const di = state.map.district[Math.floor(cy) * state.map.size + Math.floor(cx)];
    incomeBias = Math.pow(state.districts[di].income, 2);
  }
  return revenue * incomeBias / (1 + 0.9 * comp) - leasePerDay * (prof.tenure === 'lease' ? 1.6 : 0.6);
}

function findSpot(state: GameState, c: Company, prof: StrategyProfile, type: BuildingType): { x: number; y: number; cost: number } | null {
  const def = BUILDINGS[type];
  const N = state.map.size;
  let best: { x: number; y: number; cost: number; score: number } | null = null;
  const tenure = type === 'store' ? prof.tenure : 'own';
  for (let y = 0; y <= N - def.h; y++) {
    for (let x = 0; x <= N - def.w; x++) {
      const chk = checkPlacement(state, type, x, y, tenure);
      if (!chk.ok) continue;
      let score: number;
      if (type === 'store') score = storeSpotScore(state, c, prof, x, y, chk.leasePerDay);
      else {
        // 공장·농장·물류센터: 땅값이 싸고 도심(매장)과 가까운 곳
        const dc = Math.abs(x + def.w / 2 - N / 2) + Math.abs(y + def.h / 2 - N / 2);
        score = -chk.landCost / 1_000_000 - dc * 2;
      }
      score += nextRandom(state) * 0.001; // 동점 해소(시드 고정)
      if (!best || score > best.score) best = { x, y, cost: chk.constructionCost, score };
    }
  }
  return best;
}

function supplyContracts(state: GameState, to: Building, p: ProductId): Contract[] {
  return state.contracts.filter((k) => k.active && k.buyer.kind === 'building' && k.buyer.id === to.id && k.product === p);
}

/** 자사 조달처: 해당 상품을 만드는 공장, 또는 해당 상품 매입 계약이 있는 물류센터 */
function ownSource(state: GameState, c: Company, to: Building, p: ProductId): Building | null {
  const mine = myBuildings(state, c).filter((b) => b.status === 'active' && b.id !== to.id);
  const producer = mine.find((b) => BUILDINGS[b.type].recipe?.output === p);
  if (producer) return producer;
  if (to.type === 'warehouse') return null;
  // 물류센터는 이 매장 3일치 이상 재고가 있을 때만 조달처로 사용(빈 센터로 전환해 품절되는 것 방지)
  const need3 = Math.max(1, sumOf(to, 'demand', p) / Math.max(1, Math.min(7, to.hist.length))) * 3;
  const wh = mine.find((b) => b.type === 'warehouse' && supplyContracts(state, b, p).length > 0 && (b.inv[p]?.qty ?? 0) >= need3);
  const current = supplyContracts(state, to, p)[0];
  if (!wh && current && current.seller.kind === 'building') return state.buildings.find((b) => b.id === current.seller.id) ?? null;
  return wh ?? null;
}

function externalSource(state: GameState, prof: StrategyProfile, to: Building, p: ProductId): PartyRef | null {
  const sellers = state.externals.filter((e) => e.role === 'seller' && e.product === p);
  if (!sellers.length) return null;
  const toRef: PartyRef = { kind: 'building', id: to.id };
  let best = sellers[0], bestScore = -Infinity;
  for (const e of sellers) {
    const q = contractQuote(state, { seller: { kind: 'external', id: e.id }, buyer: toRef, product: p, qty: 200, intervalDays: 3, payment: 'ship', shortage: 'partial' });
    const landed = sellerPrice(e) + q.freightPerUnit;
    const avail = e.stock / e.maxStock;
    const score = prof.prefersQuality ? e.quality * 100 - landed * 0.01 + avail * 500 : -landed * (1.2 - avail * 0.4) + e.quality * 0.5;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return { kind: 'external', id: best.id };
}

/** 조달 계약 유지: 자사 조달처가 생기면 외부 계약을 대체하고, 필요량에 맞춰 수량을 조정 */
function ensureSupply(state: GameState, c: Company, prof: StrategyProfile, to: Building, p: ProductId, dailyNeed: number, interval: number, maxQty: number): void {
  const ks = supplyContracts(state, to, p);
  const own = ownSource(state, c, to, p);
  const desired: PartyRef | null = own ? { kind: 'building', id: own.id } : externalSource(state, prof, to, p);
  if (!desired) return;
  const qty = Math.max(1, Math.min(maxQty, Math.ceil(dailyNeed * interval)));
  const current = ks[0];
  if (current && own && current.seller.kind === 'external') {
    // 자사 조달처로 전환(위약금이 있으면 감수)
    applyCommand(state, c.id, { type: 'cancelContract', contractId: current.id });
  } else if (current) {
    for (const extra of ks.slice(1)) applyCommand(state, c.id, { type: 'cancelContract', contractId: extra.id });
    if (Math.abs(current.qty - qty) / Math.max(1, current.qty) > 0.12 || current.intervalDays !== interval) {
      applyCommand(state, c.id, { type: 'updateContract', contractId: current.id, qty, intervalDays: interval, shortage: 'partial' });
    }
    return;
  }
  applyCommand(state, c.id, {
    type: 'createContract', seller: desired, buyer: { kind: 'building', id: to.id }, product: p, qty, intervalDays: interval,
    payment: desired.kind === 'external' && prof.tenure === 'own' ? 'arrival' : 'ship', shortage: 'partial',
  });
}

function roundPrice(p: ProductId, x: number): number {
  const step = PRODUCTS[p].refPrice >= 10000 ? 100 : 10;
  return Math.max(step, Math.round(x / step) * step);
}

function landedCost(state: GameState, store: Building, p: ProductId): number {
  const uc = unitCost(store, p);
  if (uc > 0) return uc;
  const k = supplyContracts(state, store, p)[0];
  if (k && k.seller.kind === 'external') {
    const e = state.externals.find((q) => q.id === k.seller.id);
    if (e) return sellerPrice(e) + contractQuote(state, { ...k, payment: k.payment, shortage: k.shortage }).freightPerUnit;
  }
  return PRODUCTS[p].refPrice * 0.6;
}

function manageStores(state: GameState, c: Company, prof: StrategyProfile): string[] {
  const notes: string[] = [];
  let priceCuts = 0, priceRaises = 0;
  for (const s of myBuildings(state, c, 'store')) {
    if (s.staffLevel !== prof.staff) applyCommand(state, c.id, { type: 'setStaff', buildingId: s.id, level: prof.staff });
    const needs: Partial<Record<ProductId, number>> = {};
    for (const p of prof.products) {
      const est = s.hist.length >= 3 ? sumOf(s, 'demand', p) / Math.min(7, s.hist.length) : catchmentAt(state, p, s.x + 1, s.y + 1) * 0.3;
      needs[p] = Math.max(p === 'bread' ? 15 : 2, est * 1.15);
    }
    const needValue = prof.products.reduce((sum, p) => sum + (needs[p] ?? 0), 0) || 1;
    for (const p of prof.products) {
      const l = s.listings[p];
      if (!l) continue;
      if (!l.enabled) applyCommand(state, c.id, { type: 'setListing', buildingId: s.id, product: p, enabled: true });
      // 조달 계약: 판매량이 아니라 수요(판매+품절 손실) 기준. 진열 공간은 수요 금액 비율로 배분하고 주기는 공간에 맞춤
      const avg = avgSold(s, p);
      const lost = sumOf(s, 'lost', p), dem = sumOf(s, 'demand', p);
      const need = needs[p] ?? 1;
      const cap = Math.max(20, Math.floor((BUILDINGS.store.storage * 0.45 * need) / needValue)); // 재고+운송 중 물량이 함께 들어가도록 절반만 배정
      const interval = Math.max(1, Math.min(5, Math.floor(cap / Math.max(1, need))));
      ensureSupply(state, c, prof, s, p, need, interval, cap);
      if (s.status !== 'active') continue;
      // 가격 결정: 지난 평가 기간의 실제 일평균 이익(저가형은 매출 비중 가산)을 이전 가격과 비교해 방향을 정함
      const cost = landedCost(state, s, p);
      const days = Math.max(1, Math.min(BALANCE.difficulty[state.difficulty].aiEvalDays, s.hist.length));
      const sold = sumOf(s, 'sold', p, days) / days;
      const bias = c.ai!.strategy === 'lowcost' ? 0.12 : c.ai!.strategy === 'vertical' ? 0.05 : 0;
      const profit = sold * (l.price - cost) + bias * sold * l.price;
      const key = `${s.id}:${p}`;
      const memo = c.ai!.priceMemo[key];
      let price: number;
      let dir: 1 | -1 = 1;
      if (!memo || s.hist.length < 3) {
        price = l.userSet ? l.price : cost * prof.markup;
      } else {
        dir = profit >= memo.profit ? memo.dir : (memo.dir === 1 ? -1 : 1);
        const stockLimited = dem > 0 && lost / dem > 0.25;
        if (stockLimited) dir = 1; // 품절 상태에서는 가격 인하가 판매를 늘리지 못함
        if (avg > 0 && (s.inv[p]?.qty ?? 0) / avg > 10) dir = -1; // 재고 과다
        price = l.price * (1 + dir * 0.04);
      }
      const floor = cost * (c.ai!.strategy === 'lowcost' ? 1.12 : 1.15);
      price = Math.max(floor, Math.min(PRODUCTS[p].refPrice * 2.5, price));
      const np = roundPrice(p, price);
      c.ai!.priceMemo[key] = { price: np, profit, dir };
      if (np < l.price * 0.95) priceCuts++;
      if (np > l.price * 1.05) priceRaises++;
      if (np !== l.price) applyCommand(state, c.id, { type: 'setPrice', buildingId: s.id, product: p, price: np });
    }
  }
  if (priceCuts >= 1) notes.push(`${priceCuts}개 품목 가격 인하`);
  if (priceRaises >= 1) notes.push(`${priceRaises}개 품목 가격 인상`);
  return notes;
}

/** 생산시설 원료 조달·잉여 판매·가동률 관리 */
function manageProduction(state: GameState, c: Company, prof: StrategyProfile): void {
  for (const b of myBuildings(state, c)) {
    const def = BUILDINGS[b.type];
    if (b.status !== 'active') continue;
    if (b.type === 'warehouse') {
      // 물류센터: 여기서 조달받는 매장들의 필요량만큼 외부에서 대량 매입
      for (const p of CONSUMER_PRODUCTS) {
        // 매입량: 자사 매장 전체의 최근 수요 합계
        const storeDemand = myBuildings(state, c, 'store').reduce((sum, st) => sum + sumOf(st, 'demand', p) / Math.max(1, Math.min(7, st.hist.length)), 0);
        const need = Math.max(storeDemand, p === 'bread' ? 150 : 20);
        ensureSupply(state, c, prof, b, p, need * 1.1, 6, Math.floor(def.storage / 2));
      }
      continue;
    }
    if (!def.recipe) continue;
    for (const [p, need] of Object.entries(def.recipe.inputs) as [ProductId, number][]) {
      ensureSupply(state, c, prof, b, p, (need * def.recipe.batchesPerDay * Math.max(30, b.utilization)) / 100, 2, Math.floor(def.storage * 0.4));
    }
    // 잉여 생산품은 외부 매입처에 판매, 재고가 줄면 중단
    const out = def.recipe.output;
    const outStock = b.inv[out]?.qty ?? 0;
    const extSale = state.contracts.find((k) => k.active && k.seller.kind === 'building' && k.seller.id === b.id && k.buyer.kind === 'external');
    if (outStock > def.storage * 0.6 && !extSale) {
      const buyer = state.externals.find((e) => e.role === 'buyer' && e.product === out);
      if (buyer) applyCommand(state, c.id, { type: 'createContract', seller: { kind: 'building', id: b.id }, buyer: { kind: 'external', id: buyer.id }, product: out, qty: Math.floor(def.storage * 0.15), intervalDays: 3, payment: 'ship', shortage: 'partial' });
    } else if (extSale && outStock < def.storage * 0.25 && state.day - extSale.startDay >= BALANCE.market.minContractDays) {
      applyCommand(state, c.id, { type: 'cancelContract', contractId: extSale.id });
    }
    // 가동률: 완제품 재고가 쌓이면 줄이고, 부족하면 늘림
    let u = b.utilization;
    if (outStock > def.storage * 0.5) u -= 20; else if (outStock < def.storage * 0.2) u += 20;
    u = Math.max(20, Math.min(100, u));
    if (u !== b.utilization) applyCommand(state, c.id, { type: 'setUtilization', buildingId: b.id, value: u });
  }
}

function manageFinance(state: GameState, c: Company): string | null {
  const reserve = reserveCash(state, c);
  const limit = creditLimit(c);
  if (c.ledger.cash < reserve && limit >= 10_000_000) {
    const amt = Math.min(limit, Math.ceil((reserve * 1.5 - c.ledger.cash) / 10_000_000) * 10_000_000);
    if (amt >= 10_000_000) {
      const r = applyCommand(state, c.id, { type: 'takeLoan', amount: amt, termMonths: 36 });
      if (r.ok) return `운영자금 ${Math.round(amt / 1e8 * 10) / 10}억원 차입`;
    }
  }
  if (c.ledger.cash > reserve * 4 && c.loans.length) {
    const loan = c.loans[0];
    const pay = Math.min(loan.remaining, Math.floor((c.ledger.cash - reserve * 3) / 1_000_000) * 1_000_000);
    if (pay > 0) applyCommand(state, c.id, { type: 'repayLoan', loanId: loan.id, amount: pay });
  }
  return null;
}

function manageExpansion(state: GameState, c: Company, prof: StrategyProfile): string | null {
  const ai = c.ai!;
  if (state.day - ai.lastBuildDay < 15) return null;
  const mine = myBuildings(state, c).filter((b) => b.type !== 'hq');
  // 계획 순서대로 아직 없는 다음 건물
  const counts: Partial<Record<BuildingType, number>> = {};
  let next: BuildingType | null = null;
  for (const t of prof.plan) {
    counts[t] = (counts[t] ?? 0) + 1;
    if (mine.filter((b) => b.type === t).length < counts[t]!) { next = t; break; }
  }
  if (!next) return null;
  if (mine.some((b) => b.status === 'construction')) return null;
  // 직전 달 회사 전체가 영업적자면 확장 보류(초기 2개 매장 제외)
  const storeCount = myBuildings(state, c, 'store').length;
  const lastMonth = c.history[c.history.length - 1];
  if (storeCount >= 2 && lastMonth && incomeOf(lastMonth.delta).operating <= 0) return null;
  if (storeCount >= prof.maxStores && next === 'store') return null;
  const spot = findSpot(state, c, prof, next);
  if (!spot) return null;
  const reserve = reserveCash(state, c) + BALANCE.difficulty[state.difficulty].aiExpansionCash * 0.25;
  if (c.ledger.cash - spot.cost < reserve) {
    // 수직계열화형은 설비 투자에 차입을 활용
    if (ai.strategy === 'vertical' && next !== 'store') {
      const need = Math.ceil((spot.cost + reserve - c.ledger.cash) / 10_000_000) * 10_000_000;
      if (need <= creditLimit(c) && (-c.ledger.loans) < c.ledger.cash + c.ledger.land + c.ledger.buildings) {
        applyCommand(state, c.id, { type: 'takeLoan', amount: need, termMonths: 60 });
      }
    }
    if (c.ledger.cash - spot.cost < reserveCash(state, c)) return null;
  }
  const tenure = next === 'store' ? prof.tenure : 'own';
  const r = applyCommand(state, c.id, { type: 'build', building: next, x: spot.x, y: spot.y, tenure });
  if (!r.ok) return null;
  ai.lastBuildDay = state.day;
  const d = state.districts[state.map.district[spot.y * state.map.size + spot.x]];
  return `${d.name}에 ${BUILDINGS[next].name} 건설 착수`;
}

function manageDownsizing(state: GameState, c: Company): string | null {
  const stores = myBuildings(state, c, 'store');
  for (const s of stores) {
    if (s.lossMonths >= 3 && stores.length > 1) {
      const name = s.name;
      if (applyCommand(state, c.id, { type: 'sell', buildingId: s.id }).ok) return `적자 매장 ${name} 폐점`;
    }
  }
  for (const b of myBuildings(state, c)) {
    if (BUILDINGS[b.type].recipe && b.lossMonths >= 5 && c.ledger.cash < reserveCash(state, c)) {
      const name = b.name;
      if (applyCommand(state, c.id, { type: 'sell', buildingId: b.id }).ok) return `적자 시설 ${name} 매각`;
    }
  }
  return null;
}

function manageMarketing(state: GameState, c: Company, prof: StrategyProfile): void {
  const last = c.history[c.history.length - 1];
  if (!last) return;
  const rev = -(last.delta.revenue ?? 0);
  for (const p of prof.products) {
    const budget = Math.min(60_000_000, Math.max(0, Math.round((rev * prof.marketingRate) / prof.products.length / 100_000) * 100_000));
    const affordable = c.ledger.cash > reserveCash(state, c) ? budget : Math.round(budget / 3 / 100_000) * 100_000;
    if ((c.marketing[p] ?? 0) !== affordable) applyCommand(state, c.id, { type: 'setMarketing', product: p, monthly: affordable });
  }
}

/** 하루 처리 10단계: 평가 주기가 된 AI 회사 의사결정 */
export function runAi(state: GameState): void {
  for (const c of state.companies) {
    if (!c.ai || c.bankrupt || state.day < c.ai.nextEvalDay) continue;
    const prof = STRATEGIES[c.ai.strategy];
    c.ai.nextEvalDay = state.day + BALANCE.difficulty[state.difficulty].aiEvalDays;
    const notes: string[] = [];
    const fin = manageFinance(state, c);
    if (fin) notes.push(fin);
    const down = manageDownsizing(state, c);
    if (down) notes.push(down);
    manageProduction(state, c, prof);
    notes.push(...manageStores(state, c, prof));
    const exp = manageExpansion(state, c, prof);
    if (exp) notes.push(exp);
    manageMarketing(state, c, prof);
    const important = notes.filter((n) => !n.includes('품목 가격 인상') || notes.length === 1);
    if (important.length) addNews(state, 'competitor', `${c.name}: ${important.join(', ')}`, c.id, { panel: 'competitors' });
    c.ai.plan = notes.join(' / ');
  }
}
