import { useEffect } from 'react';
import { controller } from '../game/controller';
import { playSound } from '../platform/audio';
import { saveToSlot } from '../platform/storage';
import { useGame } from './hooks';
import { StartScreen } from './StartScreen';
import { GameScreen } from './GameScreen';

export function App() {
  const ctrl = useGame();
  useEffect(() => {
    controller.hooks = {
      sound: (n) => { if (controller.settings.sound) playSound(n, controller.settings.volume); },
      autosave: async (s) => {
        try { await saveToSlot(s, 'auto'); controller.toast('자동 저장 완료', 'info'); }
        catch (e) { controller.toast(`자동 저장 실패: ${(e as Error).message}`, 'error'); }
      },
    };
    // 개발·검증용: 콘솔에서 상태 확인
    (window as unknown as { eum: typeof controller }).eum = controller;
  }, []);
  return ctrl.state ? <GameScreen /> : <StartScreen />;
}
