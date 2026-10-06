import { DurableObject } from 'cloudflare:workers'
import { isTimeZone, nextFire, parseStatus, reminderMessage, TIME, type Reminder, type TrainingStatus } from './reminders'
import { sendPush, type PushTarget, type Vapid } from './webpush'

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
//
// Daily reminders (Web Push), once the VAPID secrets are set (see README):
//
//   GET    /push/key                    the VAPID public key; 404 when reminders aren't set up
//   PUT    /users/:name/reminder        { subscription, time: "HH:MM", tz } from one device
//   DELETE /users/:name/reminder        { endpoint }
//   POST   /users/:name/reminder/test   { endpoint }: sends a notification now
//   PUT    /users/:name/status          the app's TrainingStatus (see reminders.ts)
//
// The Durable Object's alarm fires at the next reminder and skips devices whose
// user has met today's goal.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'X-Version',
  'Access-Control-Max-Age': '86400',
}

// Lichess usernames: letters, digits, _ and -.
const USERNAME = /^[a-z0-9_-]{2,30}$/
const MAX_BYTES = 20 * 1024 * 1024
// Stored values are limited to 2 MB, so a document is split into chunks.
const CHUNK = 1024 * 1024

// Push services of the browsers: only these are sent to.
const PUSH_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']
const MAX_REMINDERS = 10
const MAX_STATUS_BYTES = 64 * 1024
// A reminder still undelivered after this long isn't worth showing.
const REMINDER_TTL = 4 * 3600

type PushEnv = Env & Partial<Record<'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT', string>>

function vapidOf(env: PushEnv): Vapid | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null
}

function parseTarget(x: unknown): PushTarget | null {
  const t = x as PushTarget | undefined
  if (typeof t?.endpoint !== 'string' || typeof t.keys?.p256dh !== 'string' || typeof t.keys.auth !== 'string') return null
  let url: URL
  try {
    url = new URL(t.endpoint)
  } catch {
    return null
  }
  const known = PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
  return url.protocol === 'https:' && known ? { endpoint: t.endpoint, keys: { p256dh: t.keys.p256dh, auth: t.keys.auth } } : null
}

function reply(status: number, version: number, body: BodyInit | null = null, type = 'text/plain') {
  return new Response(body, { status, headers: { ...CORS, 'X-Version': String(version), 'Content-Type': type } })
}

export class UserStore extends DurableObject<PushEnv> {
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

  async subscribe(target: PushTarget, time: string, tz: string): Promise<void> {
    const reminders = (await this.reminders()).filter((r) => r.endpoint !== target.endpoint)
    reminders.push({ ...target, time, tz, next: nextFire(time, tz, Date.now()) })
    await this.saveReminders(reminders.slice(-MAX_REMINDERS))
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.saveReminders((await this.reminders()).filter((r) => r.endpoint !== endpoint))
  }

  async setStatus(status: TrainingStatus): Promise<void> {
    await this.ctx.storage.put('status', status)
  }

  /** Sends a notification to one device now. Resolves to the push service's status, or null for an unknown device. */
  async test(endpoint: string): Promise<number | null> {
    const vapid = vapidOf(this.env)
    const r = (await this.reminders()).find((x) => x.endpoint === endpoint)
    if (!vapid || !r) return null
    const message = { title: 'Reminders are on', body: `You'll be reminded at ${r.time} on days you haven't trained yet.`, url: '' }
    const code = await sendPush(r, message, vapid, { ttl: 600 })
    if (code === 404 || code === 410) await this.unsubscribe(endpoint)
    return code
  }

  async alarm(): Promise<void> {
    const vapid = vapidOf(this.env)
    if (!vapid) return
    const now = Date.now()
    const status = await this.ctx.storage.get<TrainingStatus>('status')
    const kept: Reminder[] = []
    for (const r of await this.reminders()) {
      if (r.next <= now + 60_000) {
        const message = reminderMessage(status, r.tz, now)
        if (message) {
          const code = await sendPush(r, message, vapid, { ttl: REMINDER_TTL, topic: 'reminder' }).catch(() => 0)
          // The browser dropped the subscription (uninstalled, permission revoked).
          if (code === 404 || code === 410) continue
        }
        r.next = nextFire(r.time, r.tz, Math.max(now, r.next))
      }
      kept.push(r)
    }
    await this.saveReminders(kept)
  }

  private async reminders(): Promise<Reminder[]> {
    return (await this.ctx.storage.get<Reminder[]>('reminders')) ?? []
  }

  /** Stores the reminders and sets the alarm for the next one. */
  private async saveReminders(reminders: Reminder[]): Promise<void> {
    await this.ctx.storage.put('reminders', reminders)
    if (reminders.length) await this.ctx.storage.setAlarm(Math.min(...reminders.map((r) => r.next)))
    else await this.ctx.storage.deleteAlarm()
  }
}

async function readJson(req: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const body = await req.arrayBuffer()
  if (body.byteLength > maxBytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(body))
  } catch {
    return null
  }
}

export default {
  async fetch(req, env: PushEnv): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const url = new URL(req.url)
    if (url.pathname === '/push/key' && req.method === 'GET') {
      const vapid = vapidOf(env)
      return vapid ? reply(200, 0, vapid.publicKey) : reply(404, 0, 'Reminders are not set up on this server')
    }
    const match = url.pathname.match(/^\/users\/([^/]+)(\/reminder|\/reminder\/test|\/status)?$/)
    if (!match) return reply(404, 0, 'Not found')
    const user = decodeURIComponent(match[1]).toLowerCase()
    if (!USERNAME.test(user)) return reply(400, 0, 'Invalid username')
    const store = env.USERS.get(env.USERS.idFromName(user))

    if (match[2]) return reminderRoute(req, match[2], store, env)

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
} satisfies ExportedHandler<PushEnv>

async function reminderRoute(req: Request, route: string, store: DurableObjectStub<UserStore>, env: PushEnv): Promise<Response> {
  if (route === '/status') {
    if (req.method !== 'PUT') return reply(405, 0, 'Method not allowed')
    const status = parseStatus(await readJson(req, MAX_STATUS_BYTES))
    if (!status) return reply(400, 0, 'Invalid status')
    await store.setStatus(status)
    return reply(204, 0)
  }
  if (!vapidOf(env)) return reply(404, 0, 'Reminders are not set up on this server')
  const body = (await readJson(req)) as { subscription?: unknown; endpoint?: unknown; time?: unknown; tz?: unknown } | null
  if (route === '/reminder' && req.method === 'PUT') {
    const target = parseTarget(body?.subscription)
    const { time, tz } = body ?? {}
    if (!target) return reply(400, 0, 'Invalid subscription')
    if (typeof time !== 'string' || !TIME.test(time) || typeof tz !== 'string' || !isTimeZone(tz)) return reply(400, 0, 'Invalid time')
    await store.subscribe(target, time, tz)
    return reply(204, 0)
  }
  if (typeof body?.endpoint !== 'string') return reply(400, 0, 'Missing endpoint')
  if (route === '/reminder' && req.method === 'DELETE') {
    await store.unsubscribe(body.endpoint)
    return reply(204, 0)
  }
  if (route === '/reminder/test' && req.method === 'POST') {
    const code = await store.test(body.endpoint)
    if (code === null) return reply(404, 0, 'This device has no reminder: turn reminders off and on again.')
    if (code === 404 || code === 410) return reply(410, 0, 'This device stopped accepting notifications: turn reminders off and on again.')
    return code >= 200 && code < 300 ? reply(204, 0) : reply(502, 0, `The push service answered ${code}`)
  }
  return reply(405, 0, 'Method not allowed')
}
