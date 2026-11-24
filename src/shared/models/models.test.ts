import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DOWNLOAD_HOSTS,
  isAllowedDownloadUrl,
  ProgressTracker,
  resumeDecision,
  resumeHeaders,
  retryDelayMs
} from './download'
import { formatBytes, modelFileName, parseRegistry, pickDefaultModel, type ModelEntry } from './registry'

const registry = parseRegistry(JSON.parse(readFileSync(new URL('../../../resources/models.json', import.meta.url), 'utf-8')))
const byId = (id: string): ModelEntry => registry.find((m) => m.id === id)!

describe('resources/models.json', () => {
  it('スキーマに合い、ID重複がなく、3候補が入っている', () => {
    expect(registry.map((m) => m.id)).toEqual(
      expect.arrayContaining(['qwen3-4b-instruct-2507-q4km', 'gemma-4-e4b-it-q4km', 'ministral-3-3b-instruct-2512-q4km'])
    )
  })
  it('全モデルが寛容ライセンスで、URLは許可ホストのhttps、SHA-256とサイズを持つ', () => {
    for (const m of registry) {
      expect(m.license).toBe('Apache-2.0')
      expect(isAllowedDownloadUrl(m.url)).toBe(true)
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(m.sizeBytes).toBeGreaterThan(1e9)
    }
  })
  it('重複IDは弾く', () => {
    const m = registry[0]
    expect(() => parseRegistry({ version: 1, models: [m, m] })).toThrow('重複')
  })
  it('http や不正なSHAは弾く', () => {
    expect(() => parseRegistry({ version: 1, models: [{ ...registry[0], url: 'http://huggingface.co/x' }] })).toThrow()
    expect(() => parseRegistry({ version: 1, models: [{ ...registry[0], sha256: 'abc' }] })).toThrow()
  })
})

describe('pickDefaultModel(PCのメモリで既定を切り替える)', () => {
  const prefer = ['gemma-4-e4b-it-q4km', 'qwen3-4b-instruct-2507-q4km']
  it('16GB以上なら Gemma 4 E4B', () => {
    expect(pickDefaultModel(registry, 16, prefer).id).toBe('gemma-4-e4b-it-q4km')
    expect(pickDefaultModel(registry, 32, prefer).id).toBe('gemma-4-e4b-it-q4km')
  })
  it('8GBなら Qwen3-4B(軽量)', () => {
    expect(pickDefaultModel(registry, 8, prefer).id).toBe('qwen3-4b-instruct-2507-q4km')
  })
  it('12GBでもGemma 4は余裕が少ないので軽量を選ぶ', () => {
    expect(pickDefaultModel(registry, 12, prefer).id).toBe('qwen3-4b-instruct-2507-q4km')
  })
  it('極端に少ないメモリでも、最小のモデルを返す(落ちない)', () => {
    expect(pickDefaultModel(registry, 2, prefer).id).toBe('ministral-3-3b-instruct-2512-q4km')
  })
  it('優先順を省略しても、動かせる中で最大のモデルを返す', () => {
    expect(pickDefaultModel(registry, 8).sizeBytes).toBe(byId('qwen3-4b-instruct-2507-q4km').sizeBytes)
  })
})

describe('modelFileName / formatBytes', () => {
  it('ファイル名はIDから決める', () => expect(modelFileName({ id: 'a-b.c' })).toBe('a-b.c.gguf'))
  it('人が読める容量', () => {
    expect(formatBytes(4977171584)).toBe('5.0 GB')
    expect(formatBytes(2497281120)).toBe('2.5 GB')
    expect(formatBytes(523_000_000)).toBe('523 MB')
  })
})

describe('isAllowedDownloadUrl', () => {
  it('Hugging Face とそのCDNのサブドメインは許可', () => {
    for (const u of ['https://huggingface.co/a/b/resolve/main/x.gguf', 'https://cdn-lfs.hf.co/x', 'https://cas-bridge.xethub.hf.co/y']) {
      expect(isAllowedDownloadUrl(u)).toBe(true)
    }
  })
  it('他のホスト・似たホスト名・http・不正URLは拒否', () => {
    for (const u of ['https://evil.com/x', 'https://huggingface.co.evil.com/x', 'https://nothf.co/x', 'http://huggingface.co/x', 'not a url', 'file:///etc/passwd']) {
      expect(isAllowedDownloadUrl(u)).toBe(false)
    }
  })
  it('テスト用にhttpと別ホストを許可できる', () => {
    expect(isAllowedDownloadUrl('http://127.0.0.1:9/x', ['127.0.0.1'], true)).toBe(true)
    expect(DEFAULT_DOWNLOAD_HOSTS).toContain('huggingface.co')
  })
})

describe('再開', () => {
  it('何も落としていなければ Range を付けず、途中からなら付ける', () => {
    expect(resumeHeaders(0)).toEqual({})
    expect(resumeHeaders(1024)).toEqual({ Range: 'bytes=1024-' })
  })
  it('206 で開始位置が一致すれば追記、Rangeを無視(200)されたら最初から', () => {
    expect(resumeDecision(1024, 206, 'bytes 1024-9999/10000')).toBe('append')
    expect(resumeDecision(1024, 200, null)).toBe('restart')
    expect(resumeDecision(1024, 206, 'bytes 0-9999/10000')).toBe('restart') // 位置がずれていたら信用しない
    expect(resumeDecision(1024, 416, null)).toBe('fail')
    expect(resumeDecision(0, 200, null)).toBe('restart')
    expect(resumeDecision(0, 500, null)).toBe('fail')
  })
  it('再試行の待ち時間は指数的に伸び、上限がある', () => {
    expect([0, 1, 2, 3].map((n) => retryDelayMs(n))).toEqual([1000, 2000, 4000, 8000])
    expect(retryDelayMs(20)).toBe(30000)
  })
})

describe('ProgressTracker', () => {
  it('割合・速度・残り時間を出す', () => {
    const t = new ProgressTracker(1000)
    t.update(0, 0)
    const s = t.update(500, 1000)
    expect(s.fraction).toBe(0.5)
    expect(s.bytesPerSec).toBeCloseTo(500)
    expect(s.etaSec).toBeCloseTo(1)
  })
  it('開始直後は速度不明(null)。完了なら残り0、総量を超えても1に収まる', () => {
    const t = new ProgressTracker(100)
    expect(t.update(10, 0).etaSec).toBeNull()
    const done = t.update(100, 2000)
    expect(done.fraction).toBe(1)
    expect(done.etaSec).toBe(0)
    expect(t.update(150, 3000).fraction).toBe(1)
  })
  it('古いサンプルは捨てる(速度が最近の値になる)', () => {
    const t = new ProgressTracker(1e9, 5000)
    t.update(0, 0)
    t.update(1000, 1000) // 遅い
    t.update(1000, 10000) // 止まっていた
    const s = t.update(1000 + 5000, 11000) // 直近は速い
    expect(s.bytesPerSec).toBeGreaterThan(1000)
  })
})
