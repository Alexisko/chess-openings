import type { Card as FsrsCard } from 'ts-fsrs'
import type { ReviewLog } from '../../db/schema'
import { isNew, retrievability } from './scheduler'

/** How many recent answers decide whether a move is shaky. */
export const RECENT = 5

/** Your answers at one position, from the review log (first attempts only; replays aren't logged). */
export interface MoveRecord {
  attempts: number
  correct: number
  /** Correct answers in a row, up to the latest. */
  streak: number
  /** The latest answers, newest first (at most RECENT). */
  recent: boolean[]
  /** When the move was last asked (ms). */
  lastTs: number
}

export const EMPTY_RECORD: MoveRecord = { attempts: 0, correct: 0, streak: 0, recent: [], lastTs: 0 }

/** The record after one more answer. */
export function withResult(rec: MoveRecord | undefined, correct: boolean, ts: number): MoveRecord {
  const r = rec ?? EMPTY_RECORD
  return {
    attempts: r.attempts + 1,
    correct: r.correct + (correct ? 1 : 0),
    streak: correct ? r.streak + 1 : 0,
    recent: [correct, ...r.recent].slice(0, RECENT),
    lastTs: Math.max(r.lastTs, ts),
  }
}

/** Records per card id, from review logs in any order. */
export function recordsFromLogs(logs: Pick<ReviewLog, 'cardId' | 'ts' | 'correct'>[]): Map<string, MoveRecord> {
  const out = new Map<string, MoveRecord>()
  for (const l of [...logs].sort((a, b) => a.ts - b.ts)) out.set(l.cardId, withResult(out.get(l.cardId), l.correct, l.ts))
  return out
}

/**
 * Recent misses, the latest counting most: a miss just now is 1, and each
 * answer since halves it. After RECENT answers a miss is forgotten, however
 * many there were before.
 */
export function recentMisses(rec: MoveRecord | undefined): number {
  if (!rec) return 0
  return Math.min(
    1,
    rec.recent.reduce((s, ok, i) => s + (ok ? 0 : 0.5 ** i), 0),
  )
}

export type Knowledge = 'new' | 'shaky' | 'learning' | 'solid' | 'mastered'

export const KNOWLEDGE_ORDER: Knowledge[] = ['mastered', 'solid', 'learning', 'shaky', 'new']

export function emptyCounts(): Record<Knowledge, number> {
  return { mastered: 0, solid: 0, learning: 0, shaky: 0, new: 0 }
}

export const KNOWLEDGE_LABEL: Record<Knowledge, string> = {
  new: 'Not learned',
  shaky: 'Shaky',
  learning: 'Learning',
  solid: 'Solid',
  mastered: 'Mastered',
}

export const KNOWLEDGE_HELP: Record<Knowledge, string> = {
  new: 'Not learned yet.',
  shaky: 'Missed last time, missed twice in the last 5, or likely forgotten by now.',
  learning: 'Fewer than 3 right in a row so far.',
  solid: 'At least 3 right in a row, and still remembered.',
  mastered: 'At least 6 right in a row, remembered for 3 weeks or more.',
}

/** How well you know a move: from your latest answers and how long the memory lasts. */
export function knowledgeOf(card: FsrsCard, rec: MoveRecord | undefined, now: Date): Knowledge {
  if (isNew(card)) return 'new'
  const recent = rec?.recent ?? []
  const misses = recent.filter((ok) => !ok).length
  if (recent[0] === false || misses >= 2 || retrievability(card, now) < 0.8) return 'shaky'
  const streak = rec?.streak ?? 0
  if (streak < 3) return 'learning'
  if (streak >= 6 && card.stability >= 21) return 'mastered'
  return 'solid'
}

/**
 * How much a learned move needs work (0–1): the chance you forgot it, recent
 * misses, and too few right answers in a row to be sure. Old mistakes stop
 * counting once you've played the move right a few times since.
 */
export function weakness(card: FsrsCard, rec: MoveRecord | undefined, now: Date): number {
  if (isNew(card)) return 0
  const forgot = 1 - retrievability(card, now)
  const streak = rec?.streak ?? 0
  const unproven = streak < 3 ? 0.1 * (3 - streak) : 0
  return Math.min(1, forgot + 0.7 * recentMisses(rec) + unproven)
}

/** "7 in a row · 18/19" style summary of a record. */
export function describeRecord(rec: MoveRecord | undefined): string {
  if (!rec?.attempts) return 'never asked yet'
  const parts: string[] = []
  const misses = rec.recent.filter((ok) => !ok).length
  if (rec.streak >= 2) parts.push(`${rec.streak} in a row`)
  else if (rec.recent[0] === false) parts.push(misses > 1 ? `missed ${misses} of the last ${rec.recent.length}` : 'missed last time')
  // Right this time after recent misses: say so, or "Shaky" after a right answer reads as a contradiction.
  else if (misses) parts.push(`right this time, missed ${misses} of the last ${rec.recent.length}`)
  parts.push(`${rec.correct}/${rec.attempts} right`)
  return parts.join(' · ')
}
