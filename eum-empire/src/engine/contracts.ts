// 공급 계약과 배송.
// 재고 이동 규칙: 출하 시 공급자 재고 → 운송 중(Shipment), 도착 시 운송 중 → 구매자 재고. 각 배송은 정확히 한 번 도착 처리 후 목록에서 제거됩니다.
import { BALANCE } from './data/balance';
import { BUILDINGS, shippableProducts } from './data/buildings';
import { PRODUCTS } from './data/products';
import { addStock, freeSpace, invQty, removeStock } from './inventory';
import { partyDistance } from './map';
import { buyerPrice, sellerPrice, sellerUnitPrice } from './market';
import { roundWon } from './money';
import { postEntry } from './ledger';
import { addNews, getBuilding, getCompany, getExternal, partyName, sameRef } from './state';
import type { Building, Contract, GameState, PartyRef, ProductId, Result, Shipment } from './types';

export interface ContractInput {
  seller: PartyRef;
  buyer: PartyRef;
  product: ProductId;
  qty: number;
  intervalDays: number;
  payment: 'ship' | 'arrival';
  shortage: 'partial' | 'wait';
}

export function transitDaysFor(distance: number): number {
  return 1 + Math.floor(distance / BALANCE.logistics.tilesPerDay);
}

export function sellerIsOwnWarehouse(state: GameState, c: { seller: PartyRef }): boolean {
  if (c.seller.kind !== 'building') return false;
  return getBuilding(state, c.seller.id)?.type === 'warehouse';
}

export function freightCost(state: GameState, c: { seller: PartyRef; product: ProductId; distance: number }, qty: number): number {
  if (qty <= 0) return 0;
  const p = PRODUCTS[c.product];
  const trucks = Math.ceil(qty / p.truckCapacity);
  const disc = sellerIsOwnWarehouse(state, c) ? 1 - BALANCE.logistics.warehouseDiscount : 1;
  return trucks * BALANCE.logistics.truckFixed + roundWon(qty * p.freightPerTile * c.distance * disc);
}

export function validateContract(state: GameState, companyId: string, input: ContractInput): Result {
  const { seller, buyer, product } = input;
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > 20000) return { ok: false, error: '1회 수량은 1~20,000 사이 정수여야 합니다' };
  if (!Number.isInteger(input.intervalDays) || input.intervalDays < 1 || input.intervalDays > 30) return { ok: false, error: '출하 주기는 1~30일입니다' };
  if (sameRef(seller, buyer)) return { ok: false, error: '같은 곳끼리는 계약할 수 없습니다' };
  if (seller.kind === 'external' && buyer.kind === 'external') return { ok: false, error: '외부 업체끼리의 계약은 만들 수 없습니다' };
  if (seller.kind === 'external') {
    const e = getExternal(state, seller.id);
    if (!e || e.role !== 'seller') return { ok: false, error: '공급자가 아닙니다' };
    if (e.product !== product) return { ok: false, error: `${e.name}은(는) ${PRODUCTS[product].name}을(를) 팔지 않습니다` };
  } else {
    const b = getBuilding(state, seller.id);
    if (!b || b.owner !== companyId) return { ok: false, error: '자사 건물만 출하지로 지정할 수 있습니다' };
    if (!shippableProducts(b.type).includes(product)) return { ok: false, error: `${b.name}에서는 ${PRODUCTS[product].name}을(를) 출하할 수 없습니다` };
  }
  if (buyer.kind === 'external') {
    const e = getExternal(state, buyer.id);
    if (!e || e.role !== 'buyer') return { ok: false, error: '매입처가 아닙니다' };
    if (e.product !== product) return { ok: false, error: `${e.name}은(는) ${PRODUCTS[product].name}을(를) 사지 않습니다` };
  } else {
    const b = getBuilding(state, buyer.id);
    if (!b || b.owner !== companyId) return { ok: false, error: '자사 건물만 입고지로 지정할 수 있습니다' };
    if (!BUILDINGS[b.type].accepts.includes(product)) return { ok: false, error: `${b.name}은(는) ${PRODUCTS[product].name}을(를) 받을 수 없습니다` };
  }
  return { ok: true };
}

export function createContract(state: GameState, companyId: string, input: ContractInput): Result {
  const v = validateContract(state, companyId, input);
  if (!v.ok) return v;
  const distance = partyDistance(state, input.seller, input.buyer);
  const c: Contract = {
    id: state.nextId++,
    owner: companyId,
    seller: input.seller,
    buyer: input.buyer,
    product: input.product,
    qty: input.qty,
    intervalDays: input.intervalDays,
    nextShipDay: state.day,
    payment: input.seller.kind === 'external' ? input.payment : 'ship',
    shortage: input.shortage,
    startDay: state.day,
    active: true,
    transitDays: transitDaysFor(distance),
    distance,
    shippedTotal: 0,
    lastShortageDay: -999,
    failedPayments: 0,
  };
  state.contracts.push(c);
  return { ok: true, id: c.id };
}

export function cancelPenalty(state: GameState, c: Contract): number {
  if (c.seller.kind !== 'external' && c.buyer.kind !== 'external') return 0;
  if (state.day - c.startDay >= BALANCE.market.minContractDays) return 0;
  const e = getExternal(state, c.seller.kind === 'external' ? c.seller.id : (c.buyer as { id: number }).id);
  const price = e ? (e.role === 'seller' ? sellerPrice(e) : buyerPrice(e)) : 0;
  return roundWon(price * c.qty * BALANCE.market.cancelPenaltyRate);
}

export function cancelContract(state: GameState, companyId: string, contractId: number, reason = '해지'): Result {
  const c = state.contracts.find((q) => q.id === contractId);
  if (!c || c.owner !== companyId) return { ok: false, error: '계약을 찾을 수 없습니다' };
  if (!c.active) return { ok: false, error: '이미 종료된 계약입니다' };
  const penalty = cancelPenalty(state, c);
  const company = getCompany(state, companyId);
  if (penalty > 0) {
    postEntry(state, company, `계약 중도 해지 위약금(${partyName(state, c.seller)}→${partyName(state, c.buyer)})`,
      [{ account: 'otherLoss', amount: penalty }, { account: 'cash', amount: -penalty }], { cf: 'operating' });
  }
  c.active = false;
  state.contracts = state.contracts.filter((q) => q.id !== c.id);
  if (company.isPlayer) addNews(state, 'contract', `계약 ${reason}: ${partyName(state, c.seller)} → ${partyName(state, c.buyer)} ${PRODUCTS[c.product].name}${penalty ? ` (위약금 ${penalty.toLocaleString()}원)` : ''}`, companyId);
  return { ok: true };
}

/** 건물이 없어질 때 관련 계약 정리(위약금 없음) */
export function dropContractsForBuilding(state: GameState, buildingId: number): void {
  state.contracts = state.contracts.filter(
    (c) => !((c.seller.kind === 'building' && c.seller.id === buildingId) || (c.buyer.kind === 'building' && c.buyer.id === buildingId)),
  );
}

export function inboundQty(state: GameState, to: PartyRef): number {
  let s = 0;
  for (const sh of state.shipments) if (sameRef(sh.to, to)) s += sh.qty;
  return s;
}

function isActiveBuilding(b: Building | undefined): b is Building {
  return !!b && b.status === 'active';
}

/** 하루 처리 3단계: 오늘 도착하는 배송 입고 */
export function processArrivals(state: GameState): void {
  const remaining: Shipment[] = [];
  for (const sh of state.shipments) {
    if (sh.arriveDay > state.day) {
      remaining.push(sh);
      continue;
    }
    const holder = getCompany(state, sh.holder);
    if (sh.to.kind === 'building') {
      const b = getBuilding(state, sh.to.id);
      if (!b || b.owner !== sh.holder) {
        // 도착지가 매각·철거됨: 운송 중 재고 손실 처리
        postEntry(state, holder, `배송 도착지 소멸로 ${PRODUCTS[sh.product].name} 폐기`, [
          { account: 'otherLoss', amount: sh.cost }, { account: 'inTransit', amount: -sh.cost },
        ]);
        if (sh.payable > 0) {
          postEntry(state, holder, '외상매입금 지급', [{ account: 'payables', amount: sh.payable }, { account: 'cash', amount: -sh.payable }], { cf: 'operating' });
        }
        continue;
      }
      addStock(b, sh.product, sh.qty, sh.cost, sh.quality);
      postEntry(state, holder, `입고: ${PRODUCTS[sh.product].name} ${sh.qty} → ${b.name}`, [
        { account: 'inventory', amount: sh.cost }, { account: 'inTransit', amount: -sh.cost },
      ], { buildingId: b.id });
      if (sh.payable > 0) {
        postEntry(state, holder, `외상매입금 지급(${partyName(state, sh.from)})`, [
          { account: 'payables', amount: sh.payable }, { account: 'cash', amount: -sh.payable },
        ], { cf: 'operating', buildingId: b.id });
      }
    } else {
      // 외부 매입처 도착: 매출 인식
      const e = getExternal(state, sh.to.id);
      const revenue = sh.qty * sh.saleUnitPrice;
      const fromId = sh.from.kind === 'building' ? sh.from.id : undefined;
      postEntry(state, holder, `도매 판매: ${PRODUCTS[sh.product].name} ${sh.qty} → ${e?.name ?? '매입처'}`, [
        { account: 'cash', amount: revenue }, { account: 'revenue', amount: -revenue },
        { account: 'cogs', amount: sh.cost }, { account: 'inTransit', amount: -sh.cost },
      ], { cf: 'operating', buildingId: fromId });
      if (e) e.stock += sh.qty;
    }
  }
  state.shipments = remaining;
}

/** 하루 처리 5단계: 출하일이 된 계약을 출하 */
export function processShipments(state: GameState): void {
  for (const c of [...state.contracts]) {
    if (!c.active || state.day < c.nextShipDay) continue;
    const company = getCompany(state, c.owner);
    if (company.bankrupt) continue;
    const sellerB = c.seller.kind === 'building' ? getBuilding(state, c.seller.id) : undefined;
    const buyerB = c.buyer.kind === 'building' ? getBuilding(state, c.buyer.id) : undefined;
    if (c.seller.kind === 'building' && !isActiveBuilding(sellerB)) continue;
    if (c.buyer.kind === 'building' && !isActiveBuilding(buyerB)) continue;
    const ext = c.seller.kind === 'external' ? getExternal(state, c.seller.id) : c.buyer.kind === 'external' ? getExternal(state, c.buyer.id) : undefined;

    const available = sellerB ? invQty(sellerB, c.product) : ext ? ext.stock : 0;
    const space = buyerB
      ? Math.max(0, freeSpace(buyerB) - inboundQty(state, c.buyer))
      : ext ? Math.max(0, ext.maxStock - ext.stock - inboundQty(state, c.buyer)) : 0;
    let qty = Math.min(c.qty, available, space);
    const sellerShort = available < c.qty;
    if (sellerShort) {
      if (state.day - c.lastShortageDay >= 7 && company.isPlayer) {
        addNews(state, 'warning', `공급 부족: ${partyName(state, c.seller)}의 ${PRODUCTS[c.product].name} 재고가 계약량(${c.qty})보다 적습니다(${available})`, c.owner, { panel: 'supply', buildingId: buyerB?.id ?? sellerB?.id });
      }
      c.lastShortageDay = state.day;
      if (c.shortage === 'wait') qty = 0;
    }
    if (qty <= 0) {
      c.nextShipDay = state.day + 1; // 내일 다시 시도
      continue;
    }
    // 대금·운송비 지급 능력 확인(대량 할인은 최종 수량 기준)
    const priceFor = (q: number) => (c.seller.kind === 'external' && ext ? sellerUnitPrice(ext, q) : 0);
    const cashAvail = company.ledger.cash + (c.payment === 'arrival' ? company.ledger.payables : 0);
    const need = (q: number) => freightCost(state, c, q) + q * priceFor(q);
    if (need(qty) > cashAvail) {
      // 살 수 있는 만큼 줄임
      let lo = 0, hi = qty;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (need(mid) <= cashAvail) lo = mid; else hi = mid - 1;
      }
      qty = c.shortage === 'wait' ? 0 : lo;
      if (qty <= 0) {
        c.failedPayments++;
        c.nextShipDay = state.day + 1;
        if (company.isPlayer && c.failedPayments === 1) addNews(state, 'warning', `현금 부족으로 출하 보류: ${partyName(state, c.seller)} → ${partyName(state, c.buyer)}`, c.owner, { panel: 'finance' });
        if (c.failedPayments >= 10) {
          c.active = false;
          state.contracts = state.contracts.filter((q) => q.id !== c.id);
          addNews(state, 'contract', `대금 미지급 누적으로 계약 자동 해지: ${partyName(state, c.seller)} → ${partyName(state, c.buyer)}`, c.owner);
        }
        continue;
      }
    }
    const unitPrice = priceFor(qty);
    c.failedPayments = 0;
    const freight = freightCost(state, c, qty);
    const bid = buyerB?.id ?? sellerB?.id;
    let shipment: Shipment;
    if (c.seller.kind === 'external' && ext) {
      const goods = qty * unitPrice;
      ext.stock -= qty;
      postEntry(state, company, `매입 출하: ${ext.name} ${PRODUCTS[c.product].name} ${qty}×${unitPrice.toLocaleString()}`, [
        { account: 'inTransit', amount: goods },
        c.payment === 'ship' ? { account: 'cash', amount: -goods } : { account: 'payables', amount: -goods },
      ], { cf: c.payment === 'ship' ? 'operating' : undefined, buildingId: bid });
      shipment = mkShipment(state, c, qty, goods, ext.quality, c.payment === 'arrival' ? goods : 0, 0);
    } else if (sellerB) {
      const { cost, quality } = removeStock(sellerB, c.product, qty);
      postEntry(state, company, `출하: ${sellerB.name} ${PRODUCTS[c.product].name} ${qty}`, [
        { account: 'inTransit', amount: cost }, { account: 'inventory', amount: -cost },
      ], { buildingId: sellerB.id });
      const salePrice = c.buyer.kind === 'external' && ext ? buyerPrice(ext) : 0;
      shipment = mkShipment(state, c, qty, cost, quality, 0, salePrice);
    } else continue;
    postEntry(state, company, `운송비(${c.distance}칸, ${qty}${PRODUCTS[c.product].unit})`, [
      { account: 'transport', amount: freight }, { account: 'cash', amount: -freight },
    ], { cf: 'operating', buildingId: bid });
    state.shipments.push(shipment);
    c.shippedTotal += qty;
    c.nextShipDay = state.day + c.intervalDays;
  }
}

function mkShipment(state: GameState, c: Contract, qty: number, cost: number, quality: number, payable: number, saleUnitPrice: number): Shipment {
  return {
    id: state.nextId++,
    contractId: c.id,
    product: c.product,
    qty,
    cost,
    quality,
    holder: c.owner,
    from: c.seller,
    to: c.buyer,
    shipDay: state.day,
    arriveDay: state.day + c.transitDays,
    payable,
    saleUnitPrice,
  };
}

/** 계약 1회 예상 비용(화면 표시용) */
export function contractQuote(state: GameState, input: ContractInput) {
  const distance = partyDistance(state, input.seller, input.buyer);
  const ext = input.seller.kind === 'external' ? getExternal(state, input.seller.id) : input.buyer.kind === 'external' ? getExternal(state, input.buyer.id) : undefined;
  const unitPrice = ext ? (ext.role === 'seller' ? sellerUnitPrice(ext, input.qty) : buyerPrice(ext)) : 0;
  const freight = freightCost(state, { seller: input.seller, product: input.product, distance }, input.qty);
  return {
    distance,
    transitDays: transitDaysFor(distance),
    unitPrice,
    goods: unitPrice * input.qty,
    freight,
    freightPerUnit: input.qty > 0 ? freight / input.qty : 0,
    perMonthShipments: 30 / input.intervalDays,
  };
}
