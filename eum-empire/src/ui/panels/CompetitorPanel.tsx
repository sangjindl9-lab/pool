import { STRATEGIES } from '../../engine/ai';
import { BUILDINGS } from '../../engine/data/buildings';
import { CONSUMER_PRODUCTS, PRODUCTS } from '../../engine/data/products';
import { marketShare } from '../../engine/demand';
import { balanceSheet, incomeOf } from '../../engine/ledger';
import { formatDate, formatWon, pct, signClass } from '../format';
import { useGame } from '../hooks';

export function CompetitorPanel() {
  const ctrl = useGame();
  const s = ctrl.state!;
  const shares = Object.fromEntries(CONSUMER_PRODUCTS.map((p) => [p, marketShare(s, p, 30)]));
  return (
    <>
      <table className="grid-table">
        <thead><tr><th>회사</th><th>전략</th><th>매장</th><th>공장·농장</th><th>지난달 매출</th><th>지난달 순이익</th><th>순자산</th><th>차입금</th>{CONSUMER_PRODUCTS.map((p) => <th key={p}>{PRODUCTS[p].name} 점유율</th>)}<th>상태</th></tr></thead>
        <tbody>
          {s.companies.map((c) => {
            const last = c.history[c.history.length - 1];
            const inc = last ? incomeOf(last.delta) : null;
            const bs = balanceSheet(c);
            const bl = s.buildings.filter((b) => b.owner === c.id);
            return (
              <tr key={c.id}>
                <td><i className="dot" style={{ background: c.color }} /><b>{c.name}</b>{c.isPlayer ? ' (나)' : ''}</td>
                <td>{c.ai ? STRATEGIES[c.ai.strategy].label : '플레이어'}</td>
                <td>{bl.filter((b) => b.type === 'store').length}</td>
                <td>{bl.filter((b) => BUILDINGS[b.type].recipe).map((b) => BUILDINGS[b.type].name).join(', ') || '-'}</td>
                <td>{inc ? formatWon(inc.revenue) : '-'}</td>
                <td className={signClass(inc?.net ?? 0)}>{inc ? formatWon(inc.net) : '-'}</td>
                <td>{formatWon(bs.equity)}</td>
                <td>{formatWon(-c.ledger.loans)}</td>
                {CONSUMER_PRODUCTS.map((p) => <td key={p}>{shares[p].sold ? pct((shares[p].byCompany[c.id] ?? 0) / shares[p].sold) : '-'}</td>)}
                <td>{c.bankrupt ? <span className="neg">파산</span> : c.negativeCashDays > 0 ? <span className="neg">자금난</span> : '정상'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">경쟁사는 플레이어와 같은 규칙(현금, 대출 한도, 공급자 재고, 생산능력, 배치 제한)으로 움직입니다. 재무 수치는 공시 정보로 공개됩니다.</p>
      <div className="two-col">
        {s.companies.filter((c) => c.ai).map((c) => (
          <div key={c.id} className="product-card">
            <div className="pc-head"><b style={{ color: c.color }}>{c.name}</b><span>{STRATEGIES[c.ai!.strategy].label}</span></div>
            <p className="small">최근 판단: {c.ai!.plan || '-'}</p>
            <ul className="newslist">
              {s.news.filter((n) => n.companyId === c.id).slice(-8).reverse().map((n) => <li key={n.id}><small>{formatDate(n.day)}</small> {n.text}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
