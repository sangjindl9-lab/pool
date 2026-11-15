// 상태 조회·뉴스 기록 공통 함수
import type { Building, Company, CompanyId, DayStat, ExternalParty, GameState, NavTarget, NewsKind, PartyRef } from './types';

export function getCompany(state: GameState, id: CompanyId): Company {
  const c = state.companies.find((q) => q.id === id);
  if (!c) throw new Error(`회사 없음: ${id}`);
  return c;
}

export function findCompany(state: GameState, id: CompanyId): Company | undefined {
  return state.companies.find((q) => q.id === id);
}

export function player(state: GameState): Company {
  return state.companies.find((c) => c.isPlayer)!;
}

export function getBuilding(state: GameState, id: number): Building | undefined {
  return state.buildings.find((b) => b.id === id);
}

export function getExternal(state: GameState, id: number): ExternalParty | undefined {
  return state.externals.find((e) => e.id === id);
}

export function partyName(state: GameState, ref: PartyRef): string {
  if (ref.kind === 'building') return getBuilding(state, ref.id)?.name ?? '(철거된 건물)';
  return getExternal(state, ref.id)?.name ?? '(알 수 없음)';
}

export function sameRef(a: PartyRef, b: PartyRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

const NEWS_KEEP = 250;

export function addNews(state: GameState, kind: NewsKind, text: string, companyId?: CompanyId, nav?: NavTarget): void {
  state.news.push({ id: state.nextId++, day: state.day, kind, text, companyId, nav });
  if (state.news.length > NEWS_KEEP) state.news.splice(0, state.news.length - NEWS_KEEP);
}

export function newDayStat(day: number): DayStat {
  return { day, demand: {}, sold: {}, lost: {}, revenue: 0, produced: 0, limit: null };
}

/** 오늘의 건물 통계(하루 처리 시작 시 생성) */
export function todayStat(state: GameState, b: Building): DayStat {
  const last = b.hist[b.hist.length - 1];
  if (last && last.day === state.day) return last;
  const s = newDayStat(state.day);
  b.hist.push(s);
  if (b.hist.length > 30) b.hist.shift();
  return s;
}

export function companyBuildings(state: GameState, id: CompanyId): Building[] {
  return state.buildings.filter((b) => b.owner === id);
}
