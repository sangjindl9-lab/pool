// 명령 API. 플레이어 UI와 경쟁사 AI가 같은 함수를 호출하며, 같은 현금·배치·재고 검증을 받습니다.
import { BALANCE } from './data/balance';
import { BUILDINGS, type BuildingType } from './data/buildings';
import { CONSUMER_PRODUCTS, PRODUCTS, type ProductId } from './data/products';
import { cancelContract, createContract, type ContractInput } from './contracts';
import { creditLimit, repayLoan, sellBuilding, takeLoan } from './finance';
import { postEntry } from './ledger';
import { checkPlacement } from './map';
import { formatWon } from './money';
import { addNews, getBuilding, getCompany } from './state';
import type { Building, Company, GameState, Result } from './types';

export type Command =
  | { type: 'build'; building: BuildingType; x: number; y: number; tenure: 'own' | 'lease' }
  | { type: 'sell'; buildingId: number }
  | { type: 'setPrice'; buildingId: number; product: ProductId; price: number }
  | { type: 'setListing'; buildingId: number; product: ProductId; enabled: boolean }
  | { type: 'setStaff'; buildingId: number; level: 1 | 2 | 3 }
  | { type: 'setUtilization'; buildingId: number; value: number }
  | ({ type: 'createContract' } & ContractInput)
  | { type: 'updateContract'; contractId: number; qty: number; intervalDays: number; shortage: 'partial' | 'wait' }
  | { type: 'cancelContract'; contractId: number }
  | { type: 'takeLoan'; amount: number; termMonths: number }
  | { type: 'repayLoan'; loanId: number; amount: number }
  | { type: 'setMarketing'; product: ProductId; monthly: number }
  | { type: 'startResearch'; category: 'food' | 'apparel' }
  | { type: 'rename'; buildingId: number; name: string };

function nextName(state: GameState, company: Company, type: BuildingType): string {
  let n = state.buildings.filter((b) => b.owner === company.id && b.type === type).length + 1;
  const taken = new Set(state.buildings.map((b) => b.name));
  while (taken.has(`${company.name} ${BUILDINGS[type].name} ${n}호`)) n++;
  return `${company.name} ${BUILDINGS[type].name} ${n}호`;
}

export function makeBuilding(state: GameState, company: Company, type: BuildingType, x: number, y: number, tenure: 'own' | 'lease', landValue: number, leasePerDay: number): Building {
  const def = BUILDINGS[type];
  const b: Building = {
    id: state.nextId++,
    type,
    owner: company.id,
    name: type === 'hq' ? `${company.name} 본사` : nextName(state, company, type),
    x, y, w: def.w, h: def.h,
    tenure,
    landValue,
    leasePerDay: tenure === 'lease' ? leasePerDay : 0,
    status: def.constructionDays > 0 ? 'construction' : 'active',
    startDay: state.day,
    completeDay: state.day + def.constructionDays,
    capex: def.constructionCost,
    accumDep: 0,
    inv: {},
    listings: {},
    staffLevel: 2,
    utilization: 100,
    hist: [],
    plMonth: {},
    plLast: null,
    lossMonths: 0,
  };
  if (type === 'store') {
    for (const p of CONSUMER_PRODUCTS) b.listings[p] = { price: PRODUCTS[p].refPrice, enabled: true, userSet: false };
  }
  return b;
}

export function buildCost(state: GameState, type: BuildingType, x: number, y: number, tenure: 'own' | 'lease') {
  return checkPlacement(state, type, x, y, tenure);
}

function build(state: GameState, company: Company, type: BuildingType, x: number, y: number, tenure: 'own' | 'lease'): Result {
  if (!BUILDINGS[type] || type === 'hq') return { ok: false, error: '지을 수 없는 건물입니다' };
  const chk = checkPlacement(state, type, x, y, tenure);
  if (!chk.ok) return { ok: false, error: chk.reasons.join(', ') };
  if (company.ledger.cash < chk.constructionCost) {
    return { ok: false, error: `현금 부족: 필요 ${formatWon(chk.constructionCost)}, 보유 ${formatWon(company.ledger.cash)}` };
  }
  const b = makeBuilding(state, company, type, x, y, tenure, chk.landCost, chk.leasePerDay);
  state.buildings.push(b);
  // 건설비는 비용이 아니라 건물 자산, 토지 매입은 토지 자산
  postEntry(state, company, `${b.name} 건설비`, [
    { account: 'buildings', amount: b.capex }, { account: 'cash', amount: -b.capex },
  ], { cf: 'investing', buildingId: b.id });
  if (tenure === 'own') {
    postEntry(state, company, `${b.name} 부지 매입`, [
      { account: 'land', amount: chk.landCost }, { account: 'cash', amount: -chk.landCost },
    ], { cf: 'investing', buildingId: b.id });
  }
  return { ok: true, id: b.id };
}

function ownBuilding(state: GameState, company: Company, id: number): Building | Result {
  const b = getBuilding(state, id);
  if (!b || b.owner !== company.id) return { ok: false, error: '자사 건물이 아닙니다' };
  return b;
}
function isResult(x: unknown): x is Result {
  return typeof x === 'object' && x !== null && 'ok' in x;
}

export function researchCost(company: Company, category: 'food' | 'apparel'): number {
  const lvl = company.research.level[category];
  return Math.round((BALANCE.research.baseCost * Math.pow(BALANCE.research.costGrowth, lvl)) / 1_000_000) * 1_000_000;
}

export function applyCommand(state: GameState, companyId: string, cmd: Command): Result {
  if (state.gameOver && getCompany(state, companyId).isPlayer && state.gameOver.won === false) return { ok: false, error: '게임이 종료되었습니다' };
  const company = getCompany(state, companyId);
  if (company.bankrupt) return { ok: false, error: '파산한 회사입니다' };
  const r = dispatch(state, company, cmd);
  if (r.ok && company.isPlayer && state.tutorial) {
    if (cmd.type === 'setPrice') state.tutorial.flags.priceSet = true;
    if (cmd.type === 'createContract') state.tutorial.flags.contract = true;
  }
  return r;
}

function dispatch(state: GameState, company: Company, cmd: Command): Result {
  switch (cmd.type) {
    case 'build':
      return build(state, company, cmd.building, cmd.x, cmd.y, cmd.tenure);
    case 'sell': {
      const b = ownBuilding(state, company, cmd.buildingId);
      if (isResult(b)) return b;
      const name = b.name;
      const r = sellBuilding(state, company, b.id);
      if (r.ok && !company.isPlayer) addNews(state, 'competitor', `${company.name}이(가) ${name}을(를) 정리했습니다.`, company.id);
      return r;
    }
    case 'setPrice': {
      const b = ownBuilding(state, company, cmd.buildingId);
      if (isResult(b)) return b;
      const l = b.listings[cmd.product];
      if (!l) return { ok: false, error: '이 매장에서 취급하지 않는 상품입니다' };
      if (!Number.isInteger(cmd.price) || cmd.price < 10 || cmd.price > PRODUCTS[cmd.product].refPrice * 10) return { ok: false, error: '가격 범위를 벗어났습니다' };
      l.price = cmd.price;
      l.userSet = true;
      return { ok: true };
    }
    case 'setListing': {
      const b = ownBuilding(state, company, cmd.buildingId);
      if (isResult(b)) return b;
      const l = b.listings[cmd.product];
      if (!l) return { ok: false, error: '취급 불가 상품' };
      l.enabled = cmd.enabled;
      return { ok: true };
    }
    case 'setStaff': {
      const b = ownBuilding(state, company, cmd.buildingId);
      if (isResult(b)) return b;
      if (b.type !== 'store') return { ok: false, error: '매장만 서비스 수준을 바꿀 수 있습니다' };
      if (![1, 2, 3].includes(cmd.level)) return { ok: false, error: '1~3단계' };
      b.staffLevel = cmd.level;
      return { ok: true };
    }
    case 'setUtilization': {
      const b = ownBuilding(state, company, cmd.buildingId);
      if (isResult(b)) return b;
      if (!BUILDINGS[b.type].recipe) return { ok: false, error: '생산시설이 아닙니다' };
      b.utilization = Math.max(0, Math.min(100, Math.round(cmd.value)));
      return { ok: true };
    }
    case 'createContract': {
      const { type: _t, ...input } = cmd;
      void _t;
      const r = createContract(state, company.id, input);
      return r;
    }
    case 'updateContract': {
      const c = state.contracts.find((q) => q.id === cmd.contractId && q.owner === company.id);
      if (!c) return { ok: false, error: '계약 없음' };
      if (!Number.isInteger(cmd.qty) || cmd.qty < 1 || cmd.qty > 20000) return { ok: false, error: '수량 1~20,000' };
      if (!Number.isInteger(cmd.intervalDays) || cmd.intervalDays < 1 || cmd.intervalDays > 30) return { ok: false, error: '주기 1~30일' };
      c.qty = cmd.qty;
      if (c.intervalDays !== cmd.intervalDays) {
        c.nextShipDay = Math.min(c.nextShipDay, state.day + cmd.intervalDays);
        c.intervalDays = cmd.intervalDays;
      }
      c.shortage = cmd.shortage;
      return { ok: true };
    }
    case 'cancelContract':
      return cancelContract(state, company.id, cmd.contractId);
    case 'takeLoan':
      return takeLoan(state, company, cmd.amount, cmd.termMonths);
    case 'repayLoan':
      return repayLoan(state, company, cmd.loanId, cmd.amount);
    case 'setMarketing': {
      if (!CONSUMER_PRODUCTS.includes(cmd.product)) return { ok: false, error: '소비재만 마케팅할 수 있습니다' };
      if (!Number.isInteger(cmd.monthly) || cmd.monthly < 0 || cmd.monthly > 2_000_000_000) return { ok: false, error: '예산 범위 오류' };
      company.marketing[cmd.product] = cmd.monthly;
      return { ok: true };
    }
    case 'startResearch': {
      if (company.research.project) return { ok: false, error: '이미 진행 중인 연구가 있습니다' };
      if (company.research.level[cmd.category] >= BALANCE.research.maxLevel) return { ok: false, error: '최고 단계입니다' };
      const cost = researchCost(company, cmd.category);
      if (company.ledger.cash < cost) return { ok: false, error: `현금 부족(필요 ${formatWon(cost)})` };
      postEntry(state, company, `${cmd.category === 'food' ? '식품' : '의류'} 품질 연구 착수`, [
        { account: 'research', amount: cost }, { account: 'cash', amount: -cost },
      ], { cf: 'operating' });
      company.research.project = { category: cmd.category, endDay: state.day + BALANCE.research.days, cost };
      return { ok: true };
    }
    case 'rename': {
      const b = ownBuilding(state, company, cmd.buildingId);
      if (isResult(b)) return b;
      const name = cmd.name.trim().slice(0, 30);
      if (!name) return { ok: false, error: '이름을 입력하세요' };
      b.name = name;
      return { ok: true };
    }
  }
}

export { creditLimit };
