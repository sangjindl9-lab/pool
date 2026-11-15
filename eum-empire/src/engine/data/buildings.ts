// 건물 정의 데이터. 금액 단위는 원(정수), 시간 단위는 게임 일(day).
import type { ProductId } from './products';

export type BuildingType =
  | 'store' | 'warehouse' | 'mill' | 'bakery' | 'spinning' | 'sewing' | 'wheatFarm' | 'cottonFarm' | 'hq';
export type Zone = 'commercial' | 'residential' | 'industrial' | 'rural';
export type BuildingKind = 'store' | 'warehouse' | 'factory' | 'farm' | 'hq';

export interface Recipe {
  /** 1회 배치에 필요한 투입물 수량 */
  inputs: Partial<Record<ProductId, number>>;
  output: ProductId;
  /** 1회 배치 산출량 */
  outputQty: number;
  /** 가동률 100%에서 하루 최대 배치 수 */
  batchesPerDay: number;
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  kind: BuildingKind;
  w: number;
  h: number;
  zones: Zone[];
  constructionCost: number;
  constructionDays: number;
  /** 감가상각 내용연수(개월) */
  lifeMonths: number;
  /** 고정 인원(매장은 서비스 수준에 따라 따로 계산) */
  workers: number;
  maintenancePerDay: number;
  /** 가동률 100% 기준 하루 전력비 */
  powerPerDay: number;
  storage: number;
  recipe?: Recipe;
  /** 이 건물이 받아들이는 상품 */
  accepts: ProductId[];
  description: string;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  store: {
    type: 'store', name: '소매점', kind: 'store', w: 2, h: 2, zones: ['commercial', 'residential'],
    constructionCost: 70_000_000, constructionDays: 12, lifeMonths: 120, workers: 0,
    maintenancePerDay: 25_000, powerPerDay: 20_000, storage: 1500,
    accepts: ['bread', 'clothing'],
    description: '빵과 의류를 진열해 주변 지역 주민에게 판매합니다. 입지·가격·품질·브랜드·서비스로 경쟁합니다.',
  },
  warehouse: {
    type: 'warehouse', name: '물류센터', kind: 'warehouse', w: 3, h: 3, zones: ['industrial'],
    constructionCost: 110_000_000, constructionDays: 18, lifeMonths: 180, workers: 2,
    maintenancePerDay: 35_000, powerPerDay: 15_000, storage: 20_000,
    accepts: ['wheat', 'flour', 'bread', 'cotton', 'fabric', 'clothing'],
    description: '대량 보관 거점(2만 단위). 외부 공급자에게 트럭 2대분 이상 주문하면 5%, 5대분 이상이면 9% 할인됩니다. 이 센터에서 출발하는 자사 배송은 거리당 운송비가 30% 저렴합니다.',
  },
  mill: {
    type: 'mill', name: '제분소', kind: 'factory', w: 3, h: 3, zones: ['industrial'],
    constructionCost: 200_000_000, constructionDays: 28, lifeMonths: 180, workers: 5,
    maintenancePerDay: 40_000, powerPerDay: 60_000, storage: 8_000,
    recipe: { inputs: { wheat: 3 }, output: 'flour', outputQty: 2, batchesPerDay: 200 },
    accepts: ['wheat'],
    description: '밀 3포대로 밀가루 2포대를 만듭니다. 최대 하루 400포대.',
  },
  bakery: {
    type: 'bakery', name: '제빵공장', kind: 'factory', w: 3, h: 3, zones: ['industrial'],
    constructionCost: 190_000_000, constructionDays: 25, lifeMonths: 180, workers: 6,
    maintenancePerDay: 40_000, powerPerDay: 70_000, storage: 8_000,
    recipe: { inputs: { flour: 1 }, output: 'bread', outputQty: 4, batchesPerDay: 300 },
    accepts: ['flour'],
    description: '밀가루 1포대로 빵 4개를 만듭니다. 최대 하루 1,200개.',
  },
  spinning: {
    type: 'spinning', name: '방직공장', kind: 'factory', w: 3, h: 3, zones: ['industrial'],
    constructionCost: 240_000_000, constructionDays: 30, lifeMonths: 180, workers: 6,
    maintenancePerDay: 45_000, powerPerDay: 90_000, storage: 6_000,
    recipe: { inputs: { cotton: 2 }, output: 'fabric', outputQty: 1, batchesPerDay: 400 },
    accepts: ['cotton'],
    description: '원면 2꾸러미로 원단 1필을 짭니다. 최대 하루 400필.',
  },
  sewing: {
    type: 'sewing', name: '봉제공장', kind: 'factory', w: 3, h: 3, zones: ['industrial'],
    constructionCost: 170_000_000, constructionDays: 24, lifeMonths: 180, workers: 8,
    maintenancePerDay: 35_000, powerPerDay: 40_000, storage: 5_000,
    recipe: { inputs: { fabric: 2 }, output: 'clothing', outputQty: 1, batchesPerDay: 200 },
    accepts: ['fabric'],
    description: '원단 2필로 의류 1벌을 만듭니다. 최대 하루 200벌.',
  },
  wheatFarm: {
    type: 'wheatFarm', name: '밀 농장', kind: 'farm', w: 4, h: 4, zones: ['rural'],
    constructionCost: 80_000_000, constructionDays: 18, lifeMonths: 240, workers: 5,
    maintenancePerDay: 20_000, powerPerDay: 15_000, storage: 6_000,
    recipe: { inputs: {}, output: 'wheat', outputQty: 60, batchesPerDay: 10 },
    accepts: [],
    description: '밀을 재배합니다. 최대 하루 600포대.',
  },
  cottonFarm: {
    type: 'cottonFarm', name: '목화 농장', kind: 'farm', w: 4, h: 4, zones: ['rural'],
    constructionCost: 90_000_000, constructionDays: 18, lifeMonths: 240, workers: 5,
    maintenancePerDay: 20_000, powerPerDay: 15_000, storage: 6_000,
    recipe: { inputs: {}, output: 'cotton', outputQty: 80, batchesPerDay: 10 },
    accepts: [],
    description: '원면을 재배합니다. 최대 하루 800꾸러미.',
  },
  hq: {
    type: 'hq', name: '본사', kind: 'hq', w: 2, h: 2, zones: ['commercial'],
    constructionCost: 0, constructionDays: 0, lifeMonths: 120, workers: 1,
    maintenancePerDay: 15_000, powerPerDay: 5_000, storage: 0,
    accepts: [],
    description: '회사 본사(임차 사무실). 경영 인력이 근무합니다.',
  },
};

export const BUILDABLE_TYPES: BuildingType[] = [
  'store', 'warehouse', 'wheatFarm', 'mill', 'bakery', 'cottonFarm', 'spinning', 'sewing',
];

/** 이 건물에서 다른 곳으로 출하 가능한 상품 */
export function shippableProducts(type: BuildingType): ProductId[] {
  const def = BUILDINGS[type];
  if (def.kind === 'warehouse') return def.accepts;
  if (def.recipe) return [def.recipe.output];
  return [];
}
