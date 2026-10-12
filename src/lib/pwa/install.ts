import { useSyncExternalStore } from 'react'

// Installing the app on the home screen. Chrome and Edge (Android, desktop)
// offer it through `beforeinstallprompt`, which is kept here so a button can
// show the browser's dialog. Safari has no such event: on iPhone and iPad it
// is Share → Add to Home Screen.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface InstallState {
  /** Running as the installed app (home screen, standalone window). */
  installed: boolean
  /** The browser can show its install dialog (see promptInstall). */
  canPrompt: boolean
  /** Safari on iPhone / iPad, where installing is done from the Share menu. */
  ios: boolean
}

const standalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

export const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

let deferred: InstallPromptEvent | null = null
let state: InstallState = { installed: standalone(), canPrompt: false, ios: isIos() }
const listeners = new Set<() => void>()
function update(s: Partial<InstallState>) {
  state = { ...state, ...s }
  listeners.forEach((l) => l())
}

window.addEventListener('beforeinstallprompt', (e) => {
  // Keep the browser's mini-infobar from showing: the app offers its own button.
  e.preventDefault()
  deferred = e as InstallPromptEvent
  update({ canPrompt: true })
})
window.addEventListener('appinstalled', () => {
  deferred = null
  update({ canPrompt: false, installed: true })
})

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Shows the browser's install dialog. Resolves to true when the app was installed. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const e = deferred
  await e.prompt()
  const { outcome } = await e.userChoice
  // The event can only be used once.
  deferred = null
  update({ canPrompt: false })
  return outcome === 'accepted'
}
