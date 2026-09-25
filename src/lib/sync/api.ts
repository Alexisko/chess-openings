import { parseBackup, toBackupJson } from '../../db/backup'
import type { SyncApi } from './sync'

// The sync server is the Cloudflare Worker in worker/. Set VITE_SYNC_URL to
// use another one (e.g. http://localhost:8787 with `npm run dev` in worker/).
export const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? 'https://opening-trainer-sync.opening-trainer-sync.workers.dev'

const userUrl = (user: string) => `${SYNC_URL}/users/${encodeURIComponent(user)}`

const gzip = (text: string) =>
  new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()

const gunzip = (data: ArrayBuffer) =>
  new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).text()

const versionOf = (res: Response) => Number(res.headers.get('X-Version') ?? 0)

export const httpApi: SyncApi = {
  async pull(user, have) {
    const res = await fetch(have ? `${userUrl(user)}?have=${have}` : userUrl(user), { cache: 'no-store' })
    if (res.status === 404) return { version: 0 }
    if (!res.ok) throw new Error(`The sync server answered ${res.status}`)
    if (res.status === 204) return { version: versionOf(res) }
    return { version: versionOf(res), snapshot: parseBackup(await gunzip(await res.arrayBuffer())) }
  },

  async push(user, base, snapshot) {
    const res = await fetch(`${userUrl(user)}?base=${base}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: await gzip(toBackupJson(snapshot)),
    })
    if (res.status === 409) return null
    if (!res.ok) throw new Error(`The sync server answered ${res.status}`)
    return versionOf(res)
  },
}
