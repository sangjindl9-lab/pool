// 복식부기 원장. 모든 금액 변동은 postEntry 하나로만 일어나며, 화면의 모든 재무 숫자는 이 원장에서 파생됩니다.
import { BALANCE } from './data/balance';
import { monthIndex } from './calendar';
import type { Account, CashFlowClass, Company, GameState, JournalLine, MonthRecord } from './types';

export const ASSET_ACCOUNTS: Account[] = ['cash', 'inventory', 'inTransit', 'land', 'buildings', 'accumDep'];
export const LIABILITY_ACCOUNTS: Account[] = ['payables', 'loans'];
export const REVENUE_ACCOUNTS: Account[] = ['revenue', 'otherIncome'];
export const EXPENSE_ACCOUNTS: Account[] = [
  'cogs', 'wages', 'rent', 'transport', 'marketing', 'maintenance', 'utilities', 'depreciation', 'interest', 'research', 'otherLoss',
];
export const OPEX_ACCOUNTS: Account[] = ['wages', 'rent', 'transport', 'marketing', 'maintenance', 'utilities', 'depreciation', 'research'];
export const ALL_ACCOUNTS: Account[] = [...ASSET_ACCOUNTS, ...LIABILITY_ACCOUNTS, 'capital', ...REVENUE_ACCOUNTS, ...EXPENSE_ACCOUNTS];

export const ACCOUNT_LABEL: Record<Account, string> = {
  cash: '현금', inventory: '재고자산', inTransit: '운송 중 재고', land: '토지', buildings: '건물·설비', accumDep: '감가상각누계액',
  payables: '외상매입금', loans: '차입금', capital: '자본금',
  revenue: '매출', otherIncome: '영업외수익', cogs: '매출원가', wages: '인건비', rent: '임대료', transport: '운송비',
  marketing: '마케팅비', maintenance: '유지비', utilities: '전력비', depreciation: '감가상각비', interest: '이자비용',
  research: '연구개발비', otherLoss: '영업외손실',
};

const JOURNAL_KEEP = 400;

export function emptyLedger(): Record<Account, number> {
  const l = {} as Record<Account, number>;
  for (const a of ALL_ACCOUNTS) l[a] = 0;
  return l;
}

export function newMonth(index: number, cashStart: number): MonthRecord {
  return { index, delta: {}, cf: { operating: 0, investing: 0, financing: 0 }, cashEnd: cashStart, closed: false };
}

export interface PostOptions {
  buildingId?: number;
  cf?: CashFlowClass;
}

/**
 * 분개 기록. 차변 합 = 대변 합(합계 0)이 아니면 예외.
 * 현금 계정을 건드리는 분개는 반드시 현금흐름 구분(cf)을 지정해야 합니다.
 */
export function postEntry(state: GameState, company: Company, memo: string, lines: JournalLine[], opts: PostOptions = {}): void {
  const nonZero = lines.filter((l) => l.amount !== 0);
  if (nonZero.length === 0) return;
  let sum = 0;
  for (const l of nonZero) {
    if (!Number.isInteger(l.amount)) throw new Error(`정수가 아닌 금액: ${memo} ${l.account} ${l.amount}`);
    sum += l.amount;
  }
  if (sum !== 0) throw new Error(`대차 불일치(${sum}): ${memo}`);
  const cashLine = nonZero.find((l) => l.account === 'cash');
  if (cashLine && !opts.cf) throw new Error(`현금흐름 구분 누락: ${memo}`);
  ensureMonth(state, company);
  for (const l of nonZero) {
    company.ledger[l.account] += l.amount;
    company.month.delta[l.account] = (company.month.delta[l.account] ?? 0) + l.amount;
  }
  if (cashLine && opts.cf) company.month.cf[opts.cf] += cashLine.amount;
  company.month.cashEnd = company.ledger.cash;
  if (opts.buildingId !== undefined) {
    const b = state.buildings.find((q) => q.id === opts.buildingId);
    if (b) {
      for (const l of nonZero) {
        if (REVENUE_ACCOUNTS.includes(l.account) || EXPENSE_ACCOUNTS.includes(l.account)) {
          b.plMonth[l.account] = (b.plMonth[l.account] ?? 0) + l.amount;
        }
      }
    }
  }
  company.journal.push({ id: state.nextId++, day: state.day, memo, lines: nonZero, buildingId: opts.buildingId, cf: opts.cf });
  if (company.journal.length > JOURNAL_KEEP) company.journal.splice(0, company.journal.length - JOURNAL_KEEP);
}

function ensureMonth(state: GameState, company: Company): void {
  const mi = monthIndex(state.day);
  if (company.month.index !== mi) {
    // 정상 흐름에서는 월말 결산에서 교체되지만, 방어적으로 처리
    closeMonth(company);
    company.month = newMonth(mi, company.ledger.cash);
  }
}

export function closeMonth(company: Company): void {
  if (company.month.closed) return;
  company.month.closed = true;
  company.month.cashEnd = company.ledger.cash;
  company.history.push(company.month);
  if (company.history.length > 120) company.history.shift();
}

export function startNextMonth(state: GameState, company: Company, nextIndex: number): void {
  closeMonth(company);
  company.month = newMonth(nextIndex, company.ledger.cash);
  for (const b of state.buildings) {
    if (b.owner !== company.id) continue;
    b.plLast = b.plMonth;
    b.plMonth = {};
  }
}

// ---------- 파생 지표(모두 원장 값에서 계산) ----------
export function incomeOf(delta: Partial<Record<Account, number>>) {
  const g = (a: Account) => delta[a] ?? 0;
  const revenue = -g('revenue');
  const cogs = g('cogs');
  const gross = revenue - cogs;
  const opex = OPEX_ACCOUNTS.reduce((s, a) => s + g(a), 0);
  const operating = gross - opex;
  const nonOp = -g('otherIncome') - g('otherLoss') - g('interest');
  const net = operating + nonOp;
  const z = (x: number) => x + 0; // -0 제거
  return { revenue: z(revenue), cogs: z(cogs), gross: z(gross), opex: z(opex), operating: z(operating), nonOp: z(nonOp), net: z(net) };
}

export function balanceSheet(company: Company) {
  const l = company.ledger;
  const assets = l.cash + l.inventory + l.inTransit + l.land + l.buildings + l.accumDep;
  const liabilities = -(l.payables + l.loans);
  const capital = -l.capital;
  const retained = -(
    REVENUE_ACCOUNTS.reduce((s, a) => s + l[a], 0) + EXPENSE_ACCOUNTS.reduce((s, a) => s + l[a], 0)
  );
  return { assets, liabilities, capital, retained, equity: capital + retained };
}

export function trialBalance(company: Company): number {
  return ALL_ACCOUNTS.reduce((s, a) => s + company.ledger[a], 0);
}

export function recentMonths(company: Company, n: number): typeof company.history {
  return company.history.slice(-n);
}

export function companyValue(company: Company): number {
  const bs = balanceSheet(company);
  const last = company.history.slice(-3);
  const avg = last.length ? last.reduce((s, m) => s + incomeOf(m.delta).net, 0) / last.length : 0;
  return Math.round(bs.equity + Math.max(0, avg) * BALANCE.finance.valueEarningsMultiple);
}
