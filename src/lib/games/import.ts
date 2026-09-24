import { db, type AppDB, type Game, type GameSource } from '../../db/schema'
import { getSettings, setSetting } from '../../db/settings'
import { LICHESS_PERF_TYPES, parseChesscomGame, parseLichessGame, type ChesscomGameJson, type LichessGameJson } from './parse'

/** How far back the first import goes. Later imports only fetch newer games. */
export const IMPORT_WINDOW_MS = 365 * 24 * 3600 * 1000

/**
 * Bumped when the import fetches games it used to skip (version 2 added
 * bullet, version 3 daily). Games stored by an older version are topped up with one full
 * import over the window; games already stored are kept.
 */
export const IMPORT_VERSION = 3

type Fetch = typeof fetch
type Sleep = (ms: number) => Promise<void>
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export interface ImportProgress {
  source: GameSource
  /** Games saved so far from this source. */
  saved: number
  status: string
}

export interface ImportOptions {
  lichessUser?: string
  lichessToken?: string
  chesscomUser?: string
  onProgress?: (p: ImportProgress) => void
  signal?: AbortSignal
  fetchFn?: Fetch
  sleep?: Sleep
  now?: number
}

export interface ImportResult {
  added: Record<GameSource, number>
  errors: string[]
}

/** Newest stored game from a source (ms), used to resume imports. */
async function newestGame(source: GameSource, d: AppDB): Promise<number | undefined> {
  const last = await d.games.where({ source }).sortBy('playedAt')
  return last.at(-1)?.playedAt
}

/** Stores games not already imported; returns how many were new. */
async function saveGames(games: Game[], d: AppDB): Promise<number> {
  if (!games.length) return 0
  const existing = await d.games.bulkGet(games.map((g) => g.id))
  const fresh = games.filter((_, i) => !existing[i])
  if (fresh.length) await d.games.bulkAdd(fresh)
  return fresh.length
}

/** Lichess refuses parallel exports from one IP (429); wait a minute and try again, as it asks. */
async function fetchWithRetry(url: string, init: RequestInit, fetchFn: Fetch, sleep: Sleep, onWait: () => void) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, init)
    if (res.status !== 429 || attempt >= 2) return res
    onWait()
    await sleep(60_000)
  }
}

/** Reads a newline-delimited JSON stream, calling `onRow` for every parsed line. */
export async function readNdjson(res: Response, onRow: (row: unknown) => Promise<void> | void) {
  if (!res.body) {
    for (const line of (await res.text()).split('\n')) if (line.trim()) await onRow(JSON.parse(line))
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    buf += decoder.decode(value, { stream: !done })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) await onRow(JSON.parse(line))
    if (done) break
  }
  if (buf.trim()) await onRow(JSON.parse(buf))
}

export async function importLichess(user: string, since: number, opts: ImportOptions, d: AppDB = db): Promise<number> {
  const fetchFn = opts.fetchFn ?? ((...a) => fetch(...a))
  const params = new URLSearchParams({
    since: String(since),
    perfType: LICHESS_PERF_TYPES.join(','),
    moves: 'true',
    tags: 'false',
    clocks: 'false',
    evals: 'false',
    opening: 'false',
    // Oldest first, so an interrupted import resumes after the last saved game without gaps.
    sort: 'dateAsc',
  })
  const headers: Record<string, string> = { Accept: 'application/x-ndjson' }
  // Your own games stream three times faster when authenticated.
  if (opts.lichessToken) headers.Authorization = `Bearer ${opts.lichessToken}`
  const report = (saved: number, status: string) => opts.onProgress?.({ source: 'lichess', saved, status })
  report(0, 'Connecting to Lichess…')
  const res = await fetchWithRetry(
    `https://lichess.org/api/games/user/${encodeURIComponent(user)}?${params}`,
    { headers, signal: opts.signal },
    fetchFn,
    opts.sleep ?? realSleep,
    () => report(0, 'Lichess is busy with another download; retrying in a minute…'),
  )
  if (res.status === 404) throw new Error(`Lichess user "${user}" not found`)
  if (res.status === 429) throw new Error('Lichess is busy with another download of games from your network; try again in a few minutes.')
  if (!res.ok) throw new Error(`Lichess returned an error (${res.status})`)

  let saved = 0
  let batch: Game[] = []
  const t = opts.now ?? Date.now()
  const flush = async () => {
    saved += await saveGames(batch, d)
    batch = []
    report(saved, `Lichess: ${saved} games`)
  }
  await readNdjson(res, async (row) => {
    const g = parseLichessGame(row as LichessGameJson, user, t)
    if (g) batch.push(g)
    if (batch.length >= 100) await flush()
  })
  await flush()
  return saved
}

export async function importChesscom(user: string, since: number, opts: ImportOptions, d: AppDB = db): Promise<number> {
  const fetchFn = opts.fetchFn ?? ((...a) => fetch(...a))
  const report = (saved: number, status: string) => opts.onProgress?.({ source: 'chesscom', saved, status })
  report(0, 'Connecting to Chess.com…')
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games`
  const res = await fetchFn(`${base}/archives`, { signal: opts.signal })
  if (res.status === 404) throw new Error(`Chess.com user "${user}" not found`)
  if (!res.ok) throw new Error(`Chess.com returned an error (${res.status})`)
  const { archives } = (await res.json()) as { archives: string[] }

  // Archive URLs end in /YYYY/MM; keep months that end after `since`.
  const from = new Date(since)
  const firstMonth = from.getUTCFullYear() * 12 + from.getUTCMonth()
  const months = archives.filter((url) => {
    const m = url.match(/(\d{4})\/(\d{2})$/)
    return m && Number(m[1]) * 12 + Number(m[2]) - 1 >= firstMonth
  })

  let saved = 0
  const t = opts.now ?? Date.now()
  for (const [i, url] of months.entries()) {
    report(saved, `Chess.com: month ${i + 1} of ${months.length}, ${saved} games`)
    const r = await fetchFn(url, { signal: opts.signal })
    if (!r.ok) throw new Error(`Chess.com returned an error (${r.status})`)
    const { games } = (await r.json()) as { games: ChesscomGameJson[] }
    const parsed = games
      .filter((g) => g.end_time * 1000 >= since)
      .map((g) => parseChesscomGame(g, user, t))
      .filter((g): g is Game => !!g)
    saved += await saveGames(parsed, d)
  }
  report(saved, `Chess.com: ${saved} games`)
  return saved
}

/**
 * Imports new bullet, blitz, rapid, classical and daily games from both sites. The
 * first import covers the last year; later ones resume after the newest
 * stored game.
 */
export async function importGames(opts: ImportOptions, d: AppDB = db): Promise<ImportResult> {
  const now = opts.now ?? Date.now()
  const result: ImportResult = { added: { lichess: 0, chesscom: 0 }, errors: [] }
  const upToDate = ((await getSettings(d)).gamesImportVersion ?? 1) >= IMPORT_VERSION
  const jobs: [GameSource, string | undefined, typeof importLichess][] = [
    ['lichess', opts.lichessUser, importLichess],
    ['chesscom', opts.chesscomUser, importChesscom],
  ]
  // The two sites are independent, so they download at the same time.
  await Promise.all(
    jobs.map(async ([source, user, run]) => {
      if (!user) return
      const newest = upToDate ? await newestGame(source, d) : undefined
      const since = newest !== undefined ? newest + 1 : now - IMPORT_WINDOW_MS
      try {
        result.added[source] = await run(user, since, opts, d)
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        result.errors.push((e as Error).message)
      }
    }),
  )
  if (!result.errors.length) await setSetting('gamesImportVersion', IMPORT_VERSION, d)
  return result
}
