import { useRef, useState } from 'react'
import { Section } from '../../components/ui'
import { exportBackup, importBackup } from '../../db/backup'
import { confirmDialog } from '../../lib/dialog'
import { db } from '../../db/schema'
import { setSetting, useSettings, type Settings } from '../../db/settings'
import { logout, saveToken, startLogin } from '../../lib/auth/lichess'
import { ALL_SPEEDS, RATING_BUCKETS, type ExplorerFilter } from '../../lib/explorer'
import { syncNow, useSyncStatus } from '../../lib/sync/auto'

export function SettingsPage() {
  const settings = useSettings()
  if (!settings) return null
  return (
    <div className="stagger mx-auto flex max-w-2xl flex-col gap-5">
      <h1 className="page-title">Settings</h1>
      <LichessAccount settings={settings} />
      <SyncSettings loggedIn={!!settings.lichessUser} />
      <ExplorerSettings filter={settings.explorerFilter} />
      <TrainingSettings settings={settings} />
      <Backup />
    </div>
  )
}

function LichessAccount({ settings }: { settings: Settings }) {
  const [token, setToken] = useState('')
  const [msg, setMsg] = useState<string>()
  return (
    <Section title="Lichess account">
      {settings.lichessUser ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-muted">Connected as</span> <span className="font-semibold">{settings.lichessUser}</span>
          <button className="btn-ghost ml-auto" onClick={() => logout()}>
            Log out
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">The opening explorer requires a Lichess login. No permissions are requested.</p>
          <button className="btn-primary self-start" onClick={() => startLogin().catch((e) => setMsg(e.message))}>
            Log in with Lichess
          </button>
          <details>
            <summary className="cursor-pointer text-xs text-muted hover:text-ink">Or paste a personal API token ▾</summary>
            <p className="my-2 text-xs text-muted">
              Create one without any scopes at{' '}
              <a className="underline" href="https://lichess.org/account/oauth/token" target="_blank" rel="noreferrer">
                lichess.org/account/oauth/token
              </a>
              .
            </p>
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  await saveToken(token.trim())
                  setToken('')
                  setMsg(undefined)
                } catch (err) {
                  setMsg((err as Error).message)
                }
              }}
            >
              <input
                className="input flex-1"
                type="password"
                autoComplete="off"
                placeholder="lip_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button className="btn-ghost" disabled={!token.trim()}>
                Save
              </button>
            </form>
          </details>
          {msg && <p className="text-bad">{msg}</p>}
        </div>
      )}
      <label className="mt-5 flex items-center gap-3 border-t border-line/70 pt-4 text-sm">
        <span className="w-40 text-muted">Chess.com username</span>
        <input
          className="input flex-1"
          defaultValue={settings.chesscomUser}
          onBlur={(e) => setSetting('chesscomUser', e.target.value.trim())}
        />
      </label>
      <p className="mt-1 text-xs text-muted">Your games are imported on the Games page to find where you left your preparation.</p>
    </Section>
  )
}

function syncedAt(ms: number) {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString()} ${time}`
}

function SyncSettings({ loggedIn }: { loggedIn: boolean }) {
  const status = useSyncStatus()
  const replace = async () => {
    const ok = await confirmDialog({
      title: 'Use the synced copy?',
      message: `The repertoires and review history on this device are replaced by ${status.user}'s synced copy.`,
      confirmLabel: 'Replace this device’s data',
      danger: true,
    })
    if (ok) await syncNow('replace')
  }
  return (
    <Section title="Sync between devices">
      {!loggedIn ? (
        <p className="text-sm text-muted">Log in with Lichess to keep your repertoires in sync on all your devices.</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {status.state === 'needs-choice' ? (
            <div className="rounded-lg border border-warn/40 bg-warn/10 p-3">
              <p className="mb-3">
                {status.previousUser
                  ? `This device last synced as ${status.previousUser}, and ${status.user} has a synced copy too.`
                  : `This device has repertoires, and so does ${status.user}'s synced copy.`}{' '}
                How should they be combined?
              </p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => syncNow('merge')}>
                  Keep both
                </button>
                <button className="btn-ghost" onClick={replace}>
                  Use the synced copy only
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span
                className={`h-2 w-2 rounded-full ${
                  status.state === 'error' ? 'bg-bad' : status.state === 'syncing' ? 'animate-pulse bg-brass' : 'bg-accent'
                }`}
              />
              <span className="min-w-0 flex-1">
                {status.state === 'syncing'
                  ? 'Syncing…'
                  : status.state === 'error'
                    ? `Couldn't sync: ${status.error}`
                    : status.lastSyncedAt
                      ? `Synced as ${status.user} at ${syncedAt(status.lastSyncedAt)}`
                      : 'Not synced yet'}
              </span>
              <button className="btn-ghost" disabled={status.state === 'syncing'} onClick={() => syncNow()}>
                Sync now
              </button>
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted">
            Repertoires, notes, training history and settings are saved under your Lichess username, so anyone who
            knows it can read them. Games are imported again on each device.
          </p>
        </div>
      )}
    </Section>
  )
}

function ExplorerSettings({ filter }: { filter: ExplorerFilter }) {
  const update = (f: Partial<ExplorerFilter>) => setSetting('explorerFilter', { ...filter, ...f })
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const chip = (active: boolean) => `chip ${active ? 'chip-on' : ''}`
  return (
    <Section title="Opponent statistics">
      <p className="mb-3 text-xs text-muted">
        Which games decide “the most common responses”. Your preparedness scores are computed with this filter.
      </p>
      <div className="mb-4 flex gap-2">
        {(['lichess', 'masters'] as const).map((d) => (
          <button key={d} className={chip(filter.db === d)} onClick={() => update({ db: d })}>
            {d === 'lichess' ? 'Lichess players' : 'Masters'}
          </button>
        ))}
      </div>
      {filter.db === 'lichess' && (
        <>
          <div className="eyebrow mb-2">Time controls</div>
          <div className="mb-3 flex flex-wrap gap-2">
            {ALL_SPEEDS.map((s) => (
              <button
                key={s}
                className={chip(filter.speeds.includes(s))}
                onClick={() => {
                  const speeds = toggle(filter.speeds, s)
                  if (speeds.length) update({ speeds })
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="eyebrow mb-2">Opponent ratings</div>
          <div className="flex flex-wrap gap-2">
            {RATING_BUCKETS.map((r) => (
              <button
                key={r}
                className={chip(filter.ratings.includes(r))}
                onClick={() => {
                  const ratings = toggle(filter.ratings, r).sort((a, b) => a - b)
                  if (ratings.length) update({ ratings })
                }}
              >
                {r}
                {r === 2500 ? '+' : ''}
              </button>
            ))}
          </div>
        </>
      )}
    </Section>
  )
}

function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  onChange: (n: number) => void
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <div className="flex-1">
        <div className="font-medium">{label}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</div>
      </div>
      <input
        type="number"
        className="input w-20 text-right tabular-nums"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (n >= min && n <= max) onChange(n)
        }}
      />
    </label>
  )
}

function TrainingSettings({ settings }: { settings: Settings }) {
  return (
    <Section title="Training">
      <div className="flex flex-col divide-y divide-line/60 [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
        <NumberSetting
          label="Preparedness target (your moves)"
          hint="Counted from each repertoire's starting position. Raise it as your score improves."
          value={settings.prepDepth}
          min={1}
          max={25}
          onChange={(n) => setSetting('prepDepth', n)}
        />
        <NumberSetting
          label="New moves per day"
          hint="How many new positions to learn each day."
          value={settings.newPerDay}
          min={1}
          max={100}
          onChange={(n) => setSetting('newPerDay', n)}
        />
        <NumberSetting
          label="Engine warning threshold (centipawns)"
          hint="Warn when a repertoire move is this much worse than the engine’s best."
          value={settings.blunderThreshold}
          min={10}
          max={500}
          onChange={(n) => setSetting('blunderThreshold', n)}
        />
      </div>
    </Section>
  )
}

function Backup() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string>()
  const download = async () => {
    const url = URL.createObjectURL(new Blob([await exportBackup()], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `opening-trainer-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Section title="Backup & transfer">
      <p className="mb-3 text-xs text-muted">
        Export a snapshot of your data to keep, or restore one. Restoring replaces your data everywhere it is
        synced.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={download}>
          Export backup
        </button>
        <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
          Import backup…
        </button>
        <button
          className="btn-ghost"
          onClick={async () => {
            await db.explorerCache.clear()
            setMsg('Opponent statistics will be downloaded again.')
          }}
        >
          Clear statistics cache
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            const ok = await confirmDialog({
              title: 'Import this backup?',
              message:
                'It replaces all repertoires and review history on this device and in your synced copy. Export a backup first if you want to keep them.',
              confirmLabel: 'Replace my data',
              danger: true,
            })
            if (!ok) return
            try {
              await importBackup(await file.text())
              setMsg('Backup imported.')
            } catch (err) {
              setMsg((err as Error).message)
            }
          }}
        />
      </div>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </Section>
  )
}
