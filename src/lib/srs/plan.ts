import type { Card as FsrsCard } from 'ts-fsrs'
import type { Line } from '../chess/graph'
import { isDue, isNew } from './scheduler'

export type CardMap = Map<string, FsrsCard>

/**
 * Plies played out before a move that needs work, so it is met in context
 * (two full moves). Everything earlier is set up instantly.
 */
export const LEAD_IN = 4

export interface PlannedRun {
  line: Line
  /** Index in line.moves where play starts (earlier moves are set up instantly). */
  startPly: number
  /** Index in line.moves where the run ends (exclusive): right after the last focus move. */
  endPly: number
  /**
   * Card positions this run is for. Only these are asked; the owner's other
   * moves in the window are already mastered and play by themselves.
   */
  focus: string[]
}

/** Plies in the line where the owner has to answer one of `focus`. */
export function focusPlies(line: Line, focus: Iterable<string>): number[] {
  const keys = new Set(focus)
  const plies: number[] = []
  line.moves.forEach((m, i) => m.byMe && keys.has(m.fromKey) && plies.push(i))
  return plies
}

/** A run that skips the mastered start and end of the line around its focus cards. */
export function makeRun(line: Line, focus: string[], leadIn = LEAD_IN): PlannedRun {
  const plies = focusPlies(line, focus)
  if (!plies.length) return { line, startPly: 0, endPly: line.moves.length, focus }
  return { line, startPly: Math.max(0, plies[0] - leadIn), endPly: plies[plies.length - 1] + 1, focus }
}

/**
 * Picks lines that together cover every target card, preferring lines that
 * cover the most (greedy set cover). Each line's focus is the targets it
 * covers that no earlier line did. Runs come in line order, so similar
 * variations follow each other.
 */
function coverLines(lines: Line[], targets: Set<string>, maxLines: number): PlannedRun[] {
  const left = new Set(targets)
  const picked: { line: Line; focus: string[] }[] = []
  const candidates = [...lines]
  while (left.size && picked.length < maxLines) {
    let best: Line | undefined
    let bestCover = 0
    for (const l of candidates) {
      const cover = l.cardKeys.filter((k) => left.has(k)).length
      if (cover > bestCover || (cover === bestCover && best && cover > 0 && l.moves.length < best.moves.length)) {
        best = l
        bestCover = cover
      }
    }
    if (!best || bestCover === 0) break
    const focus = best.cardKeys.filter((k) => left.has(k))
    focus.forEach((k) => left.delete(k))
    picked.push({ line: best, focus })
    candidates.splice(candidates.indexOf(best), 1)
  }
  return picked
    .sort((a, b) => lines.indexOf(a.line) - lines.indexOf(b.line))
    .map(({ line, focus }) => makeRun(line, focus))
}

/** Lines that together cover every due card, each played only around its due moves. */
export function planReview(lines: Line[], cards: CardMap, now: Date, maxLines = 20): PlannedRun[] {
  const due = new Set<string>()
  for (const [key, c] of cards) if (isDue(c, now)) due.add(key)
  return coverLines(lines, due, maxLines)
}

/**
 * Lines containing cards never learned, most important first (by `weight`,
 * e.g. how often opponents reach the line), until `maxNew` cards are covered.
 */
export function planLearn(
  lines: Line[],
  cards: CardMap,
  maxNew: number,
  weight: (l: Line) => number = () => 0,
): PlannedRun[] {
  const newKeys = new Set<string>()
  for (const [key, c] of cards) if (isNew(c)) newKeys.add(key)
  const ordered = lines
    .map((line, i) => ({ line, i, w: weight(line) }))
    .filter(({ line }) => line.cardKeys.some((k) => newKeys.has(k)))
    .sort((a, b) => b.w - a.w || a.i - b.i)
  const runs: PlannedRun[] = []
  let budget = maxNew
  for (const { line } of ordered) {
    if (budget <= 0) break
    const focus = line.cardKeys.filter((k) => newKeys.has(k))
    if (!focus.length) continue
    focus.forEach((k) => newKeys.delete(k))
    budget -= focus.length
    runs.push(makeRun(line, focus))
  }
  return runs
}

export type TrainUnit = 'moves' | 'lines'

/** Plies played out before a single asked move: your previous move and the reply to it. */
export const MOVE_LEAD_IN = 2

/** One repertoire's share of a training session: its lines and how weak each learned move is. */
export interface TrainPool {
  lines: Line[]
  /** Weakness (0–1) per learned card; cards not learned yet are left out. */
  weakness: ReadonlyMap<string, number>
  /** When each card was last asked (ms), to bring back moves not seen for a while. */
  lastAsked?: ReadonlyMap<string, number>
}

export interface TrainItem {
  /** Index of the pool (repertoire) the run belongs to. */
  pool: number
  run: PlannedRun
}

/** Every learned move keeps at least this chance weight, so any of them can come up. */
const FLOOR = 0.15

/** Weight of a move in a training draw: how weak it is, plus a little for each month not asked. */
function drawWeight(pool: TrainPool, key: string, now: number): number {
  const last = pool.lastAsked?.get(key)
  const stale = last === undefined ? 1 : Math.min(1, (now - last) / (30 * 86400e3))
  return FLOOR + (pool.weakness.get(key) ?? 0) + 0.2 * stale
}

/**
 * Weighted sampling without replacement (Efraimidis–Spirakis): the returned
 * items are in draw order, heavier ones tending to come first.
 */
export function weightedSample<T>(items: T[], weight: (t: T) => number, n: number, rng: () => number = Math.random): T[] {
  return items
    .map((item) => ({ item, key: rng() ** (1 / Math.max(1e-9, weight(item))) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, n)
    .map((x) => x.item)
}

/**
 * A training session. Moves: single positions, each played from a short
 * lead-in, in draw order. Lines: whole lines in repertoire order, each asking
 * every learned move not already asked earlier in the session (so a shared
 * start is only asked once). Weak and long-unasked moves are drawn more
 * often, but every learned move can come up.
 */
export function planTrain(pools: TrainPool[], unit: TrainUnit, size: number, now: Date, rng: () => number = Math.random): TrainItem[] {
  const t = now.getTime()
  if (unit === 'moves') {
    const cands = pools.flatMap((pool, p) =>
      [...pool.weakness.keys()].flatMap((key) => {
        const line = pool.lines.find((l) => l.cardKeys.includes(key))
        return line ? [{ p, key, line, w: drawWeight(pool, key, t) }] : []
      }),
    )
    return weightedSample(cands, (c) => c.w, size, rng).map((c) => ({ pool: c.p, run: makeRun(c.line, [c.key], MOVE_LEAD_IN) }))
  }
  const cands = pools.flatMap((pool, p) =>
    pool.lines.flatMap((line, i) => {
      const learned = line.cardKeys.filter((k) => pool.weakness.has(k))
      if (!learned.length) return []
      return [{ p, i, line, w: Math.max(...learned.map((k) => drawWeight(pool, k, t))) }]
    }),
  )
  const asked = pools.map(() => new Set<string>())
  const items: TrainItem[] = []
  for (const c of weightedSample(cands, (x) => x.w, size, rng).sort((a, b) => a.p - b.p || a.i - b.i)) {
    const focus = c.line.cardKeys.filter((k) => pools[c.p].weakness.has(k) && !asked[c.p].has(k))
    if (!focus.length) continue
    focus.forEach((k) => asked[c.p].add(k))
    items.push({ pool: c.p, run: makeRun(c.line, focus) })
  }
  return items
}
