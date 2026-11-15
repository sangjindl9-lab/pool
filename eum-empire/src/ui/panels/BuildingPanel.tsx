import { useState } from 'react';
import { BALANCE } from '../../engine/data/balance';
import { BUILDINGS } from '../../engine/data/buildings';
import { PRODUCTS, type ProductId } from '../../engine/data/products';
import { diagnoseBuilding, rivalStats } from '../../engine/diagnostics';
import { dailyFixedCosts, storeStaff } from '../../engine/finance';
import { invQty, totalStored, unitCost } from '../../engine/inventory';
import { ACCOUNT_LABEL, incomeOf } from '../../engine/ledger';
import { externalPrice } from '../../engine/market';
import { planProduction } from '../../engine/production';
import { getBuilding, getExternal, partyName } from '../../engine/state';
import type { Account, Building, GameState } from '../../engine/types';
import { formatWon, num, pct, signClass } from '../format';
import { useGame } from '../hooks';

type Tab = 'overview' | 'sales' | 'production' | 'inventory' | 'contracts' | 'pl';

export function BuildingPanel({ id }: { id: number }) {
  const ctrl = useGame();
  const s = ctrl.state!;
  const b = getBuilding(s, id);
  const def = b ? BUILDINGS[b.type] : null;
  const initial: Tab = ctrl.panelArg?.buildingId === id && ctrl.panelArg.product ? 'sales' : 'overview';
  const [tab, setTab] = useState<Tab>(initial);
  if (!b || !def) return null;
  const owner = s.companies.find((c) => c.id === b.owner)!;
  const mine = owner.isPlayer;
  const progress = b.status === 'active' ? 1 : Math.min(1, (s.day - b.startDay) / Math.max(1, b.completeDay - b.startDay));
  const tabs: [Tab, string][] = [['overview', '개요']];
  if (b.type === 'store') tabs.push(['sales', '가격·판매']);
  if (def.recipe) tabs.push(['production', '생산']);
  if (mine) tabs.push(['inventory', '재고'], ['contracts', '계약'], ['pl', '손익']);
  return (
    <div className="rightpanel">
      <header>
        <div>
          <h3><i className="dot" style={{ background: owner.color }} />{b.name}</h3>
          <small>{def.name} · {owner.name}{mine ? '' : ' (경쟁사)'} · {b.tenure === 'own' ? '부지 소유' : `임차 월 ${formatWon(b.leasePerDay * 30)}`}</small>
        </div>
        <button className="x" onClick={() => ctrl.select(null)}>✕</button>
      </header>
      {b.status === 'construction' && (
        <div className="progress"><div style={{ width: `${progress * 100}%` }} /><span>건설 중 {Math.round(progress * 100)}% · 완공까지 {b.completeDay - s.day}일</span></div>
      )}
      <div className="tabs small">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="rp-body">
        {tab === 'overview' && <Overview s={s} b={b} mine={mine} onPrice={() => setTab('sales')} />}
        {tab === 'sales' && <Sales s={s} b={b} mine={mine} />}
        {tab === 'production' && <Production s={s} b={b} mine={mine} />}
        {tab === 'inventory' && <InventoryTab b={b} />}
        {tab === 'contracts' && <ContractsTab s={s} b={b} />}
        {tab === 'pl' && <PlTab b={b} />}
      </div>
    </div>
  );
}

function Overview({ s, b, mine, onPrice }: { s: GameState; b: Building; mine: boolean; onPrice: () => void }) {
  const ctrl = useGame();
  const def = BUILDINGS[b.type];
  const h7 = b.hist.slice(-7);
  const rev7 = h7.reduce((a, h) => a + h.revenue, 0);
  const issues = mine ? diagnoseBuilding(s, b) : [];
  const fixed = dailyFixedCosts(b);
  const [confirm, setConfirm] = useState(false);
  const netBook = b.capex - b.accumDep;
  const proceeds = Math.round(netBook * BALANCE.finance.buildingSaleRecovery) + (b.tenure === 'own' ? Math.round(b.landValue * BALANCE.finance.landSaleRecovery) : 0);
  return (
    <>
      <p className="muted small">{def.description}</p>
      <table className="kv">
        <tbody>
          {b.type === 'store' && <tr><td>최근 7일 매출</td><td>{formatWon(rev7)}</td></tr>}
          {def.recipe && <tr><td>최근 7일 생산</td><td>{num(h7.reduce((a, h) => a + h.produced, 0))} {PRODUCTS[def.recipe.output].unit}</td></tr>}
          {mine && <tr><td>하루 고정비</td><td>{formatWon(fixed.wages + fixed.rent + fixed.maintenance + fixed.utilities)} <small className="muted">(인건비 {num(fixed.wages)} · 임대 {num(fixed.rent)} · 유지 {num(fixed.maintenance)} · 전력 {num(fixed.utilities)})</small></td></tr>}
          {mine && <tr><td>장부가</td><td>건물 {formatWon(netBook)}{b.tenure === 'own' ? ` · 토지 ${formatWon(b.landValue)}` : ''}</td></tr>}
          <tr><td>보관</td><td>{num(totalStored(b))} / {num(def.storage)}</td></tr>
        </tbody>
      </table>
      {mine && (
        <>
          <h4>문제 진단</h4>
          {b.status !== 'active' ? <p className="muted">건설 중입니다. 완공 전에 공급 계약을 미리 맺어 둘 수 있습니다(완공일부터 출하).</p>
            : issues.length === 0 ? <p className="pos">특별한 문제가 발견되지 않았습니다.</p>
            : <ul className="issues">{issues.map((i, k) => (
              <li key={k} className={i.severity}>
                <span>{i.text}</span>
                {i.nav && <button onClick={() => (i.nav!.panel === 'building' && i.nav!.buildingId === b.id ? onPrice() : ctrl.navigate(i.nav!))} className="link">{navLabel(i.nav!.panel)} ›</button>}
              </li>
            ))}</ul>}
          <div className="row">
            <button onClick={() => ctrl.openPanel('supply', { panel: 'supply', buildingId: b.id })}>공급 계약 관리</button>
            {b.type !== 'hq' && !confirm && <button className="danger" onClick={() => setConfirm(true)}>매각·철거…</button>}
          </div>
          {confirm && (
            <div className="confirm">
              <p>매각 시 회수액 약 <b>{formatWon(proceeds)}</b> (건물 장부가의 {pct(BALANCE.finance.buildingSaleRecovery, 0)}{b.tenure === 'own' ? `, 토지의 ${pct(BALANCE.finance.landSaleRecovery, 0)}` : ''}). 재고는 원가의 50%로 처분, 관련 계약은 종료됩니다. 차액은 영업외손익으로 처리됩니다.</p>
              <div className="row"><button className="danger" onClick={() => { ctrl.command({ type: 'sell', buildingId: b.id }, `${b.name}을(를) 매각했습니다`); ctrl.select(null); }}>매각 확정</button><button onClick={() => setConfirm(false)}>취소</button></div>
            </div>
          )}
        </>
      )}
      {!mine && b.type === 'store' && (
        <p className="muted small">경쟁사 매장의 진열 가격은 [가격·판매] 탭에서 볼 수 있습니다. 재고·원가는 공개되지 않습니다.</p>
      )}
    </>
  );
}

function navLabel(p: string) {
  return ({ supply: '공급망', market: '시장', building: '가격', finance: '재무' } as Record<string, string>)[p] ?? '이동';
}

function Sales({ s, b, mine }: { s: GameState; b: Building; mine: boolean }) {
  const ctrl = useGame();
  const products = Object.keys(b.listings) as ProductId[];
  const [draft, setDraft] = useState<Record<string, string>>({});
  const staffCost = (lvl: number) => BALANCE.demand.staffByLevel[lvl - 1] * BALANCE.wages.retailPerDay;
  return (
    <>
      {products.map((p) => {
        const l = b.listings[p]!;
        const h7 = b.hist.slice(-7);
        const dem = h7.reduce((a, h) => a + (h.demand[p] ?? 0), 0);
        const sold = h7.reduce((a, h) => a + (h.sold[p] ?? 0), 0);
        const lost = h7.reduce((a, h) => a + (h.lost[p] ?? 0), 0);
        const uc = unitCost(b, p);
        const r = rivalStats(s, b, p);
        const val = draft[p] ?? String(l.price);
        return (
          <div key={p} className="product-card">
            <div className="pc-head"><b>{PRODUCTS[p].name}</b>
              {mine && <label className="toggle"><input type="checkbox" checked={l.enabled} onChange={(e) => ctrl.command({ type: 'setListing', buildingId: b.id, product: p, enabled: e.target.checked })} /> 판매</label>}
            </div>
            <table className="kv">
              <tbody>
                <tr><td>판매가</td><td>
                  {mine ? (
                    <span className="price-edit">
                      <input type="number" value={val} step={PRODUCTS[p].refPrice >= 10000 ? 500 : 50} onChange={(e) => setDraft({ ...draft, [p]: e.target.value })} />원
                      <button className="primary" onClick={() => { ctrl.command({ type: 'setPrice', buildingId: b.id, product: p, price: Math.round(Number(val)) }, `${PRODUCTS[p].name} 가격을 ${num(Number(val))}원으로 정했습니다`); setDraft({ ...draft, [p]: '' + Math.round(Number(val)) }); }}>적용</button>
                    </span>
                  ) : <b>{num(l.price)}원</b>}
                </td></tr>
                <tr><td>기준가(시장 평균 기대)</td><td>{num(PRODUCTS[p].refPrice)}원</td></tr>
                {r && <tr><td>주변 경쟁 매장({r.count}곳) 평균</td><td className={l.price > r.avgPrice * 1.08 ? 'neg' : ''}>{num(Math.round(r.avgPrice))}원 · 품질 {Math.round(r.avgQuality)}</td></tr>}
                {mine && <tr><td>재고 / 단위원가</td><td>{num(invQty(b, p))}{PRODUCTS[p].unit} · {uc ? `${num(Math.round(uc))}원 (마진 ${pct((l.price - uc) / l.price, 0)})` : '-'}</td></tr>}
                {mine && <tr><td>품질</td><td>{b.inv[p]?.qty ? Math.round(b.inv[p]!.quality) : '-'}</td></tr>}
                {mine && <tr><td>최근 7일 수요/판매/품절</td><td>{num(dem)} / <b>{num(sold)}</b> / <span className={lost ? 'neg' : ''}>{num(lost)}</span></td></tr>}
              </tbody>
            </table>
          </div>
        );
      })}
      {mine && (
        <div className="product-card">
          <div className="pc-head"><b>서비스 수준(직원)</b></div>
          <div className="seg">
            {[1, 2, 3].map((lvl) => (
              <button key={lvl} className={b.staffLevel === lvl ? 'on' : ''} onClick={() => ctrl.command({ type: 'setStaff', buildingId: b.id, level: lvl as 1 | 2 | 3 })}>
                {['기본', '표준', '고급'][lvl - 1]}<small>{BALANCE.demand.staffByLevel[lvl - 1]}명 · 하루 {num(staffCost(lvl))}원 · 매력도 ×{BALANCE.demand.serviceFactor[lvl - 1]}</small>
              </button>
            ))}
          </div>
          <p className="muted small">현재 직원 {storeStaff(b)}명. 서비스가 높을수록 같은 가격에서 더 많은 손님을 끌어옵니다.</p>
        </div>
      )}
    </>
  );
}

function Production({ s, b, mine }: { s: GameState; b: Building; mine: boolean }) {
  const ctrl = useGame();
  const def = BUILDINGS[b.type];
  const r = def.recipe!;
  const plan = planProduction(b);
  const [util, setUtil] = useState(b.utilization);
  const h7 = b.hist.slice(-7);
  const limitText: Record<string, string> = { input: '원재료 부족', space: '보관 공간 부족', utilization: '가동률 설정', cash: '현금 부족' };
  const inputs = Object.entries(r.inputs) as [ProductId, number][];
  void s;
  return (
    <>
      <p><b>레시피</b>: {inputs.length ? inputs.map(([p, q]) => `${PRODUCTS[p].name} ${q}`).join(' + ') : '토지·노동'} → {PRODUCTS[r.output].name} {r.outputQty} · 최대 하루 {num(r.batchesPerDay * r.outputQty)}{PRODUCTS[r.output].unit}</p>
      {mine && (
        <div className="slider">
          <label>목표 가동률 <b>{util}%</b></label>
          <input type="range" min={0} max={100} step={5} value={util} onChange={(e) => setUtil(Number(e.target.value))} />
          <button className="primary" onClick={() => ctrl.command({ type: 'setUtilization', buildingId: b.id, value: util }, `가동률 ${util}%로 설정`)}>적용</button>
          <p className="muted small">인건비 = 인원 {def.workers}명 × 하루 {num(BALANCE.wages.factoryPerDay)}원 × (40% 고정 + 60% × 가동률). 전력비는 실제 생산량에 비례.</p>
        </div>
      )}
      <table className="kv">
        <tbody>
          <tr><td>오늘 예상 생산</td><td>{num(plan.batches * r.outputQty)} {PRODUCTS[r.output].unit} {plan.limit && <span className="neg">({limitText[plan.limit]})</span>}</td></tr>
          {mine && <tr><td>예상 가공비(하루)</td><td>인건비 {num(plan.wages)} + 전력 {num(plan.power)}원</td></tr>}
          {mine && <tr><td>완제품 단위원가</td><td>{unitCost(b, r.output) ? `${num(Math.round(unitCost(b, r.output)))}원` : '-'} <small className="muted">(재료+가공비)</small></td></tr>}
          {mine && inputs.map(([p]) => <tr key={p}><td>{PRODUCTS[p].name} 재고</td><td>{num(invQty(b, p))} (하루 최대 {num(r.inputs[p]! * r.batchesPerDay)} 필요)</td></tr>)}
          {mine && <tr><td>{PRODUCTS[r.output].name} 재고</td><td>{num(invQty(b, r.output))} · 품질 {b.inv[r.output]?.qty ? Math.round(b.inv[r.output]!.quality) : '-'}</td></tr>}
        </tbody>
      </table>
      <h4>최근 생산 기록</h4>
      <div className="bars">{h7.map((h) => (
        <div key={h.day} title={`${h.produced} ${h.limit ? limitText[h.limit] : ''}`}>
          <i style={{ height: `${(h.produced / (r.outputQty * r.batchesPerDay)) * 100}%` }} className={h.limit === 'input' || h.limit === 'space' ? 'bad' : ''} />
        </div>
      ))}</div>
      <p className="muted small">자사 시설 간 이동은 원가로 이전되므로 공장 자체 손익은 비용만 표시되고, 이익은 판매하는 매장(또는 외부 매입처 판매)에서 나타납니다.</p>
    </>
  );
}

function InventoryTab({ b }: { b: Building }) {
  const lots = Object.entries(b.inv).filter(([, l]) => l && (l.qty > 0));
  return (
    <>
      <p>보관 {num(totalStored(b))} / {num(BUILDINGS[b.type].storage)}</p>
      {lots.length === 0 ? <p className="muted">재고 없음</p> : (
        <table className="grid-table">
          <thead><tr><th>상품</th><th>수량</th><th>재고원가</th><th>단위원가</th><th>품질</th></tr></thead>
          <tbody>{lots.map(([p, l]) => (
            <tr key={p}><td>{PRODUCTS[p as ProductId].name}</td><td>{num(l!.qty)}</td><td>{formatWon(l!.cost)}</td><td>{num(Math.round(l!.cost / l!.qty))}원</td><td>{Math.round(l!.quality)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}

function ContractsTab({ s, b }: { s: GameState; b: Building }) {
  const ctrl = useGame();
  const inbound = s.contracts.filter((k) => k.buyer.kind === 'building' && k.buyer.id === b.id);
  const outbound = s.contracts.filter((k) => k.seller.kind === 'building' && k.seller.id === b.id);
  const ships = s.shipments.filter((x) => (x.to.kind === 'building' && x.to.id === b.id) || (x.from.kind === 'building' && x.from.id === b.id));
  const row = (k: (typeof inbound)[number]) => (
    <tr key={k.id}><td>{partyName(s, k.seller)}</td><td>→ {partyName(s, k.buyer)}</td><td>{PRODUCTS[k.product].name} {num(k.qty)}</td><td>{k.intervalDays}일마다</td></tr>
  );
  return (
    <>
      <h4>입고 계약</h4>
      {inbound.length ? <table className="grid-table"><tbody>{inbound.map(row)}</tbody></table> : <p className="muted">없음</p>}
      <h4>출하 계약</h4>
      {outbound.length ? <table className="grid-table"><tbody>{outbound.map(row)}</tbody></table> : <p className="muted">없음</p>}
      <h4>운송 중 {ships.length}건</h4>
      {ships.map((x) => <div key={x.id} className="small">{PRODUCTS[x.product].name} {num(x.qty)} · {partyName(s, x.from)} → {partyName(s, x.to)} · 도착 D-{Math.max(0, x.arriveDay - s.day)}</div>)}
      <button className="primary" onClick={() => ctrl.openPanel('supply', { panel: 'supply', buildingId: b.id })}>새 계약 / 계약 수정</button>
    </>
  );
}

const PL_ROWS: Account[] = ['revenue', 'cogs', 'wages', 'rent', 'transport', 'maintenance', 'utilities', 'depreciation', 'otherIncome', 'otherLoss'];

function PlTab({ b }: { b: Building }) {
  const cur = b.plMonth, last = b.plLast ?? {};
  const ic = incomeOf(cur), il = incomeOf(last);
  const v = (pl: Partial<Record<Account, number>>, a: Account) => (a === 'revenue' || a === 'otherIncome' ? -(pl[a] ?? 0) : pl[a] ?? 0);
  return (
    <>
      <table className="grid-table">
        <thead><tr><th>항목</th><th>이번 달(진행 중)</th><th>지난 달</th></tr></thead>
        <tbody>
          {PL_ROWS.map((a) => <tr key={a}><td>{ACCOUNT_LABEL[a]}</td><td>{formatWon(v(cur, a))}</td><td>{formatWon(v(last, a))}</td></tr>)}
          <tr className="total"><td>건물 영업이익</td><td className={signClass(ic.operating)}>{formatWon(ic.operating)}</td><td className={signClass(il.operating)}>{formatWon(il.operating)}</td></tr>
        </tbody>
      </table>
      <p className="muted small">원장의 건물별 분개를 집계한 값입니다. 본사·마케팅·이자는 회사 전체 비용이라 포함되지 않습니다.{b.lossMonths > 0 ? ` 연속 적자 ${b.lossMonths}개월.` : ''}</p>
    </>
  );
}

export function ExternalPanel({ id }: { id: number }) {
  const ctrl = useGame();
  const s = ctrl.state!;
  const e = getExternal(s, id);
  if (!e) return null;
  const users = s.contracts.filter((k) => (k.seller.kind === 'external' && k.seller.id === id) || (k.buyer.kind === 'external' && k.buyer.id === id));
  return (
    <div className="rightpanel">
      <header><div><h3>{e.name}</h3><small>외부 {e.role === 'seller' ? '공급자' : '매입처'} · {PRODUCTS[e.product].name}</small></div><button className="x" onClick={() => ctrl.selectExternal(null)}>✕</button></header>
      <div className="rp-body">
        <table className="kv"><tbody>
          <tr><td>현재 {e.role === 'seller' ? '판매' : '매입'} 단가</td><td><b>{num(externalPrice(e))}원</b> (기준 {num(e.basePrice)}원)</td></tr>
          <tr><td>보유 재고</td><td>{num(e.stock)} / {num(e.maxStock)}</td></tr>
          <tr><td>하루 {e.role === 'seller' ? '공급' : '소비'}능력</td><td>{num(e.ratePerDay)}</td></tr>
          {e.role === 'seller' && <tr><td>품질</td><td>{e.quality}</td></tr>}
          <tr><td>거래 중인 계약</td><td>{users.length}건 ({[...new Set(users.map((k) => s.companies.find((c) => c.id === k.owner)?.name))].join(', ') || '-'})</td></tr>
        </tbody></table>
        <p className="muted small">{e.role === 'seller'
          ? `재고가 줄수록 값이 오릅니다(최대 +${pct(BALANCE.market.sellerScarcity, 0)}). 트럭 2대분 이상 주문 시 ${pct(BALANCE.market.bulkDiscountSmall, 0)}, 5대분 이상 ${pct(BALANCE.market.bulkDiscountLarge, 0)} 할인. 경쟁사와 같은 재고를 나눠 씁니다.`
          : `재고가 쌓일수록 매입가가 내려갑니다(최대 -${pct(BALANCE.market.buyerGlut, 0)}).`}</p>
        <button className="primary" onClick={() => ctrl.openPanel('supply', { panel: 'supply', externalId: e.id, product: e.product })}>이 업체와 계약하기</button>
      </div>
    </div>
  );
}
