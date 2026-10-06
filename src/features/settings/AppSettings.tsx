import { useState } from 'react'
import { CrossIcon, InstallIcon, ShareIcon } from '../../components/icons'
import { Section, Toggle } from '../../components/ui'
import { useInstall, promptInstall } from '../../lib/pwa/install'
import {
  DEFAULT_REMINDER_TIME,
  disableReminder,
  enableReminder,
  reminderSupport,
  testReminder,
  useDeviceReminder,
} from '../../lib/pwa/reminders'

/** Settings → App: installing on the home screen and the daily reminder. */
export function AppSettings({ loggedIn }: { loggedIn: boolean }) {
  return (
    <Section title="App">
      <div className="flex flex-col divide-y divide-line/60 [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
        <InstallApp />
        <DailyReminder loggedIn={loggedIn} />
      </div>
    </Section>
  )
}

function InstallApp() {
  const { installed, canPrompt, ios } = useInstall()
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="font-medium">Install on your phone</div>
          <div className="mt-0.5 text-xs leading-relaxed text-muted">
            {installed
              ? 'Installed: you’re using the app.'
              : 'From the home screen it opens full screen, without the browser’s bars, and works offline.'}
          </div>
        </div>
        {!installed && canPrompt && (
          <button className="btn-primary" onClick={() => promptInstall()}>
            <InstallIcon size={16} /> Install
          </button>
        )}
      </div>
      {!installed && !canPrompt && (ios ? <IosSteps /> : <p className="text-xs leading-relaxed text-muted">{OTHER_BROWSERS}</p>)}
    </div>
  )
}

const OTHER_BROWSERS =
  'Open your browser’s menu and choose “Install app” or “Add to Home screen”. In Chrome on Android, it’s in the ⋮ menu.'

function IosSteps() {
  return (
    <ol className="flex flex-col gap-1 text-xs leading-relaxed text-muted">
      <li>
        1. Tap Share <ShareIcon size={14} className="inline -translate-y-px text-info" /> in Safari’s toolbar.
      </li>
      <li>
        2. Choose <span className="font-medium text-ink">Add to Home Screen</span>, then Add.
      </li>
      <li>3. Open Opening Trainer from its icon.</li>
    </ol>
  )
}

function DailyReminder({ loggedIn }: { loggedIn: boolean }) {
  const reminder = useDeviceReminder()
  const [time, setTime] = useState(reminder?.time ?? DEFAULT_REMINDER_TIME)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>()
  const support = reminderSupport()

  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true)
    setMsg(undefined)
    try {
      await action()
      if (done) setMsg({ text: done })
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(false)
    }
  }

  const blocked =
    support === 'needs-install'
      ? 'On iPhone and iPad, reminders only work in the installed app: add it to your Home Screen, then turn them on from there.'
      : support === 'unsupported'
        ? 'This browser can’t show notifications.'
        : !loggedIn
          ? 'Log in with Lichess to get reminders: they follow your synced training.'
          : undefined

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="font-medium">Daily reminder</div>
          <div className="mt-0.5 text-xs leading-relaxed text-muted">
            A notification on days you haven’t met your daily goal yet, with the moves due. Set on each device.
          </div>
        </div>
        {!blocked && (
          <Toggle
            label="Remind me"
            checked={!!reminder}
            onChange={(on) => run(() => (on ? enableReminder(time) : disableReminder()))}
          />
        )}
      </div>
      {blocked && <p className="text-xs leading-relaxed text-muted">{blocked}</p>}
      {!blocked && reminder && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-3">
            <span className="text-muted">At</span>
            <input
              type="time"
              className="input w-28 tabular-nums"
              value={time}
              disabled={busy}
              onChange={(e) => {
                const t = e.target.value
                setTime(t)
                if (/^\d{2}:\d{2}$/.test(t)) run(() => enableReminder(t), `Reminder set for ${t}.`)
              }}
            />
          </label>
          <button
            className="btn-ghost ml-auto"
            disabled={busy}
            onClick={() => run(testReminder, 'Sent: it should arrive in a few seconds.')}
          >
            Send a test
          </button>
        </div>
      )}
      {msg && <p className={`text-xs leading-relaxed ${msg.bad ? 'text-bad' : 'text-muted'}`}>{msg.text}</p>}
    </div>
  )
}

const HINT_KEY = 'install-hint-dismissed'

/** On phones, until it's dismissed or the app is installed: install it. */
export function InstallHint() {
  const { installed, canPrompt, ios } = useInstall()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === '1'
    } catch {
      return false
    }
  })
  if (installed || dismissed || !(canPrompt || ios)) return null
  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(HINT_KEY, '1')
    } catch {
      // Shown again next time.
    }
  }
  return (
    <div className="relative flex flex-col gap-2 rounded-xl border border-brass/35 bg-brass/8 px-4 py-3 pr-10 md:hidden">
      <button className="absolute top-2.5 right-2.5 p-1 text-muted hover:text-ink" onClick={dismiss} aria-label="Dismiss">
        <CrossIcon size={14} />
      </button>
      <p className="text-xs leading-relaxed text-muted">
        <span className="font-medium text-ink">Install the app</span> to train full screen from your home screen and
        get a daily reminder.
      </p>
      {canPrompt ? (
        <button className="btn-primary self-start py-1.5 text-xs" onClick={() => promptInstall()}>
          <InstallIcon size={15} /> Install
        </button>
      ) : (
        <IosSteps />
      )}
    </div>
  )
}
