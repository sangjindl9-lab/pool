import { useState } from 'react';
import { BALANCE } from '../../engine/data/balance';
import { CONSUMER_PRODUCTS, PRODUCTS, type ProductId } from '../../engine/data/products';
import { researchCost } from '../../engine/commands';
import { player } from '../../engine/state';
import { formatDate, formatWon } from '../format';
import { useGame } from '../hooks';

export function ResearchPanel() {
  const ctrl = useGame();
  const s = ctrl.state!;
  const me = player(s);
  const [budget, setBudget] = useState<Record<string, number>>(() => Object.fromEntries(CONSUMER_PRODUCTS.map((p) => [p, me.marketing[p] ?? 0])));
  const proj = me.research.project;
  return (
    <div className="two-col">
      <div>
        <h3>품질 연구개발</h3>
        <p className="muted small">연구 단계마다 자사 공장·농장 생산품의 기술 품질이 +{BALANCE.research.qualityPerLevel} 오릅니다(최대 {BALANCE.research.maxLevel}단계, 기간 {BALANCE.research.days}일). 외부에서 사 온 상품의 품질에는 영향이 없습니다. 연구비는 착수 시 비용 처리됩니다.</p>
        {proj && <div className="alert info">진행 중: {proj.category === 'food' ? '식품' : '의류'} 연구 — {formatDate(proj.endDay)} 완료 예정 ({proj.endDay - s.day}일 남음)</div>}
        {(['food', 'apparel'] as const).map((cat) => {
          const lvl = me.research.level[cat];
          const cost = researchCost(me, cat);
          return (
            <div key={cat} className="product-card">
              <div className="pc-head"><b>{cat === 'food' ? '식품(밀·밀가루·빵)' : '의류(원면·원단·의류)'}</b><span>현재 {lvl}단계</span></div>
              {lvl >= BALANCE.research.maxLevel ? <p>최고 단계</p> : (
                <button className="primary" disabled={!!proj || me.ledger.cash < cost} onClick={() => ctrl.command({ type: 'startResearch', category: cat }, '연구를 시작했습니다')}>
                  {lvl + 1}단계 연구 착수 ({formatWon(cost)})
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <h3>마케팅(브랜드 인지도)</h3>
        <p className="muted small">월 예산을 매일 나누어 지출합니다. 인지도는 지출에 따라 오르고 매일 조금씩 줄어듭니다. 인지도 100이면 지역 브랜드 선호에 따라 매장 매력도가 최대 +{BALANCE.demand.brandMaxBonus * 100}% 오릅니다.</p>
        {CONSUMER_PRODUCTS.map((p: ProductId) => (
          <div key={p} className="product-card">
            <div className="pc-head"><b>{PRODUCTS[p].name}</b><span>내 인지도 {(me.brand[p] ?? 0).toFixed(1)}</span></div>
            <div className="brand-bars">
              {s.companies.map((c) => (
                <div key={c.id}><span>{c.name}</span><div className="progress small"><div style={{ width: `${c.brand[p] ?? 0}%`, background: c.color }} /></div><small>{(c.brand[p] ?? 0).toFixed(0)}</small></div>
              ))}
            </div>
            <label>월 예산(원)<input type="number" step={1_000_000} min={0} value={budget[p]} onChange={(e) => setBudget({ ...budget, [p]: Math.max(0, Math.round(Number(e.target.value))) })} /></label>
            <button className="primary" onClick={() => ctrl.command({ type: 'setMarketing', product: p, monthly: budget[p] }, `${PRODUCTS[p].name} 마케팅 예산을 ${formatWon(budget[p])}/월로 정했습니다`)}>적용 (현재 {formatWon(me.marketing[p] ?? 0)}/월)</button>
          </div>
        ))}
      </div>
    </div>
  );
}
