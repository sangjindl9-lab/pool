// 경제 계수 데이터. 플레이 테스트에 따라 이 파일만 조정하면 됩니다.
export const BALANCE = {
  calendar: {
    daysPerMonth: 30,
    monthsPerYear: 12,
    startYear: 2027,
  },
  map: {
    size: 48,
    /** 도로 간격(칸). i % roadEvery === 0 인 행·열이 도로 */
    roadEvery: 6,
    /** 지가: 중심부 칸당 가격, 외곽 칸당 가격(원) */
    landPriceCenter: 30_000_000,
    landPriceEdge: 3_000_000,
    /** 월 임대료 = 땅값 × 이 비율 */
    monthlyLeaseRate: 0.025,
    /** 본사는 건물 일부 층만 임차: 임대료 = 땅값 기준 임대료 × 이 비율 */
    hqLeaseShare: 0.3,
  },
  demand: {
    /** 상권 접근성 거리 감쇠 길이(칸). 거리 L 마다 매력도 1/e */
    distanceDecay: 9,
    /** 품절 매장 미충족 수요 중 다른 매장으로 이동하는 비율 */
    spillFraction: 0.55,
    /** 매장 간 이동 시 거리 감쇠(칸) */
    spillDecay: 12,
    /** 브랜드 인지도 100일 때 최대 매력도 가산(× 지역 브랜드 선호) */
    brandMaxBonus: 0.6,
    /** 서비스 수준(직원 등급 1~3) 매력도 배수 */
    serviceFactor: [0.82, 1.0, 1.14] as const,
    /** 서비스 수준별 직원 수 */
    staffByLevel: [2, 3, 4] as const,
    /** 품질 기준점. 이보다 높으면 가산, 낮으면 감산 */
    qualityPivot: 50,
  },
  wages: {
    retailPerDay: 55_000,
    factoryPerDay: 90_000,
    officePerDay: 110_000,
  },
  logistics: {
    /** 트럭 1대 출발 고정비 */
    truckFixed: 20_000,
    /** 운송 소요일 = 1 + floor(거리 / 이 값) */
    tilesPerDay: 28,
    warehouseDiscount: 0.3,
  },
  market: {
    /** 외부 공급자 가격: 기준가 × (1 + scarcity × (1 - 재고비율)) */
    sellerScarcity: 0.35,
    /** 외부 매입처 가격: 기준가 × (1 - glut × 재고비율) */
    buyerGlut: 0.35,
    /** 계약 최소 유지일. 이전에 해지하면 위약금 */
    bulkDiscountSmall: 0.05,
    bulkDiscountLarge: 0.09,
    minContractDays: 30,
    cancelPenaltyRate: 0.2,
  },
  marketing: {
    /** 하루 1원당 인지도 상승 계수(인구 10만 기준) */
    gainPerWon: 0.0000009,
    /** 하루 인지도 감쇠율 */
    decay: 0.004,
  },
  research: {
    /** 품질 연구 1단계 비용(단계마다 증가) */
    baseCost: 60_000_000,
    costGrowth: 1.6,
    days: 30,
    qualityPerLevel: 8,
    maxLevel: 5,
  },
  quality: {
    /** 생산 품질 = 투입 품질 × inputWeight + (기술 품질) × (1 - inputWeight) */
    inputWeight: 0.5,
    baseTech: 45,
    farmBase: 50,
  },
  finance: {
    baseRate: 0.055,
    /** 부채비율에 따른 가산금리 */
    leveragePremium: 0.08,
    /** 대출 한도 = 순자산 × equityMultiple + 담보(토지·건물 장부가) × collateralRate - 기존 대출 */
    equityMultiple: 0.6,
    collateralRate: 0.5,
    /** 당좌대월(현금 음수) 연이율 */
    overdraftRate: 0.24,
    /** 현금이 음수인 상태가 이 일수 이상 지속되면 파산 */
    bankruptcyGraceDays: 30,
    /** 자산 매각 시 장부가 대비 회수율 */
    buildingSaleRecovery: 0.65,
    landSaleRecovery: 0.9,
    /** 기업가치 = 순자산 + max(0, 최근 3개월 평균 월 순이익) × 이 배수 */
    valueEarningsMultiple: 24,
  },
  difficulty: {
    easy: { capital: 1_000_000_000, aiEvalDays: 10, aiExpansionCash: 500_000_000, aiCapital: 600_000_000, loanRateAdj: -0.01 },
    normal: { capital: 600_000_000, aiEvalDays: 7, aiExpansionCash: 320_000_000, aiCapital: 700_000_000, loanRateAdj: 0 },
    hard: { capital: 400_000_000, aiEvalDays: 5, aiExpansionCash: 240_000_000, aiCapital: 850_000_000, loanRateAdj: 0.015 },
  },
} as const;

export type Difficulty = keyof typeof BALANCE.difficulty;
