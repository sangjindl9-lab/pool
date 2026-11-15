import { useSyncExternalStore } from 'react';
import { controller } from '../game/controller';

/** 컨트롤러 버전이 바뀔 때마다 다시 렌더링 */
export function useGame() {
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  return controller;
}
