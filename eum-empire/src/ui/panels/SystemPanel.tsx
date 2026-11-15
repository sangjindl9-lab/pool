import { useEffect, useRef, useState } from 'react';
import { deleteSlot, exportFile, importFile, listSlots, loadFromSlot, saveToSlot, SLOTS, SLOT_LABEL, type Slot } from '../../platform/storage';
import type { SaveMeta } from '../../engine/save';
import { formatDate, formatWon } from '../format';
import { useGame } from '../hooks';

export function SystemPanel() {
  const ctrl = useGame();
  const [slots, setSlots] = useState<Partial<Record<Slot, SaveMeta>>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => void listSlots().then(setSlots);
  useEffect(refresh, []);
  const save = async (slot: Slot) => {
    try { await saveToSlot(ctrl.state!, slot); ctrl.toast(`${SLOT_LABEL[slot]}에 저장했습니다`, 'ok'); refresh(); }
    catch (e) { ctrl.toast(`저장 실패: ${(e as Error).message}`, 'error'); }
  };
  const load = async (slot: Slot) => {
    const r = await loadFromSlot(slot);
    if (!r.ok) return ctrl.toast(r.error, 'error');
    ctrl.load(r.state);
    ctrl.toast(`${SLOT_LABEL[slot]}을(를) 불러왔습니다`, 'ok');
    if (r.warning) ctrl.toast(r.warning, 'error');
  };
  const st = ctrl.settings;
  return (
    <div className="two-col">
      <div>
        <h3>저장 슬롯</h3>
        <div className="slots">
          {SLOTS.map((slot) => {
            const m = slots[slot];
            return (
              <div key={slot} className="slot row">
                <span><b>{SLOT_LABEL[slot]}</b><br />{m ? <small>{m.companyName} · {formatDate(m.day)} · 현금 {formatWon(m.cash)} · {new Date(m.savedAt).toLocaleString('ko-KR')}</small> : <small className="muted">비어 있음</small>}</span>
                <span className="row">
                  {slot !== 'auto' && <button onClick={() => save(slot)}>저장</button>}
                  <button disabled={!m} onClick={() => load(slot)}>불러오기</button>
                  <button disabled={!m} className="danger" onClick={async () => { await deleteSlot(slot); refresh(); }}>삭제</button>
                </span>
              </div>
            );
          })}
        </div>
        <div className="row">
          <button onClick={() => exportFile(ctrl.state!)}>파일로 내보내기</button>
          <button onClick={() => fileRef.current?.click()}>파일 가져오기</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = await importFile(f);
            if (!r.ok) return ctrl.toast(r.error, 'error');
            ctrl.load(r.state);
            ctrl.toast('파일을 불러왔습니다', 'ok');
            if (r.warning) ctrl.toast(r.warning, 'error');
          }} />
        </div>
        <p className="muted small">저장 내용: 날짜·난수 상태, 도시·건물, 회사 원장·월별 결산·대출, 재고 수량·원가, 계약과 운송 중 배송, 경쟁사 상태, 통계, 튜토리얼 진행도. 저장 파일에는 버전과 체크섬이 들어갑니다.</p>
      </div>
      <div>
        <h3>환경설정</h3>
        <label className="toggle"><input type="checkbox" checked={st.sound} onChange={(e) => ctrl.updateSettings({ sound: e.target.checked })} /> 효과음</label>
        <label>음량<input type="range" min={0} max={1} step={0.05} value={st.volume} onChange={(e) => ctrl.updateSettings({ volume: Number(e.target.value) })} /></label>
        <label className="toggle"><input type="checkbox" checked={st.shadows} onChange={(e) => ctrl.updateSettings({ shadows: e.target.checked })} /> 그림자(끄면 성능 향상)</label>
        <label>장식 차량 수: {st.decorCars}<input type="range" min={0} max={150} step={10} value={st.decorCars} onChange={(e) => ctrl.updateSettings({ decorCars: Number(e.target.value) })} /></label>
        <p className="muted small">장식 차량은 경제 계산과 무관합니다. 실제 배송 트럭(흰 짐칸 + 회사 색)은 계약 배송과 연동됩니다.</p>
        <label className="toggle"><input type="checkbox" checked={st.autosave} onChange={(e) => ctrl.updateSettings({ autosave: e.target.checked })} /> 월말 자동 저장</label>
        <label className="toggle"><input type="checkbox" checked={st.showFps} onChange={(e) => ctrl.updateSettings({ showFps: e.target.checked })} /> 성능 정보 표시(FPS·하루 처리 시간)</label>
        <h3>게임</h3>
        <button className="danger" onClick={() => { if (confirm('저장하지 않은 진행은 사라집니다. 시작 화면으로 갈까요?')) ctrl.quit(); }}>시작 화면으로</button>
      </div>
    </div>
  );
}
