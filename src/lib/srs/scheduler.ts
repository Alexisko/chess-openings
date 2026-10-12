import { fsrs, generatorParameters, Rating, State, type Card as FsrsCard, type Grade } from 'ts-fsrs'

// Reviews run on a daily schedule. Every answer puts a move at least a day
// ahead (no minute-long learning steps: a missed move is asked again within
// the session instead), and a move due at any time today is due from the start
// of the day. So once today's reviews are done, nothing more comes up until
// tomorrow. Days are the device's local days, as for the streak.
export const scheduler = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9, enable_short_term: false }))

const DAY = 86_400_000

/** When the local day of `now` ends (the next midnight): what is due before it is due today. */
export function endOfDay(now: Date): Date {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d
}

export const isNew = (c: FsrsCard) => c.state === State.New

/** Due today: at any time before the day ends, not only by now. */
export const isDue = (c: FsrsCard, now: Date) => !isNew(c) && new Date(c.due).getTime() < endOfDay(now).getTime()

/** Probability of recalling the move right now (0 for cards never learned). */
export function retrievability(c: FsrsCard, now: Date): number {
  if (isNew(c)) return 0
  return scheduler.get_retrievability(c, now, false)
}

/**
 * Wrong is wrong: any move other than the repertoire move is "Again", even a
 * good one. A correct first attempt is "Good". The move is never due again the
 * same day, and a move just learned is checked the next day: it was only
 * played back right after being shown.
 */
export function gradeCard(c: FsrsCard, correct: boolean, now: Date): { card: FsrsCard; rating: Grade } {
  const rating: Grade = correct ? Rating.Good : Rating.Again
  const card = scheduler.next(c, now, rating).card
  if (isNew(c)) {
    card.due = new Date(now.getTime() + DAY)
    card.scheduled_days = 1
  }
  // A day can last 25 hours (clocks going back): 24 hours on may still be today.
  const tomorrow = endOfDay(now)
  if (new Date(card.due).getTime() < tomorrow.getTime()) card.due = tomorrow
  return { card, rating }
}

export { Rating, State }
