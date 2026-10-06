import type { PushTarget } from './webpush'

// Daily training reminders: when each device's reminder is due, and what it
// says. The app reports a summary of the user's training (TrainingStatus)
// whenever it changes; the reminder is skipped on days the goal is met.

/** What the app reports about the user's training, in the reporting device's days. */
export interface TrainingStatus {
  /** Moves to answer in a day to keep the streak going. */
  goal: number
  /** Moves answered per day (YYYY-MM-DD) over the last few days. */
  recent: Record<string, number>
  /** The last day the goal was met, and the length of the streak that day ended. */
  lastGoalDay?: string
  streak: number
  /** When cards come due: [hour (ms / 3,600,000), cards], earliest first. */
  due: [number, number][]
}

/** One device's reminder. */
export interface Reminder extends PushTarget {
  /** Local time of day, HH:MM. */
  time: string
  /** IANA time zone of the device. */
  tz: string
  /** When it fires next (ms). */
  next: number
}

/** What the service worker shows. `url` is relative to the app's scope. */
export interface ReminderMessage {
  title: string
  body: string
  url: string
  /** Moves due, for the app icon's badge. */
  badge: number
}

const HOUR = 3_600_000
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function parts(ts: number, tz: string) {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  const p = Object.fromEntries(f.formatToParts(ts).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}

/** The local day (YYYY-MM-DD) of an instant in a time zone. */
export function dayKey(ts: number, tz: string): string {
  const { y, m, d } = parts(ts, tz)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 24 * HOUR
  return new Date(t).toISOString().slice(0, 10)
}

/** Local time minus UTC at an instant, in ms. */
function offset(ts: number, tz: string): number {
  const { y, m, d, h, mi, s } = parts(ts, tz)
  return Date.UTC(y, m - 1, d, h, mi, s) - Math.floor(ts / 1000) * 1000
}

/** The instant a local day and time (HH:MM) happen in a time zone. */
function zonedToUtc(day: string, time: string, tz: string): number {
  const local = Date.parse(`${day}T${time}:00Z`)
  const first = local - offset(local, tz)
  // Again with the offset at the result, in case a DST change lies in between.
  return local - offset(first, tz)
}

/** The first time after `after` that the clock in `tz` shows `time`. */
export function nextFire(time: string, tz: string, after: number): number {
  const day = dayKey(after, tz)
  const t = zonedToUtc(day, time, tz)
  return t > after ? t : zonedToUtc(addDays(day, 1), time, tz)
}

const moves = (n: number) => `${n} move${n === 1 ? '' : 's'}`

/** The reminder for a device at `now`, or null when today's goal is already met. */
export function reminderMessage(status: TrainingStatus | undefined, tz: string, now: number): ReminderMessage | null {
  if (!status) return { title: 'Time to train', body: 'A few minutes on your openings today?', url: '', badge: 0 }
  const today = dayKey(now, tz)
  const done = status.recent[today] ?? 0
  if (done >= status.goal) return null
  const streak = status.lastGoalDay === addDays(today, -1) ? status.streak : 0
  const due = status.due.reduce((n, [hour, count]) => (hour * HOUR <= now ? n + count : n), 0)

  const left = status.goal - done
  const todo = done > 0 ? `${left} more move${left === 1 ? '' : 's'} today` : `Answer ${moves(status.goal)} today`
  const goal = `${todo} to ${streak ? 'keep it going' : 'start a streak'}.`
  return {
    title: streak ? `Keep your ${streak}-day streak` : 'Time to train',
    body: due ? `${moves(due)} to review. ${goal}` : goal,
    url: due ? 'train?mode=review' : '',
    badge: due,
  }
}

/** Checks a status sent by the app (it is stored as is). */
export function parseStatus(x: unknown): TrainingStatus | null {
  if (!x || typeof x !== 'object') return null
  const s = x as TrainingStatus
  const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 0
  const day = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  if (!count(s.goal) || s.goal < 1 || !count(s.streak)) return null
  if (s.lastGoalDay !== undefined && !day(s.lastGoalDay)) return null
  if (!s.recent || typeof s.recent !== 'object' || !Object.entries(s.recent).every(([d, n]) => day(d) && count(n))) return null
  if (!Array.isArray(s.due) || !s.due.every((e) => Array.isArray(e) && e.length === 2 && count(e[0]) && count(e[1]))) return null
  return { goal: s.goal, recent: s.recent, lastGoalDay: s.lastGoalDay, streak: s.streak, due: s.due }
}
