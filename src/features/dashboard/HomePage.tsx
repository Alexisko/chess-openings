import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { pct, scoreColor } from '../../components/format'
import { ColorDot, Section } from '../../components/ui'
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

  return (
    // On phones: Today, Repertoires, New. On wider screens the repertoire list gets its own column.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-start">
      <div className="flex flex-col gap-4">
        {settings && !settings.lichessToken && (
          <div className="card border-warn/50 p-3 text-sm">
            <p className="mb-2">
              Log in with Lichess to see what opponents play (the opening explorer requires it). No permissions are
              requested: the token only identifies you.
            </p>
            <button className="btn-primary" onClick={() => startLogin()}>
              Log in with Lichess
            </button>
          </div>
        )}

        <Section title="Today">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-md bg-surface-2 p-3">
              <div className="text-2xl font-semibold">{counts?.due ?? '–'}</div>
              <div className="text-xs text-muted">reviews due</div>
            </div>
            <div className="rounded-md bg-surface-2 p-3">
              <div className="text-2xl font-semibold">{newLeft}</div>
              <div className="text-xs text-muted">new moves to learn</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/train?mode=review" className={`btn-primary flex-1 ${counts?.due ? '' : 'pointer-events-none opacity-40'}`}>
              Review
            </Link>
            <Link to="/train?mode=learn" className={`btn-ghost flex-1 ${newLeft ? '' : 'pointer-events-none opacity-40'}`}>
              Learn new
            </Link>
            <Link to="/train?mode=drill" className="btn-ghost flex-1">
              Drill weak spots
            </Link>
          </div>
        </Section>
      </div>

      <div className="flex flex-col gap-4 md:row-span-2">
        {reps !== undefined &&
          settings &&
          (['white', 'black'] as const).map((c) => (
            <ColorSection key={c} color={c} reps={reps.filter((r) => r.color === c)} settings={settings} />
          ))}
      </div>

      <NewRepertoire />
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
        <span className="flex items-center gap-2">
          <ColorDot color={color} /> {COLOR_NAME[color]}
        </span>
      }
      right={
        <Link to={planUrl(color)} className="text-xs text-muted hover:text-ink">
          Open plan →
        </Link>
      }
    >
      {plan?.empty ? (
        <Link to={planUrl(color)} className="btn-primary w-full">
          {color === 'white' ? 'Choose your first move as White' : 'Choose your defences as Black'}
        </Link>
      ) : (
        plan && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              {plan.coverage !== null && (
                <span>
                  <span className="font-semibold">{pct(plan.coverage)}</span>{' '}
                  <span className="text-muted">of games covered</span>
                </span>
              )}
              {score !== null && (
                <span>
                  <span className={`font-semibold ${scoreColor(score)}`}>{pct(score)}</span>{' '}
                  <span className="text-muted">prepared, {settings.prepDepth} moves deep</span>
                </span>
              )}
            </div>
            {next && (
              <Link
                to={planUrl(color, next.path)}
                className="mt-2 flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm hover:bg-warn/20"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">Next:</span> {next.title}
                  {next.sans.length > 0 && <span className="text-muted"> · {formatMoves(next.sans)}</span>}
                </span>
                {next.reach !== null && <span className="shrink-0 text-xs text-muted">{pct(next.reach, 1)}</span>}
              </Link>
            )}
          </>
        )
      )}
      {reps.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {reps.map((r) => (
            <RepertoireRow key={r.id} rep={r} settings={settings} onScore={report} />
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
}: {
  rep: Repertoire
  settings: Settings
  onScore: (repId: string, score: number) => void
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
      <Link to={`/rep/${rep.id}`} className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2 hover:bg-line">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{rep.name}</div>
          <div className="truncate text-xs text-muted">
            {repStart(rep).moves.length > 0 && <>from {formatMoves(repStart(rep).sans)} · </>}
            {data?.lines.length ?? 0} lines · {data?.cards.length ?? 0} moves · {due} due
          </div>
        </div>
        {prep && data && data.moves.length > 0 && (
          <div className="text-right">
            <div className={`text-lg font-semibold ${scoreColor(prep.result.score)}`}>{pct(prep.result.score)}</div>
            <div className="text-[10px] text-muted">prepared, {settings.prepDepth} moves deep</div>
          </div>
        )}
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
      !confirm(
        `This overlaps with ${overlaps.map((r) => `"${r.name}"`).join(', ')}: the same positions would be in two ` +
          'repertoires and be drilled twice. Create it anyway?',
      )
    )
      return
    const fallback = color === 'white' ? 'White repertoire' : 'Black repertoire'
    const rep = await createRepertoire(name.trim() || fallback, color, undefined, startMoves)
    setName('')
    setStartText('')
    navigate(builderUrl(rep.id, startMoves))
  }
  return (
    <details className="card" open={params.has('newStart')}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">Custom repertoire</summary>
      <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line p-3">
        <p className="text-xs text-muted">
          The White and Black plans create repertoires for you. Use this for anything they don't offer.
        </p>
        <input
          className="input"
          placeholder="Vienna Game"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus={params.has('newStart')}
        />
        <label className="flex flex-col gap-1 text-xs text-muted">
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
          <span>These moves are set up, not drilled, and your score only counts what happens after them.</span>
        </label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex gap-2">
          {(['white', 'black'] as const).map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              className={`btn flex-1 border ${color === c ? 'border-accent bg-surface-2' : 'border-line'}`}
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
