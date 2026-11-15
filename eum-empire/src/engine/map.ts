// 도시 생성(시드 기반 결정적), 구역·지가·지역 데이터, 배치 검사, 거리 계산
import { BALANCE } from './data/balance';
import { BUILDINGS, type BuildingType, type Zone } from './data/buildings';
import { makeLocalRng } from './rng';
import { roundWon } from './money';
import type { Building, CityMap, District, GameState, PartyRef } from './types';

export const ZONE_CODE: Record<Zone | 'road', number> = { road: 0, commercial: 1, residential: 2, industrial: 3, rural: 4 };
export const CODE_ZONE: (Zone | 'road')[] = ['road', 'commercial', 'residential', 'industrial', 'rural'];
export const ZONE_LABEL: Record<Zone | 'road', string> = {
  road: '도로', commercial: '상업지역', residential: '주거지역', industrial: '공업지역', rural: '농업지역',
};

const DISTRICT_NAMES = [
  '은하동', '솔빛동', '한결동', '미르동', '가람동', '다온동', '누리동', '하늘동',
  '새봄동', '바름동', '단비동', '온새동', '별빛동', '푸른동', '이음동', '라온동',
];

export const DISTRICT_GRID = 4;
export const TARGET_POPULATION = 150_000;

export function isRoadIndex(i: number): boolean {
  return i % BALANCE.map.roadEvery === 0 && i < BALANCE.map.size - 1;
}

export function generateCity(seed: number): { map: CityMap; districts: District[] } {
  const N = BALANCE.map.size;
  const rnd = makeLocalRng(seed ^ 0x5eed);
  const blocks = Math.ceil(N / BALANCE.map.roadEvery);
  const center = (blocks - 1) / 2;
  // 블록별 구역 결정
  const blockZone: Zone[][] = [];
  for (let by = 0; by < blocks; by++) {
    blockZone.push([]);
    for (let bx = 0; bx < blocks; bx++) {
      const d = Math.max(Math.abs(bx - center), Math.abs(by - center));
      let z: Zone;
      if (d <= 0.5) z = 'commercial';
      else if (d <= 1.5) z = rnd() < 0.45 ? 'commercial' : 'residential';
      else if (d <= 2.5) z = rnd() < 0.12 ? 'commercial' : 'residential';
      else {
        // 외곽: 동·남쪽은 공업, 서·북쪽은 농업
        const east = bx > center, south = by > center;
        if (east && south) z = 'industrial';
        else if (!east && !south) z = 'rural';
        else if (east) z = by < 1 ? 'rural' : 'industrial';
        else z = bx < 1 ? 'rural' : 'industrial';
        if (rnd() < 0.15) z = z === 'industrial' ? 'rural' : 'industrial';
      }
      blockZone[by].push(z);
    }
  }
  const tiles: number[] = new Array(N * N);
  const landPrice: number[] = new Array(N * N);
  const district: number[] = new Array(N * N);
  const zoneMult: Record<Zone, number> = { commercial: 1, residential: 0.7, industrial: 0.32, rural: 0.12 };
  const maxR = Math.hypot(N / 2, N / 2);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const road = isRoadIndex(x) || isRoadIndex(y);
      const bz = blockZone[Math.floor(y / BALANCE.map.roadEvery)][Math.floor(x / BALANCE.map.roadEvery)];
      tiles[i] = road ? 0 : ZONE_CODE[bz];
      const r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / maxR;
      const base = BALANCE.map.landPriceEdge + (BALANCE.map.landPriceCenter - BALANCE.map.landPriceEdge) * Math.pow(1 - r, 1.6);
      const noise = 0.92 + rnd() * 0.16;
      landPrice[i] = road ? 0 : Math.max(500_000, roundWon((base * zoneMult[bz] * noise) / 10_000) * 10_000);
      district[i] = Math.min(DISTRICT_GRID - 1, Math.floor((y / N) * DISTRICT_GRID)) * DISTRICT_GRID +
        Math.min(DISTRICT_GRID - 1, Math.floor((x / N) * DISTRICT_GRID));
    }
  }
  // 지역 인구·특성
  const weights = new Array(DISTRICT_GRID * DISTRICT_GRID).fill(0);
  const sx = new Array(weights.length).fill(0);
  const sy = new Array(weights.length).fill(0);
  for (let i = 0; i < N * N; i++) {
    const w = tiles[i] === 2 ? 1 : tiles[i] === 1 ? 0.3 : tiles[i] === 3 ? 0.03 : tiles[i] === 4 ? 0.02 : 0;
    const d = district[i];
    weights[d] += w;
    sx[d] += w * ((i % N) + 0.5);
    sy[d] += w * (Math.floor(i / N) + 0.5);
  }
  const totalW = weights.reduce((a, b) => a + b, 0);
  const districts: District[] = weights.map((w, id) => {
    const gx = id % DISTRICT_GRID, gy = Math.floor(id / DISTRICT_GRID);
    const centrality = 1 - Math.max(Math.abs(gx - 1.5), Math.abs(gy - 1.5)) / 1.5; // 0(외곽)~1(중심 근처)
    const income = round2(0.75 + centrality * 0.35 + rnd() * 0.35);
    return {
      id,
      name: DISTRICT_NAMES[id],
      cx: w > 0 ? sx[id] / w : (gx + 0.5) * (N / DISTRICT_GRID),
      cy: w > 0 ? sy[id] / w : (gy + 0.5) * (N / DISTRICT_GRID),
      population: Math.round((TARGET_POPULATION * w) / totalW),
      income,
      priceSensitivity: round2(1.35 - (income - 0.75) * 0.7),
      qualityPref: round2(0.6 + (income - 0.75) * 1.1),
      brandPref: round2(0.7 + rnd() * 0.6),
    };
  });
  return { map: { size: N, tiles, landPrice, district }, districts };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function tileZone(map: CityMap, x: number, y: number): Zone | 'road' | null {
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return null;
  return CODE_ZONE[map.tiles[y * map.size + x]];
}

export interface PlacementCheck {
  ok: boolean;
  reasons: string[];
  landCost: number;
  leasePerDay: number;
  constructionCost: number;
  roadAccess: boolean;
}

export function footprintLandCost(map: CityMap, x: number, y: number, w: number, h: number): number {
  let sum = 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    if (i >= 0 && j >= 0 && i < map.size && j < map.size) sum += map.landPrice[j * map.size + i];
  }
  return sum;
}

export function leasePerDayFor(landCost: number): number {
  return roundWon((landCost * BALANCE.map.monthlyLeaseRate) / BALANCE.calendar.daysPerMonth);
}

export function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function hasRoadAccess(map: CityMap, x: number, y: number, w: number, h: number): boolean {
  for (let i = x; i < x + w; i++) {
    if (tileZone(map, i, y - 1) === 'road' || tileZone(map, i, y + h) === 'road') return true;
  }
  for (let j = y; j < y + h; j++) {
    if (tileZone(map, x - 1, j) === 'road' || tileZone(map, x + w, j) === 'road') return true;
  }
  return false;
}

export function checkPlacement(state: GameState, type: BuildingType, x: number, y: number, tenure: 'own' | 'lease'): PlacementCheck {
  const def = BUILDINGS[type];
  const reasons: string[] = [];
  const { map } = state;
  let zoneOk = true;
  let inBounds = true;
  for (let j = y; j < y + def.h; j++) for (let i = x; i < x + def.w; i++) {
    const z = tileZone(map, i, j);
    if (z === null) inBounds = false;
    else if (z === 'road') zoneOk = false;
    else if (!def.zones.includes(z)) zoneOk = false;
  }
  if (!inBounds) reasons.push('지도 범위를 벗어났습니다');
  if (!zoneOk) reasons.push(`${def.zones.map((z) => ZONE_LABEL[z]).join('·')}에만 지을 수 있습니다(도로 위 불가)`);
  const fp = { x, y, w: def.w, h: def.h };
  const clash = state.buildings.find((b) => overlaps(b, fp));
  if (clash) reasons.push(`다른 건물(${clash.name})과 겹칩니다`);
  const roadAccess = inBounds && hasRoadAccess(map, x, y, def.w, def.h);
  if (inBounds && !roadAccess) reasons.push('도로와 맞닿아 있어야 합니다');
  const landCost = inBounds ? footprintLandCost(map, x, y, def.w, def.h) : 0;
  return {
    ok: reasons.length === 0,
    reasons,
    landCost,
    leasePerDay: leasePerDayFor(landCost),
    constructionCost: def.constructionCost + (tenure === 'own' ? landCost : 0),
    roadAccess,
  };
}

export function buildingCenter(b: Pick<Building, 'x' | 'y' | 'w' | 'h'>): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function partyPos(state: GameState, ref: PartyRef): { x: number; y: number } | null {
  if (ref.kind === 'building') {
    const b = state.buildings.find((q) => q.id === ref.id);
    return b ? buildingCenter(b) : null;
  }
  const e = state.externals.find((q) => q.id === ref.id);
  return e ? { x: e.x, y: e.y } : null;
}

/** 도로망 기준 맨해튼 거리(칸) */
export function partyDistance(state: GameState, a: PartyRef, b: PartyRef): number {
  const pa = partyPos(state, a), pb = partyPos(state, b);
  if (!pa || !pb) return 0;
  return Math.round(Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y));
}
