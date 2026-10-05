import { useEffect, useSyncExternalStore } from 'react'

/*
 * Focus mode: while a training session runs, phones hide the app's header and bottom
 * navigation so the board and its controls fill the screen. The session leaves it on purpose
 * (its own exit button), not by a stray tap on the nav.
 */

let holders = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Turns focus mode on while the calling component is mounted (and `on` is true). */
export function useFocusMode(on = true) {
  useEffect(() => {
    if (!on) return
    holders++
    listeners.forEach((l) => l())
    return () => {
      holders--
      listeners.forEach((l) => l())
    }
  }, [on])
}

/** Whether a component currently holds focus mode. */
export function useInFocusMode() {
  return useSyncExternalStore(subscribe, () => holders > 0)
}
