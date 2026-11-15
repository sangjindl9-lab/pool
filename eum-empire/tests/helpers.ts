import { applyCommand } from '../src/engine/commands';
import { checkPlacement } from '../src/engine/map';
import { catchmentAt } from '../src/engine/demand';
import { newGame } from '../src/engine/sim';
import type { GameState } from '../src/engine/types';
import type { BuildingType } from '../src/engine/data/buildings';
import { ALL_ACCOUNTS, trialBalance } from '../src/engine/ledger';

export function game(seed = 42, mode: 'free' | 'tutorial' = 'free') {
  return newGame({ seed, mode, difficulty: 'normal', companyName: '테스트상사' });
}

/** 수요가 가장 큰 유효 부지 */
export function bestSpot(s: GameState, type: BuildingType, tenure: 'own' | 'lease' = 'lease') {
  let best: { x: number; y: number; score: number } | null = null;
  for (let y = 0; y < s.map.size; y++) for (let x = 0; x < s.map.size; x++) {
    const c = checkPlacement(s, type, x, y, tenure);
    if (!c.ok) continue;
    const score = type === 'store' ? catchmentAt(s, 'bread', x + 1, y + 1) : -c.landCost;
    if (!best || score > best.score) best = { x, y, score };
  }
  return best!;
}

export function build(s: GameState, type: BuildingType, tenure: 'own' | 'lease' = 'lease') {
  const spot = bestSpot(s, type, tenure);
  const r = applyCommand(s, 'player', { type: 'build', building: type, x: spot.x, y: spot.y, tenure });
  if (!r.ok) throw new Error(r.error);
  return r.id!;
}

export function seller(s: GameState, product: string, idx = 0) {
  return s.externals.filter((e) => e.role === 'seller' && e.product === product)[idx];
}

/** 원장 불변식 검사: 대차 합 0, 재고·운송중·건물 계정과 실물 일치 */
export function checkInvariants(s: GameState) {
  const errors: string[] = [];
  for (const c of s.companies) {
    if (trialBalance(c) !== 0) errors.push(`${c.name} 대차합 ${trialBalance(c)}`);
    for (const a of ALL_ACCOUNTS) if (!Number.isInteger(c.ledger[a])) errors.push(`${c.name} ${a} 정수 아님`);
    let inv = 0, capex = 0, dep = 0, land = 0;
    for (const b of s.buildings.filter((q) => q.owner === c.id)) {
      for (const lot of Object.values(b.inv)) {
        inv += lot!.cost;
        if (lot!.qty < 0 || !Number.isInteger(lot!.qty)) errors.push(`${b.name} 재고 수량 ${lot!.qty}`);
        if (lot!.qty === 0 && lot!.cost !== 0) errors.push(`${b.name} 수량0 원가 ${lot!.cost}`);
      }
      capex += b.capex; dep += b.accumDep; if (b.tenure === 'own') land += b.landValue;
    }
    const transit = s.shipments.filter((sh) => sh.holder === c.id).reduce((a, sh) => a + sh.cost, 0);
    const payable = s.shipments.filter((sh) => sh.holder === c.id).reduce((a, sh) => a + sh.payable, 0);
    if (c.ledger.inventory !== inv) errors.push(`${c.name} 재고계정 ${c.ledger.inventory} ≠ 실물 ${inv}`);
    if (c.ledger.inTransit !== transit) errors.push(`${c.name} 운송중 ${c.ledger.inTransit} ≠ ${transit}`);
    if (-c.ledger.payables !== payable) errors.push(`${c.name} 외상 ${-c.ledger.payables} ≠ ${payable}`);
    if (c.ledger.buildings !== capex) errors.push(`${c.name} 건물 ${c.ledger.buildings} ≠ ${capex}`);
    if (-c.ledger.accumDep !== dep) errors.push(`${c.name} 감가누계 ${-c.ledger.accumDep} ≠ ${dep}`);
    if (c.ledger.land !== land) errors.push(`${c.name} 토지 ${c.ledger.land} ≠ ${land}`);
    const loans = c.loans.reduce((a, l) => a + l.remaining, 0);
    if (-c.ledger.loans !== loans) errors.push(`${c.name} 차입금 ${-c.ledger.loans} ≠ ${loans}`);
  }
  return errors;
}
