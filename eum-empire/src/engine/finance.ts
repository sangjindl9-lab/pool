// 재무: 일일 운영비, 마케팅, 당좌대월 이자, 대출, 감가상각, 월말 결산, 자산 매각, 파산
import { BALANCE } from './data/balance';
import { BUILDINGS } from './data/buildings';
import { CONSUMER_PRODUCTS, PRODUCTS } from './data/products';
import { dropContractsForBuilding } from './contracts';
import { balanceSheet, incomeOf, postEntry, startNextMonth } from './ledger';
import { monthIndex } from './calendar';
import { roundWon, formatWon } from './money';
import { addNews, getBuilding, getCompany } from './state';
import type { Building, Company, GameState, Result } from './types';

export function storeStaff(b: Building): number {
  return BALANCE.demand.staffByLevel[b.staffLevel - 1];
}

/** 생산시설이 아닌 건물의 하루 고정비(인건비, 임대료, 유지비, 전력비) */
export function dailyFixedCosts(b: Building) {
  const def = BUILDINGS[b.type];
  const active = b.status === 'active';
  let wages = 0;
  if (active) {
    if (b.type === 'store') wages = storeStaff(b) * BALANCE.wages.retailPerDay;
    else if (b.type === 'hq') wages = def.workers * BALANCE.wages.officePerDay;
    else if (b.type === 'warehouse') wages = def.workers * BALANCE.wages.factoryPerDay;
  }
  return {
    wages,
    rent: b.tenure === 'lease' ? b.leasePerDay : 0,
    maintenance: active ? def.maintenancePerDay : 0,
    // 공장·농장 전력비는 생산 단계에서 가동량에 따라 계산
    utilities: active && !def.recipe ? def.powerPerDay : 0,
  };
}

/** 하루 처리 7단계: 고정비, 마케팅, 당좌대월 이자 */
export function processDailyCosts(state: GameState): void {
  for (const b of state.buildings) {
    const company = getCompany(state, b.owner);
    if (company.bankrupt) continue;
    const c = dailyFixedCosts(b);
    const total = c.wages + c.rent + c.maintenance + c.utilities;
    if (total === 0) continue;
    postEntry(state, company, `${b.name} 일일 운영비`, [
      { account: 'wages', amount: c.wages }, { account: 'rent', amount: c.rent },
      { account: 'maintenance', amount: c.maintenance }, { account: 'utilities', amount: c.utilities },
      { account: 'cash', amount: -total },
    ], { cf: 'operating', buildingId: b.id });
  }
  for (const company of state.companies) {
    if (company.bankrupt) continue;
    for (const p of CONSUMER_PRODUCTS) {
      const monthly = company.marketing[p] ?? 0;
      if (monthly <= 0) continue;
      const daily = roundWon(monthly / BALANCE.calendar.daysPerMonth);
      postEntry(state, company, `${PRODUCTS[p].name} 마케팅`, [
        { account: 'marketing', amount: daily }, { account: 'cash', amount: -daily },
      ], { cf: 'operating' });
    }
    if (company.ledger.cash < 0) {
      const interest = roundWon((-company.ledger.cash * BALANCE.finance.overdraftRate) / 360);
      postEntry(state, company, '당좌대월 이자', [
        { account: 'interest', amount: interest }, { account: 'cash', amount: -interest },
      ], { cf: 'operating' });
    }
  }
}

/** 하루 처리 8단계: 브랜드 인지도 갱신 */
export function updateBrands(state: GameState): void {
  const pop = state.districts.reduce((s, d) => s + d.population, 0);
  const scale = 100_000 / Math.max(1, pop);
  for (const company of state.companies) {
    for (const p of CONSUMER_PRODUCTS) {
      const a = company.brand[p] ?? 0;
      const spend = company.bankrupt ? 0 : (company.marketing[p] ?? 0) / BALANCE.calendar.daysPerMonth;
      const stores = state.buildings.filter((b) => b.owner === company.id && b.type === 'store' && b.status === 'active' && b.listings[p]?.enabled).length;
      const gain = (BALANCE.marketing.gainPerWon * spend * scale + 0.02 * stores) * (1 - a / 100);
      company.brand[p] = Math.max(0, Math.min(100, a + gain - BALANCE.marketing.decay * a));
    }
  }
}

export function loanRate(state: GameState, company: Company): number {
  const bs = balanceSheet(company);
  const debt = -company.ledger.loans;
  const lev = bs.assets > 0 ? debt / bs.assets : 1;
  return Math.max(0.02, BALANCE.finance.baseRate + BALANCE.finance.leveragePremium * lev + BALANCE.difficulty[state.difficulty].loanRateAdj);
}

export function creditLimit(company: Company): number {
  const bs = balanceSheet(company);
  const l = company.ledger;
  const collateral = l.land + l.buildings + l.accumDep;
  const raw = Math.max(0, bs.equity) * BALANCE.finance.equityMultiple + collateral * BALANCE.finance.collateralRate + l.loans;
  return Math.max(0, Math.floor(raw / 1_000_000) * 1_000_000);
}

export function takeLoan(state: GameState, company: Company, amount: number, termMonths: number): Result {
  if (!Number.isInteger(amount) || amount < 10_000_000) return { ok: false, error: '대출은 1,000만원 이상 정수 금액이어야 합니다' };
  if (![12, 24, 36, 60].includes(termMonths)) return { ok: false, error: '상환 기간은 12·24·36·60개월 중 선택합니다' };
  const limit = creditLimit(company);
  if (amount > limit) return { ok: false, error: `대출 한도 초과(한도 ${formatWon(limit)})` };
  const rate = loanRate(state, company);
  const id = state.nextId++;
  company.loans.push({ id, principal: amount, remaining: amount, annualRate: rate, termMonths, monthsPaid: 0, startDay: state.day });
  // 대출 실행: 현금 증가 / 차입금(부채) 증가. 수익이 아닙니다.
  postEntry(state, company, `대출 실행 ${formatWon(amount)} (연 ${(rate * 100).toFixed(1)}%, ${termMonths}개월)`, [
    { account: 'cash', amount }, { account: 'loans', amount: -amount },
  ], { cf: 'financing' });
  return { ok: true, id };
}

export function repayLoan(state: GameState, company: Company, loanId: number, amount: number): Result {
  const loan = company.loans.find((l) => l.id === loanId);
  if (!loan) return { ok: false, error: '대출을 찾을 수 없습니다' };
  const pay = Math.min(amount, loan.remaining);
  if (!Number.isInteger(pay) || pay <= 0) return { ok: false, error: '상환 금액이 올바르지 않습니다' };
  if (company.ledger.cash < pay) return { ok: false, error: '현금이 부족합니다' };
  // 원금 상환: 부채 감소 / 현금 감소. 비용이 아닙니다.
  postEntry(state, company, `대출 원금 조기상환 ${formatWon(pay)}`, [
    { account: 'loans', amount: pay }, { account: 'cash', amount: -pay },
  ], { cf: 'financing' });
  loan.remaining -= pay;
  if (loan.remaining <= 0) company.loans = company.loans.filter((l) => l.id !== loanId);
  return { ok: true };
}

/** 건물 매각(또는 철거): 장부가 × 회수율, 보유 토지 × 회수율, 재고는 원가 50%로 처분 */
export function sellBuilding(state: GameState, company: Company, buildingId: number): Result {
  const b = getBuilding(state, buildingId);
  if (!b || b.owner !== company.id) return { ok: false, error: '자사 건물이 아닙니다' };
  if (b.type === 'hq') return { ok: false, error: '본사는 매각할 수 없습니다' };
  const netBook = b.capex - b.accumDep;
  const bldProceeds = roundWon(netBook * BALANCE.finance.buildingSaleRecovery);
  const landProceeds = b.tenure === 'own' ? roundWon(b.landValue * BALANCE.finance.landSaleRecovery) : 0;
  let invCost = 0;
  for (const lot of Object.values(b.inv)) invCost += lot?.cost ?? 0;
  const invProceeds = roundWon(invCost * 0.5);
  const proceeds = bldProceeds + landProceeds;
  const bookTotal = netBook + (b.tenure === 'own' ? b.landValue : 0);
  const gainLoss = proceeds - bookTotal;
  postEntry(state, company, `${b.name} 매각(건물·토지)`, [
    { account: 'cash', amount: proceeds },
    { account: 'accumDep', amount: b.accumDep },
    { account: 'buildings', amount: -b.capex },
    { account: 'land', amount: b.tenure === 'own' ? -b.landValue : 0 },
    gainLoss >= 0 ? { account: 'otherIncome', amount: -gainLoss } : { account: 'otherLoss', amount: -gainLoss },
  ], { cf: 'investing', buildingId: b.id });
  if (invCost > 0) {
    postEntry(state, company, `${b.name} 재고 처분`, [
      { account: 'cash', amount: invProceeds }, { account: 'otherLoss', amount: invCost - invProceeds }, { account: 'inventory', amount: -invCost },
    ], { cf: 'operating', buildingId: b.id });
  }
  dropContractsForBuilding(state, b.id);
  state.buildings = state.buildings.filter((q) => q.id !== b.id);
  return { ok: true };
}

/** 월말 처리: 감가상각, 대출 이자·원금 상환, 결산 */
export function processMonthEnd(state: GameState): void {
  for (const company of state.companies) {
    if (company.bankrupt) continue;
    for (const b of state.buildings) {
      if (b.owner !== company.id || b.status !== 'active' || b.capex <= 0) continue;
      const monthly = Math.min(roundWon(b.capex / BUILDINGS[b.type].lifeMonths), b.capex - b.accumDep);
      if (monthly <= 0) continue;
      b.accumDep += monthly;
      postEntry(state, company, `${b.name} 감가상각`, [
        { account: 'depreciation', amount: monthly }, { account: 'accumDep', amount: -monthly },
      ], { buildingId: b.id });
    }
    for (const loan of [...company.loans]) {
      const interest = roundWon((loan.remaining * loan.annualRate) / 12);
      const left = loan.termMonths - loan.monthsPaid;
      const principal = left <= 1 ? loan.remaining : Math.min(loan.remaining, roundWon(loan.principal / loan.termMonths));
      postEntry(state, company, `대출 이자(연 ${(loan.annualRate * 100).toFixed(1)}%)`, [
        { account: 'interest', amount: interest }, { account: 'cash', amount: -interest },
      ], { cf: 'operating' });
      postEntry(state, company, '대출 원금 정기상환', [
        { account: 'loans', amount: principal }, { account: 'cash', amount: -principal },
      ], { cf: 'financing' });
      loan.remaining -= principal;
      loan.monthsPaid++;
      if (loan.remaining <= 0) company.loans = company.loans.filter((l) => l.id !== loan.id);
    }
  }
  const next = monthIndex(state.day) + 1;
  for (const company of state.companies) {
    const inc = incomeOf(company.month.delta);
    startNextMonth(state, company, next);
    if (company.isPlayer) {
      addNews(state, 'finance', `월말 결산: 매출 ${formatWon(inc.revenue)}, 영업이익 ${formatWon(inc.operating)}, 순이익 ${formatWon(inc.net)}`, company.id, { panel: 'finance' });
    }
  }
  for (const b of state.buildings) {
    if (!b.plLast) continue;
    const inc = incomeOf(b.plLast);
    b.lossMonths = b.status === 'active' && inc.operating < 0 ? b.lossMonths + 1 : 0;
  }
}

/** 하루 처리 11단계: 자금 부족 경고 및 파산 판정 */
export function checkSolvency(state: GameState): void {
  const grace = BALANCE.finance.bankruptcyGraceDays;
  for (const company of state.companies) {
    if (company.bankrupt) continue;
    if (company.ledger.cash >= 0) {
      company.negativeCashDays = 0;
      continue;
    }
    company.negativeCashDays++;
    const n = company.negativeCashDays;
    if (company.isPlayer && (n === 1 || n === 10 || n === 20 || n === 25 || n === 28)) {
      addNews(state, 'warning', `자금 부족! 현금 ${formatWon(company.ledger.cash)}. ${grace - n}일 안에 현금을 회복하지 못하면 파산합니다. (대출·건물 매각·계약 축소)`, company.id, { panel: 'finance' });
    }
    if (n >= grace) declareBankruptcy(state, company);
  }
}

export function declareBankruptcy(state: GameState, company: Company): void {
  company.bankrupt = true;
  company.marketing = {};
  state.contracts = state.contracts.filter((c) => c.owner !== company.id);
  if (company.isPlayer) {
    state.gameOver = { day: state.day, won: false, reason: `${BALANCE.finance.bankruptcyGraceDays}일 동안 현금 부족 상태가 이어져 파산했습니다.` };
    addNews(state, 'warning', `${company.name} 파산`, company.id);
    return;
  }
  // AI 파산: 보유 건물 청산 후 시장에서 퇴출
  for (const b of state.buildings.filter((q) => q.owner === company.id)) {
    if (b.type === 'hq') {
      state.buildings = state.buildings.filter((q) => q.id !== b.id);
      continue;
    }
    sellBuilding(state, company, b.id);
  }
  addNews(state, 'competitor', `${company.name}이(가) 자금난으로 파산하여 모든 매장과 공장을 정리했습니다.`, company.id, { panel: 'competitors' });
}
