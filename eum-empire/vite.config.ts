import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' : 빌드 결과를 file:// 로도 열 수 있어 Electron/Tauri 패키징에 그대로 사용 가능
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
