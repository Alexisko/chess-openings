import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useSettings } from './db/settings'
import { BuilderPage } from './features/builder/BuilderPage'
import { GameReview } from './features/games/GameReview'
import { GamesPage } from './features/games/GamesPage'
import { HomePage } from './features/dashboard/HomePage'
import { OverviewPage } from './features/overview/OverviewPage'
import { RepertoirePage } from './features/dashboard/RepertoirePage'
import { RepertoiresPage } from './features/dashboard/RepertoiresPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TrainPage } from './features/train/TrainPage'
import { DialogHost } from './components/DialogHost'
import { GamesIcon, MoonIcon, RepertoireIcon, SettingsIcon, SunIcon, TrainIcon } from './components/icons'
import { completeLoginIfCallback } from './lib/auth/lichess'
import { useInFocusMode } from './lib/focusMode'
import { startAutoSync, useSyncStatus } from './lib/sync/auto'
import { planUrl } from './lib/routes'
import { useTheme } from './lib/theme'

/** The app's three parts. Each route belongs to one of them; settings sit behind the account pill. */
const NAV = [
  { to: '/', label: 'Train', Icon: TrainIcon, match: /^\/(train)?$/ },
  { to: '/repertoire', label: 'Repertoire', Icon: RepertoireIcon, match: /^\/(repertoire|plan|rep)(\/|$)/ },
  { to: '/games', label: 'Games', Icon: GamesIcon, match: /^\/games(\/|$)/ },
]

export default function App() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const settings = useSettings()
  const [loginError, setLoginError] = useState<string>()
  const [theme, toggleTheme] = useTheme()
  const sync = useSyncStatus()
  // A training session hides the header and bottom nav on phones.
  const focus = useInFocusMode()

  useEffect(() => startAutoSync(), [])

  useEffect(() => {
    let done = false
    completeLoginIfCallback()
      .then((to) => !done && to && navigate(to, { replace: true }))
      .catch((e: Error) => setLoginError(e.message))
    return () => {
      done = true
    }
  }, [navigate])

  return (
    <div
      className={`flex min-h-dvh flex-col md:pb-0 ${focus ? 'pb-[env(safe-area-inset-bottom)]' : 'pb-[calc(4.25rem+env(safe-area-inset-bottom))]'}`}
    >
      <header
        className={`sticky top-0 z-30 border-b border-line/70 bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur-md ${focus ? 'max-md:hidden' : ''}`}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <NavLink to="/" className="group flex items-center gap-2.5">
            <img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt=""
              className="h-8 w-8 rounded-lg shadow-[0_0_0_1px_rgb(217_170_85/0.25)] transition group-hover:shadow-[0_0_0_1px_rgb(217_170_85/0.6)]"
            />
            <span className="font-display text-lg leading-none font-medium tracking-tight whitespace-nowrap">
              Opening <span className="text-brass italic">Trainer</span>
            </span>
          </NavLink>
          <nav className="ml-auto hidden gap-1 md:flex">
            {NAV.map((n) => {
              const active = n.match.test(pathname)
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? 'text-ink after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:rounded-full after:bg-brass'
                      : 'text-muted hover:bg-surface-2 hover:text-ink'
                  }`}
                >
                  <n.Icon size={16} />
                  {n.label}
                </Link>
              )
            })}
          </nav>
          <NavLink
            to="/settings"
            aria-label={`Settings and account${settings?.lichessUser ? `: ${settings.lichessUser}` : ', not connected'}`}
            className={({ isActive }) =>
              `ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap transition md:ml-2 ${
                isActive
                  ? 'border-brass/70 bg-brass/10 text-ink'
                  : settings?.lichessUser
                    ? 'border-line text-muted hover:border-line-strong hover:text-ink'
                    : 'border-warn/40 text-warn hover:bg-warn/10'
              }`
            }
            title={
              !settings?.lichessUser
                ? 'Log in with Lichess in Settings'
                : sync.state === 'error'
                  ? `Couldn't sync: ${sync.error}`
                  : sync.state === 'needs-choice'
                    ? 'Choose how to sync in Settings'
                    : 'Connected to Lichess and synced'
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                !settings?.lichessUser || sync.state === 'needs-choice'
                  ? 'bg-warn'
                  : sync.state === 'error'
                    ? 'bg-bad'
                    : sync.state === 'syncing'
                      ? 'animate-pulse bg-brass'
                      : 'bg-accent'
              }`}
            />
            {settings?.lichessUser ?? (
              <>
                {/* Short on phones, so the pill fits beside the wordmark. */}
                <span className="sm:hidden">Log in</span>
                <span className="max-sm:hidden">Not connected</span>
              </>
            )}
            <SettingsIcon size={14} className="-mr-0.5 opacity-80" />
          </NavLink>
          <button
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:border-line-strong hover:text-brass"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </button>
        </div>
      </header>

      {loginError && (
        <div className="mx-auto mt-4 w-full max-w-6xl px-4">
          <div className="rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm">
            {loginError}
            <button className="ml-3 underline" onClick={() => setLoginError(undefined)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main
        className={`mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-7 ${focus ? 'max-md:pt-[max(0.75rem,env(safe-area-inset-top))] max-md:pb-2' : ''}`}
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/repertoire" element={<RepertoiresPage />} />
          <Route path="/plan/:color" element={<PlanRedirect />} />
          <Route path="/rep/:id" element={<RepertoirePage />} />
          <Route path="/rep/:id/build" element={<BuilderPage />} />
          <Route path="/rep/:id/tree" element={<OverviewPage />} />
          <Route path="/train" element={<TrainPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/games/:id" element={<GameReview />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      <DialogHost />

      <nav
        className={`fixed inset-x-0 bottom-0 z-30 flex border-t border-line/80 bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden ${focus ? 'hidden' : ''}`}
      >
        {NAV.map((n) => {
          const active = n.match.test(pathname)
          return (
            <Link
              key={n.to}
              to={n.to}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium transition ${
                active
                  ? 'text-brass before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-full before:bg-brass'
                  : 'text-muted'
              }`}
            >
              <n.Icon size={21} />
              {n.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

/** The plan pages became the repertoire tab: old links and installed shortcuts land there. */
function PlanRedirect() {
  const { color } = useParams()
  const [params] = useSearchParams()
  const at = params.get('at')
  return <Navigate to={planUrl(color === 'black' ? 'black' : 'white', at ? at.split(',') : undefined)} replace />
}
