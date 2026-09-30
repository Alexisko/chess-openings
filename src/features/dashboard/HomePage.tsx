import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { pct } from '../../components/format'
import { ArrowRight, BoltIcon, ChevronDown, BookIcon, TargetIcon, TrainIcon } from '../../components/icons'
import { ColorDot, ScoreRing, Section } from '../../components/ui'
import { createRepertoire, findOverlaps } from '../../db/repertoire'
import { learnedToday } from '../../db/reviews'
import { db, type Repertoire } from '../../db/schema'
import { useSettings, type Settings } from '../../db/settings'
import { useRepertoire, useRepertoires } from '../../db/useRepertoire'
import { startLogin } from '../../lib/auth/lichess'
import { formatMoves, type Color } from '../../lib/chess/position'
import { parseMoves, repStart } from '../../lib/chess/start'
import { planScore, type CoveredNode, type RepScore } from '../../lib/plan/plan'
import { useLineScore, usePlan, useScoreMap } from '../../lib/plan/usePlan'
import { usePreparedness } from '../../lib/prep/usePreparedness'
import { builderUrl, planUrl, trainUrl } from '../../lib/routes'
import { confirmOverlap } from '../../lib/dialog'
import { isDue, isNew } from '../../lib/srs/scheduler'

export function HomePage() {
  const reps = useRepertoires()
  const settings = useSettings()
  const counts = useLiveQuery(async () => {
    const paused = new Set((await db.repertoires.toArray()).filter((r) => r.paused).map((r) => r.id))
    const cards = (await db.cards.toArray()).filter((c) => !paused.has(c.repertoireId))
    const now = new Date()
    return {
      due: cards.filter((c) => isDue(c.fsrs, now)).length,
      fresh: cards.filter((c) => isNew(c.fsrs)).length,
      learnedToday: await learnedToday(),
    }
  }, [])
  const newLeft = counts && settings ? Math.max(0, Math.min(counts.fresh, settings.newPerDay - counts.learnedToday)) : 0

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const headline = !counts
    ? '\u00a0'
    : counts.due
      ? `${counts.due} move${counts.due === 1 ? '' : 's'} to review`
      : newLeft
        ? 'All caught up — time to learn'
        : 'All caught up for today'

  return (
    <div className="stagger flex flex-col gap-5">
      <header>
        <div className="eyebrow">{today}</div>
        <h1 className="page-title mt-1">{headline}</h1>
      </header>

      {/* On phones: Today, Repertoires, New. On wider screens the repertoire list gets its own column. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:grid-rows-[auto_1fr] md:items-start">
        <div className="flex flex-col gap-5">
          {settings && !settings.lichessToken && (
            <div className="card border-warn/40 p-4 text-sm">
              <p className="mb-3 leading-relaxed text-muted">
                <span className="font-medium text-ink">Connect Lichess</span> to see what opponents play: the opening
                explorer requires it. No permissions are requested; the token only identifies you.
              </p>
              <button className="btn-primary" onClick={() => startLogin()}>
                Log in with Lichess
              </button>
            </div>
          )}

          <section className="card overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-line/70 border-b border-line/70">
              <TodayStat value={counts?.due} label="reviews due" tone={counts?.due ? 'text-maple' : 'text-faint'} />
              <TodayStat value={counts ? newLeft : undefined} label="new moves to learn" tone={newLeft ? 'text-ink' : 'text-faint'} />
            </div>
            <div className="flex flex-col gap-2 p-4">
              <Link
                to="/train?mode=review"
                className={`btn-primary w-full py-2.5 ${counts?.due ? '' : 'pointer-events-none opacity-40'}`}
              >
                <TrainIcon size={17} /> Review
              </Link>
              <div className="grid grid-cols-2 gap-2">
                <Link to="/train?mode=learn" className={`btn-ghost ${newLeft ? '' : 'pointer-events-none opacity-40'}`}>
                  <BookIcon size={16} /> Learn new
                </Link>
                <Link to={trainUrl('train')} className="btn-ghost" title="Test any move you have learned, weak ones more often">
                  <TargetIcon size={16} /> Train
                </Link>
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-5 md:col-start-2 md:row-span-2 md:row-start-1">
          {reps !== undefined &&
            settings &&
            (['white', 'black'] as const).map((c) => (
              <ColorSection key={c} color={c} reps={reps.filter((r) => r.color === c)} settings={settings} />
            ))}
        </div>

        <NewRepertoire />
      </div>
    </div>
  )
}

function TodayStat({ value, label, tone }: { value: number | undefined; label: string; tone: string }) {
  return (
    <div className="px-4 py-5 text-center">
      <div className={`font-display text-5xl leading-none font-medium tabular-nums ${tone}`}>{value ?? '–'}</div>
      <div className="mt-2 text-xs text-muted">{label}</div>
    </div>
  )
}

const COLOR_NAME = { white: 'White', black: 'Black' } as const

/** A colour's repertoire: how much of the plan is covered, the next choice to make and its repertoires. */
function ColorSection({ color, reps, settings }: { color: Color; reps: Repertoire[]; settings: Settings }) {
  const state = usePlan(color, settings)
  const [scores, report] = useScoreMap()
  const plan = state?.plan
  const score = plan ? planScore(plan, scores) : null
  const next = plan?.decisions[0]
  return (
    <Section
      title={
        <span className="flex items-center gap-2.5">
          <ColorDot color={color} size={14} /> {COLOR_NAME[color]}
        </span>
      }
      right={
        <span className="flex items-center gap-3">
          {reps.length > 0 && (
            <Link
              to={trainUrl('train', { color })}
              className="flex items-center gap-1 text-xs font-medium text-muted hover:text-brass"
              title={`Train your ${COLOR_NAME[color]} repertoires`}
            >
              <TargetIcon size={13} /> Train
            </Link>
          )}
          <Link to={planUrl(color)} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-brass">
            Plan <ArrowRight size={13} />
          </Link>
        </span>
      }
    >
      {plan?.empty ? (
        <Link to={planUrl(color)} className="btn-primary w-full py-2.5">
          {color === 'white' ? 'Choose your first move as White' : 'Choose your defences as Black'}
          <ArrowRight size={16} />
        </Link>
      ) : (
        plan && (
          <>
            {plan.covered.map((c) => (
              <LineReporter key={c.key} node={c} color={color} settings={settings} onScore={report} />
            ))}
            {score !== null && <PrepBar score={score} depth={settings.prepDepth} />}
            {next && (
              <Link
                to={planUrl(color, next.path)}
                className="group mt-3 flex items-center gap-3 rounded-lg border border-warn/30 bg-warn/8 px-3 py-2.5 text-sm transition hover:border-warn/60 hover:bg-warn/12"
              >
                <BoltIcon size={16} className="shrink-0 text-warn" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-warn">Next</span> {next.title}
                  {next.sans.length > 0 && <span className="text-muted"> · {formatMoves(next.sans)}</span>}
                </span>
                {next.reach !== null && <span className="shrink-0 text-xs text-muted tabular-nums">{pct(next.reach, 1)}</span>}
                <ArrowRight size={15} className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-warn" />
              </Link>
            )}
          </>
        )
      )}
      {reps.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {reps.map((r) => (
            <RepertoireRow key={r.id} rep={r} settings={settings} side={!!plan?.sideLines.some((s) => s.id === r.id)} />
          ))}
        </ul>
      )}
    </Section>
  )
}

/**
 * A colour's preparedness as one rounded bar: remembered in front, built
 * behind it in a lighter shade.
 */
function PrepBar({ score, depth }: { score: RepScore; depth: number }) {
  const width = (x: number) => ({ width: `${Math.max(0, Math.min(1, x)) * 100}%` })
  return (
    <div
      title={`Share of games in which you reach your move ${depth} without leaving your preparation. Opponents' moves are weighted by how often they are played in the Lichess opening explorer (with your filter in Settings), not by your own games.\nBuilt: every move you prepared counts as known.\nRemembered: each of your moves counts at the chance you recall it today.`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          Games in your prep to move {depth} <span className="text-faint">· Lichess explorer</span>
        </span>
        <span className="flex gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-maple" />
            <span className="font-medium text-ink tabular-nums">{pct(score.remembered)}</span> remembered
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-maple/30" />
            <span className="font-medium text-ink tabular-nums">{pct(score.built)}</span> built
          </span>
        </span>
      </div>
      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-line/70">
        <div className="absolute inset-y-0 left-0 rounded-full bg-maple/30 transition-[width] duration-700 ease-out" style={width(score.built)} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-maple transition-[width] duration-700 ease-out" style={width(score.remembered)} />
      </div>
    </div>
  )
}

/** Computes a covered line's preparedness for the colour's overall score; renders nothing. */
function LineReporter({
  node,
  color,
  settings,
  onScore,
}: {
  node: CoveredNode
  color: Color
  settings: Settings
  onScore: (key: string, score: RepScore) => void
}) {
  const { score } = useLineScore(node, color, settings)
  useEffect(() => {
    if (score) onScore(node.key, score)
  }, [score, node.key, onScore])
  return null
}

function RepertoireRow({
  rep,
  settings,
  side,
}: {
  rep: Repertoire
  settings: Settings
  /** Reached only through a second answer (see the plan). */
  side: boolean
}) {
  const data = useRepertoire(rep.id)
  const prep = usePreparedness(data, settings.explorerFilter, settings.prepDepth)
  const hasMoves = !!data && data.moves.length > 0
  const now = new Date()
  const due = data ? data.cards.filter((c) => isDue(c.fsrs, now)).length : 0
  return (
    <li>
      <Link
        to={`/rep/${rep.id}`}
        className="group flex items-center gap-3 rounded-lg border border-line/60 bg-surface-2/60 px-3 py-2.5 transition hover:border-line-strong hover:bg-surface-2"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-display text-[16px] font-medium">{rep.name}</span>
            {side && (
              <span
                className="shrink-0 rounded-full border border-line-strong px-1.5 text-[10px] text-muted"
                title="Not your main answer: it doesn't count towards coverage"
              >
                side line
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">
            {repStart(rep).moves.length > 0 && <>{formatMoves(repStart(rep).sans)} · </>}
            {data?.lines.length ?? 0} lines · {data?.cards.length ?? 0} moves
            {rep.paused ? (
              <span className="text-faint" title="Left out of daily training">
                {' '}
                · paused
              </span>
            ) : (
              due > 0 && <span className="font-medium text-maple"> · {due} due</span>
            )}
          </div>
        </div>
        <ScoreRing
          value={prep && hasMoves ? prep.result.score : undefined}
          under={prep && hasMoves ? prep.built.score : undefined}
          label={
            prep && hasMoves ? (
              // Sized to fit "100%" inside the ring.
              <span className="text-ink" style={{ fontSize: 12.5 }}>
                {pct(prep.built.score)}
              </span>
            ) : undefined
          }
          title={
            prep && hasMoves
              ? `In prep to your move ${settings.prepDepth}, opponents' moves weighted by the Lichess explorer:\n${pct(prep.built.score)} built (centre, light arc): every move you prepared counts as known.\n${pct(prep.result.score)} remembered (dark arc): each move counts at the chance you recall it today.`
              : undefined
          }
          size={48}
        />
      </Link>
    </li>
  )
}

function NewRepertoire() {
  // The Games page links here with the colour and moves of an opening you meet but haven't prepared.
  const [params] = useSearchParams()
  const [name, setName] = useState('')
  const [color, setColor] = useState<'white' | 'black'>(params.get('newColor') === 'black' ? 'black' : 'white')
  const [startText, setStartText] = useState(params.get('newStart') ?? '')
  const [error, setError] = useState<string>()
  const navigate = useNavigate()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    let startMoves: string[]
    try {
      startMoves = parseMoves(startText)
    } catch (err) {
      return setError((err as Error).message)
    }
    const overlaps = await findOverlaps(color, startMoves)
    if (
      overlaps.length &&
      !(await confirmOverlap(overlaps.map((r) => r.name)))
    )
      return
    const fallback = color === 'white' ? 'White repertoire' : 'Black repertoire'
    const rep = await createRepertoire(name.trim() || fallback, color, undefined, startMoves)
    setName('')
    setStartText('')
    navigate(builderUrl(rep.id, startMoves))
  }
  return (
    <details className="group card" open={params.has('newStart')}>
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm">
        <span className="font-display text-[15px] font-medium">Custom repertoire</span>
        <span className="text-xs text-muted">for anything the plans don't offer</span>
        <ChevronDown size={16} className="ml-auto text-muted transition group-open:rotate-180" />
      </summary>
      <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line/70 p-4">
        <input
          className="input"
          placeholder="Vienna Game"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus={params.has('newStart')}
        />
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Starts after (optional)
          <input
            className="input"
            placeholder="1.e4 e5 2.Nc3"
            value={startText}
            onChange={(e) => {
              setStartText(e.target.value)
              setError(undefined)
            }}
          />
          <span className="leading-relaxed text-faint">
            These moves are set up, not drilled: your score counts them as known.
          </span>
        </label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex gap-2">
          {(['white', 'black'] as const).map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              className={`btn flex-1 border ${color === c ? 'border-brass/70 bg-brass/10 text-ink' : 'border-line text-muted hover:text-ink'}`}
            >
              <ColorDot color={c} /> {c === 'white' ? 'White' : 'Black'}
            </button>
          ))}
        </div>
        <button className="btn-primary">Create and open builder</button>
      </form>
    </details>
  )
}
