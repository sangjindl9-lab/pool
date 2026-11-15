import { BUILDINGS } from '../../engine/data/buildings';
import { CONSUMER_PRODUCTS, PRODUCTS } from '../../engine/data/products';
import { marketShare } from '../../engine/demand';
import { diagnoseBuilding } from '../../engine/diagnostics';
import { balanceSheet, companyValue, incomeOf } from '../../engine/ledger';
import { objectiveProgress } from '../../engine/sim';
import { player } from '../../engine/state';
import { formatDate, formatWon, num, pct, signClass } from '../format';
import { useGame } from '../hooks';

export function CompanyPanel() {
  const ctrl = useGame();
  const s = ctrl.state!;
  const me = player(s);
  const bs = balanceSheet(me);
  const last = me.history[me.history.length - 1];
  const lastInc = last ? incomeOf(last.delta) : null;
  const mine = s.buildings.filter((b) => b.owner === me.id);
  const allIssues = mine.flatMap((b) => diagnoseBuilding(s, b).map((i) => ({ ...i, b })));
  allIssues.sort((a, z) => ['high', 'mid', 'low'].indexOf(a.severity) - ['high', 'mid', 'low'].indexOf(z.severity));
  return (
    <>
      <div className="kpis">
        <div><span>현금</span><b className={signClass(me.ledger.cash)}>{formatWon(me.ledger.cash)}</b></div>
        <div><span>순자산</span><b>{formatWon(bs.equity)}</b></div>
        <div><span>기업가치</span><b>{formatWon(companyValue(me))}</b></div>
        <div><span>차입금</span><b>{formatWon(-me.ledger.loans)}</b></div>
        <div><span>지난달 매출</span><b>{lastInc ? formatWon(lastInc.revenue) : '-'}</b></div>
        <div><span>지난달 순이익</span><b className={signClass(lastInc?.net ?? 0)}>{lastInc ? formatWon(lastInc.net) : '-'}</b></div>
        {CONSUMER_PRODUCTS.map((p) => {
          const m = marketShare(s, p, 30);
          return <div key={p}><span>{PRODUCTS[p].name} 점유율(30일)</span><b>{m.sold ? pct((m.byCompany[me.id] ?? 0) / m.sold) : '-'}</b></div>;
        })}
      </div>
      {s.objectives.length > 0 && (
        <>
          <h3>경영 목표</h3>
          <ul className="objectives">
            {s.objectives.map((o) => {
              const prog = Math.min(1, objectiveProgress(s, o));
              return (
                <li key={o.id} className={o.done ? 'done' : ''}>
                  <span>{o.done ? '✅' : '⬜'} {o.label}</span>
                  <div className="progress small"><div style={{ width: `${prog * 100}%` }} /></div>
                  <small>{o.done ? `${formatDate(o.doneDay!)} 달성` : pct(prog, 0)}</small>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <h3>문제와 원인 {allIssues.length > 0 && <small className="muted">({allIssues.length}건)</small>}</h3>
      {allIssues.length === 0 ? <p className="muted">현재 감지된 문제가 없습니다.</p> : (
        <ul className="issues">
          {allIssues.slice(0, 12).map((i, k) => (
            <li key={k} className={i.severity}>
              <span><b>{i.b.name}</b>: {i.text}</span>
              <span className="row">
                <button className="link" onClick={() => { ctrl.openPanel(null); ctrl.navigate({ panel: 'building', buildingId: i.b.id }); }}>건물 ›</button>
                {i.nav && i.nav.panel !== 'building' && <button className="link" onClick={() => ctrl.navigate(i.nav!)}>해결 화면 ›</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3>보유 건물 {mine.length}곳</h3>
      <table className="grid-table">
        <thead><tr><th>이름</th><th>종류</th><th>상태</th><th>최근 7일</th><th>이번 달 영업이익</th><th>지난 달</th><th></th></tr></thead>
        <tbody>
          {mine.map((b) => {
            const h7 = b.hist.slice(-7);
            const def = BUILDINGS[b.type];
            const seven = b.type === 'store' ? `매출 ${formatWon(h7.reduce((a, h) => a + h.revenue, 0))}` : def.recipe ? `생산 ${num(h7.reduce((a, h) => a + h.produced, 0))}` : '-';
            const cur = incomeOf(b.plMonth).operating, prev = b.plLast ? incomeOf(b.plLast).operating : null;
            return (
              <tr key={b.id}>
                <td>{b.name}</td><td>{def.name}</td>
                <td>{b.status === 'active' ? '운영' : `건설 ${b.completeDay - s.day}일 남음`}</td>
                <td>{seven}</td>
                <td className={signClass(cur)}>{formatWon(cur)}</td>
                <td className={signClass(prev ?? 0)}>{prev === null ? '-' : formatWon(prev)}</td>
                <td><button className="link" onClick={() => { ctrl.openPanel(null); ctrl.navigate({ panel: 'building', buildingId: b.id }); }}>보기 ›</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
