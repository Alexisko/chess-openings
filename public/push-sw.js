// Imported by the generated service worker (vite.config.ts, workbox.importScripts):
// shows the daily reminders the sync server sends (worker/src/reminders.ts) and
// opens the app where the notification points.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // Not JSON: show the default text.
  }
  const scope = self.registration.scope
  const shown = self.registration.showNotification(data.title || 'Opening Trainer', {
    body: data.body || 'Time to train your openings.',
    icon: new URL('icon-192.png', scope).href,
    // One reminder at a time: a newer one replaces the last.
    tag: 'reminder',
    data: { url: new URL(data.url || '', scope).href },
  })
  const badge =
    typeof data.badge === 'number' && 'setAppBadge' in navigator
      ? (data.badge ? navigator.setAppBadge(data.badge) : navigator.clearAppBadge()).catch(() => {})
      : null
  event.waitUntil(Promise.all([shown, badge]))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope))
      if (!open) return self.clients.openWindow(url)
      await open.focus()
      return open.navigate(url).catch(() => {})
    }),
  )
})
