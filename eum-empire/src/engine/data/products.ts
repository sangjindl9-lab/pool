// 상품 정의 데이터. 가격 단위는 원(정수).
export type ProductId = 'wheat' | 'flour' | 'bread' | 'cotton' | 'fabric' | 'clothing';
export type ProductTier = 'raw' | 'intermediate' | 'consumer';

export interface ProductDef {
  id: ProductId;
  name: string;
  tier: ProductTier;
  unit: string;
  /** 소비재: 기준 소매가(수요 계산의 기준점) */
  refPrice: number;
  /** 소비재: 1인당 하루 기본 수요(단위) */
  perCapitaDaily: number;
  /** 가격 탄력성(높을수록 가격에 민감) */
  priceElasticity: number;
  /** 품질 중요도 계수 */
  qualityWeight: number;
  /** 소득 탄력성: 소득지수^이 값 만큼 수요가 변함 */
  incomeElasticity: number;
  /** 트럭 1대에 싣는 단위 수 */
  truckCapacity: number;
  /** 단위·칸(tile)당 운송비(원) */
  freightPerTile: number;
  /** 외부 구매(시장 밖 소비)로 빠지는 기본 매력도 */
  outsideAttraction: number;
  category: 'food' | 'apparel';
  color: string;
}

export const PRODUCTS: Record<ProductId, ProductDef> = {
  wheat: {
    id: 'wheat', name: '밀', tier: 'raw', unit: '포대', refPrice: 900, perCapitaDaily: 0,
    priceElasticity: 0, qualityWeight: 0, incomeElasticity: 0, truckCapacity: 400, freightPerTile: 4,
    outsideAttraction: 0, category: 'food', color: '#d9b45a',
  },
  flour: {
    id: 'flour', name: '밀가루', tier: 'intermediate', unit: '포대', refPrice: 3500, perCapitaDaily: 0,
    priceElasticity: 0, qualityWeight: 0, incomeElasticity: 0, truckCapacity: 300, freightPerTile: 4,
    outsideAttraction: 0, category: 'food', color: '#efe6cf',
  },
  bread: {
    id: 'bread', name: '빵', tier: 'consumer', unit: '개', refPrice: 3000, perCapitaDaily: 0.02,
    priceElasticity: 2.2, qualityWeight: 0.6, incomeElasticity: 0.3, truckCapacity: 1200, freightPerTile: 0.8,
    outsideAttraction: 0.55, category: 'food', color: '#c98a3c',
  },
  cotton: {
    id: 'cotton', name: '원면', tier: 'raw', unit: '꾸러미', refPrice: 1800, perCapitaDaily: 0,
    priceElasticity: 0, qualityWeight: 0, incomeElasticity: 0, truckCapacity: 300, freightPerTile: 5,
    outsideAttraction: 0, category: 'apparel', color: '#f4f4f0',
  },
  fabric: {
    id: 'fabric', name: '원단', tier: 'intermediate', unit: '필', refPrice: 7000, perCapitaDaily: 0,
    priceElasticity: 0, qualityWeight: 0, incomeElasticity: 0, truckCapacity: 250, freightPerTile: 5,
    outsideAttraction: 0, category: 'apparel', color: '#6d8fc7',
  },
  clothing: {
    id: 'clothing', name: '의류', tier: 'consumer', unit: '벌', refPrice: 35000, perCapitaDaily: 0.0022,
    priceElasticity: 1.7, qualityWeight: 1.0, incomeElasticity: 1.0, truckCapacity: 500, freightPerTile: 3,
    outsideAttraction: 0.7, category: 'apparel', color: '#b5537a',
  },
};

export const PRODUCT_IDS = Object.keys(PRODUCTS) as ProductId[];
export const CONSUMER_PRODUCTS: ProductId[] = PRODUCT_IDS.filter((p) => PRODUCTS[p].tier === 'consumer');
