// 생산: 원재료를 실제로 차감하고 완제품을 실제로 입고합니다.
// 원가: 투입 재료 원가 + 그날의 가공비(생산 인건비·전력비)를 제품 원가로 자본화. 생산이 0이면 가공비는 당기 비용.
import { BALANCE } from './data/balance';
import { BUILDINGS } from './data/buildings';
import { PRODUCTS, type ProductId } from './data/products';
import { addStock, freeSpace, invQty, removeStock } from './inventory';
import { postEntry } from './ledger';
import { roundWon } from './money';
import { getCompany, todayStat } from './state';
import type { Building, Company, GameState } from './types';

export function techQuality(company: Company, product: ProductId, isFarm: boolean): number {
  const lvl = company.research.level[PRODUCTS[product].category];
  const base = isFarm ? BALANCE.quality.farmBase : BALANCE.quality.baseTech;
  return Math.min(100, base + lvl * BALANCE.research.qualityPerLevel);
}

export interface ProductionPlan {
  batches: number;
  maxBatches: number;
  limit: null | 'input' | 'space' | 'utilization';
  wages: number;
  power: number;
}

export function planProduction(b: Building): ProductionPlan {
  const def = BUILDINGS[b.type];
  const r = def.recipe!;
  const maxBatches = r.batchesPerDay;
  const utilCap = Math.floor((maxBatches * b.utilization) / 100);
  let inputCap = Infinity;
  let netPerBatch = r.outputQty;
  for (const [p, need] of Object.entries(r.inputs) as [ProductId, number][]) {
    inputCap = Math.min(inputCap, Math.floor(invQty(b, p) / need));
    netPerBatch -= need;
  }
  const spaceCap = netPerBatch > 0 ? Math.floor(freeSpace(b) / netPerBatch) : Infinity;
  const batches = Math.max(0, Math.min(utilCap, inputCap, spaceCap));
  let limit: ProductionPlan['limit'] = null;
  if (batches < maxBatches) {
    if (batches === inputCap && inputCap < utilCap) limit = 'input';
    else if (batches === spaceCap && spaceCap < utilCap) limit = 'space';
    else if (b.utilization < 100) limit = 'utilization';
  }
  const wages = roundWon(def.workers * BALANCE.wages.factoryPerDay * (0.4 + (0.6 * b.utilization) / 100));
  const power = roundWon(def.powerPerDay * (0.2 + (0.8 * batches) / maxBatches));
  return { batches, maxBatches, limit, wages, power };
}

/** 하루 처리 4단계: 공장·농장 생산 */
export function processProduction(state: GameState): void {
  for (const b of state.buildings) {
    const def = BUILDINGS[b.type];
    if (!def.recipe || b.status !== 'active') continue;
    const company = getCompany(state, b.owner);
    if (company.bankrupt) continue;
    const plan = planProduction(b);
    const stat = todayStat(state, b);
    stat.limit = plan.limit;
    const r = def.recipe;
    const conversion = plan.wages + plan.power;
    if (plan.batches <= 0) {
      postEntry(state, company, `${b.name} 유휴 가동비`, [
        { account: 'wages', amount: plan.wages }, { account: 'utilities', amount: plan.power }, { account: 'cash', amount: -conversion },
      ], { cf: 'operating', buildingId: b.id });
      continue;
    }
    let material = 0;
    let qSum = 0, qWeight = 0;
    for (const [p, need] of Object.entries(r.inputs) as [ProductId, number][]) {
      const { cost, quality } = removeStock(b, p, need * plan.batches);
      material += cost;
      qSum += quality * need;
      qWeight += need;
    }
    const outQty = r.outputQty * plan.batches;
    const tech = techQuality(company, r.output, def.kind === 'farm');
    const quality = qWeight > 0
      ? (qSum / qWeight) * BALANCE.quality.inputWeight + tech * (1 - BALANCE.quality.inputWeight)
      : tech;
    addStock(b, r.output, outQty, material + conversion, quality);
    // 재료 원가는 재고 내부 이동(순증 0), 가공비만 현금 → 재고
    postEntry(state, company, `${b.name} 생산 ${PRODUCTS[r.output].name} ${outQty} (가공비 자본화)`, [
      { account: 'inventory', amount: conversion }, { account: 'cash', amount: -conversion },
    ], { cf: 'operating', buildingId: b.id });
    stat.produced = outQty;
  }
}
