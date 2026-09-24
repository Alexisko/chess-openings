import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router'
import { useSettings } from './db/settings'
import { BuilderPage } from './features/builder/BuilderPage'
import { HomePage } from './features/dashboard/HomePage'
import { RepertoirePage } from './features/dashboard/RepertoirePage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TrainPage } from './features/train/TrainPage'
import { completeLoginIfCallback } from './lib/auth/lichess'

const NAV = [
  { to: '/', label: 'Home', icon: '⌂' },
  { to: '/train?mode=review', label: 'Train', icon: '↻' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export default function App() {
  const navigate = useNavigate()
  const settings = useSettings()
  const [loginError, setLoginError] = useState<string>()

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
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col pb-16 md:pb-0">
      <header className="flex items-center gap-4 border-b border-line px-4 py-3">
        <NavLink to="/" className="flex items-center gap-2 font-semibold">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" />
          <span>Opening Trainer</span>
        </NavLink>
        <nav className="ml-auto hidden gap-1 md:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <span className="ml-auto text-xs text-muted md:ml-2">
          {settings?.lichessUser ? `● ${settings.lichessUser}` : 'Not connected'}
        </span>
      </header>

      {loginError && (
        <div className="m-4 rounded-md border border-bad/50 bg-bad/10 px-3 py-2 text-sm">
          {loginError}
          <button className="ml-3 underline" onClick={() => setLoginError(undefined)}>
            Dismiss
          </button>
        </div>
      )}

      <main className="flex-1 px-4 py-4">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/rep/:id" element={<RepertoirePage />} />
          <Route path="/rep/:id/build" element={<BuilderPage />} />
          <Route path="/train" element={<TrainPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center py-2 text-xs ${isActive ? 'text-accent' : 'text-muted'}`
            }
          >
            <span className="text-lg leading-none">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
