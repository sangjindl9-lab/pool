// 게임 상태 타입. 모든 상태는 JSON 직렬화 가능한 순수 데이터입니다(함수·클래스·Map 없음).
import type { ProductId } from './data/products';
import type { BuildingType, Zone } from './data/buildings';
import type { Difficulty } from './data/balance';

export type { ProductId, BuildingType, Zone, Difficulty };
export type CompanyId = string;

/** 원장 계정. 차변(+) / 대변(-) 부호 규칙. */
export type Account =
  // 자산
  | 'cash' | 'inventory' | 'inTransit' | 'land' | 'buildings' | 'accumDep'
  // 부채
  | 'payables' | 'loans'
  // 자본
  | 'capital'
  // 수익
  | 'revenue' | 'otherIncome'
  // 비용
  | 'cogs' | 'wages' | 'rent' | 'transport' | 'marketing' | 'maintenance' | 'utilities'
  | 'depreciation' | 'interest' | 'research' | 'otherLoss';

export type CashFlowClass = 'operating' | 'investing' | 'financing';

export interface JournalLine { account: Account; amount: number }
export interface JournalEntry {
  id: number;
  day: number;
  memo: string;
  lines: JournalLine[];
  buildingId?: number;
  cf?: CashFlowClass;
}

export interface MonthRecord {
  /** 0부터 시작하는 게임 월 번호 */
  index: number;
  /** 이 달 동안의 계정별 증감(차변 +) */
  delta: Partial<Record<Account, number>>;
  cf: Record<CashFlowClass, number>;
  cashEnd: number;
  closed: boolean;
}

export interface Loan {
  id: number;
  principal: number;
  remaining: number;
  annualRate: number;
  termMonths: number;
  monthsPaid: number;
  startDay: number;
}

export interface ResearchState {
  /** 체인별 품질 연구 단계 */
  level: Record<'food' | 'apparel', number>;
  project: null | { category: 'food' | 'apparel'; endDay: number; cost: number };
}

export type Strategy = 'lowcost' | 'premium' | 'vertical';

export interface AiState {
  strategy: Strategy;
  nextEvalDay: number;
  lastBuildDay: number;
  /** 최근 판단 요약 */
  plan: string;
  /** 매장·상품별 가격 탐색 기록: 이전 가격의 실제 일평균 이익과 탐색 방향 */
  priceMemo: Record<string, { price: number; profit: number; dir: 1 | -1 }>;
}

export interface Company {
  id: CompanyId;
  name: string;
  color: string;
  isPlayer: boolean;
  ledger: Record<Account, number>;
  month: MonthRecord;
  history: MonthRecord[];
  journal: JournalEntry[];
  loans: Loan[];
  brand: Partial<Record<ProductId, number>>;
  /** 상품별 월 마케팅 예산(원) */
  marketing: Partial<Record<ProductId, number>>;
  research: ResearchState;
  negativeCashDays: number;
  bankrupt: boolean;
  ai: AiState | null;
}

export interface Lot { qty: number; cost: number; quality: number }

export interface Listing { price: number; enabled: boolean; userSet: boolean }

export interface DayStat {
  day: number;
  demand: Partial<Record<ProductId, number>>;
  sold: Partial<Record<ProductId, number>>;
  lost: Partial<Record<ProductId, number>>;
  revenue: number;
  produced: number;
  /** 생산 제약 원인 */
  limit: null | 'input' | 'space' | 'utilization' | 'cash';
}

export interface Building {
  id: number;
  type: BuildingType;
  owner: CompanyId;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tenure: 'own' | 'lease';
  /** 매입 시 토지 취득가, 임차 시 기준 땅값 */
  landValue: number;
  leasePerDay: number;
  status: 'construction' | 'active';
  startDay: number;
  completeDay: number;
  capex: number;
  accumDep: number;
  inv: Partial<Record<ProductId, Lot>>;
  listings: Partial<Record<ProductId, Listing>>;
  staffLevel: 1 | 2 | 3;
  /** 0~100 목표 가동률 */
  utilization: number;
  hist: DayStat[];
  /** 건물별 손익(이번 달, 지난 달) */
  plMonth: Partial<Record<Account, number>>;
  plLast: Partial<Record<Account, number>> | null;
  lossMonths: number;
}

export type PartyRef = { kind: 'building'; id: number } | { kind: 'external'; id: number };

export interface ExternalParty {
  id: number;
  name: string;
  role: 'seller' | 'buyer';
  product: ProductId;
  /** 지도 밖 위치(칸 좌표, 지도 경계 바깥 가능) */
  x: number;
  y: number;
  basePrice: number;
  quality: number;
  /** 판매자: 하루 생산(보충)량 / 구매자: 하루 소비량 */
  ratePerDay: number;
  stock: number;
  maxStock: number;
}

export interface Contract {
  id: number;
  owner: CompanyId;
  seller: PartyRef;
  buyer: PartyRef;
  product: ProductId;
  qty: number;
  intervalDays: number;
  nextShipDay: number;
  payment: 'ship' | 'arrival';
  shortage: 'partial' | 'wait';
  startDay: number;
  active: boolean;
  transitDays: number;
  distance: number;
  shippedTotal: number;
  lastShortageDay: number;
  failedPayments: number;
}

export interface Shipment {
  id: number;
  contractId: number;
  product: ProductId;
  qty: number;
  /** 재고 원가(운송 중 재고 계정 금액). 외부 판매자 출하는 매입가. */
  cost: number;
  quality: number;
  /** 운송 중 재고를 보유한 회사(외부→회사 / 회사→회사 / 회사→외부 모두 출하 회사 또는 구매 회사) */
  holder: CompanyId;
  from: PartyRef;
  to: PartyRef;
  shipDay: number;
  arriveDay: number;
  /** 외부 판매자에게 도착 시 지급할 금액(외상) */
  payable: number;
  /** 외부 매입처에 판매하는 경우 도착 시 받을 단가 */
  saleUnitPrice: number;
}

export interface District {
  id: number;
  name: string;
  cx: number;
  cy: number;
  population: number;
  income: number;
  priceSensitivity: number;
  qualityPref: number;
  brandPref: number;
}

export interface CityMap {
  size: number;
  /** 0 도로, 1 상업, 2 주거, 3 공업, 4 농업 */
  tiles: number[];
  /** 칸당 땅값(원) */
  landPrice: number[];
  district: number[];
}

export type NewsKind = 'info' | 'warning' | 'contract' | 'competitor' | 'finance' | 'construction' | 'sales';

export interface NavTarget {
  panel: 'building' | 'supply' | 'finance' | 'market' | 'company' | 'competitors' | 'research' | 'build';
  buildingId?: number;
  product?: ProductId;
  externalId?: number;
}

export interface NewsItem {
  id: number;
  day: number;
  kind: NewsKind;
  text: string;
  companyId?: CompanyId;
  nav?: NavTarget;
}

export interface MarketDay {
  day: number;
  potential: number;
  sold: number;
  lost: number;
  byCompany: Record<CompanyId, number>;
  revenueByCompany: Record<CompanyId, number>;
}

export interface Objective {
  id: string;
  kind: 'profitStreak' | 'marketShare' | 'fullChain' | 'companyValue';
  label: string;
  target: number;
  product?: ProductId;
  done: boolean;
  doneDay: number | null;
}

export interface TutorialState {
  step: number;
  flags: Record<string, boolean>;
}

export interface GameState {
  saveVersion: number;
  seed: number;
  rng: number;
  day: number;
  mode: 'tutorial' | 'free';
  difficulty: Difficulty;
  map: CityMap;
  districts: District[];
  companies: Company[];
  buildings: Building[];
  externals: ExternalParty[];
  contracts: Contract[];
  shipments: Shipment[];
  nextId: number;
  news: NewsItem[];
  market: Partial<Record<ProductId, MarketDay[]>>;
  demandCarry: Record<string, number>;
  objectives: Objective[];
  tutorial: TutorialState | null;
  gameOver: null | { day: number; won: boolean; reason: string };
}

export type Result = { ok: true; id?: number } | { ok: false; error: string; id?: undefined };
