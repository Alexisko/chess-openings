import { DurableObject } from 'cloudflare:workers'

// Sync store for the Opening Trainer. Each user (their Lichess username, which
// the app doesn't verify) has one Durable Object holding one gzipped JSON
// document and a version number. The app merges on its side and uploads the
// whole document; a write only succeeds if it was based on the current version,
// so two devices can't overwrite each other's changes.
//
//   GET /users/:name?have=N  200 + gzip body, 204 when version N is current, 404 when empty
//   PUT /users/:name?base=N  gzip body; 200, or 409 when the stored version isn't N
//
// Every response carries the stored version in X-Version. The data is not
// private: anyone who knows a username can read it.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'X-Version',
  'Access-Control-Max-Age': '86400',
}

// Lichess usernames: letters, digits, _ and -.
const USERNAME = /^[a-z0-9_-]{2,30}$/
const MAX_BYTES = 20 * 1024 * 1024
// Stored values are limited to 2 MB, so a document is split into chunks.
const CHUNK = 1024 * 1024

function reply(status: number, version: number, body: BodyInit | null = null, type = 'text/plain') {
  return new Response(body, { status, headers: { ...CORS, 'X-Version': String(version), 'Content-Type': type } })
}

export class UserStore extends DurableObject<Env> {
  async load(have: number | null): Promise<{ version: number; data?: Uint8Array }> {
    const version = (await this.ctx.storage.get<number>('version')) ?? 0
    if (version === 0 || version === have) return { version }
    const chunks = (await this.ctx.storage.get<number>('chunks')) ?? 0
    const parts = await this.ctx.storage.get<Uint8Array>(Array.from({ length: chunks }, (_, i) => `chunk:${i}`))
    const data = new Uint8Array([...parts.values()].reduce((n, p) => n + p.byteLength, 0))
    let offset = 0
    for (let i = 0; i < chunks; i++) {
      const p = parts.get(`chunk:${i}`)!
      data.set(p, offset)
      offset += p.byteLength
    }
    return { version, data }
  }

  async save(base: number, data: Uint8Array): Promise<{ ok: boolean; version: number }> {
    const version = (await this.ctx.storage.get<number>('version')) ?? 0
    if (version !== base) return { ok: false, version }
    const chunks = Math.ceil(data.byteLength / CHUNK)
    const old = (await this.ctx.storage.get<number>('chunks')) ?? 0
    const entries: Record<string, unknown> = { version: version + 1, chunks, updatedAt: Date.now() }
    for (let i = 0; i < chunks; i++) entries[`chunk:${i}`] = data.slice(i * CHUNK, (i + 1) * CHUNK)
    await this.ctx.storage.put(entries)
    if (old > chunks) await this.ctx.storage.delete(Array.from({ length: old - chunks }, (_, i) => `chunk:${chunks + i}`))
    return { ok: true, version: version + 1 }
  }
}

export default {
  async fetch(req, env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const url = new URL(req.url)
    const match = url.pathname.match(/^\/users\/([^/]+)$/)
    if (!match) return reply(404, 0, 'Not found')
    const user = decodeURIComponent(match[1]).toLowerCase()
    if (!USERNAME.test(user)) return reply(400, 0, 'Invalid username')
    const store = env.USERS.get(env.USERS.idFromName(user))

    if (req.method === 'GET') {
      const have = url.searchParams.has('have') ? Number(url.searchParams.get('have')) : null
      const { version, data } = await store.load(have)
      if (version === 0) return reply(404, 0)
      if (!data) return reply(204, version)
      return reply(200, version, data, 'application/octet-stream')
    }

    if (req.method === 'PUT') {
      const base = Number(url.searchParams.get('base'))
      if (!Number.isInteger(base) || base < 0) return reply(400, 0, 'Missing base version')
      const data = new Uint8Array(await req.arrayBuffer())
      if (!data.byteLength) return reply(400, 0, 'Empty body')
      if (data.byteLength > MAX_BYTES) return reply(413, 0, 'Too large')
      const { ok, version } = await store.save(base, data)
      return reply(ok ? 200 : 409, version)
    }

    return reply(405, 0, 'Method not allowed')
  },
} satisfies ExportedHandler<Env>
