import { fsrs, generatorParameters, Rating, State, type Card as FsrsCard, type Grade } from 'ts-fsrs'

export const scheduler = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }))

export const isNew = (c: FsrsCard) => c.state === State.New

export const isDue = (c: FsrsCard, now: Date) => !isNew(c) && new Date(c.due).getTime() <= now.getTime()

/** Probability of recalling the move right now (0 for cards never learned). */
export function retrievability(c: FsrsCard, now: Date): number {
  if (isNew(c)) return 0
  return scheduler.get_retrievability(c, now, false)
}

/**
 * Wrong is wrong: any move other than the repertoire move is "Again", even a
 * good one. A correct first attempt is "Good".
 */
export function gradeCard(c: FsrsCard, correct: boolean, now: Date): { card: FsrsCard; rating: Grade } {
  const rating: Grade = correct ? Rating.Good : Rating.Again
  return { card: scheduler.next(c, now, rating).card, rating }
}

export { Rating, State }
