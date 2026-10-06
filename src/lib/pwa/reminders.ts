import { useSyncExternalStore } from 'react'
import { loadStreak } from '../../db/reviews'
import { db } from '../../db/schema'
import { getSettings } from '../../db/settings'
import { isNew } from '../srs/scheduler'
import { addDays } from '../srs/streak'
import { SYNC_URL } from '../sync/api'
import { isIos } from './install'

// Daily training reminders, sent as Web Push by the sync server (worker/):
// this device subscribes with a time of day, and the app keeps the server told
// how training is going (TrainingStatus in worker/src/reminders.ts) so it can
// skip days the goal is met and say how many moves are due. The app icon's
// badge shows the moves due.

/** This device's reminder, as the server has it. */
export interface DeviceReminder {
  user: string
  /** HH:MM, local time. */
  time: string
}

export const DEFAULT_REMINDER_TIME = '19:00'

const KEY = 'reminder'
const SENT_KEY = 'reminder-status'
const HOUR = 3_600_000
/** Due-time buckets sent to the server, earliest first. */
const MAX_DUE_BUCKETS = 1000

function read(): DeviceReminder | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return null
  }
}

let current = read()
const listeners = new Set<() => void>()
function store(r: DeviceReminder | null) {
  try {
    if (r) localStorage.setItem(KEY, JSON.stringify(r))
    else localStorage.removeItem(KEY)
    localStorage.removeItem(SENT_KEY)
  } catch {
    // Private mode: the reminder still works until the app is closed.
  }
  current = r
  listeners.forEach((l) => l())
}

export function useDeviceReminder(): DeviceReminder | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

/**
 * Whether this browser can get reminders. Safari on iPhone and iPad only
 * delivers them to the app added to the home screen.
 */
export function reminderSupport(): 'ok' | 'needs-install' | 'unsupported' {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok'
  return isIos() ? 'needs-install' : 'unsupported'
}

const userUrl = (user: string) => `${SYNC_URL}/users/${encodeURIComponent(user)}`

async function call(url: string, method: string, body?: unknown): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `The sync server answered ${res.status}`)
  return res
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** The service worker. It isn't registered in development (`npm run dev`). */
async function registration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("The app's service worker isn't running. Reload the page and try again.")), 10_000),
  )
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

/** Turns reminders on for this device (or changes their time). Call it from a click: it may ask for permission. */
export async function enableReminder(time: string): Promise<void> {
  const { lichessUser } = await getSettings()
  if (!lichessUser) throw new Error('Log in with Lichess first: reminders are kept with your synced data.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted')
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this app. Allow them in your browser or phone settings, then try again.'
        : 'Notifications were not allowed.',
    )

  const res = await fetch(`${SYNC_URL}/push/key`)
  if (res.status === 404) throw new Error("Reminders aren't set up on the sync server yet.")
  if (!res.ok) throw new Error(`The sync server answered ${res.status}`)
  const key = (await res.text()).trim()

  const serverKey = fromB64url(key)
  const reg = await registration()
  let sub = await reg.pushManager.getSubscription()
  // A subscription made with an older server key can't receive anything.
  const subKey = sub?.options.applicationServerKey
  if (sub && subKey && new Uint8Array(subKey).join() !== serverKey.join()) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey })

  const previous = current
  if (previous && previous.user !== lichessUser)
    await call(`${userUrl(previous.user)}/reminder`, 'DELETE', { endpoint: sub.endpoint }).catch(() => undefined)
  await call(`${userUrl(lichessUser)}/reminder`, 'PUT', {
    subscription: sub.toJSON(),
    time,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  store({ user: lichessUser, time })
  await reportTraining()
}

/** Turns reminders off for this device. */
export async function disableReminder(): Promise<void> {
  const r = current
  if (!r) return
  const sub = 'serviceWorker' in navigator ? await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() : null
  if (sub) {
    await call(`${userUrl(r.user)}/reminder`, 'DELETE', { endpoint: sub.endpoint }).catch(() => undefined)
    await sub.unsubscribe().catch(() => undefined)
  }
  store(null)
}

/** Asks the server to send a notification to this device now. */
export async function testReminder(): Promise<void> {
  const r = current
  const sub = await (await registration()).pushManager.getSubscription()
  if (!r || !sub) throw new Error('Reminders are off on this device.')
  await call(`${userUrl(r.user)}/reminder/test`, 'POST', { endpoint: sub.endpoint })
}

/**
 * Updates the app icon's badge with the moves due and, when reminders are on,
 * tells the server how training is going (only when that changed). Called
 * after each sync.
 */
export async function reportTraining(): Promise<void> {
  const paused = new Set((await db.repertoires.toArray()).filter((r) => r.paused).map((r) => r.id))
  const cards = (await db.cards.toArray()).filter((c) => !paused.has(c.repertoireId) && !isNew(c.fsrs))
  const now = Date.now()
  const dueNow = cards.filter((c) => new Date(c.fsrs.due).getTime() <= now).length
  if ('setAppBadge' in navigator) {
    await (dueNow ? navigator.setAppBadge(dueNow) : navigator.clearAppBadge()).catch(() => undefined)
  }

  const r = current
  if (!r) return
  const streak = await loadStreak()
  const buckets = new Map<number, number>()
  for (const c of cards) {
    const hour = Math.floor(new Date(c.fsrs.due).getTime() / HOUR)
    buckets.set(hour, (buckets.get(hour) ?? 0) + 1)
  }
  const recent: Record<string, number> = {}
  for (let i = -2; i <= 0; i++) {
    const day = addDays(streak.today, i)
    if (streak.days.has(day)) recent[day] = streak.days.get(day)!
  }
  const status = {
    goal: streak.goal,
    recent,
    lastGoalDay: streak.lastGoalDay,
    streak: streak.lastStreak,
    due: [...buckets].sort((a, b) => a[0] - b[0]).slice(0, MAX_DUE_BUCKETS),
  }
  const json = JSON.stringify(status)
  const key = `${r.user}:${json}`
  try {
    if (localStorage.getItem(SENT_KEY) === key) return
  } catch {
    // Not remembered: send it anyway.
  }
  await call(`${userUrl(r.user)}/status`, 'PUT', status)
  try {
    localStorage.setItem(SENT_KEY, key)
  } catch {
    // Sent again next time.
  }
}
