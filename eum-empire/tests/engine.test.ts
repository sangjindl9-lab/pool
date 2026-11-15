import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/engine/commands';
import { incomeOf } from '../src/engine/ledger';
import { advanceDay, newGame, runDays } from '../src/engine/sim';
import { deserializeState, serializeState, SAVE_FORMAT } from '../src/engine/save';
import { tickClock, type ClockState } from '../src/game/clock';
import { checkPlacement } from '../src/engine/map';
import { getBuilding } from '../src/engine/state';
import { BUILDINGS } from '../src/engine/data/buildings';
import type { GameState } from '../src/engine/types';
import { bestSpot, build, checkInvariants, game, seller } from './helpers';

function tutorialGame(seed = 3) {
  // 경쟁사 1곳(20일 이후 활동)만 있는 단순 환경
  return newGame({ seed, mode: 'tutorial', difficulty: 'normal', companyName: '테스트' });
}

function storeWithBread(s: GameState, qty = 200, interval = 1) {
  const store = build(s, 'store');
  const r = applyCommand(s, 'player', { type: 'createContract', seller: { kind: 'external', id: seller(s, 'bread').id }, buyer: { kind: 'building', id: store }, product: 'bread', qty, intervalDays: interval, payment: 'ship', shortage: 'partial' });
  expect(r.ok).toBe(true);
  return store;
}

describe('재고 보존', () => {
  it('구매·배송·판매 과정에서 수량이 보존된다', () => {
    const s = tutorialGame();
    const storeId = storeWithBread(s, 150, 1);
    let shipped = 0, sold = 0;
    for (let d = 0; d < 60; d++) {
      const before = new Set(s.shipments.map((x) => x.id));
      advanceDay(s);
      for (const sh of s.shipments) if (!before.has(sh.id) && sh.product === 'bread' && sh.to.kind === 'building' && sh.to.id === storeId) shipped += sh.qty;
      const st = getBuilding(s, storeId)!;
      const h = st.hist[st.hist.length - 1];
      if (h && h.day === s.day - 1) sold += h.sold.bread ?? 0;
      expect(checkInvariants(s)).toEqual([]);
    }
    const st = getBuilding(s, storeId)!;
    const inTransit = s.shipments.filter((x) => x.to.kind === 'building' && x.to.id === storeId).reduce((a, x) => a + x.qty, 0);
    expect(shipped).toBeGreaterThan(0);
    expect(sold).toBeGreaterThan(0);
    expect((st.inv.bread?.qty ?? 0) + sold + inTransit).toBe(shipped);
  });

  it('생산은 원재료를 레시피만큼 차감하고 완제품을 입고한다', () => {
    const s = tutorialGame();
    const s2 = s; // 같은 상태 사용
    const farm = build(s2, 'wheatFarm', 'own');
    const mill = build(s2, 'mill', 'own');
    applyCommand(s, 'player', { type: 'createContract', seller: { kind: 'building', id: farm }, buyer: { kind: 'building', id: mill }, product: 'wheat', qty: 600, intervalDays: 1, payment: 'ship', shortage: 'partial' });
    let produced = 0, wheatIn = 0;
    for (let d = 0; d < 70; d++) {
      const m = getBuilding(s, mill)!;
      const wheatBefore = m.inv.wheat?.qty ?? 0;
      const flourBefore = m.inv.flour?.qty ?? 0;
      const arriving = s.shipments.filter((x) => x.arriveDay === s.day && x.to.kind === 'building' && x.to.id === mill).reduce((a, x) => a + x.qty, 0);
      advanceDay(s);
      const consumed = wheatBefore + arriving - (m.inv.wheat?.qty ?? 0);
      const made = (m.inv.flour?.qty ?? 0) - flourBefore;
      expect(consumed * 2).toBe(made * 3); // 밀 3 → 밀가루 2
      expect(made).toBeLessThanOrEqual(BUILDINGS.mill.recipe!.batchesPerDay * 2);
      produced += made;
      wheatIn += arriving;
      expect(checkInvariants(s)).toEqual([]);
    }
    expect(wheatIn).toBeGreaterThan(0);
    expect(produced).toBeGreaterThan(0);
  });

  it('원재료가 없으면 생산되지 않는다', () => {
    const s = tutorialGame();
    const bakery = build(s, 'bakery', 'own');
    runDays(s, 40);
    const b = getBuilding(s, bakery)!;
    expect(b.inv.bread?.qty ?? 0).toBe(0);
    expect(b.hist.slice(-5).every((h) => h.limit === 'input')).toBe(true);
  });
});

describe('회계', () => {
  it('매입 시 현금은 줄지만 매출원가는 판매 시에만 반영된다', () => {
    const s = tutorialGame();
    const store = build(s, 'store');
    runDays(s, 12); // 완공
    const me = s.companies[0];
    const cogs0 = me.ledger.cogs, cash0 = me.ledger.cash;
    applyCommand(s, 'player', { type: 'setListing', buildingId: store, product: 'bread', enabled: false });
    applyCommand(s, 'player', { type: 'createContract', seller: { kind: 'external', id: seller(s, 'bread').id }, buyer: { kind: 'building', id: store }, product: 'bread', qty: 300, intervalDays: 30, payment: 'ship', shortage: 'partial' });
    advanceDay(s);
    expect(me.ledger.cash).toBeLessThan(cash0);
    expect(me.ledger.cogs).toBe(cogs0); // 아직 판매 안 함
    expect(me.ledger.inTransit).toBeGreaterThan(0);
    runDays(s, 3);
    expect(me.ledger.inventory).toBeGreaterThan(0);
    expect(me.ledger.cogs).toBe(cogs0);
    applyCommand(s, 'player', { type: 'setListing', buildingId: store, product: 'bread', enabled: true });
    runDays(s, 3);
    expect(me.ledger.cogs).toBeGreaterThan(cogs0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('대출 실행·상환은 수익·비용이 아니다', () => {
    const s = tutorialGame();
    const me = s.companies[0];
    const rev0 = me.ledger.revenue, cash0 = me.ledger.cash;
    const r = applyCommand(s, 'player', { type: 'takeLoan', amount: 100_000_000, termMonths: 12 });
    expect(r.ok).toBe(true);
    expect(me.ledger.cash).toBe(cash0 + 100_000_000);
    expect(me.ledger.revenue).toBe(rev0);
    expect(me.ledger.otherIncome).toBe(0);
    expect(-me.ledger.loans).toBe(100_000_000);
    expect(incomeOf(me.month.delta).net).toBe(0);
    const loanId = me.loans[0].id;
    applyCommand(s, 'player', { type: 'repayLoan', loanId, amount: 40_000_000 });
    expect(-me.ledger.loans).toBe(60_000_000);
    expect(incomeOf(me.month.delta).net).toBe(0);
    expect(me.month.cf.operating).toBe(0); // 대출·상환은 재무활동 현금흐름
    runDays(s, 30); // 월말 이자: 비용, 원금: 비용 아님
    const m = me.history[me.history.length - 1];
    expect((m.delta.interest ?? 0)).toBeGreaterThan(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('건물 건설은 비용이 아니라 자산이며 한도 초과 대출은 거절된다', () => {
    const s = tutorialGame();
    const me = s.companies[0];
    build(s, 'store', 'own');
    expect(me.ledger.buildings).toBe(BUILDINGS.store.constructionCost);
    expect(me.ledger.land).toBeGreaterThan(0);
    expect(incomeOf(me.month.delta).opex).toBe(0);
    const r = applyCommand(s, 'player', { type: 'takeLoan', amount: 50_000_000_000, termMonths: 12 });
    expect(r.ok).toBe(false);
  });
});

describe('수요와 판매', () => {
  it('재고가 없으면 판매할 수 없다', () => {
    const s = tutorialGame();
    const store = build(s, 'store');
    runDays(s, 30);
    const b = getBuilding(s, store)!;
    expect(b.hist.every((h) => (h.sold.bread ?? 0) === 0 && (h.sold.clothing ?? 0) === 0)).toBe(true);
    expect(s.companies[0].ledger.revenue).toBe(0);
  });

  it('판매량은 재고 이하, 총판매량은 지역 총수요 이하', () => {
    const s = game(11);
    storeWithBread(s, 400, 1);
    for (let d = 0; d < 200; d++) {
      const stocks = new Map(s.buildings.filter((b) => b.type === 'store').map((b) => [b.id, (b.inv.bread?.qty ?? 0)]));
      const arrivals = new Map<number, number>();
      for (const sh of s.shipments) if (sh.arriveDay === s.day && sh.to.kind === 'building' && sh.product === 'bread') arrivals.set(sh.to.id, (arrivals.get(sh.to.id) ?? 0) + sh.qty);
      advanceDay(s);
      const md = s.market.bread![s.market.bread!.length - 1];
      expect(md.sold).toBeLessThanOrEqual(md.potential);
      for (const b of s.buildings.filter((q) => q.type === 'store')) {
        const h = b.hist[b.hist.length - 1];
        if (!h || h.day !== s.day - 1 || !stocks.has(b.id)) continue;
        expect(h.sold.bread ?? 0).toBeLessThanOrEqual(stocks.get(b.id)! + (arrivals.get(b.id) ?? 0));
      }
    }
  });

  it('가격만 올리면 판매량이 늘지 않는다(가격 인상 → 판매 감소)', () => {
    const results: number[] = [];
    for (const price of [2500, 3000, 3600, 4500]) {
      const s = tutorialGame(5);
      const store = storeWithBread(s, 1000, 1);
      runDays(s, 14);
      applyCommand(s, 'player', { type: 'setPrice', buildingId: store, product: 'bread', price });
      runDays(s, 14);
      const b = getBuilding(s, store)!;
      results.push(b.hist.slice(-10).reduce((a, h) => a + (h.sold.bread ?? 0), 0));
    }
    for (let i = 1; i < results.length; i++) expect(results[i]).toBeLessThan(results[i - 1]);
  });

  it('경쟁사의 가격 인하는 플레이어 판매를 줄인다', () => {
    const run = (rivalPrice: number) => {
      const s = tutorialGame(9);
      storeWithBread(s, 1000, 1);
      // 같은 자리 근처에 경쟁사 매장을 같은 규칙으로 건설
      const rival = s.companies[1];
      rival.ai = null; // 자동 판단 끔(가격 고정 실험)
      const spot = bestSpot(s, 'store');
      const r = applyCommand(s, rival.id, { type: 'build', building: 'store', x: spot.x, y: spot.y, tenure: 'lease' });
      expect(r.ok).toBe(true);
      applyCommand(s, rival.id, { type: 'createContract', seller: { kind: 'external', id: seller(s, 'bread').id }, buyer: { kind: 'building', id: r.id! }, product: 'bread', qty: 1000, intervalDays: 1, payment: 'ship', shortage: 'partial' });
      applyCommand(s, rival.id, { type: 'setPrice', buildingId: r.id!, product: 'bread', price: rivalPrice });
      runDays(s, 30);
      const me = s.buildings.find((b) => b.owner === 'player' && b.type === 'store')!;
      return me.hist.slice(-10).reduce((a, h) => a + (h.sold.bread ?? 0), 0);
    };
    expect(run(2200)).toBeLessThan(run(3400));
  });

  it('품절 매장의 미충족 수요 일부가 다른 매장으로 이동한다', () => {
    const run = (rivalStocked: boolean) => {
      const s = tutorialGame(9);
      storeWithBread(s, 1000, 1);
      const rival = s.companies[1];
      rival.ai = null;
      const spot = bestSpot(s, 'store');
      const r = applyCommand(s, rival.id, { type: 'build', building: 'store', x: spot.x, y: spot.y, tenure: 'lease' });
      if (rivalStocked) applyCommand(s, rival.id, { type: 'createContract', seller: { kind: 'external', id: seller(s, 'bread').id }, buyer: { kind: 'building', id: r.id! }, product: 'bread', qty: 1000, intervalDays: 1, payment: 'ship', shortage: 'partial' });
      runDays(s, 30);
      const me = s.buildings.find((b) => b.owner === 'player' && b.type === 'store')!;
      return me.hist.slice(-10).reduce((a, h) => a + (h.sold.bread ?? 0), 0);
    };
    // 경쟁 매장이 텅 비어 있으면(품절) 그 수요 일부가 내 매장으로 넘어와 판매가 더 많다
    expect(run(false)).toBeGreaterThan(run(true));
  });
});

describe('재현성·저장', () => {
  const script = (s: GameState) => {
    if (s.day === 0) storeWithBread(s, 300, 2);
    if (s.day === 40) {
      const st = s.buildings.find((b) => b.owner === 'player' && b.type === 'store')!;
      applyCommand(s, 'player', { type: 'setPrice', buildingId: st.id, product: 'bread', price: 3300 });
    }
    if (s.day === 70) applyCommand(s, 'player', { type: 'takeLoan', amount: 50_000_000, termMonths: 24 });
  };

  it('같은 시드와 입력은 같은 결과를 만든다', () => {
    const a = game(77), b = game(77);
    for (let d = 0; d < 150; d++) { script(a); advanceDay(a); script(b); advanceDay(b); }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('시간 배속에 따라 같은 기간의 결과가 달라지지 않는다', () => {
    const runWithSpeed = (pattern: (0 | 1 | 2 | 4)[]) => {
      const s = game(77);
      const clock: ClockState = { speed: 1, fraction: 0 };
      let frame = 0;
      script(s);
      while (s.day < 150) {
        clock.speed = pattern[frame % pattern.length];
        const days = tickClock(clock, 16.7);
        for (let i = 0; i < days && s.day < 150; i++) { advanceDay(s); script(s); }
        frame++;
      }
      return JSON.stringify(s);
    };
    const r1 = runWithSpeed([1]);
    const r4 = runWithSpeed([4]);
    const mixed = runWithSpeed([2, 0, 4, 1, 4, 4, 0, 2]);
    expect(r4).toBe(r1);
    expect(mixed).toBe(r1);
  });

  it('저장·불러오기 전후 핵심 상태가 같고 이후 진행도 같다', () => {
    const a = game(5);
    for (let d = 0; d < 120; d++) { script(a); advanceDay(a); }
    expect(a.shipments.length + a.contracts.length).toBeGreaterThan(0);
    const text = serializeState(a, 'slot1', 1);
    const loaded = deserializeState(text);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const b = loaded.state;
    expect(b.companies[0].ledger.cash).toBe(a.companies[0].ledger.cash);
    expect(JSON.stringify(b.shipments)).toBe(JSON.stringify(a.shipments));
    expect(JSON.stringify(b.contracts)).toBe(JSON.stringify(a.contracts));
    expect(JSON.stringify(b.buildings.map((x) => x.inv))).toBe(JSON.stringify(a.buildings.map((x) => x.inv)));
    expect(b.rng).toBe(a.rng);
    for (let d = 0; d < 120; d++) { advanceDay(a); advanceDay(b); }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('잘못된 파일·미래 버전은 거부, 이전 버전은 변환한다', () => {
    expect(deserializeState('not json').ok).toBe(false);
    expect(deserializeState(JSON.stringify({ hello: 1 })).ok).toBe(false);
    const a = game(5);
    const file = JSON.parse(serializeState(a, 's', 1));
    expect(deserializeState(JSON.stringify({ ...file, saveVersion: 99 })).ok).toBe(false);
    const old = { ...file, saveVersion: 0, checksum: undefined, state: { ...file.state } };
    delete old.state.demandCarry;
    const r = deserializeState(JSON.stringify(old));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.migratedFrom).toBe(0); expect(r.state.demandCarry).toEqual({}); }
    const broken = { ...file, state: { ...file.state, companies: file.state.companies.map((c: any, i: number) => i === 0 ? { ...c, ledger: { ...c.ledger, cash: c.ledger.cash + 1 } } : c) } };
    const br = deserializeState(JSON.stringify(broken));
    expect(br.ok).toBe(false);
    expect(file.format).toBe(SAVE_FORMAT);
  });
});

describe('경쟁사 제약', () => {
  it('경쟁사도 현금이 없으면 건설할 수 없다', () => {
    const s = game(3);
    const ai = s.companies[1];
    ai.ledger.capital += ai.ledger.cash; ai.ledger.cash = 0; // 대차를 유지한 채 현금 0으로
    const spot = bestSpot(s, 'store');
    const r = applyCommand(s, ai.id, { type: 'build', building: 'store', x: spot.x, y: spot.y, tenure: 'lease' });
    expect(r.ok).toBe(false);
  });

  it('1년 동안 경쟁사도 원장 불변식·생산능력·배치 규칙을 지킨다', () => {
    const s = game(21);
    for (let d = 0; d < 360; d++) {
      advanceDay(s);
      expect(checkInvariants(s)).toEqual([]);
      for (const b of s.buildings) {
        const def = BUILDINGS[b.type];
        const h = b.hist[b.hist.length - 1];
        if (def.recipe && h && h.day === s.day - 1) expect(h.produced).toBeLessThanOrEqual(def.recipe.batchesPerDay * def.recipe.outputQty);
      }
    }
    // 건물끼리 겹치지 않음
    for (const a of s.buildings) for (const b of s.buildings) {
      if (a.id >= b.id) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap).toBe(false);
    }
    expect(s.buildings.filter((b) => b.owner !== 'player' && b.type !== 'hq').length).toBeGreaterThan(3);
  });

  it('배치 검사: 도로 위·구역 불일치·중복은 거절', () => {
    const s = game(3);
    expect(checkPlacement(s, 'store', 0, 0, 'lease').ok).toBe(false); // 도로
    const hq = s.buildings[0];
    expect(checkPlacement(s, 'store', hq.x, hq.y, 'lease').ok).toBe(false); // 중복
    const spot = bestSpot(s, 'mill', 'own');
    expect(checkPlacement(s, 'store', spot.x, spot.y, 'lease').ok).toBe(false); // 공업지역에 매장 불가
  });
});

describe('파산', () => {
  it('현금 부족이 30일 이어지면 파산하여 게임이 끝난다', () => {
    const s = tutorialGame();
    const me = s.companies[0];
    // 자본금보다 큰 마케팅 지출로 현금을 음수로 만든다
    applyCommand(s, 'player', { type: 'setMarketing', product: 'bread', monthly: 1_500_000_000 });
    let warned = false;
    for (let d = 0; d < 120 && !s.gameOver; d++) { advanceDay(s); if (s.news.some((n) => n.text.startsWith('자금 부족'))) warned = true; }
    expect(warned).toBe(true);
    expect(me.bankrupt).toBe(true);
    expect(s.gameOver?.won).toBe(false);
    expect(checkInvariants(s)).toEqual([]);
  });
});
