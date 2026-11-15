import { useEffect, useRef, useState } from 'react';
import { controller } from '../game/controller';
import { BALANCE, type Difficulty } from '../engine/data/balance';
import { listSlots, loadFromSlot, importFile, SLOTS, SLOT_LABEL, type Slot } from '../platform/storage';
import type { SaveMeta } from '../engine/save';
import { formatDate, formatWon } from './format';

const DIFF_LABEL: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };

export function StartScreen() {
  const [mode, setMode] = useState<'tutorial' | 'free'>('tutorial');
  const [name, setName] = useState('이음상사');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [capital, setCapital] = useState<number>(BALANCE.difficulty.normal.capital);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [slots, setSlots] = useState<Partial<Record<Slot, SaveMeta>>>({});
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void listSlots().then(setSlots); }, []);
  useEffect(() => setCapital(BALANCE.difficulty[difficulty].capital), [difficulty]);

  const start = () => controller.start({ seed, mode, difficulty: mode === 'tutorial' ? 'easy' : difficulty, companyName: name.trim() || '이음상사', capital: mode === 'tutorial' ? undefined : capital });
  const load = async (slot: Slot) => {
    const r = await loadFromSlot(slot);
    if (!r.ok) return setMsg(r.error);
    controller.load(r.state);
    if (r.warning) controller.toast(r.warning, 'error');
    if (r.migratedFrom !== undefined) controller.toast(`v${r.migratedFrom} 저장 데이터를 현재 버전으로 변환했습니다`, 'info');
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = await importFile(f);
    if (!r.ok) return setMsg(r.error);
    controller.load(r.state);
    if (r.warning) controller.toast(r.warning, 'error');
  };

  return (
    <div className="start">
      <div className="start-card">
        <h1>EUM BUSINESS EMPIRE <b>3D</b></h1>
        <p className="sub">생산 · 유통 · 판매 · 투자 · 기업 경쟁 경영 시뮬레이션</p>
        <div className="start-grid">
          <section>
            <h2>새 게임</h2>
            <div className="seg">
              <button className={mode === 'tutorial' ? 'on' : ''} onClick={() => setMode('tutorial')}>튜토리얼</button>
              <button className={mode === 'free' ? 'on' : ''} onClick={() => setMode('free')}>자유 경영</button>
            </div>
            <p className="hint">{mode === 'tutorial'
              ? '부지 선택 → 소매점 건설 → 빵 구매 계약 → 가격 설정 → 첫 매출 → 월말 결산을 직접 해 보며 배웁니다. 경쟁사 1곳.'
              : '경쟁사 3곳(저가형·고급형·수직계열화형)과 함께 경영합니다. 목표: 3개월 연속 흑자, 빵 점유율 30%, 자체 공급망, 기업가치 20억원.'}</p>
            <label>회사 이름<input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} /></label>
            {mode === 'free' && (
              <>
                <label>난이도
                  <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                    {(Object.keys(BALANCE.difficulty) as Difficulty[]).map((d) => <option key={d} value={d}>{DIFF_LABEL[d]} (경쟁사 자본 {formatWon(BALANCE.difficulty[d].aiCapital)})</option>)}
                  </select>
                </label>
                <label>초기 자본
                  <select value={capital} onChange={(e) => setCapital(Number(e.target.value))}>
                    {[300_000_000, 400_000_000, 600_000_000, 1_000_000_000, 1_500_000_000].map((c) => <option key={c} value={c}>{formatWon(c)}</option>)}
                  </select>
                </label>
              </>
            )}
            <label>지도 시드<input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
            <button className="primary big" onClick={start}>게임 시작</button>
          </section>
          <section>
            <h2>불러오기</h2>
            <div className="slots">
              {SLOTS.map((s) => {
                const m = slots[s];
                return (
                  <button key={s} disabled={!m} onClick={() => load(s)} className="slot">
                    <b>{SLOT_LABEL[s]}</b>
                    {m ? <span>{m.companyName} · {formatDate(m.day)} · 현금 {formatWon(m.cash)}<br /><small>{new Date(m.savedAt).toLocaleString('ko-KR')}</small></span> : <span className="muted">비어 있음</span>}
                  </button>
                );
              })}
            </div>
            <button onClick={() => fileRef.current?.click()}>파일에서 가져오기…</button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            {msg && <p className="error">{msg}</p>}
          </section>
        </div>
        <p className="foot">조작: 좌클릭 드래그 이동 · 우클릭 드래그 회전 · 휠 확대/축소 · WASD/화살표 이동 · Q/E 회전 · Esc 취소</p>
      </div>
    </div>
  );
}
