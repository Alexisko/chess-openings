import { db, type AppDB } from '../../db/schema'
import { canonicalUci, positionKey } from '../chess/position'

export type Speed = 'blitz' | 'rapid' | 'classical'
export const ALL_SPEEDS: Speed[] = ['blitz', 'rapid', 'classical']
/** Rating buckets supported by the Lichess explorer (lower bound of each band). */
export const RATING_BUCKETS = [400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500] as const

export interface ExplorerFilter {
  db: 'lichess' | 'masters'
  speeds: Speed[]
  ratings: number[]
}

/** Default filter derived from the user's Lichess blitz rating (~1630). */
export const DEFAULT_FILTER: ExplorerFilter = {
  db: 'lichess',
  speeds: ['blitz', 'rapid', 'classical'],
  ratings: [1600, 1800, 2000],
}

export interface ExplorerMove {
  uci: string
  san: string
  white: number
  draws: number
  black: number
  averageRating?: number
}

export interface ExplorerData {
  white: number
  draws: number
  black: number
  moves: ExplorerMove[]
  opening: { eco: string; name: string } | null
}

export const totalGames = (x: { white: number; draws: number; black: number }) => x.white + x.draws + x.black

export function filterHash(f: ExplorerFilter): string {
  if (f.db === 'masters') return 'masters'
  return `lichess:${[...f.speeds].sort().join(',')}:${[...f.ratings].sort((a, b) => a - b).join(',')}`
}

export function explorerUrl(fen: string, f: ExplorerFilter): string {
  const params = new URLSearchParams({ fen, moves: '30', topGames: '0' })
  if (f.db === 'lichess') {
    params.set('variant', 'standard')
    params.set('speeds', f.speeds.join(','))
    params.set('ratings', f.ratings.join(','))
    params.set('recentGames', '0')
  }
  return `https://explorer.lichess.org/${f.db}?${params}`
}

export class AuthRequiredError extends Error {
  constructor() {
    super('The Lichess opening explorer requires you to log in with Lichess.')
  }
}

type Fetch = typeof fetch
type Sleep = (ms: number) => Promise<void>
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Serialises requests to the explorer (one at a time, with a minimum gap) and
 * waits a full minute after a 429, as Lichess asks API clients to do.
 */
export class RequestQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private lastAt = Number.NEGATIVE_INFINITY
  private readonly minGapMs: number
  private readonly fetchFn: Fetch
  private readonly sleep: Sleep
  private readonly clock: () => number

  constructor(
    minGapMs = 300,
    fetchFn: Fetch = (...a) => fetch(...a),
    sleep: Sleep = realSleep,
    clock: () => number = Date.now,
  ) {
    this.minGapMs = minGapMs
    this.fetchFn = fetchFn
    this.sleep = sleep
    this.clock = clock
  }

  run(url: string, init?: RequestInit): Promise<Response> {
    const job = this.tail.then(() => this.exec(url, init))
    this.tail = job.catch(() => undefined)
    return job
  }

  private async exec(url: string, init?: RequestInit, attempt = 0): Promise<Response> {
    const wait = this.lastAt + this.minGapMs - this.clock()
    if (wait > 0) await this.sleep(wait)
    this.lastAt = this.clock()
    const res = await this.fetchFn(url, init)
    if (res.status === 429 && attempt < 2) {
      await this.sleep(60_000)
      return this.exec(url, init, attempt + 1)
    }
    return res
  }
}

const CACHE_TTL = 30 * 24 * 3600 * 1000

export class ExplorerClient {
  private readonly getToken: () => Promise<string | undefined>
  private readonly queue: RequestQueue
  private readonly d: AppDB

  constructor(getToken: () => Promise<string | undefined>, queue = new RequestQueue(), d: AppDB = db) {
    this.getToken = getToken
    this.queue = queue
    this.d = d
  }

  cacheKey(fen: string, f: ExplorerFilter) {
    return `${filterHash(f)}|${positionKey(fen)}`
  }

  async cached(fen: string, f: ExplorerFilter): Promise<ExplorerData | undefined> {
    const hit = await this.d.explorerCache.get(this.cacheKey(fen, f))
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL) return hit.data as ExplorerData
    return undefined
  }

  async get(fen: string, f: ExplorerFilter): Promise<ExplorerData> {
    const hit = await this.cached(fen, f)
    if (hit) return hit
    const token = await this.getToken()
    if (!token) throw new AuthRequiredError()
    const res = await this.queue.run(explorerUrl(fen, f), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (res.status === 401) throw new AuthRequiredError()
    if (!res.ok) throw new Error(`Explorer error ${res.status}`)
    const raw = (await res.json()) as ExplorerData
    const data: ExplorerData = {
      white: raw.white,
      draws: raw.draws,
      black: raw.black,
      opening: raw.opening ?? null,
      // Store moves in our canonical notation so they compare with repertoire moves.
      moves: raw.moves.map((m) => ({
        uci: canonicalUci(fen, m.uci) ?? m.uci,
        san: m.san,
        white: m.white,
        draws: m.draws,
        black: m.black,
        averageRating: m.averageRating,
      })),
    }
    await this.d.explorerCache.put({ key: this.cacheKey(fen, f), data, fetchedAt: Date.now() })
    return data
  }
}
