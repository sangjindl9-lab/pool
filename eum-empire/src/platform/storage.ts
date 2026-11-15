// IndexedDB 저장소: 슬롯별 저장(수동 5개 + 자동 1개), 파일 내보내기·가져오기
import { deserializeState, makeMeta, serializeState, type LoadResult, type SaveMeta } from '../engine/save';
import type { GameState } from '../engine/types';

const DB = 'eum-empire';
const STORE = 'saves';
export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABEL: Record<Slot, string> = {
  auto: '자동 저장', slot1: '슬롯 1', slot2: '슬롯 2', slot3: '슬롯 3', slot4: '슬롯 4', slot5: '슬롯 5',
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    t.oncomplete = () => db.close();
  }));
}

interface Record_ { meta: SaveMeta; text: string }

export async function saveToSlot(state: GameState, slot: Slot): Promise<void> {
  const now = Date.now();
  const rec: Record_ = { meta: makeMeta(state, slot, now), text: serializeState(state, slot, now) };
  await tx('readwrite', (s) => s.put(rec, slot));
}

export async function loadFromSlot(slot: Slot): Promise<LoadResult> {
  const rec = await tx<Record_ | undefined>('readonly', (s) => s.get(slot));
  if (!rec) return { ok: false, error: '빈 슬롯입니다' };
  return deserializeState(rec.text);
}

export async function listSlots(): Promise<Partial<Record<Slot, SaveMeta>>> {
  const out: Partial<Record<Slot, SaveMeta>> = {};
  try {
    for (const slot of SLOTS) {
      const rec = await tx<Record_ | undefined>('readonly', (s) => s.get(slot));
      if (rec) out[slot] = rec.meta;
    }
  } catch {
    /* 저장소 사용 불가 */
  }
  return out;
}

export async function deleteSlot(slot: Slot): Promise<void> {
  await tx('readwrite', (s) => s.delete(slot));
}

export function exportFile(state: GameState): void {
  const text = serializeState(state, 'export');
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const me = state.companies.find((c) => c.isPlayer)!;
  a.download = `eum-empire-${me.name}-day${state.day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importFile(file: File): Promise<LoadResult> {
  return file.text().then(deserializeState);
}
