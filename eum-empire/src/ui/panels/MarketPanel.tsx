import { useState } from 'react';
import { CONSUMER_PRODUCTS, PRODUCTS, type ProductId } from '../../engine/data/products';
import { districtDemand, marketShare } from '../../engine/demand';
import { externalPrice } from '../../engine/market';
import type { OverlayMode } from '../../game/controller';
import { Legend, LineChart, ShareBar } from '../charts';
import { num, pct } from '../format';
import { useGame } from '../hooks';

export function MarketPanel() {
  const ctrl = useGame();
  const s = ctrl.state!;
  const [p, setP] = useState<ProductId>(ctrl.panelArg?.product && CONSUMER_PRODUCTS.includes(ctrl.panelArg.product) ? ctrl.panelArg.product : 'bread');
  const m = marketShare(s, p, 30);
  const days = (s.market[p] ?? []).slice(-60);
  const stores = s.buildings.filter((b) => b.type === 'store' && b.status === 'active' && b.listings[p]?.enabled);
  const potentialDaily = s.districts.reduce((a, d) => a + districtDemand(d, p), 0);
  return (
    <>
      <div className="row">
        <div className="seg">{CONSUMER_PRODUCTS.map((x) => <button key={x} className={p === x ? 'on' : ''} onClick={() => setP(x)}>{PRODUCTS[x].name}</button>)}</div>
        <button onClick={() => { ctrl.setOverlay(`demand:${p}` as OverlayMode); ctrl.openPanel(null); }}>지도에 {PRODUCTS[p].name} 수요 표시</button>
        <button onClick={() => { ctrl.setOverlay('land'); ctrl.openPanel(null); }}>지도에 지가 표시</button>
      </div>
      <div className="kpis">
        <div><span>도시 잠재 수요(하루)</span><b>{num(potentialDaily)}{PRODUCTS[p].unit}</b></div>
        <div><span>최근 30일 판매</span><b>{num(m.sold)}</b></div>
        <div><span>시장 포착률</span><b>{m.potential ? pct(m.sold / m.potential) : '-'}</b></div>
        <div><span>기준 가격</span><b>{num(PRODUCTS[p].refPrice)}원</b></div>
        <div><span>가격 민감도</span><b>{PRODUCTS[p].priceElasticity}</b></div>
        <div><span>품질 중요도</span><b>{PRODUCTS[p].qualityWeight}</b></div>
      </div>
      <h3>회사별 점유율(최근 30일 판매량)</h3>
      <ShareBar parts={s.companies.map((c) => ({ name: c.name, color: c.color, value: m.byCompany[c.id] ?? 0 }))} />
      <div className="chart-box">
        <Legend series={s.companies.map((c) => ({ name: c.name, color: c.color }))} />
        <LineChart money={false} labels={days.map((d) => String(d.day + 1))} series={s.companies.map((c) => ({ name: c.name, color: c.color, values: days.map((d) => d.byCompany[c.id] ?? 0) }))} />
      </div>
      <p className="muted small">잠재 수요 중 매장이 포착하지 못한 몫은 시외 구매·구매 포기로 빠집니다. 가격이 낮고 품질·브랜드·서비스가 좋고 가까울수록 더 많이 포착합니다.</p>
      <div className="two-col">
        <div>
          <h3>매장별 가격 비교 ({stores.length}곳)</h3>
          <table className="grid-table">
            <thead><tr><th>매장</th><th>가격</th><th>품질</th><th>7일 판매</th><th>품절 손실</th></tr></thead>
            <tbody>
              {stores.sort((a, b) => a.listings[p]!.price - b.listings[p]!.price).map((b) => {
                const c = s.companies.find((x) => x.id === b.owner)!;
                const h = b.hist.slice(-7);
                return (
                  <tr key={b.id} onClick={() => { ctrl.openPanel(null); ctrl.navigate({ panel: 'building', buildingId: b.id }); }} className="click">
                    <td><i className="dot" style={{ background: c.color }} />{b.name}</td>
                    <td>{num(b.listings[p]!.price)}원</td>
                    <td>{b.inv[p]?.qty ? Math.round(b.inv[p]!.quality) : '-'}</td>
                    <td>{num(h.reduce((a, x) => a + (x.sold[p] ?? 0), 0))}</td>
                    <td>{num(h.reduce((a, x) => a + (x.lost[p] ?? 0), 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <h3>지역별 특성</h3>
          <table className="grid-table">
            <thead><tr><th>지역</th><th>인구</th><th>소득</th><th>가격민감</th><th>품질선호</th><th>브랜드선호</th><th>하루 수요</th></tr></thead>
            <tbody>
              {[...s.districts].sort((a, b) => districtDemand(b, p) - districtDemand(a, p)).map((d) => (
                <tr key={d.id}><td>{d.name}</td><td>{num(d.population)}</td><td>{d.income.toFixed(2)}</td><td>{d.priceSensitivity.toFixed(2)}</td><td>{d.qualityPref.toFixed(2)}</td><td>{d.brandPref.toFixed(2)}</td><td>{num(districtDemand(d, p))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <h3>외부 도매 시장</h3>
      <table className="grid-table">
        <thead><tr><th>업체</th><th>구분</th><th>상품</th><th>현재 단가</th><th>품질</th><th>재고</th><th>하루 능력</th><th></th></tr></thead>
        <tbody>
          {s.externals.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td><td>{e.role === 'seller' ? '공급' : '매입'}</td><td>{PRODUCTS[e.product].name}</td>
              <td>{num(externalPrice(e))}원</td><td>{e.role === 'seller' ? e.quality : '-'}</td>
              <td>{num(e.stock)} / {num(e.maxStock)}</td><td>{num(e.ratePerDay)}</td>
              <td><button className="link" onClick={() => ctrl.openPanel('supply', { panel: 'supply', externalId: e.id, product: e.product })}>계약 ›</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">외부 공급자의 재고는 모든 회사가 함께 씁니다. 수요가 몰리면 값이 오르고 물량이 부족해집니다.단가는 재고 비율에 따라 매일 변합니다.</p>
    </>
  );
}
