// 저장 데이터 포맷: 버전·체크섬·상태 전체(JSON). 저장소(IndexedDB/파일)와 무관한 순수 함수입니다.
import { SAVE_VERSION } from './sim';
import type { GameState } from './types';

export const SAVE_FORMAT = 'eum-empire-save';

export interface SaveMeta {
  slot: string;
  companyName: string;
  day: number;
  cash: number;
  mode: 'tutorial' | 'free';
  savedAt: number;
}

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  saveVersion: number;
  savedAt: number;
  checksum: string;
  meta: SaveMeta;
  state: GameState;
}

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function makeMeta(state: GameState, slot: string, savedAt: number): SaveMeta {
  const me = state.companies.find((c) => c.isPlayer)!;
  return { slot, companyName: me.name, day: state.day, cash: me.ledger.cash, mode: state.mode, savedAt };
}

export function serializeState(state: GameState, slot: string, savedAt = Date.now()): string {
  const stateJson = JSON.stringify(state);
  const file: SaveFile = {
    format: SAVE_FORMAT,
    saveVersion: SAVE_VERSION,
    savedAt,
    checksum: fnv1a(stateJson),
    meta: makeMeta(state, slot, savedAt),
    state,
  };
  return JSON.stringify(file);
}

/** 이전 버전 저장 데이터를 현재 버전으로 변환. 버전마다 함수 하나씩 추가합니다. */
const MIGRATIONS: Record<number, (s: any) => any> = {
  // 예: 0 → 1 (프로토타입 저장 형식). 누락 필드를 기본값으로 채움
  0: (s) => ({ ...s, saveVersion: 1, demandCarry: s.demandCarry ?? {}, objectives: s.objectives ?? [], tutorial: s.tutorial ?? null, gameOver: s.gameOver ?? null }),
};

export type LoadResult = { ok: true; state: GameState; migratedFrom?: number; warning?: string } | { ok: false; error: string };

export function deserializeState(text: string): LoadResult {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '저장 파일을 읽을 수 없습니다(JSON 형식 오류).' };
  }
  if (!raw || raw.format !== SAVE_FORMAT || typeof raw.saveVersion !== 'number' || !raw.state) {
    return { ok: false, error: 'EUM BUSINESS EMPIRE 3D 저장 파일이 아닙니다.' };
  }
  if (raw.saveVersion > SAVE_VERSION) {
    return { ok: false, error: `더 새로운 버전(v${raw.saveVersion})에서 만든 저장입니다. 게임을 업데이트하세요.` };
  }
  let warning: string | undefined;
  // 체크섬 검사: 상태 부분 원문을 다시 직렬화해 비교
  const stateJson = JSON.stringify(raw.state);
  if (raw.checksum && fnv1a(stateJson) !== raw.checksum) {
    warning = '체크섬이 일치하지 않습니다. 파일이 수정되었거나 손상되었을 수 있습니다.';
  }
  let s = raw.state;
  let v = raw.saveVersion as number;
  const from = v;
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) return { ok: false, error: `v${v} 저장 데이터를 변환할 수 없습니다.` };
    s = m(s);
    v++;
  }
  const problem = validateState(s);
  if (problem) return { ok: false, error: `저장 데이터 손상: ${problem}` };
  return { ok: true, state: s as GameState, migratedFrom: from !== SAVE_VERSION ? from : undefined, warning };
}

export function validateState(s: any): string | null {
  if (typeof s !== 'object' || s === null) return '상태 없음';
  const need: [string, string][] = [
    ['day', 'number'], ['rng', 'number'], ['seed', 'number'], ['nextId', 'number'], ['mode', 'string'], ['difficulty', 'string'],
  ];
  for (const [k, t] of need) if (typeof s[k] !== t) return `${k} 필드 오류`;
  for (const k of ['companies', 'buildings', 'externals', 'contracts', 'shipments', 'districts', 'news']) {
    if (!Array.isArray(s[k])) return `${k} 목록 없음`;
  }
  if (!s.map || !Array.isArray(s.map.tiles) || s.map.tiles.length !== s.map.size * s.map.size) return '지도 데이터 오류';
  if (!s.companies.some((c: any) => c.isPlayer)) return '플레이어 회사 없음';
  for (const c of s.companies) {
    if (!c.ledger || typeof c.ledger.cash !== 'number') return `회사 ${c.name} 원장 오류`;
    const sum = Object.values(c.ledger as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
    if (sum !== 0) return `회사 ${c.name} 대차 불일치`;
  }
  for (const b of s.buildings) {
    if (typeof b.id !== 'number' || typeof b.x !== 'number' || !b.inv) return '건물 데이터 오류';
    for (const lot of Object.values(b.inv as Record<string, any>)) {
      if (!Number.isInteger(lot.qty) || lot.qty < 0) return `${b.name} 재고 수량 오류`;
    }
  }
  return null;
}
