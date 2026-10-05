import { Link } from 'react-router'
import { KnowledgeBar } from '../../components/Knowledge'
import { pct, resultColor } from '../../components/format'
import { ArrowRight, BoltIcon, BookIcon, TargetIcon } from '../../components/icons'
import { ScoreRing } from '../../components/ui'
import type { Game } from '../../db/schema'
import type { Settings } from '../../db/settings'
import { useMoveRecords, useRepertoire } from '../../db/useRepertoire'
import { formatMoves, replay, type Color } from '../../lib/chess/position'
import { startsWith } from '../../lib/chess/start'
import type { ExplorerData } from '../../lib/explorer'
import { scoreOf } from '../../lib/games/analyze'
import type { CoveredNode, DecisionNode } from '../../lib/plan/plan'
import { builderUrl, gamesParams, trainUrl } from '../../lib/routes'
import { emptyCounts, knowledgeOf } from '../../lib/srs/knowledge'
import { isNew } from '../../lib/srs/scheduler'
import { DecisionChoices } from './PlanChoice'
import { ActionLink } from './SlotParts'
import { gapAction, share, slotAction, type Slot } from './slots'

/** The line's moves, in Fraunces like all notation. */
function Line({ sans }: { sans: string[] }) {
  if (!sans.length) return <span className="text-muted">Starting position</span>
  return <span className="font-display text-[15px] text-ink/80">{formatMoves(sans)}</span>
}

/**
 * Everything about one reply: how often you meet it, how ready you are, how
 * it went in your games, and what to do about it.
 */
export function SlotDetail({
  slot,
  color,
  settings,
  explorer,
  games,
  onPreview,
  compact = false,
}: {
  slot: Slot
  color: Color
  settings: Settings
  explorer: Map<string, ExplorerData>
  /** Your games with this colour. */
  games: Game[] | undefined
  /** Shows a position on the board while a gap is hovered (null to go back). */
  onPreview?: (path: string[] | null) => void
  /** Inside a list row on phones: no header, it's the row above. */
  compact?: boolean
}) {
  return slot.node.kind === 'decision' ? (
    <DecisionDetail node={slot.node} slot={slot} color={color} explorer={explorer} compact={compact} />
  ) : (
    <CoveredDetail
      node={slot.node}
      slot={slot}
      color={color}
      settings={settings}
      games={games}
      onPreview={onPreview}
      compact={compact}
    />
  )
}

function DecisionDetail({
  node,
  slot,
  color,
  explorer,
  compact,
}: {
  node: DecisionNode
  slot: Slot
  color: Color
  explorer: Map<string, ExplorerData>
  compact: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      {!compact && (
        <header>
          <div className="flex items-center gap-2 text-sm text-warn">
            <BoltIcon size={15} /> <span className="font-medium">Still to choose</span>
          </div>
          <h2 className="mt-1.5 font-display text-2xl leading-tight font-medium tracking-tight">{node.title}</h2>
          <p className="mt-1 text-sm text-muted">
            <Line sans={node.sans} />
            {slot.reach !== null && (
              <>
                {' '}
                · met in <span className="tabular-nums">{share(slot.reach)}</span> of your {color === 'white' ? 'White' : 'Black'} games
              </>
            )}
          </p>
        </header>
      )}
      <DecisionChoices node={node} color={color} explorer={explorer} />
    </div>
  )
}

function CoveredDetail({
  node,
  slot,
  color,
  settings,
  games,
  onPreview,
  compact,
}: {
  node: CoveredNode
  slot: Slot
  color: Color
  settings: Settings
  games: Game[] | undefined
  onPreview?: (path: string[] | null) => void
  compact: boolean
}) {
  const { rep } = node
  const data = useRepertoire(rep.id)
  const records = useMoveRecords(rep.id)
  const { facts, cost } = slot
  const action = slotAction(rep, facts)

  const now = new Date()
  const counts = emptyCounts()
  if (data && records) for (const c of data.cards) counts[knowledgeOf(c.fsrs, records.get(c.positionKey), now)]++
  const fresh = data ? data.cards.filter((c) => isNew(c.fsrs)).length : 0

  // Your games through this line: how often you reached it and how they went. Nothing about your
  // preparation, which many of them predate.
  const mine = games?.filter((g) => startsWith(g.moves, node.path)) ?? []
  const score = scoreOf(mine)

  const gaps = (facts?.gaps ?? []).slice(0, 4)

  return (
    <div className="flex flex-col gap-5">
      {!compact && (
        <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl leading-tight font-medium tracking-tight">
              <Link to={`/rep/${rep.id}`} className="hover:text-maple">
                {rep.name}
              </Link>
              {rep.paused && <span className="ml-2 align-middle font-sans text-xs font-normal text-faint">paused</span>}
            </h2>
            <p className="mt-1 text-sm text-muted">
              <Line sans={node.sans} />
              {slot.reach !== null && (
                <>
                  {' '}
                  · met in <span className="tabular-nums">{share(slot.reach)}</span> of your {color === 'white' ? 'White' : 'Black'} games
                </>
              )}
            </p>
          </div>
          <Link to={`/rep/${rep.id}`} className="flex items-center gap-1 pt-1.5 text-xs font-medium text-muted hover:text-brass">
            Open repertoire <ArrowRight size={13} />
          </Link>
        </header>
      )}

      {facts && (
        <div className="flex items-center gap-4">
          <ScoreRing
            value={facts.score.remembered}
            under={facts.score.built}
            toneBy={facts.score.built}
            size={64}
            stroke={5}
            label={<span className="text-ink" style={{ fontSize: 15 }}>{pct(facts.score.built)}</span>}
            ariaLabel={`${pct(facts.score.built)} built, ${pct(facts.score.remembered)} remembered`}
          />
          <div className="min-w-0 text-sm">
            <p>
              <span className="font-medium tabular-nums">{pct(facts.score.built)}</span> built ·{' '}
              <span className="font-medium tabular-nums">{pct(facts.score.remembered)}</span> remembered
              <span className="text-muted"> to your move {settings.prepDepth}</span>
            </p>
            {cost && cost.total >= 0.0005 && (
              <p className="mt-1 text-xs leading-relaxed text-muted">
                <span className="font-medium text-ink tabular-nums">{share(cost.total)}</span> of your games leave your prep
                here: {share(cost.forgotten)} you’d forget, {share(cost.notBuilt)} not built yet.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {action && <ActionLink action={action} primary />}
        {fresh > 0 && !rep.paused && (
          <Link className="btn-ghost px-2.5 py-1.5 text-xs" to={trainUrl('learn', { repId: rep.id })}>
            <BookIcon size={14} /> Learn <span className="font-semibold text-maple tabular-nums">{fresh}</span>
          </Link>
        )}
        <Link className="btn-ghost px-2.5 py-1.5 text-xs" to={trainUrl('train', { repId: rep.id })} title="Test any move you have learned, weak ones more often">
          <TargetIcon size={14} /> Train
        </Link>
        <Link className="btn-ghost px-2.5 py-1.5 text-xs" to={builderUrl(rep.id, node.path)}>
          Open in builder
        </Link>
      </div>

      {data && data.cards.length > 0 && records && (
        <section>
          <h3 className="mb-2 text-xs font-medium text-muted">How well you know its {data.cards.length} moves</h3>
          <KnowledgeBar counts={counts} />
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-medium text-muted">In your games</h3>
        {!games?.length ? (
          <p className="text-sm text-muted">
            No games imported on this device yet.{' '}
            <Link to="/games" className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-current">
              Import them
            </Link>{' '}
            to see how this line goes in your games.
          </p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted">None of your imported games went this way.</p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
            <Fact value={String(mine.length)} label={mine.length === 1 ? 'game' : 'games'} />
            <Fact value={pct(score)} label="score" cls={resultColor(score)} />
            <Link
              to={`/games?${gamesParams('explorer', color, node.path)}`}
              className="flex items-center gap-1 text-xs font-medium text-muted hover:text-brass"
            >
              See them <ArrowRight size={13} />
            </Link>
          </div>
        )}
      </section>

      {gaps.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-medium text-muted">Biggest gaps</h3>
          <ul className="flex flex-col divide-y divide-line/60" onMouseLeave={() => onPreview?.(null)}>
            {gaps.map((g, i) => {
              const a = gapAction(g)
              const sans = replay(g.path).map((m) => m.san)
              const at = g.uci ? [...g.path, g.uci] : g.path
              return (
                <li key={i} className="flex items-center gap-3 py-2" onMouseEnter={() => onPreview?.(at)}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-[15px]">{formatMoves(g.san ? [...sans, g.san] : sans) || 'Starting position'}</div>
                    <div className="text-xs text-muted">
                      {GAP_LABEL[g.kind]} · <span className="tabular-nums">{share(g.reach)}</span> of this repertoire’s games
                    </div>
                  </div>
                  {a ? (
                    <ActionLink action={a} />
                  ) : (
                    <Link className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs" to={trainUrl(g.kind === 'weak' ? 'train' : 'learn', { repId: g.rep.id })}>
                      {g.kind === 'weak' ? 'Train' : 'Learn'}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

const GAP_LABEL = {
  'unprepared-reply': 'No answer prepared',
  'line-ends': 'Line ends too early',
  'not-learned': 'Not learned yet',
  weak: 'Weak recall',
} as const

function Fact({ value, label, cls = '' }: { value: string; label: string; cls?: string }) {
  return (
    <span>
      <span className={`font-display text-xl font-medium tabular-nums ${cls}`}>{value}</span>{' '}
      <span className="text-xs text-muted">{label}</span>
    </span>
  )
}
