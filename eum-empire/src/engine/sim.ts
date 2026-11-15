// 게임 생성과 하루 처리.
//
// ■ 하루 처리 순서(고정, advanceDay)
//  1. 건설 진행·완공
//  2. 외부 시장 재고 보충/소비
//  3. 배송 도착(운송 중 → 구매자 재고, 외상 지급, 외부 판매 매출 인식)
//  4. 생산(원재료 차감 → 완제품 입고, 가공비 자본화)
//  5. 계약 출하(공급자 재고 → 운송 중, 매입 대금·운송비 지급)
//  6. 소매 판매(수요 배분 → 재고 차감 → 매출·매출원가)
//  7. 일일 고정비·마케팅·당좌대월 이자
//  8. 브랜드 인지도·연구 완료
//  9. 경쟁사 AI 의사결정(다음 날부터 효과)
// 10. 지급능력 검사·파산 판정
// 11. 월말이면 감가상각·대출 상환·월 결산
// 12. 목표·튜토리얼 진행 판정, 날짜 +1
// 플레이어 명령은 날짜 사이(처리 전)에만 적용되므로 배속과 무관하게 같은 입력이면 같은 결과가 나옵니다.
import { BALANCE, type Difficulty } from './data/balance';
import { BUILDINGS } from './data/buildings';
import { PRODUCTS } from './data/products';
import { runAi, STRATEGIES } from './ai';
import { makeBuilding } from './commands';
import { processArrivals, processShipments } from './contracts';
import { marketShare, processSales } from './demand';
import { checkSolvency, processDailyCosts, processMonthEnd, updateBrands } from './finance';
import { companyValue, emptyLedger, incomeOf, newMonth, postEntry } from './ledger';
import { checkPlacement, generateCity } from './map';
import { createExternals, updateExternals } from './market';
import { isMonthEnd } from './calendar';
import { processProduction } from './production';
import { addNews, player } from './state';
import type { Company, GameState, Objective, Strategy } from './types';

export const SAVE_VERSION = 1;

export interface NewGameOptions {
  seed: number;
  mode: 'tutorial' | 'free';
  difficulty: Difficulty;
  companyName: string;
  capital?: number;
}

const AI_DEFS: { id: string; name: string; color: string; strategy: Strategy }[] = [
  { id: 'ai1', name: '알뜰유통', color: '#e3a21a', strategy: 'lowcost' },
  { id: 'ai2', name: '프레스티지', color: '#9b59b6', strategy: 'premium' },
  { id: 'ai3', name: '한결산업', color: '#d64541', strategy: 'vertical' },
];

function makeCompany(id: string, name: string, color: string, isPlayer: boolean, strategy: Strategy | null, firstEval: number): Company {
  return {
    id, name, color, isPlayer,
    ledger: emptyLedger(),
    month: newMonth(0, 0),
    history: [],
    journal: [],
    loans: [],
    brand: { bread: 0, clothing: 0 },
    marketing: {},
    research: { level: { food: 0, apparel: 0 }, project: null },
    negativeCashDays: 0,
    bankrupt: false,
    ai: strategy ? { strategy, nextEvalDay: firstEval, lastBuildDay: -999, plan: '', priceMemo: {} } : null,
  };
}

function placeHq(state: GameState, company: Company, index: number): void {
  // 상업지역 중 도로에 닿는 자리를 결정적으로 탐색(중심에서 가까운 순)
  const N = state.map.size;
  const cand: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
    const chk = checkPlacement(state, 'hq', x, y, 'lease');
    if (chk.ok) cand.push({ x, y, d: Math.abs(x - N / 2) + Math.abs(y - N / 2) });
  }
  cand.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const pick = cand[Math.min(cand.length - 1, index * 7)];
  const chk = checkPlacement(state, 'hq', pick.x, pick.y, 'lease');
  const hq = makeBuilding(state, company, 'hq', pick.x, pick.y, 'lease', chk.landCost, Math.round(chk.leasePerDay * BALANCE.map.hqLeaseShare));
  state.buildings.push(hq);
}

export function defaultObjectives(): Objective[] {
  return [
    { id: 'profit3', kind: 'profitStreak', label: '3개월 연속 순이익 흑자', target: 3, done: false, doneDay: null },
    { id: 'share', kind: 'marketShare', label: '빵 시장점유율 30% 달성(최근 30일)', target: 0.3, product: 'bread', done: false, doneDay: null },
    { id: 'chain', kind: 'fullChain', label: '밀 농장 → 제분소 → 제빵공장 → 소매점 자체 공급망 완성', target: 1, done: false, doneDay: null },
    { id: 'value', kind: 'companyValue', label: '기업가치 20억원 달성', target: 2_000_000_000, done: false, doneDay: null },
  ];
}

export function newGame(opts: NewGameOptions): GameState {
  const { map, districts } = generateCity(opts.seed);
  const diff = BALANCE.difficulty[opts.difficulty];
  const state: GameState = {
    saveVersion: SAVE_VERSION,
    seed: opts.seed,
    rng: (opts.seed * 2654435761) >>> 0,
    day: 0,
    mode: opts.mode,
    difficulty: opts.difficulty,
    map,
    districts,
    companies: [],
    buildings: [],
    externals: [],
    contracts: [],
    shipments: [],
    nextId: 1,
    news: [],
    market: {},
    demandCarry: {},
    objectives: opts.mode === 'free' ? defaultObjectives() : [],
    tutorial: opts.mode === 'tutorial' ? { step: 0, flags: {} } : null,
    gameOver: null,
  };
  state.externals = createExternals(state);
  const me = makeCompany('player', opts.companyName || '이음상사', '#2f80ed', true, null, 0);
  state.companies.push(me);
  const ais = opts.mode === 'tutorial' ? AI_DEFS.slice(0, 1) : AI_DEFS;
  ais.forEach((a, i) => state.companies.push(makeCompany(a.id, a.name, a.color, false, a.strategy, opts.mode === 'tutorial' ? 20 : i)));
  state.companies.forEach((c, i) => {
    const capital = c.isPlayer ? (opts.capital ?? diff.capital) : diff.aiCapital;
    postEntry(state, c, '설립 자본금 납입', [{ account: 'cash', amount: capital }, { account: 'capital', amount: -capital }], { cf: 'financing' });
    placeHq(state, c, i);
  });
  addNews(state, 'info', `${me.name} 설립. 초기 자본금으로 사업을 시작하세요.`, me.id);
  for (const c of state.companies) if (c.ai) addNews(state, 'competitor', `경쟁사 ${c.name}(${STRATEGIES[c.ai.strategy].label})이(가) 시장에 진입했습니다.`, c.id, { panel: 'competitors' });
  return state;
}

function processConstruction(state: GameState): void {
  for (const b of state.buildings) {
    if (b.status === 'construction' && state.day >= b.completeDay) {
      b.status = 'active';
      const owner = state.companies.find((c) => c.id === b.owner)!;
      if (owner.isPlayer) addNews(state, 'construction', `${b.name} 완공! ${b.type === 'store' ? '공급 계약을 맺고 가격을 정하세요.' : ''}`, owner.id, { panel: 'building', buildingId: b.id });
      else addNews(state, 'competitor', `${owner.name}의 ${BUILDINGS[b.type].name}이(가) 문을 열었습니다.`, owner.id);
    }
  }
}

function processResearch(state: GameState): void {
  for (const c of state.companies) {
    const p = c.research.project;
    if (p && state.day >= p.endDay) {
      c.research.level[p.category]++;
      c.research.project = null;
      if (c.isPlayer) addNews(state, 'info', `${p.category === 'food' ? '식품' : '의류'} 품질 연구 ${c.research.level[p.category]}단계 완료: 자사 생산 품질 +${BALANCE.research.qualityPerLevel}`, c.id, { panel: 'research' });
    }
  }
}

function profitStreak(c: Company): number {
  let n = 0;
  for (let i = c.history.length - 1; i >= 0; i--) {
    if (incomeOf(c.history[i].delta).net > 0) n++; else break;
  }
  return n;
}

export function hasFullBreadChain(state: GameState, companyId: string): boolean {
  const typeOf = (id: number) => state.buildings.find((b) => b.id === id && b.owner === companyId && b.status === 'active')?.type;
  const links = state.contracts
    .filter((k) => k.active && k.owner === companyId && k.seller.kind === 'building' && k.buyer.kind === 'building')
    .map((k) => ({ from: typeOf(k.seller.id), to: typeOf(k.buyer.id), product: k.product }));
  const has = (from: string, to: string, product: string) => links.some((l) => l.from === from && l.to === to && l.product === product);
  const bakeryToStore = has('bakery', 'store', 'bread') || (has('bakery', 'warehouse', 'bread') && has('warehouse', 'store', 'bread'));
  const bakeryProduced = state.buildings.some((b) => b.owner === companyId && b.type === 'bakery' && b.hist.slice(-7).some((h) => h.produced > 0));
  return has('wheatFarm', 'mill', 'wheat') && has('mill', 'bakery', 'flour') && bakeryToStore && bakeryProduced;
}

export function objectiveProgress(state: GameState, o: Objective): number {
  const me = player(state);
  switch (o.kind) {
    case 'profitStreak': return profitStreak(me) / o.target;
    case 'marketShare': {
      const ms = marketShare(state, o.product!, 30);
      return ms.sold > 0 ? (ms.byCompany[me.id] ?? 0) / ms.sold / o.target : 0;
    }
    case 'fullChain': return hasFullBreadChain(state, me.id) ? 1 : 0;
    case 'companyValue': return companyValue(me) / o.target;
  }
}

function checkObjectives(state: GameState): void {
  for (const o of state.objectives) {
    if (o.done) continue;
    if (objectiveProgress(state, o) >= 1) {
      o.done = true;
      o.doneDay = state.day;
      addNews(state, 'info', `목표 달성: ${o.label}`, 'player', { panel: 'company' });
    }
  }
  if (state.objectives.length && state.objectives.every((o) => o.done) && !state.gameOver) {
    state.gameOver = { day: state.day, won: true, reason: '모든 경영 목표를 달성했습니다! 계속 플레이할 수 있습니다.' };
  }
}

export const TUTORIAL_STEPS = [
  { title: '부지 선택과 소매점 건설', text: '왼쪽 [건설] 메뉴에서 소매점을 고르고, 지도의 상업·주거지역 중 도로에 맞닿은 초록색 자리를 클릭하세요. [지도 표시 → 빵 수요]로 사람이 많은 곳을 확인할 수 있습니다.' },
  { title: '건설 완료 기다리기', text: '건설에는 12일이 걸립니다. 상단의 ▶ 버튼으로 시간을 진행하세요. 기다리는 동안 다음 단계(공급 계약)를 미리 해도 됩니다.' },
  { title: '빵 구매 계약', text: '왼쪽 [공급망] → [새 계약]에서 공급자로 빵 도매상을, 입고지로 내 소매점을 선택해 계약하세요. 출하 시 대금과 운송비가 현금에서 빠집니다.' },
  { title: '판매가격 설정', text: '내 소매점을 클릭하고 오른쪽 상세창의 [가격] 칸에서 빵 가격을 정한 뒤 [적용]을 누르세요. 매입가보다 높되 경쟁 매장보다 지나치게 비싸지 않게!' },
  { title: '첫 매출', text: '빵이 도착하면 주변 주민이 구매합니다. 시간을 진행해 첫 매출을 기다리세요.' },
  { title: '월말 결산', text: '매달 30일이 지나면 결산이 이루어집니다. 월말까지 진행한 뒤 [재무] 화면에서 손익계산서를 확인하세요.' },
  { title: '튜토리얼 완료', text: '축하합니다! 이제 매장을 늘리거나, 공장을 지어 직접 생산해 보세요. 자유 경영 모드에서는 3개 경쟁사가 함께 경쟁합니다.' },
];

export function checkTutorial(state: GameState): void {
  const t = state.tutorial;
  if (!t) return;
  const me = player(state);
  const stores = state.buildings.filter((b) => b.owner === me.id && b.type === 'store');
  const before = t.step;
  if (t.step === 0 && stores.length > 0) t.step = 1;
  if (t.step === 1 && stores.some((s) => s.status === 'active')) t.step = 2;
  if (t.step === 2 && state.contracts.some((k) => k.owner === me.id && k.product === 'bread' && k.buyer.kind === 'building' && stores.some((s) => s.id === (k.buyer as { id: number }).id))) t.step = 3;
  if (t.step === 3 && t.flags.priceSet) t.step = 4;
  if (t.step === 4 && stores.some((s) => s.hist.some((h) => (h.sold.bread ?? 0) > 0))) t.step = 5;
  if (t.step === 5 && me.history.some((m) => incomeOf(m.delta).revenue > 0)) t.flags.monthClosedAfterSale = true;
  if (t.step === 5 && t.flags.monthClosedAfterSale && t.flags.financeViewed) t.step = 6;
  if (t.step !== before) addNews(state, 'info', `튜토리얼: ${TUTORIAL_STEPS[t.step].title}`, me.id);
}

/** UI에서 화면 열람 같은 비시뮬레이션 행동을 튜토리얼에 알릴 때 사용 */
export function tutorialFlag(state: GameState, flag: string): void {
  if (state.tutorial) {
    // 재무 화면 확인은 첫 매출 후 월말 결산이 끝난 다음에만 인정
    if (flag === 'financeViewed' && !state.tutorial.flags.monthClosedAfterSale) return;
    state.tutorial.flags[flag] = true;
    checkTutorial(state);
  }
}

export function advanceDay(state: GameState): void {
  if (state.gameOver && !state.gameOver.won) return;
  processConstruction(state);
  updateExternals(state);
  processArrivals(state);
  processProduction(state);
  processShipments(state);
  processSales(state);
  processDailyCosts(state);
  updateBrands(state);
  processResearch(state);
  runAi(state);
  checkSolvency(state);
  if (isMonthEnd(state.day)) processMonthEnd(state);
  checkObjectives(state);
  checkTutorial(state);
  state.day++;
}

export function runDays(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) advanceDay(state);
}

export { PRODUCTS };
