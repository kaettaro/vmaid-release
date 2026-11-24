import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(import.meta.dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      // FBX の変換(main)が使う three と FBXLoader は、バンドルに含める(配布版では、three/examples が除外されるので、外部のままだと読み込めない)
      externalizeDeps: { exclude: ['three'] },
      rollupOptions: {
        // 本体と、内蔵LLMの推論ワーカー(別プロセスで動かす)の2つを出力する
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          llmWorker: resolve(import.meta.dirname, 'src/main/llm/worker.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        // キャラ・設定・パネル用(index)と、スクリプト Mod の窓用(scriptmod)。どちらも別のファイルで出力する
        input: {
          index: resolve(import.meta.dirname, 'src/preload/index.ts'),
          scriptmod: resolve(import.meta.dirname, 'src/preload/scriptMod.ts')
        },
        // sandbox: true のpreloadはESMを読めないため、CommonJSの単一ファイルで出力する
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: { alias: { '@shared': shared } },
    plugins: [react()],
    build: {
      rollupOptions: {
        // キャラウィンドウと設定ウィンドウは別HTML(別エントリ)
        input: {
          character: resolve(import.meta.dirname, 'src/renderer/character/index.html'),
          settings: resolve(import.meta.dirname, 'src/renderer/settings/index.html'),
          panel: resolve(import.meta.dirname, 'src/renderer/panel/index.html'),
          overlay: resolve(import.meta.dirname, 'src/renderer/overlay/index.html'),
          preview: resolve(import.meta.dirname, 'src/renderer/preview/index.html'),
          game: resolve(import.meta.dirname, 'src/renderer/game/index.html'),
          movearea: resolve(import.meta.dirname, 'src/renderer/movearea/index.html'),
          modlist: resolve(import.meta.dirname, 'src/renderer/modlist/index.html')
        }
      }
    }
  }
})
