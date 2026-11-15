// 환경설정(브라우저 localStorage). 경제 상태와 무관한 표시·편의 설정만 저장합니다.
export interface Settings {
  sound: boolean;
  volume: number;
  shadows: boolean;
  decorCars: number;
  autosave: boolean;
  showFps: boolean;
}

const KEY = 'eum-empire-settings';
export const DEFAULT_SETTINGS: Settings = { sound: true, volume: 0.5, shadows: true, decorCars: 40, autosave: true, showFps: false };

export function loadSettings(): Settings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 불가 환경(사생활 보호 모드 등)에서는 무시 */
  }
}
