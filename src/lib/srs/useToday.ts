import { useSyncExternalStore } from 'react'
import { localDay } from './streak'

/** How often an open app checks whether the day has changed. */
const CHECK_MS = 60_000

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, CHECK_MS)
  // A phone brings the app back from the background, often the next day.
  document.addEventListener('visibilitychange', onChange)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onChange)
  }
}

/** Today's local day (YYYY-MM-DD). What depends on it is worked out again when the day changes. */
export function useToday(): string {
  return useSyncExternalStore(subscribe, () => localDay(Date.now()))
}
