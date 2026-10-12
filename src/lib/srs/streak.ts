import type { ReviewMode } from '../../db/schema'

// Daily streaks: a day counts once you've answered the daily goal's number of
// moves in training (moves from imported games don't count). Days are the
// device's local days, so the streak follows you across devices through the
// synced review history.

/** Training modes whose answers count towards the daily goal. */
const COUNTED: ReadonlySet<ReviewMode> = new Set(['learn', 'review', 'train', 'drill'])

/** The local day of an instant, YYYY-MM-DD. */
export function localDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The day `n` days after (or before) a YYYY-MM-DD day. */
export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

export interface Streak {
  goal: number
  /** Moves answered per local day. */
  days: Map<string, number>
  today: string
  /** Moves answered today. */
  done: number
  goalMet: boolean
  /**
   * Days in a row the goal was met, up to today, or up to yesterday while
   * today's goal isn't met yet (the streak is still alive until midnight).
   */
  current: number
  best: number
  /** The last day the goal was met and the streak it ended. */
  lastGoalDay?: string
  lastStreak: number
}

export function computeStreak(logs: Iterable<{ ts: number; mode: ReviewMode }>, goal: number, now: number): Streak {
  const days = new Map<string, number>()
  for (const l of logs) {
    if (!COUNTED.has(l.mode)) continue
    const day = localDay(l.ts)
    days.set(day, (days.get(day) ?? 0) + 1)
  }
  const met = [...days].filter(([, n]) => n >= goal).map(([d]) => d).sort()

  // Runs of consecutive days, in order: the length of the run ending at each met day.
  const runAt = new Map<string, number>()
  let best = 0
  for (const d of met) {
    const run = (runAt.get(addDays(d, -1)) ?? 0) + 1
    runAt.set(d, run)
    best = Math.max(best, run)
  }

  const today = localDay(now)
  const done = days.get(today) ?? 0
  const lastGoalDay = met.at(-1)
  return {
    goal,
    days,
    today,
    done,
    goalMet: done >= goal,
    current: runAt.get(today) ?? runAt.get(addDays(today, -1)) ?? 0,
    best,
    lastGoalDay,
    lastStreak: lastGoalDay ? runAt.get(lastGoalDay)! : 0,
  }
}
