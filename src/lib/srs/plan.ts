import type { Card as FsrsCard } from 'ts-fsrs'
import type { Line } from '../chess/graph'
import { isDue, isNew, retrievability } from './scheduler'

export type CardMap = Map<string, FsrsCard>

export interface PlannedRun {
  line: Line
  /** Index in line.moves where play starts (earlier moves are set up instantly). */
  startPly: number
  /** Card positions to highlight as the reason for this run. */
  focus: string[]
}

/**
 * Picks lines that together cover every due card, preferring lines that cover
 * the most due cards (greedy set cover). Each line is played from the start.
 */
export function planReview(lines: Line[], cards: CardMap, now: Date, maxLines = 20): PlannedRun[] {
  const due = new Set<string>()
  for (const [key, c] of cards) if (isDue(c, now)) due.add(key)
  const runs: PlannedRun[] = []
  const candidates = [...lines]
  while (due.size && runs.length < maxLines) {
    let best: Line | undefined
    let bestCover = 0
    for (const l of candidates) {
      const cover = l.cardKeys.filter((k) => due.has(k)).length
      if (cover > bestCover || (cover === bestCover && best && cover > 0 && l.moves.length < best.moves.length)) {
        best = l
        bestCover = cover
      }
    }
    if (!best || bestCover === 0) break
    const focus = best.cardKeys.filter((k) => due.has(k))
    focus.forEach((k) => due.delete(k))
    runs.push({ line: best, startPly: 0, focus })
    candidates.splice(candidates.indexOf(best), 1)
  }
  return runs
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
    runs.push({ line, startPly: 0, focus })
  }
  return runs
}

/** How weak a learned card is: low recall probability and frequent lapses. */
export function weakness(c: FsrsCard, now: Date): number {
  if (isNew(c)) return 0
  return 1 - retrievability(c, now) + 0.15 * c.lapses
}

/**
 * Drills the weakest learned cards, starting two full moves before the weak
 * position so it is met in context.
 */
export function planDrill(lines: Line[], cards: CardMap, now: Date, limit = 10, minWeakness = 0.1): PlannedRun[] {
  const weak = [...cards.entries()]
    .map(([key, c]) => ({ key, w: weakness(c, now) }))
    .filter((x) => x.w >= minWeakness)
    .sort((a, b) => b.w - a.w)
    .slice(0, limit)
  const runs: PlannedRun[] = []
  for (const { key } of weak) {
    const line = lines.find((l) => l.cardKeys.includes(key))
    if (!line) continue
    const idx = line.moves.findIndex((m) => m.byMe && m.fromKey === key)
    runs.push({ line, startPly: Math.max(0, idx - 4), focus: [key] })
  }
  return runs
}
