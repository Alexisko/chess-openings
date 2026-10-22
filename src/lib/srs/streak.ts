import type { ReviewMode } from '../../db/schema'

// Daily streaks: a day counts once you've answered the daily goal's number of
// moves in training (moves from imported games don't count). Days are the
// device's local days, so the streak follows you across devices through the
// synced review history.
//
// Jokers: finishing a review without a mistake earns a joker (at most one a
// day). A day missed while a streak is going spends one and keeps the streak
// alive; the saved day doesn't add to it.

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
   * Days saved by a joker keep it going without counting.
   */
  current: number
  best: number
  /** Jokers held now, including one earned today (it can save tomorrow on). */
  jokers: number
  /** Whether today's joker was already earned. */
  jokerToday: boolean
  /** Missed days a joker saved. */
  saved: Set<string>
  /** The last day the streak can be kept going without training any more (undefined without a streak). */
  keptUntil?: string
  /** The last day the streak was kept going (goal met, or saved by a joker) and the streak that day. */
  lastGoalDay?: string
  lastStreak: number
}

/** `jokerDays`: the days a joker was earned. */
export function computeStreak(
  logs: Iterable<{ ts: number; mode: ReviewMode }>,
  goal: number,
  now: number,
  jokerDays: Iterable<string> = [],
): Streak {
  const days = new Map<string, number>()
  for (const l of logs) {
    if (!COUNTED.has(l.mode)) continue
    const day = localDay(l.ts)
    days.set(day, (days.get(day) ?? 0) + 1)
  }
  const earned = new Set(jokerDays)
  const today = localDay(now)
  const done = days.get(today) ?? 0

  // Day by day from the first day that matters: a met day extends the run, a
  // missed one spends a joker or ends it. Today, unless met, leaves the run as
  // it was. A joker earned on a day can save the days after it.
  const first = [...days.keys(), ...earned].filter((d) => d <= today).sort()[0]
  let run = 0
  let best = 0
  let jokers = 0
  let lastGoalDay: string | undefined
  let lastStreak = 0
  const saved = new Set<string>()
  for (let d = first; d && d < today; d = addDays(d, 1)) {
    if ((days.get(d) ?? 0) >= goal) run++
    else if (run && jokers) {
      jokers--
      saved.add(d)
    } else run = 0
    if (run) {
      lastGoalDay = d
      lastStreak = run
    }
    best = Math.max(best, run)
    if (earned.has(d)) jokers++
  }
  const goalMet = done >= goal
  if (goalMet) {
    run++
    lastGoalDay = today
    lastStreak = run
    best = Math.max(best, run)
  }

  // The last day the streak can still be kept going if you stop training now.
  // Missed, today needs a joker held this morning; the days after it can also
  // use one earned today.
  const jokerToday = earned.has(today)
  const held = jokers
  if (jokerToday) jokers++
  const keptUntil = !run ? undefined : goalMet ? addDays(today, 1 + jokers) : held ? addDays(today, jokers) : today

  return {
    goal,
    days,
    today,
    done,
    goalMet,
    current: run,
    best,
    jokers,
    jokerToday,
    saved,
    keptUntil,
    lastGoalDay,
    lastStreak,
  }
}
