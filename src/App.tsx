import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router'
import { useSettings } from './db/settings'
import { BuilderPage } from './features/builder/BuilderPage'
import { GamesPage } from './features/games/GamesPage'
import { HomePage } from './features/dashboard/HomePage'
import { OverviewPage } from './features/overview/OverviewPage'
import { PlanPage } from './features/plan/PlanPage'
import { RepertoirePage } from './features/dashboard/RepertoirePage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TrainPage } from './features/train/TrainPage'
import { DialogHost } from './components/DialogHost'
import { GamesIcon, HomeIcon, MoonIcon, SettingsIcon, SunIcon, TrainIcon } from './components/icons'
import { completeLoginIfCallback } from './lib/auth/lichess'
import { useTheme } from './lib/theme'

const NAV = [
  { to: '/', label: 'Home', Icon: HomeIcon },
  { to: '/train?mode=review', label: 'Train', Icon: TrainIcon },
  { to: '/games', label: 'Games', Icon: GamesIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
]

export default function App() {
  const navigate = useNavigate()
  const settings = useSettings()
  const [loginError, setLoginError] = useState<string>()
  const [theme, toggleTheme] = useTheme()

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
    <div className="flex min-h-dvh flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <NavLink to="/" className="group flex items-center gap-2.5">
            <img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt=""
              className="h-8 w-8 rounded-lg shadow-[0_0_0_1px_rgb(217_170_85/0.25)] transition group-hover:shadow-[0_0_0_1px_rgb(217_170_85/0.6)]"
            />
            <span className="font-display text-lg leading-none font-medium tracking-tight">
              Opening <span className="text-brass italic">Trainer</span>
            </span>
          </NavLink>
          <nav className="ml-auto hidden gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  `relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'text-ink after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:rounded-full after:bg-brass'
                      : 'text-muted hover:bg-surface-2 hover:text-ink'
                  }`
                }
              >
                <n.Icon size={16} />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <NavLink
            to="/settings"
            className={`ml-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs md:ml-2 ${
              settings?.lichessUser ? 'border-line text-muted hover:text-ink' : 'border-warn/40 text-warn hover:bg-warn/10'
            }`}
            title={settings?.lichessUser ? 'Connected to Lichess' : 'Log in with Lichess in Settings'}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${settings?.lichessUser ? 'bg-accent' : 'bg-warn'}`} />
            {settings?.lichessUser ?? 'Not connected'}
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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-7">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/plan/:color" element={<PlanPage />} />
          <Route path="/rep/:id" element={<RepertoirePage />} />
          <Route path="/rep/:id/build" element={<BuilderPage />} />
          <Route path="/rep/:id/tree" element={<OverviewPage />} />
          <Route path="/train" element={<TrainPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      <DialogHost />

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line/80 bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `relative flex flex-1 flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium transition ${
                isActive
                  ? 'text-brass before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-full before:bg-brass'
                  : 'text-muted'
              }`
            }
          >
            <n.Icon size={21} />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
