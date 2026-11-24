import { createHash } from 'node:crypto'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { protocol } from 'electron'

// PMX モデルの読み込み用の専用プロトコル `vmaid-model://<トークン>/<モデルのフォルダ内の相対パス>`。
// PMX は、テクスチャを相対パスで参照するので、レンダラーが、モデルのフォルダの中だけを読めるようにする。
// 配信するのは、登録したモデルのフォルダの中の、モデル・画像だけ(フォルダの外・シンボリックリンクでの脱出・その他の種類は 404/403)。
// ネットワークには出ない。MMD 対応 Mod が OFF のときは、何も配信しない。

export const MODEL_SCHEME = 'vmaid-model'

/** 配信してよいファイルの種類と MIME */
const MIME: Record<string, string> = {
  '.pmx': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.tga': 'application/octet-stream',
  '.dds': 'application/octet-stream',
  '.spa': 'application/octet-stream',
  '.sph': 'application/octet-stream'
}

/**
 * 大文字小文字だけが違うパスを、実在する名前に直す(Windows で作った PMX は、「toon/」と「Toon/」のように、表記が揺れる。macOS は区別するので、そのままでは見つからない)。
 * root の中だけを、1 階層ずつ、readdir で探す。見つからなければ null
 */
export async function resolveCaseInsensitive(root: string, rel: string): Promise<string | null> {
  let cur = root
  for (const part of rel.split(/[\\/]+/).filter((p) => p !== '')) {
    if (part === '..' || part === '.') return null
    let names: string[]
    try {
      names = await readdir(cur)
    } catch {
      return null
    }
    const hit = names.includes(part) ? part : names.find((n) => n.toLowerCase() === part.toLowerCase())
    if (hit === undefined) return null
    cur = join(cur, hit)
  }
  return cur
}

/** トークン → モデルのフォルダ。ファイルを解決する部分は、Electron に依存しない(テストできる) */
export class ModelRoots {
  private readonly roots = new Map<string, string>()

  /** モデルのフォルダを登録して、トークンを返す(同じフォルダなら、同じトークン) */
  register(dir: string): string {
    const root = resolve(dir)
    const token = createHash('sha256').update(root).digest('hex').slice(0, 16)
    this.roots.set(token, root)
    return token
  }

  /** トークンと相対パスから、配信するファイルの実パス。許されないものは null */
  async resolveFile(token: string, relPath: string): Promise<{ path: string; mime: string } | null> {
    const root = this.roots.get(token)
    if (!root) return null
    const mime = MIME[extname(relPath).toLowerCase()]
    if (!mime) return null
    let full: string
    try {
      full = resolve(root, decodeURIComponent(relPath).replace(/^[/\\]+/, ''))
    } catch {
      return null
    }
    if (!full.startsWith(root + sep)) return null
    try {
      // シンボリックリンクで、フォルダの外を指していないか(実パスで確かめる)。無ければ、大文字小文字の違いを直して探す
      const target = (await realpath(full).then(() => full, () => resolveCaseInsensitive(root, decodeURIComponent(relPath)))) ?? full
      const [realRoot, realFull] = await Promise.all([realpath(root), realpath(target)])
      if (!realFull.startsWith(realRoot + sep)) return null
      return { path: realFull, mime }
    } catch {
      return null
    }
  }
}

export const modelRoots = new ModelRoots()

/** `vmaid-model://<トークン>/<相対パス>` の URL。pmxPath のフォルダを登録する */
export function modelUrlFor(pmxPath: string): string {
  const token = modelRoots.register(dirname(pmxPath))
  const name = pmxPath.slice(dirname(pmxPath).length + 1)
  return `${MODEL_SCHEME}://${token}/${encodeURIComponent(name)}`
}

/** app.whenReady() のあとに呼ぶ。`enabled()` が false の間は、何も配信しない */
export function handleModelScheme(enabled: () => boolean): void {
  protocol.handle(MODEL_SCHEME, async (req) => {
    if (!enabled()) return new Response('disabled', { status: 403 })
    const u = new URL(req.url)
    const file = await modelRoots.resolveFile(u.hostname, u.pathname)
    if (!file) return new Response('not found', { status: 404 })
    try {
      return new Response(await readFile(file.path), { headers: { 'content-type': file.mime } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
