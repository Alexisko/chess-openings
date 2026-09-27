import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ColorDot, Section } from '../../components/ui'
import { deleteAllGames, gradeForgottenMoves, loadRepIndex } from '../../db/games'
import { db, type GameSpeed } from '../../db/schema'
import { useSettings, type Settings } from '../../db/settings'
import type { Color } from '../../lib/chess/position'
import { analyzeGame, type RepIndex } from '../../lib/games/analyze'
import { importGames, type ImportProgress } from '../../lib/games/import'
import { GAME_SPEEDS } from '../../lib/games/parse'
import { confirmDialog } from '../../lib/dialog'
import { gamesParams, type GamesTab } from '../../lib/routes'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { Findings } from './Findings'
import { GameExplorer } from './GameExplorer'
import { OpeningMap } from './OpeningMap'
import { OpeningOverview } from './OpeningOverview'

const DAY = 24 * 3600 * 1000
const PERIODS = [
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '12 months' },
  { months: 0, label: 'All' },
]

const TABS: { id: GamesTab; label: string }[] = [
  { id: 'overview', label: 'Openings' },
  { id: 'map', label: 'Map' },
  { id: 'explorer', label: 'Explorer' },
  { id: 'findings', label: 'Findings' },
]

/** Games played in the last `months` months (0 = all). */
const periodFrom = (months: number) => ({ months, since: months ? Date.now() - months * 30.5 * DAY : 0 })

export function GamesPage() {
  const settings = useSettings()
  const games = useLiveQuery(() => db.games.orderBy('playedAt').reverse().toArray(), [])
  const reps = useLiveQuery(() => loadRepIndex(), [])
  const [period, setPeriod] = useState(() => periodFrom(12))
  const [speeds, setSpeeds] = useState<GameSpeed[]>(GAME_SPEEDS)
  // Tab, colour and explorer line live in the URL, so links can open them and Back works.
  const [params, setParams] = useSearchParams()
  // The map needs a wide screen: on phones its tab is hidden and a link to it opens the Openings list.
  const mapFits = useMediaQuery('(min-width: 768px)')
  const asked = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'overview'
  const tab: GamesTab = asked === 'map' && !mapFits ? 'overview' : asked
  const color: Color = params.get('color') === 'black' ? 'black' : 'white'
  const at = useMemo(() => params.get('at')?.split(',').filter(Boolean) ?? [], [params])
  const go = (next: { tab?: GamesTab; color?: Color; at?: string[] }, replace = false) =>
    setParams(gamesParams(next.tab ?? tab, next.color ?? color, next.at ?? at), { replace })

  const analyses = useMemo(() => {
    if (!games || !reps) return undefined
    return games
      .filter((g) => g.playedAt >= period.since && speeds.includes(g.speed))
      .map((g) => analyzeGame(g, reps))
  }, [games, reps, period, speeds])
  const ofColor = useMemo(() => analyses?.filter((a) => a.game.color === color), [analyses, color])
  // Only offer the time controls you actually have games in.
  const played = useMemo(() => GAME_SPEEDS.filter((s) => games?.some((g) => g.speed === s)), [games])
  const chip = (active: boolean) => `chip ${active ? 'chip-on' : ''}`

  if (!settings || !games || !reps) return null
  return (
    <div className="stagger flex flex-col gap-5">
      <div>
        <div className="eyebrow">Lichess & Chess.com</div>
        <h1 className="page-title mt-1">Your games</h1>
      </div>
      <ImportSection settings={settings} count={games.length} newest={games[0]?.playedAt} reps={reps} />
      {games.length > 0 && analyses && ofColor && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-28 shrink-0 text-xs text-muted">Games from the last</span>
              {PERIODS.map((p) => (
                <button
                  key={p.months}
                  className={chip(period.months === p.months)}
                  onClick={() => setPeriod(periodFrom(p.months))}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {played.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-28 shrink-0 text-xs text-muted">Time controls</span>
                {played.map((s) => (
                  <button
                    key={s}
                    className={chip(speeds.includes(s))}
                    onClick={() => {
                      const next = speeds.includes(s) ? speeds.filter((x) => x !== s) : [...speeds, s]
                      if (next.some((x) => played.includes(x))) setSpeeds(next)
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-b border-line/70">
            <nav className="flex gap-1" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${t.id === 'map' && !mapFits ? 'hidden' : ''} ${
                    tab === t.id ? 'border-brass text-ink' : 'border-transparent text-muted hover:text-ink'
                  }`}
                  onClick={() => go({ tab: t.id })}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            {tab !== 'findings' && (
              <div className="ml-auto flex gap-1 pb-1.5" role="group" aria-label="Colour">
                {(['white', 'black'] as const).map((c) => (
                  <button
                    key={c}
                    className={chip(color === c)}
                    aria-pressed={color === c}
                    onClick={() => go({ color: c, at: [] }, true)}
                  >
                    <ColorDot color={c} size={10} />
                    {c === 'white' ? 'White' : 'Black'}
                    <span className="text-faint tabular-nums">{analyses.filter((a) => a.game.color === c).length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {tab === 'overview' && (
            <OpeningOverview
              analyses={ofColor}
              color={color}
              reps={reps}
              onExplore={(line) => go({ tab: 'explorer', at: line })}
            />
          )}
          {tab === 'map' && (
            <OpeningMap analyses={ofColor} color={color} reps={reps} onExplore={(line) => go({ tab: 'explorer', at: line })} />
          )}
          {tab === 'explorer' && (
            <GameExplorer analyses={ofColor} color={color} reps={reps} at={at} onGo={(line) => go({ at: line }, true)} />
          )}
          {tab === 'findings' && <Findings analyses={analyses} reps={reps} settings={settings} />}
        </>
      )}
    </div>
  )
}

function ImportSection({
  settings,
  count,
  newest,
  reps,
}: {
  settings: Settings
  count: number
  newest?: number
  reps: RepIndex[]
}) {
  const [progress, setProgress] = useState<Partial<Record<ImportProgress['source'], ImportProgress>>>({})
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<string>()
  const lichessUser = settings.lichessUser
  const chesscomUser = settings.chesscomUser.trim() || undefined

  const run = async () => {
    setRunning(true)
    setMsg(undefined)
    setProgress({})
    try {
      const res = await importGames({
        lichessUser,
        lichessToken: settings.lichessToken,
        chesscomUser,
        onProgress: (p) => setProgress((s) => ({ ...s, [p.source]: p })),
      })
      // Grade forgotten moves in every stored game: games already graded are skipped.
      const all = await db.games.toArray()
      const graded = await gradeForgottenMoves(all.map((g) => analyzeGame(g, reps)))
      const added = res.added.lichess + res.added.chesscom
      setMsg(
        [
          added ? `Imported ${added} new games (Lichess ${res.added.lichess}, Chess.com ${res.added.chesscom}).` : 'No new games.',
          graded ? `${graded} forgotten moves were sent back to review.` : '',
          ...res.errors,
        ]
          .filter(Boolean)
          .join(' '),
      )
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Section
      title="Import"
      right={
        count > 0 && (
          <button
            className="text-xs text-muted hover:text-bad"
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Delete imported games?',
                message: 'All imported games are removed from this device. Your cards keep their review history.',
                confirmLabel: 'Delete games',
                danger: true,
              })
              if (ok) await deleteAllGames()
            }}
          >
            Delete imported games
          </button>
        )
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-muted">
        Imports your bullet, blitz, rapid, classical and daily games (the first import covers the last 12 months) and compares
        them with your repertoires. A repertoire move you got wrong in a game played after its last review is sent back to review.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg border border-line/60 bg-surface-2/60 px-3 py-2">
          <div className="text-[11px] text-muted">Lichess</div>
          {lichessUser ? (
            <span className="font-medium">{lichessUser}</span>
          ) : (
            <Link to="/settings" className="text-xs text-warn hover:underline">
              Log in first
            </Link>
          )}
        </div>
        <div className="rounded-lg border border-line/60 bg-surface-2/60 px-3 py-2">
          <div className="flex items-center text-[11px] text-muted">
            Chess.com
            <Link to="/settings" className="ml-auto hover:text-ink">
              change
            </Link>
          </div>
          {chesscomUser ? <span className="font-medium">{chesscomUser}</span> : <span className="text-xs text-faint">not set</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={running || (!lichessUser && !chesscomUser)} onClick={run}>
          {running ? 'Importing…' : count ? 'Import new games' : 'Import games'}
        </button>
        <span className="text-xs text-muted">
          {count} games stored{newest ? `, newest ${new Date(newest).toLocaleDateString()}` : ''}
        </span>
      </div>
      {running && (
        <ul className="mt-2 text-xs text-muted">
          {Object.values(progress).map((p) => (
            <li key={p.source}>{p.status}</li>
          ))}
        </ul>
      )}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Section>
  )
}

