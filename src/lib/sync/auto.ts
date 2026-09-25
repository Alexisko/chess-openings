import Dexie from 'dexie'
import { useSyncExternalStore } from 'react'
import { db } from '../../db/schema'
import { getSettings } from '../../db/settings'
import { SNAPSHOT_TABLES } from '../../db/snapshot'
import { getSyncBase } from '../../db/sync'
import { httpApi } from './api'
import { syncOnce, type FirstSyncMode } from './sync'

// Syncs in the background as the logged-in Lichess user: when the app opens or
// comes back to the foreground, every few minutes while it is open, and a few
// seconds after local changes.

export interface SyncStatus {
  state: 'off' | 'idle' | 'syncing' | 'error' | 'needs-choice'
  /** Lichess username synced as. */
  user?: string
  lastSyncedAt?: number
  error?: string
  /** With 'needs-choice': the user this device synced as before, if another one. */
  previousUser?: string
}

let status: SyncStatus = { state: 'off' }
const listeners = new Set<() => void>()
function setStatus(s: Partial<SyncStatus>) {
  status = { ...status, ...s }
  listeners.forEach((l) => l())
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => status,
  )
}

const AFTER_CHANGE_MS = 5_000
const PERIOD_MS = 5 * 60_000

let running: Promise<void> | null = null
let again = false

async function run(mode?: FirstSyncMode) {
  const { lichessUser } = await getSettings()
  if (!lichessUser) return setStatus({ state: 'off', user: undefined, error: undefined })
  // Waiting for the user to choose how to combine the data: only an explicit choice syncs.
  if (!mode && status.state === 'needs-choice' && status.user === lichessUser) return
  setStatus({ state: 'syncing', user: lichessUser })
  try {
    const res = await syncOnce(db, httpApi, lichessUser, mode)
    if (res.outcome === 'needs-choice') setStatus({ state: 'needs-choice', previousUser: res.previousUser })
    else setStatus({ state: 'idle', lastSyncedAt: Date.now(), error: undefined, previousUser: undefined })
  } catch (e) {
    setStatus({ state: 'error', error: navigator.onLine ? (e as Error).message : 'You are offline' })
  }
}

/** Syncs now (or right after the sync in progress). `mode` answers a 'needs-choice'. */
export function syncNow(mode?: FirstSyncMode): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      await run(mode)
      while (again) {
        again = false
        await run()
      }
    } finally {
      running = null
    }
  })()
  return running
}

let timer: ReturnType<typeof setTimeout> | undefined
function syncSoon(delay: number) {
  clearTimeout(timer)
  timer = setTimeout(() => syncNow(), delay)
}

const watched = new Set(SNAPSHOT_TABLES.map((t) => `idb://${db.name}/${t}/`))

/** Starts background syncing; returns a function that stops it. */
export function startAutoSync(): () => void {
  getSyncBase(db).then((b) => b && !status.lastSyncedAt && setStatus({ lastSyncedAt: b.syncedAt }))
  const onMutation = (parts: Record<string, unknown>) => {
    // While logged out, the change may be the login itself.
    if (Object.keys(parts).some((p) => [...watched].some((w) => p.startsWith(w))))
      syncSoon(status.state === 'off' ? 0 : AFTER_CHANGE_MS)
  }
  // Leaving the app pushes pending changes right away; coming back pulls.
  const onVisibility = () => syncSoon(document.visibilityState === 'hidden' ? 0 : 500)
  const onOnline = () => syncSoon(0)
  const interval = setInterval(() => document.visibilityState === 'visible' && syncNow(), PERIOD_MS)
  Dexie.on('storagemutated', onMutation)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  syncNow()
  return () => {
    Dexie.on.storagemutated.unsubscribe(onMutation)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    clearInterval(interval)
    clearTimeout(timer)
  }
}
