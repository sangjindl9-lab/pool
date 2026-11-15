import { useEffect, useState } from 'react';
import { BUILDABLE_TYPES, BUILDINGS } from '../../engine/data/buildings';
import { BALANCE } from '../../engine/data/balance';
import { ZONE_LABEL } from '../../engine/map';
import { player } from '../../engine/state';
import { useGame } from '../hooks';
import { formatWon, num } from '../format';

const ICON: Record<string, string> = { store: '🏪', warehouse: '📦', mill: '🌾', bakery: '🍞', spinning: '🧵', sewing: '👕', wheatFarm: '🌱', cottonFarm: '☁' };

export function BuildDrawer() {
  const ctrl = useGame();
  const s = ctrl.state!;
  const me = player(s);
  const [tenure, setTenure] = useState<'lease' | 'own'>(ctrl.buildMode?.tenure ?? 'lease');
  useEffect(() => {
    if (ctrl.buildMode && ctrl.buildMode.tenure !== tenure) ctrl.setBuildMode({ ...ctrl.buildMode, tenure });
  }, [tenure]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="drawer">
      <header><h3>건설</h3><button className="x" onClick={() => { ctrl.setBuildMode(null); ctrl.openPanel(null); }}>✕</button></header>
      <div className="seg">
        <button className={tenure === 'lease' ? 'on' : ''} onClick={() => setTenure('lease')}>부지 임차</button>
        <button className={tenure === 'own' ? 'on' : ''} onClick={() => setTenure('own')}>부지 매입</button>
      </div>
      <p className="hint">{tenure === 'lease'
        ? `임차: 초기 비용은 건설비만. 매달 땅값의 ${(BALANCE.map.monthlyLeaseRate * 100).toFixed(1)}%를 임대료로 냅니다(중심가일수록 비쌈).`
        : '매입: 땅값을 한 번에 지불(토지 자산으로 남고 감가상각 없음). 임대료가 없지만 현금이 크게 묶입니다.'}</p>
      <div className="build-list">
        {BUILDABLE_TYPES.map((t) => {
          const d = BUILDINGS[t];
          const active = ctrl.buildMode?.type === t;
          const canAfford = me.ledger.cash >= d.constructionCost;
          return (
            <button key={t} className={`build-item ${active ? 'on' : ''}`} onClick={() => ctrl.setBuildMode(active ? null : { type: t, tenure })}>
              <span className="bi">{ICON[t]}</span>
              <span className="bt"><b>{d.name}</b> <small>{d.w}×{d.h}칸 · {d.zones.map((z) => ZONE_LABEL[z]).join('/')}</small>
                <small>{d.description}</small>
                <small>건설비 <b className={canAfford ? '' : 'neg'}>{formatWon(d.constructionCost)}</b> · {d.constructionDays}일 · 유지비 하루 {num(d.maintenancePerDay)}원{d.workers ? ` · 인력 ${d.workers}명` : ''}</small>
              </span>
            </button>
          );
        })}
      </div>
      {ctrl.buildMode && <p className="hint strong">지도에서 위치를 고르세요. 초록색이면 건설 가능, 빨간색이면 이유가 표시됩니다. [지도 표시]로 수요·지가를 확인할 수 있습니다.</p>}
    </div>
  );
}
