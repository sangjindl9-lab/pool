import { useState } from 'react';
import { BALANCE } from '../../engine/data/balance';
import { creditLimit, loanRate } from '../../engine/finance';
import { ACCOUNT_LABEL, balanceSheet, companyValue, incomeOf, OPEX_ACCOUNTS } from '../../engine/ledger';
import { player } from '../../engine/state';
import type { Account, MonthRecord } from '../../engine/types';
import { Legend, LineChart } from '../charts';
import { formatDate, formatMonth, formatWon, signClass } from '../format';
import { useGame } from '../hooks';

type Tab = 'pl' | 'cf' | 'bs' | 'loans' | 'journal';

export function FinancePanel() {
  const [tab, setTab] = useState<Tab>('pl');
  return (
    <>
      <div className="tabs">
        {([['pl', '월별 손익계산서'], ['cf', '현금흐름'], ['bs', '재무상태표'], ['loans', '대출'], ['journal', '거래 기록']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'pl' && <IncomeStatement />}
      {tab === 'cf' && <CashFlow />}
      {tab === 'bs' && <BalanceSheet />}
      {tab === 'loans' && <Loans />}
      {tab === 'journal' && <Journal />}
    </>
  );
}

function months(): MonthRecord[] {
  const me = player(useGame().state!);
  return [...me.history.slice(-11), me.month];
}

function IncomeStatement() {
  const ms = months();
  const inc = ms.map((m) => incomeOf(m.delta));
  const g = (m: MonthRecord, a: Account) => m.delta[a] ?? 0;
  const label = (m: MonthRecord) => `${formatMonth(m.index)}${m.closed ? '' : '(진행)'}`;
  const row = (name: string, vals: number[], cls = '') => (
    <tr className={cls}><td>{name}</td>{vals.map((v, i) => <td key={i} className={cls.includes('total') ? signClass(v) : ''}>{formatWon(v)}</td>)}</tr>
  );
  return (
    <>
      <div className="chart-box">
        <Legend series={[{ name: '매출', color: '#2f80ed' }, { name: '영업이익', color: '#27ae60' }, { name: '순이익', color: '#e67e22' }]} />
        <LineChart labels={ms.map((m) => formatMonth(m.index))} series={[
          { name: '매출', color: '#2f80ed', values: inc.map((i) => i.revenue) },
          { name: '영업이익', color: '#27ae60', values: inc.map((i) => i.operating) },
          { name: '순이익', color: '#e67e22', values: inc.map((i) => i.net) },
        ]} />
      </div>
      <div className="scroll-x">
        <table className="grid-table fin">
          <thead><tr><th>항목</th>{ms.map((m) => <th key={m.index}>{label(m)}</th>)}</tr></thead>
          <tbody>
            {row('매출', inc.map((i) => i.revenue))}
            {row('매출원가', inc.map((i) => i.cogs))}
            {row('매출총이익', inc.map((i) => i.gross), 'total')}
            {OPEX_ACCOUNTS.map((a) => <tr key={a}><td className="indent">{ACCOUNT_LABEL[a]}</td>{ms.map((m) => <td key={m.index}>{formatWon(g(m, a))}</td>)}</tr>)}
            {row('영업이익', inc.map((i) => i.operating), 'total')}
            {row('영업외수익', ms.map((m) => -g(m, 'otherIncome')))}
            {row('영업외손실', ms.map((m) => g(m, 'otherLoss')))}
            {row('이자비용', ms.map((m) => g(m, 'interest')))}
            {row('순이익', inc.map((i) => i.net), 'total strong')}
          </tbody>
        </table>
      </div>
      <p className="muted small">모든 숫자는 회사 원장의 분개를 월별로 집계한 값입니다. 원재료·상품 매입은 재고자산으로 기록되고 판매될 때 매출원가가 됩니다. 공장 인건비·전력비는 생산이 있으면 제품 원가에 포함됩니다. 건물 건설·토지 매입·대출 원금은 비용이 아닙니다.</p>
    </>
  );
}

function CashFlow() {
  const ms = months();
  const me = player(useGame().state!);
  return (
    <>
      <div className="chart-box">
        <Legend series={[{ name: '월말 현금', color: '#2f80ed' }]} />
        <LineChart labels={ms.map((m) => formatMonth(m.index))} series={[{ name: '월말 현금', color: '#2f80ed', values: ms.map((m) => (m.closed ? m.cashEnd : me.ledger.cash)) }]} />
      </div>
      <table className="grid-table fin">
        <thead><tr><th>구분</th>{ms.map((m) => <th key={m.index}>{formatMonth(m.index)}</th>)}</tr></thead>
        <tbody>
          <tr><td>영업활동(판매 대금, 매입, 운영비, 이자)</td>{ms.map((m) => <td key={m.index} className={signClass(m.cf.operating)}>{formatWon(m.cf.operating)}</td>)}</tr>
          <tr><td>투자활동(건설, 토지, 자산 매각)</td>{ms.map((m) => <td key={m.index} className={signClass(m.cf.investing)}>{formatWon(m.cf.investing)}</td>)}</tr>
          <tr><td>재무활동(자본금, 대출 실행·원금 상환)</td>{ms.map((m) => <td key={m.index} className={signClass(m.cf.financing)}>{formatWon(m.cf.financing)}</td>)}</tr>
          <tr className="total"><td>순현금 증감</td>{ms.map((m) => { const t = m.cf.operating + m.cf.investing + m.cf.financing; return <td key={m.index} className={signClass(t)}>{formatWon(t)}</td>; })}</tr>
          <tr><td>월말 현금</td>{ms.map((m) => <td key={m.index}>{formatWon(m.closed ? m.cashEnd : me.ledger.cash)}</td>)}</tr>
        </tbody>
      </table>
      <p className="muted small">이익과 현금은 다릅니다: 재고를 많이 사 두면 이익은 그대로지만 현금은 줄고, 대출을 받으면 현금은 늘지만 이익은 늘지 않습니다.</p>
    </>
  );
}

function BalanceSheet() {
  const me = player(useGame().state!);
  const l = me.ledger;
  const bs = balanceSheet(me);
  return (
    <div className="two-col">
      <table className="grid-table">
        <thead><tr><th colSpan={2}>자산</th></tr></thead>
        <tbody>
          <tr><td>현금</td><td>{formatWon(l.cash)}</td></tr>
          <tr><td>재고자산</td><td>{formatWon(l.inventory)}</td></tr>
          <tr><td>운송 중 재고</td><td>{formatWon(l.inTransit)}</td></tr>
          <tr><td>토지</td><td>{formatWon(l.land)}</td></tr>
          <tr><td>건물·설비</td><td>{formatWon(l.buildings)}</td></tr>
          <tr><td>감가상각누계액</td><td>{formatWon(l.accumDep)}</td></tr>
          <tr className="total"><td>자산 총계</td><td>{formatWon(bs.assets)}</td></tr>
        </tbody>
      </table>
      <table className="grid-table">
        <thead><tr><th colSpan={2}>부채와 자본</th></tr></thead>
        <tbody>
          <tr><td>외상매입금</td><td>{formatWon(-l.payables)}</td></tr>
          <tr><td>차입금</td><td>{formatWon(-l.loans)}</td></tr>
          <tr className="total"><td>부채 총계</td><td>{formatWon(bs.liabilities)}</td></tr>
          <tr><td>자본금</td><td>{formatWon(bs.capital)}</td></tr>
          <tr><td>이익잉여금(누적 순이익)</td><td className={signClass(bs.retained)}>{formatWon(bs.retained)}</td></tr>
          <tr className="total"><td>자본 총계</td><td>{formatWon(bs.equity)}</td></tr>
          <tr className="total"><td>부채+자본</td><td>{formatWon(bs.liabilities + bs.equity)}</td></tr>
          <tr><td>기업가치(추정)</td><td>{formatWon(companyValue(me))}</td></tr>
        </tbody>
      </table>
      <p className="muted small">기업가치 = 순자산 + 최근 3개월 평균 월 순이익(흑자일 때) × {BALANCE.finance.valueEarningsMultiple}.</p>
    </div>
  );
}

function Loans() {
  const ctrl = useGame();
  const s = ctrl.state!;
  const me = player(s);
  const limit = creditLimit(me);
  const rate = loanRate(s, me);
  const [amount, setAmount] = useState(Math.min(limit, 100_000_000));
  const [term, setTerm] = useState(24);
  const monthlyPrincipal = Math.round(amount / term);
  const firstInterest = Math.round((amount * rate) / 12);
  const lowCash = me.ledger.cash < 30_000_000;
  return (
    <>
      {(lowCash || me.negativeCashDays > 0) && (
        <div className="alert">
          <b>{me.negativeCashDays > 0 ? `현금 부족 ${me.negativeCashDays}일째 — ${BALANCE.finance.bankruptcyGraceDays - me.negativeCashDays}일 안에 회복하지 못하면 파산` : '현금이 얼마 남지 않았습니다'}</b>
          <p>대응: ① 아래에서 추가 대출 ② 적자 건물 매각(건물 상세창 → 매각) ③ 공급 계약 수량 축소 ④ 마케팅·연구 중단 ⑤ 가동률 낮추기</p>
          <div className="row"><button onClick={() => ctrl.openPanel('supply')}>공급 계약 보기</button><button onClick={() => ctrl.openPanel('research')}>마케팅 예산</button><button onClick={() => ctrl.openPanel('company')}>건물 목록</button></div>
        </div>
      )}
      <div className="two-col">
        <div>
          <h3>신규 대출</h3>
          <table className="kv"><tbody>
            <tr><td>대출 한도</td><td><b>{formatWon(limit)}</b> <small className="muted">(순자산 × {BALANCE.finance.equityMultiple} + 토지·건물 담보 × {BALANCE.finance.collateralRate} − 기존 대출)</small></td></tr>
            <tr><td>적용 금리</td><td>연 {(rate * 100).toFixed(2)}% <small className="muted">(부채비율이 높을수록 상승)</small></td></tr>
          </tbody></table>
          <label>금액(원)<input type="number" step={10_000_000} value={amount} onChange={(e) => setAmount(Math.round(Number(e.target.value)))} /></label>
          <label>상환 기간<select value={term} onChange={(e) => setTerm(Number(e.target.value))}>{[12, 24, 36, 60].map((t) => <option key={t} value={t}>{t}개월</option>)}</select></label>
          <p className="small">매달 원금 {formatWon(monthlyPrincipal)} + 이자(첫 달 약 {formatWon(firstInterest)})를 월말에 상환합니다. 대출금은 현금(자산)과 차입금(부채)으로 기록되며 수익이 아닙니다.</p>
          <button className="primary" disabled={amount < 10_000_000 || amount > limit} onClick={() => ctrl.command({ type: 'takeLoan', amount, termMonths: term }, `${formatWon(amount)} 대출을 받았습니다`)}>대출 실행</button>
        </div>
        <div>
          <h3>대출 현황</h3>
          {me.loans.length === 0 && <p className="muted">대출이 없습니다.</p>}
          {me.loans.map((ln) => (
            <div key={ln.id} className="contract">
              <div className="c-head"><b>{formatWon(ln.principal)}</b> · 연 {(ln.annualRate * 100).toFixed(2)}% · {ln.termMonths}개월</div>
              <div className="small">잔액 {formatWon(ln.remaining)} · 상환 {ln.monthsPaid}/{ln.termMonths}회 · 실행 {formatDate(ln.startDay)}</div>
              <div className="row">
                <button disabled={me.ledger.cash < ln.remaining} onClick={() => ctrl.command({ type: 'repayLoan', loanId: ln.id, amount: ln.remaining }, '대출을 전액 상환했습니다')}>전액 조기상환</button>
                <button disabled={me.ledger.cash < 10_000_000} onClick={() => ctrl.command({ type: 'repayLoan', loanId: ln.id, amount: Math.min(ln.remaining, 10_000_000) }, '1,000만원 상환')}>1,000만원 상환</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Journal() {
  const me = player(useGame().state!);
  const rows = me.journal.slice(-120).reverse();
  return (
    <div className="scroll-y">
      <table className="grid-table small">
        <thead><tr><th>날짜</th><th>내용</th><th>분개(차변 + / 대변 −)</th></tr></thead>
        <tbody>
          {rows.map((j) => (
            <tr key={j.id}><td>{formatDate(j.day)}</td><td>{j.memo}</td><td>{j.lines.map((l) => `${ACCOUNT_LABEL[l.account]} ${l.amount > 0 ? '+' : ''}${l.amount.toLocaleString()}`).join(' / ')}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">최근 400건까지 보관합니다. 월별 합계는 전체 기간이 보존됩니다.</p>
    </div>
  );
}
