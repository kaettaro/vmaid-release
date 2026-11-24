import { protocol } from 'electron'

/**
 * アプリ専用のプロトコルを、まとめて登録する。app.whenReady() より前に、1回だけ呼ぶ(スキームの登録は、準備前の、1回だけ)。
 * - vmaid-model: PMX のモデルを、モデルのフォルダの中から読む(MMD 対応 Mod)
 * - vmaid-ext: スクリプト Mod のファイルを、Mod ごとの窓へ配る(ADR 0002)
 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'vmaid-model', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
    { scheme: 'vmaid-ext', privileges: { standard: true, secure: true } }
  ])
}
