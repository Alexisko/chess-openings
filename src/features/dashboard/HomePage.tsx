import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router'
import { pct } from '../../components/format'
import { ArrowRight, BookIcon, TargetIcon, TrainIcon } from '../../components/icons'
import { ColorDot, ScoreRing, Section } from '../../components/ui'
import { learnedToday } from '../../db/reviews'
import { db, type Repertoire } from '../../db/schema'
import { useSettings, type Settings } from '../../db/settings'
import { useRepertoires } from '../../db/useRepertoire'
import { startLogin } from '../../lib/auth/lichess'
import { formatMoves, type Color } from '../../lib/chess/position'
import { planScore, type CoveredNode, type RepScore } from '../../lib/plan/plan'
import { usePlan, useScoreMap } from '../../lib/plan/usePlan'
import { planUrl, repertoireUrl, trainUrl } from '../../lib/routes'
import { isDue, isNew } from '../../lib/srs/scheduler'
import { COLOR_NAME, LineReporter, NextStep, PrepBar } from './RepertoiresPage'

/** The Train tab, where the app opens: today's session, free training and each colour's prep. */
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

  const headline = !counts
    ? ' '
    : counts.due
      ? `${counts.due} move${counts.due === 1 ? '' : 's'} to review`
      : newLeft
        ? 'All caught up — time to learn'
        : 'All caught up for today'
  const learnBlocked = !counts || !settings ? undefined : !counts.fresh ? 'No new moves: add some in Repertoire.' : !newLeft ? `Daily limit reached (${settings.newPerDay} new moves a day).` : undefined

  return (
    <div className="stagger flex flex-col gap-5">
      <h1 className="page-title">{headline}</h1>

      {/* On phones: Today, the colours, Free training. On wider screens the colours get their own column. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:grid-rows-[auto_1fr] md:items-start">
        <section className="card overflow-hidden" aria-label="Today">
          <div className="grid grid-cols-2 divide-x divide-line/70 border-b border-line/70">
            <TodayStat value={counts?.due} label="reviews due" tone={counts?.due ? 'text-maple' : 'text-faint'} />
            <TodayStat value={counts ? newLeft : undefined} label="new moves to learn" tone={newLeft ? 'text-ink' : 'text-faint'} />
          </div>
          <div className="flex flex-col gap-2 p-4">
            {counts?.due ? (
              <>
                <Link to={trainUrl('review')} className="btn-primary w-full py-2.5">
                  <TrainIcon size={17} /> Review
                </Link>
                {newLeft > 0 && (
                  <Link to={trainUrl('learn')} className="btn-ghost w-full">
                    <BookIcon size={16} /> Learn new
                  </Link>
                )}
              </>
            ) : newLeft > 0 ? (
              <Link to={trainUrl('learn')} className="btn-primary w-full py-2.5">
                <BookIcon size={17} /> Learn new
              </Link>
            ) : (
              counts && <p className="py-1 text-center text-sm text-muted">Nothing due. Free training is always open.</p>
            )}
            {learnBlocked && counts && (counts.due > 0 || counts.fresh > 0) && (
              <p className="text-center text-xs text-muted">{learnBlocked}</p>
            )}
          </div>
        </section>

        <div className="flex flex-col gap-5 md:col-start-2 md:row-span-2 md:row-start-1">
          {settings && !settings.lichessToken && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-warn/35 bg-warn/8 px-4 py-3">
              <p className="min-w-0 flex-1 basis-56 text-xs leading-relaxed text-muted">
                <span className="font-medium text-ink">Connect Lichess</span> to measure your prep against what opponents play.
              </p>
              <button className="btn-ghost py-1.5 text-xs" onClick={() => startLogin()}>
                Log in with Lichess
              </button>
            </div>
          )}
          {reps !== undefined &&
            settings &&
            (['white', 'black'] as const).map((c) => (
              <ColorTraining key={c} color={c} hasReps={reps.some((r) => r.color === c)} settings={settings} />
            ))}
        </div>

        {reps && reps.length > 0 && <FreeTraining reps={reps} />}
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

/** Train any learned move, weak ones more often: everything, one colour or one repertoire. */
function FreeTraining({ reps }: { reps: Repertoire[] }) {
  const navigate = useNavigate()
  const scopes = [
    { label: 'All', to: trainUrl('train') },
    ...(['white', 'black'] as const)
      .filter((c) => reps.some((r) => r.color === c))
      .map((c) => ({ label: COLOR_NAME[c], to: trainUrl('train', { color: c }), color: c })),
  ]
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <TargetIcon size={15} className="text-muted" /> Free training
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-muted">Any move you've learned, weak ones more often. It doesn't change your schedule.</p>
      <div className="flex flex-wrap gap-2">
        {scopes.map((s) => (
          <Link key={s.label} to={s.to} className="btn-ghost flex-1">
            {'color' in s && s.color && <ColorDot color={s.color} size={11} />}
            {s.label}
          </Link>
        ))}
      </div>
      <select
        className="input mt-2 w-full"
        aria-label="Train one repertoire"
        value=""
        onChange={(e) => e.target.value && navigate(trainUrl('train', { repId: e.target.value }))}
      >
        <option value="">One repertoire…</option>
        {(['white', 'black'] as const).map((c) => (
          <optgroup key={c} label={COLOR_NAME[c]}>
            {reps
              .filter((r) => r.color === c)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </Section>
  )
}

/** Lines worth showing: at least this share of all games leaves your prep there. */
const MIN_LOST = 0.005

/**
 * A colour at a glance: how much is built against how much you remember, the
 * plan's next choice, and the lines where you drop out of prep most often.
 */
function ColorTraining({ color, hasReps, settings }: { color: Color; hasReps: boolean; settings: Settings }) {
  const state = usePlan(color, settings)
  const [scores, report] = useScoreMap()
  const plan = state?.plan
  const score = plan ? planScore(plan, scores) : null
  const next = plan?.decisions[0]
  // Games that leave your prep in each line today: how often it's met times what you wouldn't play.
  const lines = (plan?.covered ?? [])
    .map((node) => ({ node, score: scores.get(node.key) }))
    .filter((l): l is { node: CoveredNode; score: RepScore } => !!l.score && l.node.reach !== null)
    .map((l) => ({ ...l, lost: l.node.reach! * (1 - l.score.remembered) }))
    .filter((l) => l.lost >= MIN_LOST)
    .sort((a, b) => b.lost - a.lost)
    .slice(0, 3)

  return (
    <Section
      title={
        <span className="flex items-center gap-2.5">
          <ColorDot color={color} size={14} /> {COLOR_NAME[color]}
        </span>
      }
      right={
        hasReps && (
          <Link to={repertoireUrl(color)} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-brass">
            {COLOR_NAME[color]} repertoires <ArrowRight size={13} />
          </Link>
        )
      }
    >
      {plan?.covered.map((c) => (
        <LineReporter key={c.key} node={c} color={color} settings={settings} onScore={report} />
      ))}
      {plan?.empty || (!hasReps && !next) ? (
        <Link to={planUrl(color)} className="btn-primary w-full py-2.5">
          {color === 'white' ? 'Choose your first move as White' : 'Choose your defences as Black'}
          <ArrowRight size={16} />
        </Link>
      ) : (
        <div className="flex flex-col gap-4">
          {score !== null && <PrepBar score={score} depth={settings.prepDepth} explain={false} />}
          {next && <NextStep color={color} next={next} />}
          {lines.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted">Where you leave your prep most</h3>
              <ul className="flex flex-col gap-2">
                {lines.map(({ node, score }) => (
                  <li key={node.key}>
                    <Link
                      to={`/rep/${node.rep.id}`}
                      className="group flex items-center gap-3 rounded-lg border border-line/60 bg-surface-2/60 px-3 py-2 transition hover:border-line-strong hover:bg-surface-2"
                    >
                      <ScoreRing
                        value={score.remembered}
                        under={score.built}
                        toneBy={score.built}
                        size={40}
                        label={
                          <span className="text-ink" style={{ fontSize: 11 }}>
                            {pct(score.built)}
                          </span>
                        }
                        ariaLabel={`${pct(score.built)} built, ${pct(score.remembered)} remembered`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[15px] font-medium">{node.rep.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {formatMoves(node.sans)} · met in {pct(node.reach!, 1)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted tabular-nums">
                        <span className="font-medium text-ink">{pct(score.remembered)}</span> remembered
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {score === null && !settings.lichessToken && !!plan?.needed.length && (
            <p className="text-xs text-muted">Scores need the Lichess explorer: connect Lichess to see them.</p>
          )}
        </div>
      )}
    </Section>
  )
}
