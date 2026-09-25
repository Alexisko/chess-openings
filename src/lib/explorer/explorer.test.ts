import { describe, expect, it, vi } from 'vitest'
import { AppDB } from '../../db/schema'
import { replay, START_FEN } from '../chess/position'
import {
  AuthRequiredError,
  DEFAULT_FILTER,
  describeFilter,
  ExplorerClient,
  explorerUrl,
  filterHash,
  ratingRanges,
  RequestQueue,
} from './explorer'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('RequestQueue', () => {
  it('runs requests one at a time with a minimum gap', async () => {
    let clock = 0
    const sleeps: number[] = []
    const sleep = async (ms: number) => {
      sleeps.push(ms)
      clock += ms
    }
    const fetchFn = vi.fn(async (_url: string) => json({}))
    const q = new RequestQueue(300, fetchFn as never, sleep, () => clock)
    await Promise.all([q.run('a'), q.run('b'), q.run('c')])
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
    expect(sleeps).toEqual([300, 300])
  })

  it('waits a minute after a 429', async () => {
    const sleeps: number[] = []
    const fetchFn = vi.fn().mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ ok: 1 }))
    const q = new RequestQueue(0, fetchFn, async (ms) => void sleeps.push(ms))
    const res = await q.run('x')
    expect(res.status).toBe(200)
    expect(sleeps).toContain(60_000)
  })
})

describe('ExplorerClient', () => {
  const data = {
    white: 5,
    draws: 1,
    black: 4,
    opening: null,
    moves: [{ uci: 'e1g1', san: 'O-O', white: 5, draws: 1, black: 4 }],
  }
  const fen = replay(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5']).at(-1)!.fen

  it('sends the token, canonicalises moves and caches responses', async () => {
    const fetchFn = vi.fn(async () => json(data))
    const d = new AppDB('explorer-test')
    const client = new ExplorerClient(async () => 'tok', new RequestQueue(0, fetchFn as never), d)
    const first = await client.get(fen, DEFAULT_FILTER)
    expect(first.moves[0].uci).toBe('e1h1')
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer tok')
    await client.get(fen, DEFAULT_FILTER)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('requires a token', async () => {
    const client = new ExplorerClient(async () => undefined, new RequestQueue(0, vi.fn()), new AppDB('explorer-test-2'))
    await expect(client.get(START_FEN, DEFAULT_FILTER)).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it('builds filter-specific URLs and cache keys', () => {
    expect(explorerUrl(START_FEN, { ...DEFAULT_FILTER, db: 'masters' })).toMatch(/^https:\/\/explorer\.lichess\.org\/masters\?/)
    const url = new URL(explorerUrl(START_FEN, DEFAULT_FILTER))
    expect(url.searchParams.get('speeds')).toBe('blitz,rapid,classical')
    expect(url.searchParams.get('ratings')).toBe('1600,1800,2000')
    expect(filterHash({ db: 'lichess', speeds: ['rapid', 'blitz'], ratings: [2000, 1600] })).toBe(
      filterHash({ db: 'lichess', speeds: ['blitz', 'rapid'], ratings: [1600, 2000] }),
    )
  })
})

describe('describeFilter', () => {
  it('joins neighbouring rating buckets into ranges', () => {
    expect(ratingRanges([1600, 1800, 2000])).toBe('1600–2199')
    expect(ratingRanges([2000, 1000, 1600])).toBe('1000–1199, 1600–1799, 2000–2199')
    expect(ratingRanges([2200, 2500])).toBe('2200+')
    expect(ratingRanges([2000, 2500])).toBe('2000–2199, 2500+')
    expect(ratingRanges([400])).toBe('400–999')
  })

  it('describes the Lichess filter and the masters database', () => {
    expect(describeFilter(DEFAULT_FILTER)).toBe('Lichess players rated 1600–2199 · blitz, rapid, classical')
    expect(describeFilter({ ...DEFAULT_FILTER, speeds: ['rapid', 'blitz'] })).toMatch(/· blitz, rapid$/)
    expect(describeFilter({ ...DEFAULT_FILTER, db: 'masters' })).toMatch(/^Masters/)
  })
})
