import { useMemo, useState } from 'react';
import { BUILDINGS, shippableProducts } from '../../engine/data/buildings';
import { PRODUCTS, PRODUCT_IDS, type ProductId } from '../../engine/data/products';
import { cancelPenalty, contractQuote, validateContract, type ContractInput } from '../../engine/contracts';
import { externalPrice } from '../../engine/market';
import { partyName } from '../../engine/state';
import type { Contract, GameState, PartyRef } from '../../engine/types';
import { formatWon, num } from '../format';
import { useGame } from '../hooks';

const parseRef = (k: string): PartyRef | null => {
  const [kind, id] = k.split(':');
  return kind === 'building' || kind === 'external' ? { kind, id: Number(id) } as PartyRef : null;
};

export function SupplyPanel() {
  const ctrl = useGame();
  const s = ctrl.state!;
  const mine = s.contracts.filter((k) => k.owner === 'player');
  const ships = s.shipments.filter((x) => x.holder === 'player');
  const focus = ctrl.panelArg?.buildingId;
  return (
    <div className="two-col">
      <div>
        <NewContract key={`${ctrl.panelArg?.buildingId ?? ''}-${ctrl.panelArg?.externalId ?? ''}-${ctrl.panelArg?.product ?? ''}`} />
        <h3>운송 중 배송 {ships.length}건</h3>
        <table className="grid-table">
          <thead><tr><th>상품</th><th>수량</th><th>출발 → 도착</th><th>도착</th><th>운송중 원가</th></tr></thead>
          <tbody>
            {ships.slice(0, 40).map((x) => (
              <tr key={x.id}><td>{PRODUCTS[x.product].name}</td><td>{num(x.qty)}</td><td>{partyName(s, x.from)} → {partyName(s, x.to)}</td><td>{x.arriveDay <= s.day ? '오늘' : `${x.arriveDay - s.day}일 후`}</td><td>{formatWon(x.cost)}{x.payable ? ' (외상)' : ''}</td></tr>
            ))}
          </tbody>
        </table>
        {ships.length === 0 && <p className="muted">운송 중인 물량이 없습니다.</p>}
      </div>
      <div>
        <h3>내 공급 계약 {mine.length}건</h3>
        {mine.length === 0 && <p className="muted">계약이 없습니다. 왼쪽에서 새 계약을 만드세요.</p>}
        {mine.map((k) => <ContractRow key={k.id} s={s} k={k} highlight={focus !== undefined && ((k.buyer.kind === 'building' && k.buyer.id === focus) || (k.seller.kind === 'building' && k.seller.id === focus))} />)}
      </div>
    </div>
  );
}

function ContractRow({ s, k, highlight }: { s: GameState; k: Contract; highlight: boolean }) {
  const ctrl = useGame();
  const [edit, setEdit] = useState(false);
  const [qty, setQty] = useState(k.qty);
  const [interval, setIntervalDays] = useState(k.intervalDays);
  const [shortage, setShortage] = useState(k.shortage);
  const q = contractQuote(s, k);
  const penalty = cancelPenalty(s, k);
  const recentShort = s.day - k.lastShortageDay <= 7;
  return (
    <div className={`contract ${highlight ? 'hl' : ''}`}>
      <div className="c-head">
        <b>{PRODUCTS[k.product].name}</b> {partyName(s, k.seller)} → {partyName(s, k.buyer)}
        {recentShort && <span className="tag bad">공급 부족</span>}
        {k.failedPayments > 0 && <span className="tag bad">대금 부족</span>}
      </div>
      <div className="small">
        {num(k.qty)}{PRODUCTS[k.product].unit} / {k.intervalDays}일마다 · 거리 {k.distance}칸 · 운송 {k.transitDays}일 · 다음 출하 {k.nextShipDay <= s.day ? '오늘' : `${k.nextShipDay - s.day}일 후`}
        <br />
        {q.unitPrice > 0 && <>단가 {num(q.unitPrice)}원 · </>}운송비 회당 {formatWon(q.freight)} (개당 {num(Math.round(q.freightPerUnit))}원) · 결제 {k.payment === 'ship' ? '출하 시' : '도착 시'} · 부족 시 {k.shortage === 'partial' ? '부분 출하' : '전량 대기'} · 누적 {num(k.shippedTotal)}
      </div>
      {!edit ? (
        <div className="row">
          <button onClick={() => setEdit(true)}>수정</button>
          <button className="danger" onClick={() => { if (penalty === 0 || confirm(`계약 시작 30일 이내 해지 위약금 ${penalty.toLocaleString()}원이 발생합니다. 해지할까요?`)) ctrl.command({ type: 'cancelContract', contractId: k.id }, '계약을 해지했습니다'); }}>
            해지{penalty ? ` (위약금 ${formatWon(penalty)})` : ''}
          </button>
        </div>
      ) : (
        <div className="row wrap">
          <label>수량<input type="number" value={qty} min={1} onChange={(e) => setQty(Math.round(Number(e.target.value)))} /></label>
          <label>주기(일)<input type="number" value={interval} min={1} max={30} onChange={(e) => setIntervalDays(Math.round(Number(e.target.value)))} /></label>
          <label>부족 시<select value={shortage} onChange={(e) => setShortage(e.target.value as 'partial' | 'wait')}><option value="partial">부분 출하</option><option value="wait">전량 대기</option></select></label>
          <button className="primary" onClick={() => { if (ctrl.command({ type: 'updateContract', contractId: k.id, qty, intervalDays: interval, shortage }, '계약을 수정했습니다').ok) setEdit(false); }}>저장</button>
          <button onClick={() => setEdit(false)}>취소</button>
        </div>
      )}
    </div>
  );
}

function NewContract() {
  const ctrl = useGame();
  const s = ctrl.state!;
  const arg = ctrl.panelArg;
  const myBuildings = s.buildings.filter((b) => b.owner === 'player' && b.type !== 'hq');
  const initialBuyer = (() => {
    if (arg?.externalId !== undefined) {
      const e = s.externals.find((x) => x.id === arg.externalId);
      if (e?.role === 'buyer') return `external:${e.id}`;
    }
    const b = myBuildings.find((x) => x.id === arg?.buildingId);
    if (b && BUILDINGS[b.type].accepts.length) return `building:${b.id}`;
    return myBuildings.find((x) => BUILDINGS[x.type].accepts.length) ? `building:${myBuildings.find((x) => BUILDINGS[x.type].accepts.length)!.id}` : '';
  })();
  const initialSeller = (() => {
    if (arg?.externalId !== undefined) {
      const e = s.externals.find((x) => x.id === arg.externalId);
      if (e?.role === 'seller') return `external:${e.id}`;
    }
    const b = myBuildings.find((x) => x.id === arg?.buildingId);
    if (b && !BUILDINGS[b.type].accepts.length && shippableProducts(b.type).length) return `building:${b.id}`;
    return '';
  })();
  const [buyerK, setBuyerK] = useState(initialBuyer);
  const [sellerK, setSellerK] = useState(initialSeller);
  const buyer = parseRef(buyerK), seller = parseRef(sellerK);
  // 가능한 상품: 판매자가 내보낼 수 있고 구매자가 받을 수 있는 상품
  const productsFor = (sel: PartyRef | null, buy: PartyRef | null): ProductId[] => {
    let ps = [...PRODUCT_IDS];
    if (sel?.kind === 'external') ps = ps.filter((p) => s.externals.find((e) => e.id === sel.id)?.product === p);
    if (sel?.kind === 'building') { const b = s.buildings.find((x) => x.id === sel.id); ps = ps.filter((p) => b && shippableProducts(b.type).includes(p)); }
    if (buy?.kind === 'external') ps = ps.filter((p) => s.externals.find((e) => e.id === buy.id)?.product === p);
    if (buy?.kind === 'building') { const b = s.buildings.find((x) => x.id === buy.id); ps = ps.filter((p) => b && BUILDINGS[b.type].accepts.includes(p)); }
    return ps;
  };
  const avail = productsFor(seller, buyer);
  const [product, setProduct] = useState<ProductId>(arg?.product && avail.includes(arg.product) ? arg.product : avail[0] ?? 'bread');
  const p = avail.includes(product) ? product : avail[0];
  const [qty, setQty] = useState(p && PRODUCTS[p].tier === 'consumer' ? (p === 'bread' ? 300 : 40) : 600);
  const [interval, setIntervalDays] = useState(p && PRODUCTS[p].tier === 'consumer' ? 1 : 2);
  const [payment, setPayment] = useState<'ship' | 'arrival'>('ship');
  const [shortage, setShortage] = useState<'partial' | 'wait'>('partial');

  // 판매자 후보: 구매자가 받을 수 있는 상품을 공급하는 외부 업체 + 자사 출하 가능 건물
  const buyerB = buyer?.kind === 'building' ? s.buildings.find((x) => x.id === buyer.id) : undefined;
  const sellerOptions = useMemo(() => {
    const opts: { k: string; label: string }[] = [];
    for (const e of s.externals.filter((x) => x.role === 'seller')) {
      if (buyerB && !BUILDINGS[buyerB.type].accepts.includes(e.product)) continue;
      if (buyer?.kind === 'external') continue;
      opts.push({ k: `external:${e.id}`, label: `[외부] ${e.name} — ${PRODUCTS[e.product].name} ${num(externalPrice(e))}원 · 품질 ${e.quality} · 재고 ${num(e.stock)}` });
    }
    for (const b of myBuildings) {
      if (!shippableProducts(b.type).length || (buyer?.kind === 'building' && buyer.id === b.id)) continue;
      opts.push({ k: `building:${b.id}`, label: `[자사] ${b.name}` });
    }
    return opts;
  }, [s, buyerK, s.day]); // eslint-disable-line react-hooks/exhaustive-deps
  const buyerOptions = [
    ...myBuildings.filter((b) => BUILDINGS[b.type].accepts.length).map((b) => ({ k: `building:${b.id}`, label: `[자사] ${b.name}${b.status !== 'active' ? ' (건설 중)' : ''}` })),
    ...s.externals.filter((e) => e.role === 'buyer').map((e) => ({ k: `external:${e.id}`, label: `[외부 매입처] ${e.name} — ${PRODUCTS[e.product].name} ${num(externalPrice(e))}원에 매입` })),
  ];
  const input: ContractInput | null = seller && buyer && p ? { seller, buyer, product: p, qty, intervalDays: interval, payment, shortage } : null;
  const v = input ? validateContract(s, 'player', input) : { ok: false as const, error: '공급자와 입고지를 고르세요' };
  const quote = input ? contractQuote(s, input) : null;
  const monthly = quote ? (quote.goods + quote.freight) * quote.perMonthShipments : 0;
  const create = () => {
    if (!input) return;
    const r = ctrl.command({ type: 'createContract', ...input }, '공급 계약을 체결했습니다');
    if (r.ok) ctrl.openPanel('supply', null);
  };
  return (
    <div className="new-contract">
      <h3>새 공급 계약</h3>
      <label>입고지(구매자)<select value={buyerK} onChange={(e) => { setBuyerK(e.target.value); setSellerK(''); }}>
        <option value="">— 선택 —</option>
        {buyerOptions.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
      </select></label>
      <label>공급자(출하지)<select value={sellerK} onChange={(e) => setSellerK(e.target.value)}>
        <option value="">— 선택 —</option>
        {sellerOptions.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
      </select></label>
      {avail.length > 1 && <label>상품<select value={p} onChange={(e) => setProduct(e.target.value as ProductId)}>{avail.map((x) => <option key={x} value={x}>{PRODUCTS[x].name}</option>)}</select></label>}
      <div className="row wrap">
        <label>1회 수량<input type="number" min={1} value={qty} onChange={(e) => setQty(Math.round(Number(e.target.value)))} /></label>
        <label>출하 주기(일)<input type="number" min={1} max={30} value={interval} onChange={(e) => setIntervalDays(Math.round(Number(e.target.value)))} /></label>
        {seller?.kind === 'external' && <label>결제<select value={payment} onChange={(e) => setPayment(e.target.value as 'ship' | 'arrival')}><option value="ship">출하 시 선결제</option><option value="arrival">도착 시 지급(외상)</option></select></label>}
        <label>공급 부족 시<select value={shortage} onChange={(e) => setShortage(e.target.value as 'partial' | 'wait')}><option value="partial">있는 만큼 부분 출하</option><option value="wait">전량 될 때까지 대기</option></select></label>
      </div>
      {quote && p && (
        <table className="kv quote"><tbody>
          <tr><td>거리 / 운송 소요</td><td>{quote.distance}칸 / {quote.transitDays}일</td></tr>
          {quote.unitPrice > 0 && <tr><td>{seller?.kind === 'external' ? '매입 단가' : '매입처 단가'}</td><td>{num(quote.unitPrice)}원 {seller?.kind === 'external' && quote.unitPrice < externalPrice(s.externals.find((e) => e.id === seller.id)!) && <span className="pos">(대량 할인 적용)</span>}</td></tr>}
          {seller?.kind === 'building' && buyer?.kind === 'building' && <tr><td>사내 이동</td><td>원가 그대로 이전(대금 없음)</td></tr>}
          <tr><td>회당 운송비</td><td>{formatWon(quote.freight)} (개당 {num(Math.round(quote.freightPerUnit))}원 · 트럭 {Math.ceil(qty / PRODUCTS[p].truckCapacity)}대)</td></tr>
          {seller?.kind === 'external' && <tr><td>회당 대금</td><td>{formatWon(quote.goods)}</td></tr>}
          {buyer?.kind === 'external' && <tr><td>회당 예상 매출</td><td>{formatWon(quote.unitPrice * qty)}</td></tr>}
          <tr><td>월 예상 지출</td><td><b>{formatWon(monthly)}</b> (월 {quote.perMonthShipments.toFixed(1)}회)</td></tr>
          <tr><td>월 물량</td><td>{num(qty * quote.perMonthShipments)}{PRODUCTS[p].unit} (하루 {num(qty / interval)})</td></tr>
        </tbody></table>
      )}
      {!v.ok && <p className="neg small">{v.error}</p>}
      <p className="muted small">외부 업체 계약을 30일 안에 해지하면 1회분 금액의 20% 위약금이 있습니다. 보관 공간이 부족하면 남는 공간만큼만 출하됩니다.</p>
      <button className="primary" disabled={!v.ok} onClick={create}>계약 체결</button>
    </div>
  );
}
