import { useLiveQuery } from 'dexie-react-hooks'
import { recordsFromLogs, type MoveRecord } from '../lib/srs/knowledge'
import { gradeCard, isDue, isNew } from '../lib/srs/scheduler'
import { computeStreak, type Streak } from '../lib/srs/streak'
import { db, now, uuid, type AppDB, type ReviewMode } from './schema'
import { getSettings, useSettings } from './settings'

/**
 * Records the first attempt at a card. Due and new cards are rescheduled
 * (Good / Again). A card that isn't due yet is only rescheduled when the move
 * was wrong; a correct early answer is logged without changing its schedule.
 */
export async function recordAttempt(
  repertoireId: string,
  positionKey: string,
  correct: boolean,
  playedUci: string,
  mode: ReviewMode,
  d: AppDB = db,
) {
  await d.transaction('rw', [d.cards, d.reviews], async () => {
    const card = await d.cards.where({ repertoireId, positionKey }).first()
    if (!card) return
    const t = now()
    const date = new Date(t)
    let rating = 0
    if (!correct || isNew(card.fsrs) || isDue(card.fsrs, date)) {
      const next = gradeCard(card.fsrs, correct, date)
      rating = next.rating
      await d.cards.update(card.id, { fsrs: next.card, updatedAt: t })
    }
    await d.reviews.add({ id: uuid(), cardId: card.id, repertoireId, ts: t, rating, playedUci, correct, mode })
  })
}

/** Number of distinct cards first learned today (for the daily new-card limit). */
export async function learnedToday(d: AppDB = db): Promise<number> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const logs = await d.reviews.where('ts').aboveOrEqual(start.getTime()).toArray()
  return new Set(logs.filter((l) => l.mode === 'learn').map((l) => l.cardId)).size
}

/** Your answers at each of a repertoire's positions (by position key). */
export async function loadMoveRecords(repertoireId: string, d: AppDB = db): Promise<Map<string, MoveRecord>> {
  const [cards, logs] = await Promise.all([d.cards.where({ repertoireId }).toArray(), d.reviews.where({ repertoireId }).toArray()])
  const byCard = recordsFromLogs(logs)
  const out = new Map<string, MoveRecord>()
  for (const c of cards) {
    const r = byCard.get(c.id)
    if (r) out.set(c.positionKey, r)
  }
  return out
}

/** Your daily streak from the training history. */
export async function loadStreak(d: AppDB = db): Promise<Streak> {
  const [logs, { dailyGoal }] = await Promise.all([d.reviews.toArray(), getSettings(d)])
  return computeStreak(logs, dailyGoal, Date.now())
}

export function useStreak(): Streak | undefined {
  const goal = useSettings()?.dailyGoal
  return useLiveQuery(async () => (goal ? computeStreak(await db.reviews.toArray(), goal, Date.now()) : undefined), [goal])
}
