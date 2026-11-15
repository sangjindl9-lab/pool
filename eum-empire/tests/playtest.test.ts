declare const process: { env: Record<string, string | undefined> };
import { it } from 'vitest';
import { applyCommand } from '../src/engine/commands';
import { incomeOf, balanceSheet } from '../src/engine/ledger';
import { advanceDay } from '../src/engine/sim';
import { formatWon } from '../src/engine/money';
import { marketShare } from '../src/engine/demand';
import { game, build, seller, checkInvariants } from './helpers';

it('playtest log', () => {
  const s = game(Number(process.env.SEED ?? 42));
  const store = build(s, 'store');
  applyCommand(s, 'player', { type: 'createContract', seller: { kind: 'external', id: seller(s, 'bread').id }, buyer: { kind: 'building', id: store }, product: 'bread', qty: 300, intervalDays: 2, payment: 'ship', shortage: 'partial' });
  applyCommand(s, 'player', { type: 'createContract', seller: { kind: 'external', id: seller(s, 'clothing').id }, buyer: { kind: 'building', id: store }, product: 'clothing', qty: 60, intervalDays: 3, payment: 'ship', shortage: 'partial' });
  const days = Number(process.env.DAYS ?? 360);
  const t0 = performance.now();
  for (let d = 0; d < days; d++) {
    advanceDay(s);
    const e = checkInvariants(s);
    if (e.length) throw new Error(`day ${s.day}: ${e.join('; ')}`);
  }
  const ms = performance.now() - t0;
  console.log(`${days}일 처리 ${ms.toFixed(0)}ms (${(ms / days).toFixed(2)}ms/일), 건물 ${s.buildings.length}, 계약 ${s.contracts.length}`);
  for (const c of s.companies) {
    const bs = balanceSheet(c);
    console.log(`\n== ${c.name} 현금 ${formatWon(c.ledger.cash)} 순자산 ${formatWon(bs.equity)} 대출 ${formatWon(-c.ledger.loans)} 파산 ${c.bankrupt}`);
    console.log('  건물:', s.buildings.filter((b) => b.owner === c.id).map((b) => `${b.type}${b.status === 'construction' ? '(공사)' : ''}`).join(','));
    console.log('  월별:', c.history.map((m) => { const i = incomeOf(m.delta); return `${m.index}:${(i.revenue / 1e6).toFixed(0)}/${(i.operating / 1e6).toFixed(1)}/${(i.net / 1e6).toFixed(1)}`; }).join(' '));
    console.log('  가격:', s.buildings.filter((b) => b.owner === c.id && b.type === 'store').map((b) => `${b.listings.bread?.price}/${b.listings.clothing?.price}`).join(' '));
  }
  for (const p of ['bread', 'clothing'] as const) {
    const m = marketShare(s, p, 30);
    console.log(p, 'potential', m.potential, 'sold', m.sold, JSON.stringify(m.byCompany));
  }
  console.log(s.news.filter((n) => n.kind === 'competitor').slice(-15).map((n) => `${n.day}: ${n.text}`).join('\n'));
});

import { ACCOUNT_LABEL } from '../src/engine/ledger';
it('per-building P&L', () => {
  const s = game(Number(process.env.SEED ?? 42));
  for (let d = 0; d < Number(process.env.DAYS ?? 240); d++) advanceDay(s);
  for (const c of s.companies.filter((q) => !q.isPlayer)) {
    console.log(`\n### ${c.name}  marketing ${JSON.stringify(c.marketing)}`);
    const last = c.history[c.history.length - 1];
    console.log('  회사 월:', Object.entries(last.delta).filter(([k]) => !['cash','inventory','inTransit','land','buildings','accumDep','payables','loans','capital'].includes(k)).map(([k, v]) => `${ACCOUNT_LABEL[k as 'cash']}:${((v as number) / 1e6).toFixed(1)}`).join(' '));
    for (const b of s.buildings.filter((q) => q.owner === c.id)) {
      const pl = b.plLast ?? {};
      const i = incomeOf(pl);
      const h = b.hist.slice(-7);
      const sold = (p: 'bread' | 'clothing') => h.reduce((a, x) => a + (x.sold[p] ?? 0), 0) / 7;
      const lost = (p: 'bread' | 'clothing') => h.reduce((a, x) => a + (x.lost[p] ?? 0), 0) / 7;
      console.log(`  ${b.type} util${b.utilization} op ${(i.operating / 1e6).toFixed(1)}M rev ${(i.revenue / 1e6).toFixed(1)} cogs ${(i.cogs / 1e6).toFixed(1)} `, Object.entries(pl).filter(([k]) => !['revenue','cogs'].includes(k)).map(([k, v]) => `${k}:${((v as number) / 1e6).toFixed(1)}`).join(' '),
        b.type === 'store' ? `| bread ${sold('bread').toFixed(0)}/lost${lost('bread').toFixed(0)} @${b.listings.bread?.price} q${b.inv.bread?.quality.toFixed(0)} cloth ${sold('clothing').toFixed(0)}/lost${lost('clothing').toFixed(0)} @${b.listings.clothing?.price}` : `| prod ${h.map((x) => x.produced).join(',')} limit ${h.map((x) => x.limit).join(',')}`,
        JSON.stringify(Object.fromEntries(Object.entries(b.inv).map(([k, v]) => [k, v!.qty]))));
    }
  }
  console.log(s.externals.map((e) => `${e.name} ${e.stock}/${e.maxStock}`).join('\n'));
});
