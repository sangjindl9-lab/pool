// 게임 컨트롤러: 시뮬레이션 상태, 시계, 명령 실행, UI 구독, 자동 저장을 묶습니다.
// 렌더링 프레임과 경제 계산은 분리: 프레임마다 tickClock으로 처리할 "일수"만 계산하고 advanceDay는 하루 단위로만 호출합니다.
import { applyCommand, type Command } from '../engine/commands';
import { advanceDay, checkTutorial, newGame, tutorialFlag, type NewGameOptions } from '../engine/sim';
import { isMonthEnd } from '../engine/calendar';
import type { BuildingType, GameState, NavTarget, ProductId, Result } from '../engine/types';
import { tickClock, type ClockState, type Speed } from './clock';
import { loadSettings, saveSettings, type Settings } from './settings';
import type { HoverInfo } from '../render/CityRenderer';

export type OverlayMode = 'none' | 'demand:bread' | 'demand:clothing' | 'land' | 'logistics' | 'zones';

export interface BuildMode {
  type: BuildingType;
  tenure: 'own' | 'lease';
}

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'ok' | 'info';
}

export interface Hooks {
  autosave?: (state: GameState) => Promise<void> | void;
  sound?: (name: 'build' | 'sale' | 'month' | 'error' | 'click' | 'complete') => void;
}

export class GameController {
  state: GameState | null = null;
  clock: ClockState = { speed: 0, fraction: 0 };
  version = 0;
  selected: number | null = null;
  selectedExternal: number | null = null;
  buildMode: BuildMode | null = null;
  overlay: OverlayMode = 'none';
  panel: string | null = null;
  panelArg: NavTarget | null = null;
  toasts: Toast[] = [];
  settings: Settings = loadSettings();
  hooks: Hooks = {};
  /** 성능 측정: 최근 하루 처리 시간(ms), 렌더링 FPS */
  lastDayMs = 0;
  fps = 0;
  hover: HoverInfo | null = null;
  private listeners = new Set<() => void>();
  private toastId = 1;
  private lastNotify = 0;
  private pendingNotify = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  notify(immediate = false) {
    this.version++;
    const now = performance.now();
    if (immediate || now - this.lastNotify > 120) {
      this.lastNotify = now;
      this.pendingNotify = false;
      this.listeners.forEach((f) => f());
    } else {
      this.pendingNotify = true;
    }
  }

  start(opts: NewGameOptions) {
    this.load(newGame(opts));
    this.clock.speed = 0;
  }

  load(state: GameState) {
    this.state = state;
    this.selected = null;
    this.selectedExternal = null;
    this.buildMode = null;
    this.panel = null;
    this.clock = { speed: 0, fraction: 0 };
    this.notify(true);
  }

  quit() {
    this.state = null;
    this.notify(true);
  }

  setSpeed(s: Speed) {
    this.clock.speed = s;
    this.notify(true);
  }

  /** rAF마다 호출. 처리한 일수를 반환 */
  frame(dtMs: number): number {
    const s = this.state;
    if (!s) return 0;
    if (s.gameOver && !s.gameOver.won && this.clock.speed !== 0) this.clock.speed = 0;
    const days = tickClock(this.clock, dtMs);
    for (let i = 0; i < days; i++) this.stepDay();
    if (days > 0) this.notify();
    else if (this.pendingNotify && performance.now() - this.lastNotify > 120) this.notify(true);
    return days;
  }

  stepDay() {
    const s = this.state;
    if (!s) return;
    const myRevenueBefore = s.companies[0].ledger.revenue;
    const newsBefore = s.news.length ? s.news[s.news.length - 1].id : 0;
    const wasMonthEnd = isMonthEnd(s.day);
    const t0 = performance.now();
    advanceDay(s);
    this.lastDayMs = performance.now() - t0;
    // 효과음: 첫 매출, 건설 완료, 월말
    if (myRevenueBefore === 0 && s.companies[0].ledger.revenue !== 0) this.hooks.sound?.('sale');
    if (s.news.some((n) => n.id > newsBefore && n.kind === 'construction')) this.hooks.sound?.('complete');
    if (wasMonthEnd) {
      this.hooks.sound?.('month');
      if (this.settings.autosave) void this.hooks.autosave?.(s);
    }
    if (s.gameOver && !s.gameOver.won) this.clock.speed = 0;
  }

  /** 플레이어 명령. 실패 시 이유를 토스트로 보여줌 */
  command(cmd: Command, okText?: string): Result {
    if (!this.state) return { ok: false, error: '게임 없음' };
    const r = applyCommand(this.state, 'player', cmd);
    if (r.ok) checkTutorial(this.state);
    if (!r.ok) {
      this.toast(r.error, 'error');
      this.hooks.sound?.('error');
    } else {
      if (okText) this.toast(okText, 'ok');
      if (cmd.type === 'build') this.hooks.sound?.('build');
      else this.hooks.sound?.('click');
    }
    this.notify(true);
    return r;
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    const t = { id: this.toastId++, text, kind };
    this.toasts = [...this.toasts.slice(-3), t];
    this.notify(true);
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.notify(true);
    }, kind === 'error' ? 4500 : 2800);
  }

  select(id: number | null) {
    this.selected = id;
    this.selectedExternal = null;
    this.notify(true);
  }
  selectExternal(id: number | null) {
    this.selectedExternal = id;
    this.selected = null;
    this.notify(true);
  }

  setBuildMode(m: BuildMode | null) {
    this.buildMode = m;
    if (m) this.selected = null;
    this.notify(true);
  }

  setOverlay(o: OverlayMode) {
    this.overlay = o;
    this.notify(true);
  }

  openPanel(panel: string | null, arg: NavTarget | null = null) {
    this.panel = panel;
    this.panelArg = arg;
    if (panel === 'finance' && this.state) tutorialFlag(this.state, 'financeViewed');
    this.notify(true);
  }

  /** 문제 원인·뉴스에서 해당 화면으로 이동 */
  navigate(nav: NavTarget) {
    if (nav.panel === 'building' && nav.buildingId !== undefined) {
      this.panel = null;
      this.select(nav.buildingId);
      this.focusRequest = nav.buildingId;
      return;
    }
    this.openPanel(nav.panel, nav);
  }
  focusRequest: number | null = null;

  updateSettings(p: Partial<Settings>) {
    this.settings = { ...this.settings, ...p };
    saveSettings(this.settings);
    this.notify(true);
  }

  productFocus: ProductId = 'bread';
}

export const controller = new GameController();
