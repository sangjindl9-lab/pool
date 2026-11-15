import { useEffect, useRef, useState } from 'react';
import { controller, type OverlayMode } from '../game/controller';
import { CityRenderer } from '../render/CityRenderer';
import { incomeOf } from '../engine/ledger';
import { TUTORIAL_STEPS } from '../engine/sim';
import { player } from '../engine/state';
import type { NewsKind } from '../engine/types';
import { formatDate, formatWon, signClass } from './format';
import { useGame } from './hooks';
import { BuildDrawer } from './panels/BuildDrawer';
import { BuildingPanel, ExternalPanel } from './panels/BuildingPanel';
import { CompanyPanel } from './panels/CompanyPanel';
import { MarketPanel } from './panels/MarketPanel';
import { SupplyPanel } from './panels/SupplyPanel';
import { FinancePanel } from './panels/FinancePanel';
import { ResearchPanel } from './panels/ResearchPanel';
import { CompetitorPanel } from './panels/CompetitorPanel';
import { SystemPanel } from './panels/SystemPanel';

const MENU: { id: string; label: string; icon: string }[] = [
  { id: 'build', label: '건설', icon: '🏗' },
  { id: 'company', label: '회사', icon: '🏢' },
  { id: 'market', label: '시장', icon: '📊' },
  { id: 'supply', label: '공급망', icon: '🚚' },
  { id: 'finance', label: '재무', icon: '💰' },
  { id: 'research', label: '연구·마케팅', icon: '🔬' },
  { id: 'competitors', label: '경쟁사', icon: '⚔' },
  { id: 'system', label: '저장·설정', icon: '💾' },
];

const OVERLAYS: { id: OverlayMode; label: string }[] = [
  { id: 'none', label: '끄기' },
  { id: 'demand:bread', label: '빵 수요' },
  { id: 'demand:clothing', label: '의류 수요' },
  { id: 'land', label: '지가' },
  { id: 'logistics', label: '물류 접근성' },
  { id: 'zones', label: '용도 지역' },
];

export function GameScreen() {
  const ctrl = useGame();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = new CityRenderer(host.current!, controller);
    return () => r.dispose();
  }, []);
  const s = ctrl.state!;
  return (
    <div className="game">
      <div className="viewport" ref={host} />
      <TopBar />
      <LeftMenu />
      {ctrl.panel === 'build' && <BuildDrawer />}
      {ctrl.selected !== null && <BuildingPanel key={ctrl.selected} id={ctrl.selected} />}
      {ctrl.selectedExternal !== null && <ExternalPanel id={ctrl.selectedExternal} />}
      <BottomBar />
      {ctrl.panel && ctrl.panel !== 'build' && <PanelHost />}
      {s.tutorial && <TutorialBox />}
      <HoverTip />
      <Toasts />
      {s.gameOver && <GameOver />}
      {ctrl.settings.showFps && <div className="fps">{ctrl.fps.toFixed(0)} FPS · 드로우콜 {ctrl.drawCalls} · 하루 처리 {ctrl.lastDayMs.toFixed(2)}ms · 건물 {s.buildings.length}</div>}
    </div>
  );
}

function TopBar() {
  const ctrl = useGame();
  const s = ctrl.state!;
  const me = player(s);
  const inc = incomeOf(me.month.delta);
  const speeds: [0 | 1 | 2 | 4, string][] = [[0, '⏸'], [1, '▶'], [2, '▶▶'], [4, '▶▶▶▶']];
  return (
    <div className="topbar">
      <div className="brand">EUM <b>EMPIRE</b></div>
      <div className="stat"><span>날짜</span><b>{formatDate(s.day)}</b></div>
      <div className="stat" title="원장 현금 잔액"><span>현금</span><b className={signClass(me.ledger.cash)}>{formatWon(me.ledger.cash)}</b></div>
      <div className="stat" title="이번 달 누적 순이익(원장 기준)"><span>당월 손익</span><b className={signClass(inc.net)}>{formatWon(inc.net)}</b></div>
      <div className="stat"><span>당월 매출</span><b>{formatWon(inc.revenue)}</b></div>
      {me.negativeCashDays > 0 && <div className="stat danger" onClick={() => ctrl.openPanel('finance')}><span>자금 부족</span><b>파산까지 {30 - me.negativeCashDays}일</b></div>}
      <div className="speeds">
        {speeds.map(([v, l]) => <button key={v} className={ctrl.clock.speed === v ? 'on' : ''} onClick={() => ctrl.setSpeed(v)} title={v === 0 ? '일시정지' : `${v}배속`}>{l}</button>)}
        <button onClick={() => { ctrl.setSpeed(0); ctrl.stepDay(); ctrl.notify(true); }} title="하루만 진행">+1일</button>
      </div>
      <div className="company-chip" style={{ borderColor: me.color }}>{me.name}</div>
    </div>
  );
}

function LeftMenu() {
  const ctrl = useGame();
  const [showOverlay, setShowOverlay] = useState(false);
  return (
    <div className="leftmenu">
      {MENU.map((m) => (
        <button key={m.id} className={ctrl.panel === m.id ? 'on' : ''} onClick={() => ctrl.openPanel(ctrl.panel === m.id ? null : m.id)}>
          <span className="ic">{m.icon}</span>{m.label}
        </button>
      ))}
      <button className={ctrl.overlay !== 'none' ? 'on' : ''} onClick={() => setShowOverlay(!showOverlay)}><span className="ic">🗺</span>지도 표시</button>
      {showOverlay && (
        <div className="overlay-pick">
          {OVERLAYS.map((o) => <button key={o.id} className={ctrl.overlay === o.id ? 'on' : ''} onClick={() => ctrl.setOverlay(o.id)}>{o.label}</button>)}
          {ctrl.overlay !== 'none' && <div className="heat-legend"><span>낮음</span><i /><span>높음</span></div>}
        </div>
      )}
    </div>
  );
}

const NEWS_ICON: Record<NewsKind, string> = { info: 'ℹ', warning: '⚠', contract: '📄', competitor: '⚔', finance: '💰', construction: '🏗', sales: '🛒' };

function BottomBar() {
  const ctrl = useGame();
  const s = ctrl.state!;
  const [filter, setFilter] = useState<'all' | 'warning' | 'competitor' | 'contract'>('all');
  const items = s.news.filter((n) => filter === 'all' || n.kind === filter || (filter === 'contract' && n.kind === 'construction')).slice(-40).reverse();
  return (
    <div className="bottombar">
      <div className="tabs">
        {([['all', '전체'], ['warning', '경고'], ['contract', '계약·건설'], ['competitor', '경쟁사 뉴스']] as const).map(([k, l]) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <div className="feed">
        {items.length === 0 && <div className="muted">소식이 없습니다</div>}
        {items.map((n) => (
          <div key={n.id} className={`news ${n.kind}`} onClick={() => n.nav && ctrl.navigate(n.nav)} style={{ cursor: n.nav ? 'pointer' : 'default' }}>
            <span className="d">{formatDate(n.day)}</span>
            <span className="i">{NEWS_ICON[n.kind]}</span>
            {n.companyId && n.companyId !== 'player' && <i className="dot" style={{ background: s.companies.find((c) => c.id === n.companyId)?.color }} />}
            <span>{n.text}</span>
            {n.nav && <span className="go">이동 ›</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelHost() {
  const ctrl = useGame();
  const title: Record<string, string> = {
    company: '회사 요약', market: '시장 조사 · 상품별 수요·가격·점유율', supply: '공급 계약과 배송 현황', finance: '재무: 손익계산서 · 현금흐름 · 대출',
    research: '연구개발 · 마케팅', competitors: '경쟁사 현황', system: '저장 · 불러오기 · 환경설정',
  };
  const p = ctrl.panel!;
  return (
    <div className="panelhost">
      <div className="panel big">
        <header><h2>{title[p]}</h2><button className="x" onClick={() => ctrl.openPanel(null)}>✕</button></header>
        <div className="panel-body">
          {p === 'company' && <CompanyPanel />}
          {p === 'market' && <MarketPanel />}
          {p === 'supply' && <SupplyPanel />}
          {p === 'finance' && <FinancePanel />}
          {p === 'research' && <ResearchPanel />}
          {p === 'competitors' && <CompetitorPanel />}
          {p === 'system' && <SystemPanel />}
        </div>
      </div>
    </div>
  );
}

function TutorialBox() {
  const ctrl = useGame();
  const t = ctrl.state!.tutorial!;
  const [hidden, setHidden] = useState(false);
  const step = TUTORIAL_STEPS[t.step];
  if (hidden) return <button className="tut-show" onClick={() => setHidden(false)}>튜토리얼 보기 ({t.step + 1}/{TUTORIAL_STEPS.length})</button>;
  return (
    <div className="tutorial">
      <div className="tut-head"><b>튜토리얼 {t.step + 1}/{TUTORIAL_STEPS.length}</b><button className="x" onClick={() => setHidden(true)}>–</button></div>
      <h3>{step.title}</h3>
      <p>{step.text}</p>
      <div className="tut-progress">{TUTORIAL_STEPS.map((_, i) => <i key={i} className={i < t.step ? 'done' : i === t.step ? 'cur' : ''} />)}</div>
    </div>
  );
}

function HoverTip() {
  const ctrl = useGame();
  const h = ctrl.hover;
  if (!h || !ctrl.buildMode) return null;
  return (
    <div className="hovertip" style={{ left: h.screenX + 18, top: h.screenY + 18 }}>
      <b className={h.ok ? 'pos' : 'neg'}>{h.ok ? '건설 가능' : '건설 불가'}</b>
      {h.reasons.map((r) => <div key={r} className="neg">· {r}</div>)}
      <div>필요 자금: <b>{formatWon(h.cost)}</b></div>
      <div className="muted">땅값 {formatWon(h.landCost)} · 임대 시 월 {formatWon(h.leasePerDay * 30)}</div>
      <div className="muted">클릭하여 건설 · Esc 취소</div>
    </div>
  );
}

function Toasts() {
  const ctrl = useGame();
  return <div className="toasts">{ctrl.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>;
}

function GameOver() {
  const ctrl = useGame();
  const g = ctrl.state!.gameOver!;
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  return (
    <div className="panelhost">
      <div className="panel gameover">
        <h2>{g.won ? '🏆 목표 달성!' : '파산'}</h2>
        <p>{g.reason}</p>
        <p className="muted">{formatDate(g.day)}</p>
        <div className="row">
          {g.won && <button className="primary" onClick={() => setClosed(true)}>계속 경영하기</button>}
          {!g.won && <button onClick={() => { setClosed(true); ctrl.openPanel('finance'); }}>닫고 재무 기록 보기</button>}
          <button onClick={() => ctrl.quit()}>시작 화면으로</button>
        </div>
      </div>
    </div>
  );
}
