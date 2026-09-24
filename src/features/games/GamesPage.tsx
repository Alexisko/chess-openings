import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { pct, scoreColor } from '../../components/format'
import { ColorDot, Section } from '../../components/ui'
import { deleteAllGames, gradeForgottenMoves, loadRepIndex } from '../../db/games'
import { db, type Game, type GameSpeed } from '../../db/schema'
import { useSettings, type Settings } from '../../db/settings'
import { formatMoves } from '../../lib/chess/position'
import {
  analyzeGame,
  collectFindings,
  summarizeByRepertoire,
  type Finding,
  type FindingMove,
  type GameAnalysis,
  type Outcome,
  type RepIndex,
} from '../../lib/games/analyze'
import { importGames, type ImportProgress } from '../../lib/games/import'
import { GAME_SPEEDS } from '../../lib/games/parse'
import { lossKey, useMoveLosses, type LossTarget } from '../../lib/games/moveLoss'
import { builderUrl } from '../../lib/routes'

const DAY = 24 * 3600 * 1000
const PERIODS = [
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '12 months' },
  { months: 0, label: 'All' },
]
/** Engine checks are limited to the most frequent deviations. */
const MAX_ENGINE_CHECKS = 30
const LIST_SIZE = 8

const OUTCOMES: { outcome: Outcome; label: string; cls: string }[] = [
  { outcome: 'in-prep', label: 'Stayed in prep', cls: 'bg-accent' },
  { outcome: 'opp-left', label: 'Opponent left your prep', cls: 'bg-info' },
  { outcome: 'prep-ended', label: 'Your line ended', cls: 'bg-warn' },
  { outcome: 'forgot', label: 'You forgot your move', cls: 'bg-bad' },
  { outcome: 'not-covered', label: 'No repertoire', cls: 'bg-line' },
]

/** Games played in the last `months` months (0 = all). */
const periodFrom = (months: number) => ({ months, since: months ? Date.now() - months * 30.5 * DAY : 0 })

export function GamesPage() {
  const settings = useSettings()
  const games = useLiveQuery(() => db.games.orderBy('playedAt').reverse().toArray(), [])
  const reps = useLiveQuery(() => loadRepIndex(), [])
  const [period, setPeriod] = useState(() => periodFrom(12))
  const [speeds, setSpeeds] = useState<GameSpeed[]>(GAME_SPEEDS)

  const analyses = useMemo(() => {
    if (!games || !reps) return undefined
    return games
      .filter((g) => g.playedAt >= period.since && speeds.includes(g.speed))
      .map((g) => analyzeGame(g, reps))
  }, [games, reps, period, speeds])
  // Only offer the time controls you actually have games in.
  const played = useMemo(() => GAME_SPEEDS.filter((s) => games?.some((g) => g.speed === s)), [games])
  const chip = (active: boolean) => `btn border px-2.5 py-1 ${active ? 'border-accent bg-surface-2' : 'border-line text-muted'}`

  if (!settings || !games || !reps) return null
  return (
    <div className="flex flex-col gap-4">
      <ImportSection settings={settings} count={games.length} newest={games[0]?.playedAt} reps={reps} />
      {games.length > 0 && analyses && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Games from the last</span>
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
            <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Time controls</span>
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
          <Report analyses={analyses} reps={reps} settings={settings} />
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
      title="Your games"
      right={
        count > 0 && (
          <button
            className="text-xs text-muted hover:text-ink"
            onClick={async () => {
              if (confirm('Delete all imported games from this device? Your cards keep their history.')) await deleteAllGames()
            }}
          >
            Delete imported games
          </button>
        )
      }
    >
      <p className="mb-3 text-sm text-muted">
        Imports your bullet, blitz, rapid and classical games (the first import covers the last 12 months) and compares
        them with your repertoires. A repertoire move you got wrong in a game played after its last review is sent back to review.
      </p>
      <div className="mb-3 flex flex-col gap-1 text-sm">
        <div>
          Lichess:{' '}
          {lichessUser ? (
            <span className="font-medium">{lichessUser}</span>
          ) : (
            <span className="text-muted">log in with Lichess in Settings to import these games</span>
          )}
        </div>
        <div>
          Chess.com:{' '}
          {chesscomUser ? <span className="font-medium">{chesscomUser}</span> : <span className="text-muted">not set</span>}{' '}
          <Link to="/settings" className="text-xs text-muted underline">
            change
          </Link>
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

function Report({ analyses, reps, settings }: { analyses: GameAnalysis[]; reps: RepIndex[]; settings: Settings }) {
  const findings = useMemo(() => collectFindings(analyses, reps), [analyses, reps])
  const summaries = useMemo(() => summarizeByRepertoire(analyses), [analyses])

  // Check the most frequent moves where games left a repertoire.
  const targets = useMemo(() => {
    const list: (LossTarget & { n: number })[] = []
    for (const f of findings)
      if (f.outcome !== 'not-covered') for (const m of f.moves) list.push({ key: f.key, uci: m.uci, n: m.games.length })
    return list.sort((a, b) => b.n - a.n).slice(0, MAX_ENGINE_CHECKS)
  }, [findings])
  const { losses, pending } = useMoveLosses(targets)
  const lossOf = (f: Finding, m: FindingMove) => losses.get(lossKey({ key: f.key, uci: m.uci }))
  const bad = (f: Finding, m: FindingMove) => (lossOf(f, m) ?? 0) >= settings.blunderThreshold

  const forgot = findings.filter((f) => f.outcome === 'forgot')
  const afterPrep = findings.filter((f) => f.outcome === 'prep-ended' && f.mover === 'me' && f.moves.some((m) => bad(f, m)))
  const punish = findings.filter((f) => f.mover === 'opponent' && f.outcome !== 'not-covered' && f.moves.some((m) => bad(f, m)))
  const unprepared = findings.filter((f) => f.outcome === 'opp-left')
  const ended = findings.filter((f) => f.outcome === 'prep-ended')
  const uncovered = findings.filter((f) => f.outcome === 'not-covered')
  const repName = new Map(reps.map((r) => [r.rep.id, r.rep]))

  const ctx: RowContext = { lossOf, threshold: settings.blunderThreshold, reps: repName }
  return (
    <>
      <Overview analyses={analyses} />

      {summaries.length > 0 && (
        <Section title="By repertoire">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="font-normal">Repertoire</th>
                <th className="text-right font-normal">Games</th>
                <th className="text-right font-normal" title="Average number of your moves played from the repertoire">
                  Moves in prep
                </th>
                <th className="text-right font-normal">Forgot</th>
                <th className="text-right font-normal">Score</th>
              </tr>
            </thead>
            <tbody>
              {summaries
                .sort((a, b) => b.games - a.games)
                .map((s) => {
                  const rep = repName.get(s.repertoireId)
                  return (
                    <tr key={s.repertoireId} className="border-t border-line">
                      <td className="py-1">
                        <Link to={`/rep/${s.repertoireId}`} className="flex items-center gap-2 hover:underline">
                          {rep && <ColorDot color={rep.color} />}
                          {rep?.name}
                        </Link>
                      </td>
                      <td className="text-right">{s.games}</td>
                      <td className="text-right">{s.avgOwnMoves.toFixed(1)}</td>
                      <td className={`text-right ${s.forgot ? 'text-bad' : 'text-muted'}`}>{s.forgot}</td>
                      <td className={`text-right font-medium ${scoreColor(s.score)}`}>{pct(s.score)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </Section>
      )}

      {pending > 0 && <p className="text-xs text-muted">Checking {pending} positions with the engine…</p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 md:items-start">
        <div className="flex flex-col gap-4">
          <FindingList
            title="You forgot your move"
            empty="You played your repertoire move every time. Nice!"
            hint="Games where you played something else than your repertoire move."
            findings={forgot}
            ctx={ctx}
          />
          <FindingList
            title="Mistakes right after your prep"
            empty={pending ? 'Waiting for the engine…' : 'No engine-flagged mistakes where your lines end.'}
            hint={`Your lines ended and your next move lost at least ${(settings.blunderThreshold / 100).toFixed(1)} pawns: extend the line with a better move.`}
            findings={afterPrep}
            ctx={ctx}
          />
        </div>
        <div className="flex flex-col gap-4">
          <FindingList
            title="Punish these moves"
            empty={pending ? 'Waiting for the engine…' : 'No engine-flagged opponent mistakes where they left your prep.'}
            hint="Opponents left your preparation with a move the engine dislikes. Prepare the refutation."
            findings={punish}
            ctx={ctx}
          />
          <FindingList
            title="Replies you have no answer to"
            empty="Opponents never surprised you inside a repertoire."
            hint="Opponent moves from your games that your repertoire doesn't answer, most frequent first."
            findings={unprepared}
            ctx={ctx}
          />
          <FindingList
            title="Where your lines end"
            empty="None of your lines ended during a game."
            hint="Positions your games reached after your preparation ran out."
            findings={ended}
            ctx={ctx}
          />
          <FindingList
            title="Not covered by a repertoire"
            empty="Every game reached one of your repertoires."
            hint="Openings you meet that no repertoire starts from."
            findings={uncovered}
            ctx={ctx}
          />
        </div>
      </div>
    </>
  )
}

function Overview({ analyses }: { analyses: GameAnalysis[] }) {
  const counts = new Map<Outcome, number>()
  for (const a of analyses) counts.set(a.outcome, (counts.get(a.outcome) ?? 0) + 1)
  const total = analyses.length || 1
  const inRep = analyses.filter((a) => a.repertoireId)
  const avg = inRep.length ? inRep.reduce((s, a) => s + a.ownMoves, 0) / inRep.length : 0
  return (
    <Section title={`${analyses.length} games`}>
      <div className="mb-3 flex gap-6">
        <div>
          <div className="text-2xl font-semibold">{pct(inRep.length / total)}</div>
          <div className="text-xs text-muted">reached a repertoire</div>
        </div>
        <div>
          <div className="text-2xl font-semibold">{avg.toFixed(1)}</div>
          <div className="text-xs text-muted">avg. own moves in prep</div>
        </div>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-sm">
        {OUTCOMES.map((o) => {
          const n = counts.get(o.outcome) ?? 0
          return n ? <div key={o.outcome} className={o.cls} style={{ width: `${(n / total) * 100}%` }} title={o.label} /> : null
        })}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {OUTCOMES.map((o) => (
          <li key={o.outcome} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-sm ${o.cls}`} />
            {o.label} <span className="text-ink">{counts.get(o.outcome) ?? 0}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

interface RowContext {
  lossOf: (f: Finding, m: FindingMove) => number | null | undefined
  threshold: number
  reps: Map<string, RepIndex['rep']>
}

function FindingList({
  title,
  hint,
  empty,
  findings,
  ctx,
}: {
  title: string
  hint: string
  empty: string
  findings: Finding[]
  ctx: RowContext
}) {
  const [all, setAll] = useState(false)
  const shown = all ? findings : findings.slice(0, LIST_SIZE)
  return (
    <Section title={title} right={findings.length > 0 && <span className="text-xs text-muted">{findings.length}</span>}>
      <p className="mb-2 text-xs text-muted">{hint}</p>
      {findings.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((f) => (
            <FindingRow key={f.id} f={f} ctx={ctx} />
          ))}
        </ul>
      )}
      {findings.length > LIST_SIZE && (
        <button className="mt-2 text-xs text-muted underline" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${findings.length}`}
        </button>
      )}
    </Section>
  )
}

function LossBadge({ loss, threshold, mine }: { loss: number | null | undefined; threshold: number; mine: boolean }) {
  if (loss === undefined || loss === null || loss < threshold) return null
  const text = loss >= 10000 ? 'mate' : `−${(loss / 100).toFixed(1)}`
  return (
    <span
      className={`rounded px-1 text-[10px] font-semibold ${mine ? 'bg-bad/20 text-bad' : 'bg-accent/20 text-accent'}`}
      title={mine ? 'Engine: your move loses this much' : 'Engine: their move loses this much'}
    >
      {text}
    </span>
  )
}

function FindingRow({ f, ctx }: { f: Finding; ctx: RowContext }) {
  const mine = f.mover === 'me'
  const moveList = (
    <span className="inline-flex flex-wrap gap-x-2">
      {f.moves.map((m) => (
        <span key={m.uci} className="inline-flex items-center gap-1">
          <span className="font-semibold text-ink">{m.san}</span>
          {f.moves.length > 1 && <span className="text-muted">×{m.games.length}</span>}
          <LossBadge loss={ctx.lossOf(f, m)} threshold={ctx.threshold} mine={mine} />
        </span>
      ))}
    </span>
  )
  let label: ReactNode
  if (f.outcome === 'forgot')
    label = (
      <>
        You played {moveList} instead of <span className="font-semibold text-accent">{f.expected?.san}</span>
      </>
    )
  else if (f.outcome === 'opp-left') label = <>No answer prepared to {moveList}</>
  else if (f.outcome === 'prep-ended') label = <>Line ended; {mine ? 'you' : 'they'} played {moveList}</>
  else
    label = (
      <>
        No {f.color} repertoire covers <span className="font-semibold text-ink">{formatMoves([...f.sans, f.moves[0].san])}</span>
      </>
    )

  const rep = f.repertoireId ? ctx.reps.get(f.repertoireId) : undefined
  // Where to prepare: where you have to choose, or after the opponent's move
  // (the one the engine flags, if any, otherwise the most frequent).
  const top = (!mine && f.moves.find((m) => (ctx.lossOf(f, m) ?? 0) >= ctx.threshold)) || f.moves[0]
  let action: ReactNode = null
  if (f.outcome === 'forgot' && rep)
    action = (
      <Link className="btn-ghost shrink-0 px-2 py-1 text-xs" to={`/train?mode=drill&rep=${rep.id}`}>
        Drill
      </Link>
    )
  else if (rep)
    action = (
      <Link
        className="btn-ghost shrink-0 px-2 py-1 text-xs"
        to={builderUrl(rep.id, mine ? f.path : [...f.path, top.uci])}
      >
        Prepare
      </Link>
    )
  else
    action = (
      <Link
        className="btn-ghost shrink-0 px-2 py-1 text-xs"
        to={`/?newColor=${f.color}&newStart=${encodeURIComponent(formatMoves([...f.sans, top.san]))}`}
      >
        New repertoire
      </Link>
    )

  return (
    <li className="rounded-md bg-surface-2 px-2 py-1.5 text-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-muted">{formatMoves(f.sans) || 'Starting position'}</div>
          <div className="text-muted">{label}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {rep ? (
              <span className="flex items-center gap-1">
                <ColorDot color={rep.color} /> {rep.name}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <ColorDot color={f.color} /> as {f.color}
              </span>
            )}
            <span>
              {f.games.length} game{f.games.length === 1 ? '' : 's'}
            </span>
            <span className={scoreColor(f.score)}>score {pct(f.score)}</span>
            <span>last {ago(f.lastPlayed)}</span>
          </div>
        </div>
        {action}
      </div>
      <GameLinks games={f.games} />
    </li>
  )
}

function GameLinks({ games }: { games: Game[] }) {
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-muted">Games</summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {[...games]
          .sort((a, b) => b.playedAt - a.playedAt)
          .slice(0, 10)
          .map((g) => (
            <li key={g.id}>
              <a href={g.url} target="_blank" rel="noreferrer" className="hover:underline">
                <span className={g.result === 'win' ? 'text-accent' : g.result === 'loss' ? 'text-bad' : 'text-muted'}>
                  {g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Drew'}
                </span>{' '}
                vs {g.opponent}
                {g.opponentRating ? ` (${g.opponentRating})` : ''} · {g.speed} ·{' '}
                {g.source === 'lichess' ? 'Lichess' : 'Chess.com'} · {new Date(g.playedAt).toLocaleDateString()}
              </a>
            </li>
          ))}
      </ul>
    </details>
  )
}

function ago(t: number): string {
  const days = Math.floor((Date.now() - t) / DAY)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 60) return `${days} days ago`
  return `${Math.round(days / 30.5)} months ago`
}
