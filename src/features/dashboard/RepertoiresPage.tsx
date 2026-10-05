import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { pct } from '../../components/format'
import { ArrowRight, BoltIcon, ChevronDown } from '../../components/icons'
import { ColorDot, ScoreRing, Section } from '../../components/ui'
import { createRepertoire, findOverlaps } from '../../db/repertoire'
import { type Repertoire } from '../../db/schema'
import { useSettings, type Settings } from '../../db/settings'
import { useRepertoire, useRepertoires } from '../../db/useRepertoire'
import { startLogin } from '../../lib/auth/lichess'
import { formatMoves, type Color } from '../../lib/chess/position'
import { parseMoves, repStart } from '../../lib/chess/start'
import { planScore, type CoveredNode, type Plan, type RepScore } from '../../lib/plan/plan'
import { useLineScore, usePlan, useScoreMap } from '../../lib/plan/usePlan'
import { usePreparedness } from '../../lib/prep/usePreparedness'
import { builderUrl, planUrl, repertoireUrl } from '../../lib/routes'
import { confirmOverlap } from '../../lib/dialog'
import { isDue } from '../../lib/srs/scheduler'

export const COLOR_NAME = { white: 'White', black: 'Black' } as const

/** Your repertoires of one colour: the plan's coverage, its next choice and every repertoire. */
export function RepertoiresPage() {
  const [params] = useSearchParams()
  const reps = useRepertoires()
  const settings = useSettings()
  // The Games page links here with the colour and moves of an opening you meet but haven't prepared.
  const color: Color = (params.get('newColor') ?? params.get('color')) === 'black' ? 'black' : 'white'

  return (
    <div className="stagger flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Repertoire</h1>
        <div className="flex gap-1" role="group" aria-label="Colour">
          {(['white', 'black'] as const).map((c) => (
            <Link
              key={c}
              to={repertoireUrl(c)}
              replace
              className={`chip py-1.5 ${color === c ? 'chip-on' : ''}`}
              aria-current={color === c ? 'page' : undefined}
            >
              <ColorDot color={c} size={11} />
              {COLOR_NAME[c]}
              {reps && <span className="text-faint tabular-nums">{reps.filter((r) => r.color === c).length}</span>}
            </Link>
          ))}
        </div>
      </header>

      {settings && !settings.lichessToken && (
        <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 border-warn/40 p-4 text-sm">
          <p className="min-w-0 flex-1 basis-72 leading-relaxed text-muted">
            <span className="font-medium text-ink">Connect Lichess</span> to measure your repertoires against what
            opponents play: the opening explorer requires it. No permissions are requested.
          </p>
          <button className="btn-primary" onClick={() => startLogin()}>
            Log in with Lichess
          </button>
        </div>
      )}

      {reps !== undefined && settings && (
        <ColorRepertoires key={color} color={color} reps={reps.filter((r) => r.color === color)} settings={settings} />
      )}
    </div>
  )
}

/** The plan summary beside the list of a colour's repertoires, most often met first. */
function ColorRepertoires({ color, reps, settings }: { color: Color; reps: Repertoire[]; settings: Settings }) {
  const state = usePlan(color, settings)
  const [scores, report] = useScoreMap()
  const plan = state?.plan
  const measured = !!settings.lichessToken
  const score = plan && measured ? planScore(plan, scores) : null
  const next = plan?.decisions[0]
  const reach = plan ? reachByRep(plan) : new Map<string, number>()
  const side = new Set(plan?.sideLines.map((r) => r.id))
  const byReach = (a: Repertoire, b: Repertoire) => (reach.get(b.id) ?? -1) - (reach.get(a.id) ?? -1)
  const main = reps.filter((r) => !r.paused && !side.has(r.id)).sort(byReach)
  const sideLines = reps.filter((r) => !r.paused && side.has(r.id))
  const paused = reps.filter((r) => r.paused)
  const row = (r: Repertoire) => (
    <RepertoireRow key={r.id} rep={r} settings={settings} side={side.has(r.id)} reach={measured ? reach.get(r.id) : undefined} />
  )

  return (
    // On phones: summary, list, custom repertoire. On wider screens the list gets its own column.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:grid-rows-[auto_1fr] md:items-start">
      <Section
        title={
          <span className="flex items-center gap-2.5">
            <ColorDot color={color} size={14} /> {COLOR_NAME[color]} plan
          </span>
        }
        right={
          <Link to={planUrl(color)} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-brass">
            Open plan <ArrowRight size={13} />
          </Link>
        }
      >
        {plan?.covered.map((c) => (
          <LineReporter key={c.key} node={c} color={color} settings={settings} onScore={report} />
        ))}
        {plan?.empty ? (
          <Link to={planUrl(color)} className="btn-primary w-full py-2.5">
            {color === 'white' ? 'Choose your first move as White' : 'Choose your defences as Black'}
            <ArrowRight size={16} />
          </Link>
        ) : (
          <>
            {measured ? (
              score !== null && <PrepBar score={score} depth={settings.prepDepth} />
            ) : (
              <p className="text-sm text-muted">Not measured: coverage needs the Lichess explorer.</p>
            )}
            {next && <NextStep color={color} next={next} className="mt-4" />}
          </>
        )}
      </Section>

      <Section
        className="md:col-start-2 md:row-span-2 md:row-start-1"
        title={`${COLOR_NAME[color]} repertoires`}
        right={measured && main.length > 1 && <span className="text-xs text-muted">Most often met first</span>}
      >
        {reps.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No {COLOR_NAME[color]} repertoire yet. Choose one in the plan, or create a custom one.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {main.length > 0 && <ul className="flex flex-col gap-2">{main.map(row)}</ul>}
            {sideLines.length > 0 && (
              <RepGroup label="Side lines" hint="Second answers: they don't count towards coverage">
                {sideLines.map(row)}
              </RepGroup>
            )}
            {paused.length > 0 && (
              <details className="group border-t border-line/70 pt-4">
                <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted hover:text-ink">
                  {paused.length} paused
                  <span className="font-normal">· left out of daily training</span>
                  <ChevronDown size={14} className="ml-auto transition group-open:rotate-180" />
                </summary>
                <ul className="mt-3 flex flex-col gap-2">{paused.map(row)}</ul>
              </details>
            )}
          </div>
        )}
      </Section>

      <NewRepertoire color={color} />
    </div>
  )
}

/**
 * Share of all games that reach each repertoire: the reach of every counted
 * position it covers. Side lines and repertoires off the plan have none.
 */
function reachByRep(plan: Plan) {
  const reach = new Map<string, number>()
  for (const c of plan.covered) {
    if (c.reach === null) continue
    for (const r of [c.rep, ...c.others]) reach.set(r.id, (reach.get(r.id) ?? 0) + c.reach)
  }
  return reach
}

function RepGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line/70 pt-4">
      <h3 className="mb-2.5 text-xs font-medium text-muted">
        {label}
        {hint && <span className="font-normal"> · {hint}</span>}
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </div>
  )
}

/** The plan's most frequent open choice. */
export function NextStep({ color, next, className = '' }: { color: Color; next: Plan['decisions'][number]; className?: string }) {
  return (
    <Link
      to={planUrl(color, next.path)}
      className={`group flex items-center gap-3 rounded-lg border border-warn/30 bg-warn/8 px-3 py-2.5 text-sm transition hover:border-warn/60 hover:bg-warn/12 ${className}`}
    >
      <BoltIcon size={16} className="shrink-0 text-warn" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <span className="font-medium text-warn">Next:</span> {next.title}
        </span>
        {next.reach !== null && (
          <span className="block text-xs text-muted tabular-nums">reached in {pct(next.reach, 1)} of games</span>
        )}
      </span>
      <ArrowRight size={15} className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-warn" />
    </Link>
  )
}

/**
 * A colour's preparedness as one rounded bar: built behind, remembered in
 * front of it in a stronger shade. The lighter stretch between them is what
 * reviewing wins back.
 */
export function PrepBar({ score, depth, explain = true }: { score: RepScore; depth: number; explain?: boolean }) {
  const width = (x: number) => ({ width: `${Math.max(0, Math.min(1, x)) * 100}%` })
  return (
    <div>
      <div className="flex items-baseline gap-4">
        <span>
          <span className="font-display text-3xl leading-none font-medium tabular-nums">{pct(score.built)}</span>
          <span className="ml-1.5 text-sm text-muted">built</span>
        </span>
        <span className="text-sm text-muted">
          <span className="font-medium text-ink tabular-nums">{pct(score.remembered)}</span> remembered
        </span>
      </div>
      <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-line/70">
        <div className="absolute inset-y-0 left-0 rounded-full bg-maple/35 transition-[width] duration-700 ease-out" style={width(score.built)} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-maple transition-[width] duration-700 ease-out" style={width(score.remembered)} />
      </div>
      {explain && (
      <p className="mt-2.5 text-xs leading-relaxed text-muted">
        Share of games you reach your move {depth} still in prep, weighting opponents by the Lichess explorer.{' '}
        <span className="text-ink">Built</span> counts every prepared move as known;{' '}
        <span className="text-ink">remembered</span> counts each at your chance of recalling it today.
      </p>
      )}
    </div>
  )
}

/** Computes a covered line's preparedness for the colour's overall score; renders nothing. */
export function LineReporter({
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
  reach,
}: {
  rep: Repertoire
  settings: Settings
  /** Reached only through a second answer (see the plan). */
  side: boolean
  /** Share of all games that reach it. */
  reach: number | undefined
}) {
  const data = useRepertoire(rep.id)
  const prep = usePreparedness(data, settings.explorerFilter, settings.prepDepth)
  const shown = !!settings.lichessToken && !!prep && !!data && data.moves.length > 0
  const now = new Date()
  const due = data ? data.cards.filter((c) => isDue(c.fsrs, now)).length : 0
  const lines = data?.lines.length ?? 0
  const moves = data?.cards.length ?? 0
  return (
    <li>
      <Link
        to={`/rep/${rep.id}`}
        className="group flex items-center gap-3 rounded-lg border border-line/60 bg-surface-2/60 px-3 py-2.5 transition hover:border-line-strong hover:bg-surface-2"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-display text-base font-medium">{rep.name}</span>
            {due > 0 && !rep.paused && <span className="shrink-0 text-xs font-medium text-maple tabular-nums">{due} due</span>}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">
            {repStart(rep).moves.length > 0 && <>{formatMoves(repStart(rep).sans)} · </>}
            {lines} {lines === 1 ? 'line' : 'lines'} · {moves} {moves === 1 ? 'move' : 'moves'}
            {reach !== undefined && !side && <> · met in {pct(reach, 1)}</>}
          </div>
        </div>
        <ScoreRing
          value={shown ? prep.result.score : undefined}
          under={shown ? prep.built.score : undefined}
          toneBy={shown ? prep.built.score : undefined}
          label={
            shown ? (
              // Sized to fit "100%" inside the ring.
              <span className="text-ink" style={{ fontSize: 12.5 }}>
                {pct(prep.built.score)}
              </span>
            ) : undefined
          }
          title={
            shown
              ? `${pct(prep.built.score)} built (number, light arc), ${pct(prep.result.score)} remembered (dark arc), in prep to your move ${settings.prepDepth}`
              : undefined
          }
          ariaLabel={shown ? `${pct(prep.built.score)} built, ${pct(prep.result.score)} remembered` : 'Not measured'}
          size={48}
        />
      </Link>
    </li>
  )
}

function NewRepertoire({ color: pageColor }: { color: Color }) {
  const [params] = useSearchParams()
  const [name, setName] = useState('')
  const [color, setColor] = useState<Color>(pageColor)
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
      <summary className="flex cursor-pointer items-start gap-2 px-4 py-3 text-sm">
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[15px] font-medium">Custom repertoire</span>
          <span className="block text-xs text-muted">For anything the plan doesn't offer</span>
        </span>
        <ChevronDown size={16} className="mt-0.5 shrink-0 text-muted transition group-open:rotate-180" />
      </summary>
      <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line/70 p-4">
        <input
          className="input"
          placeholder="Vienna Game"
          aria-label="Name"
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
          <span className="leading-relaxed text-muted">
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
              aria-pressed={color === c}
              className={`btn flex-1 border ${color === c ? 'border-brass/70 bg-brass/10 text-ink' : 'border-line text-muted hover:text-ink'}`}
            >
              <ColorDot color={c} /> {COLOR_NAME[c]}
            </button>
          ))}
        </div>
        <button className="btn-primary">Create and open builder</button>
      </form>
    </details>
  )
}
