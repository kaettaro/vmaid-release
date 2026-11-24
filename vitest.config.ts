import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// shared/ は Electron 非依存の純粋TS。ここだけをテスト対象にする
export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: { include: ['src/shared/**/*.test.ts', 'src/main/models/**/*.test.ts', 'src/main/llm/**/*.test.ts', 'src/main/history/**/*.test.ts', 'src/main/*.test.ts'], environment: 'node' }
})
