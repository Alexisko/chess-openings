import type { Card as FsrsCard } from 'ts-fsrs'
import type { Line } from '../chess/graph'
import { isDue, isNew, retrievability } from './scheduler'

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
export function makeRun(line: Line, focus: string[]): PlannedRun {
  const plies = focusPlies(line, focus)
  if (!plies.length) return { line, startPly: 0, endPly: line.moves.length, focus }
  return { line, startPly: Math.max(0, plies[0] - LEAD_IN), endPly: plies[plies.length - 1] + 1, focus }
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

/** How weak a learned card is: low recall probability and frequent lapses. */
export function weakness(c: FsrsCard, now: Date): number {
  if (isNew(c)) return 0
  return 1 - retrievability(c, now) + 0.15 * c.lapses
}

/** Drills the weakest learned cards, grouping those that share a line into one run. */
export function planDrill(lines: Line[], cards: CardMap, now: Date, limit = 10, minWeakness = 0.1): PlannedRun[] {
  const weak = [...cards.entries()]
    .map(([key, c]) => ({ key, w: weakness(c, now) }))
    .filter((x) => x.w >= minWeakness)
    .sort((a, b) => b.w - a.w)
    .slice(0, limit)
  return coverLines(lines, new Set(weak.map((x) => x.key)), limit)
}
