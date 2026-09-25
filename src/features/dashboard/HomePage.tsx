import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { pct, scoreColor } from '../../components/format'
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
import { planScore } from '../../lib/plan/plan'
import { usePlan, useScoreMap } from '../../lib/plan/usePlan'
import { usePreparedness } from '../../lib/prep/usePreparedness'
import { builderUrl, planUrl } from '../../lib/routes'
import { confirmOverlap } from '../../lib/dialog'
import { isDue, isNew } from '../../lib/srs/scheduler'

export function HomePage() {
  const reps = useRepertoires()
  const settings = useSettings()
  const counts = useLiveQuery(async () => {
    const cards = await db.cards.toArray()
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
                <Link to="/train?mode=drill" className="btn-ghost">
                  <TargetIcon size={16} /> Drill weak spots
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
        <Link to={planUrl(color)} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-brass">
          Plan <ArrowRight size={13} />
        </Link>
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
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
              {plan.coverage !== null && (
                <span>
                  <span className="font-display text-lg font-medium tabular-nums">{pct(plan.coverage)}</span>{' '}
                  <span className="text-muted">of games covered</span>
                </span>
              )}
              {score !== null && (
                <span>
                  <span className={`font-display text-lg font-medium tabular-nums ${scoreColor(score)}`}>{pct(score)}</span>{' '}
                  <span className="text-muted">prepared, {settings.prepDepth} moves deep</span>
                </span>
              )}
            </div>
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
            <RepertoireRow key={r.id} rep={r} settings={settings} onScore={report} side={!!plan?.sideLines.some((s) => s.id === r.id)} />
          ))}
        </ul>
      )}
    </Section>
  )
}

function RepertoireRow({
  rep,
  settings,
  onScore,
  side,
}: {
  rep: Repertoire
  settings: Settings
  onScore: (repId: string, score: number) => void
  /** Reached only through a second answer (see the plan). */
  side: boolean
}) {
  const data = useRepertoire(rep.id)
  const prep = usePreparedness(data, settings.explorerFilter, settings.prepDepth)
  const score = data && data.moves.length ? prep?.result.score : data ? 0 : undefined
  useEffect(() => {
    if (score !== undefined) onScore(rep.id, score)
  }, [score, rep.id, onScore])
  const now = new Date()
  const due = data ? data.cards.filter((c) => isDue(c.fsrs, now)).length : 0
  return (
    <li>
      <Link
        to={`/rep/${rep.id}`}
        className="group flex items-center gap-3 rounded-lg border border-line/60 bg-surface-2/60 px-3 py-2.5 transition hover:border-line-strong hover:bg-surface-2"
        title={`Prepared ${settings.prepDepth} moves deep`}
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
            {due > 0 && <span className="font-medium text-maple"> · {due} due</span>}
          </div>
        </div>
        <ScoreRing value={prep && data && data.moves.length > 0 ? prep.result.score : undefined} size={44} />
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
            These moves are set up, not drilled, and your score only counts what happens after them.
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
