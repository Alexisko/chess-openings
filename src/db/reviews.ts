import { gradeCard, isDue, isNew } from '../lib/srs/scheduler'
import { db, now, uuid, type AppDB, type ReviewMode } from './schema'

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
