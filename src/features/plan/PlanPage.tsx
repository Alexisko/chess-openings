import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { pct, scoreColor } from '../../components/format'
import { ColorDot, Section } from '../../components/ui'
import { createRepertoire, findOverlaps } from '../../db/repertoire'
import { db, type Game, type Repertoire } from '../../db/schema'
import { setPlanChoice, useSettings, type Settings } from '../../db/settings'
import { useRepertoire } from '../../db/useRepertoire'
import { formatMoves, type Color } from '../../lib/chess/position'
import { startOf, startsWith } from '../../lib/chess/start'
import { AuthRequiredError, moveShare, totalGames, type ExplorerData } from '../../lib/explorer'
import type { ResolvedOption, Style, Theory } from '../../lib/openings/catalog'
import { planScore, scoreFor, type DecisionNode, type PlanNode, type RepliesNode } from '../../lib/plan/plan'
import { usePlan, useScoreMap } from '../../lib/plan/usePlan'
import { usePreparedness } from '../../lib/prep/usePreparedness'
import { builderUrl, planUrl } from '../../lib/routes'
import { isDue } from '../../lib/srs/scheduler'

const EMPTY = new Set<string>()
const COLOR_NAME: Record<Color, string> = { white: 'White', black: 'Black' }

const STYLE_CLS: Record<Style, string> = {
  solid: 'bg-info/15 text-info',
  active: 'bg-accent/15 text-accent',
  sharp: 'bg-bad/15 text-bad',
  gambit: 'bg-warn/15 text-warn',
}
const THEORY_LABEL: Record<Theory, string> = { light: 'little theory', medium: 'some theory', heavy: 'lots of theory' }

const fmtReach = (r: number | null) => (r === null ? '–' : pct(r, r < 0.1 ? 1 : 0))

/** A repertoire name for an option: move-like names get the slot's opponent in front. */
function repName(title: string, option: ResolvedOption) {
  if (!/\d/.test(option.name)) return option.name
  const vs = title.replace(/^(Against|Your answer to|Your defence to|Your system against)\s+/, 'vs ')
  return `${vs}: ${option.name}`
}

interface Ctx {
  color: Color
  settings: Settings
  explorer: Map<string, ExplorerData>
  games: Game[]
  open: Set<string>
  toggle: (id: string) => void
  report: (repId: string, score: number) => void
  create: (name: string, startUci: string[], lineUci: string[]) => Promise<void>
}

export function PlanPage() {
  const params = useParams()
  const color: Color = params.color === 'black' ? 'black' : 'white'
  const settings = useSettings()
  const state = usePlan(color, settings)
  const [scores, report] = useScoreMap()
  const [search] = useSearchParams()
  const focus = search.get('at') ?? ''
  const games = useLiveQuery(() => db.games.toArray().then((g) => g.filter((x) => x.color === color)), [color])
  const navigate = useNavigate()

  // Open decisions: the one in the URL, else the most frequent. The reader can open and close others.
  // Toggles are forgotten when the focus changes.
  const [toggleState, setToggleState] = useState({ scope: '', ids: new Set<string>() })
  const scope = `${color}|${focus}`
  const toggled = toggleState.scope === scope ? toggleState.ids : EMPTY
  const defaultOpen = focus || state?.plan.decisions[0]?.path.join(',') || ''
  const open = useMemo(() => {
    const s = new Set(toggled)
    if (defaultOpen) {
      if (s.has(defaultOpen)) s.delete(defaultOpen)
      else s.add(defaultOpen)
    }
    return s
  }, [toggled, defaultOpen])

  useEffect(() => {
    if (!focus) return
    document.getElementById(`plan-${focus}`)?.scrollIntoView({ block: 'center' })
    // Scroll once the plan has loaded, not on every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, state === undefined])

  if (!settings || !state || !games) return null
  const { plan, explorer } = state
  const score = planScore(plan, scores)

  const ctx: Ctx = {
    color,
    settings,
    explorer,
    games,
    open,
    toggle: (id) => {
      const next = new Set(toggled)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setToggleState({ scope, ids: next })
    },
    report,
    create: async (name, startUci, lineUci) => {
      const overlaps = await findOverlaps(color, startUci)
      if (
        overlaps.length &&
        !confirm(
          `This overlaps with ${overlaps.map((r) => `"${r.name}"`).join(', ')}: the same positions would be in two ` +
            'repertoires and be drilled twice. Create it anyway?',
        )
      )
        return
      const rep = await createRepertoire(name, color, undefined, startUci)
      navigate(builderUrl(rep.id, lineUci))
    },
  }
  const next = plan.decisions[0]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ColorDot color={color} />
        <h1 className="text-xl font-semibold">{COLOR_NAME[color]} repertoire</h1>
        <div className="ml-auto flex gap-1">
          {(['white', 'black'] as const).map((c) => (
            <Link
              key={c}
              to={planUrl(c)}
              className={`btn border px-3 py-1 ${c === color ? 'border-accent bg-surface-2' : 'border-line text-muted'}`}
            >
              <ColorDot color={c} /> {COLOR_NAME[c]}
            </Link>
          ))}
        </div>
      </div>

      {!plan.empty && (
        <Section title="Where you stand">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat value={plan.coverage === null ? '–' : pct(plan.coverage)} label="of games reach one of your repertoires" />
            <Stat
              value={score === null ? '–' : pct(score)}
              cls={score === null ? '' : scoreColor(score)}
              label={`prepared overall, ${settings.prepDepth} moves deep`}
            />
            <Stat value={String(plan.decisions.length)} label={plan.decisions.length === 1 ? 'choice left' : 'choices left'} />
          </div>
          {next ? (
            <Link
              to={planUrl(color, next.path)}
              className="mt-3 flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm hover:bg-warn/20"
            >
              <span className="font-medium">Next step:</span>
              <span className="min-w-0 flex-1 truncate">
                {next.title}
                {next.sans.length > 0 && <span className="text-muted"> · after {formatMoves(next.sans)}</span>}
              </span>
              {next.reach !== null && <span className="shrink-0 text-xs text-muted">{fmtReach(next.reach)} of games</span>}
            </Link>
          ) : (
            <p className="mt-3 text-sm text-accent">
              Every frequent line leads to one of your repertoires. Now build them up and train them.
            </p>
          )}
        </Section>
      )}

      {state.pending > 0 && (
        <p className="text-xs text-warn">
          {state.fetchError instanceof AuthRequiredError
            ? 'Log in with Lichess (Settings) to see how often opponents play each move.'
            : `Downloading opponent statistics… ${state.pending} positions left.`}
        </p>
      )}

      <section className="card p-2">
        {plan.empty && (
          <p className="px-1 pb-2 text-sm text-muted">
            {color === 'white'
              ? 'Start with your first move. The plan then asks for an answer to each of Black’s main replies, and every answer becomes a repertoire you build and train.'
              : 'Choose a defence against each of White’s main first moves. The plan then asks for an answer to White’s main tries, and every answer becomes a repertoire you build and train.'}
          </p>
        )}
        <NodeView node={plan.root} level={0} ctx={ctx} />
      </section>

      {plan.offPlan.length > 0 && (
        <Section title="Other repertoires">
          <p className="mb-2 text-xs text-muted">
            The plan doesn't reach these: they start inside another repertoire, or too deep.
          </p>
          <ul className="flex flex-col gap-1">
            {plan.offPlan.map((r) => (
              <li key={r.id}>
                <Link to={`/rep/${r.id}`} className="text-sm hover:underline">
                  {r.name}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="text-xs text-muted">
        Shares come from the Lichess opening explorer with your filter (Settings). Replies played in fewer than 3% of
        games are grouped under "other replies"; your repertoires cover them too once you add them in the builder.
      </p>
    </div>
  )
}

function Stat({ value, label, cls = '' }: { value: string; label: string; cls?: string }) {
  return (
    <div className="rounded-md bg-surface-2 p-2">
      <div className={`text-2xl font-semibold ${cls}`}>{value}</div>
      <div className="text-[11px] leading-tight text-muted">{label}</div>
    </div>
  )
}

const indent = (level: number) => ({ paddingLeft: `${level * 1.1 + 0.25}rem` })

/** Renders a node: moves are shown inline, replies and decisions below. */
function NodeView({ node, level, ctx }: { node: PlanNode; level: number; ctx: Ctx }): ReactNode {
  if (node.kind === 'replies') return <RepliesView node={node} level={level} ctx={ctx} />
  if (node.kind === 'decision') return <DecisionView node={node} level={level} ctx={ctx} />
  // A root that is covered, a move or too deep: one row with the chain.
  return (
    <ul>
      <ChainRow node={node} level={level} ctx={ctx} />
    </ul>
  )
}

/** Follows your moves from a node until the next branch point. */
function chainOf(node: PlanNode) {
  const moves: { san: string; ply: number; source: 'choice' | 'repertoire'; reps: Repertoire[]; fromKey: string }[] = []
  const extra: { node: PlanNode; san: string; ply: number; reps: Repertoire[] }[] = []
  let cur = node
  while (cur.kind === 'move') {
    const [first, ...rest] = cur.moves
    moves.push({ san: first.san, ply: cur.path.length, source: first.source, reps: first.reps, fromKey: cur.key })
    for (const m of rest) extra.push({ node: m.child, san: m.san, ply: cur.path.length, reps: m.reps })
    cur = first.child
  }
  return { moves, extra, end: cur }
}

/** One line of the outline: an opponent reply (if any), then your moves up to the next branch. */
function ChainRow({
  node,
  level,
  ctx,
  reply,
}: {
  node: PlanNode
  level: number
  ctx: Ctx
  reply?: { san: string; ply: number; name?: string; share: number | null }
}) {
  const { moves, extra, end } = chainOf(node)
  const id = end.path.join(',')
  const decisionOpen = end.kind === 'decision' && ctx.open.has(id)
  return (
    <li id={`plan-${id}`}>
      <div
        className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md py-1.5 pr-1 text-sm ${node.counted ? '' : 'opacity-60'}`}
        style={indent(level)}
      >
        {reply && (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="font-medium">{formatMoves([reply.san], reply.ply)}</span>
            {reply.name && <span className="truncate text-muted">{reply.name}</span>}
            {reply.share !== null && <span className="text-xs text-muted">{pct(reply.share, reply.share < 0.1 ? 1 : 0)}</span>}
          </span>
        )}
        {moves.map((m, i) => (
          <span key={i} className="flex items-baseline gap-1">
            <span className="text-muted">→</span>
            <span className="font-medium">{formatMoves([m.san], m.ply)}</span>
            {m.source === 'choice' ? (
              <button
                className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                title="Forget this choice"
                onClick={() => setPlanChoice(ctx.color, m.fromKey, undefined)}
              >
                change
              </button>
            ) : (
              moves.length === 1 &&
              end.kind !== 'covered' && <span className="text-xs text-muted">({m.reps.map((r) => r.name).join(', ')})</span>
            )}
          </span>
        ))}
        {end.kind === 'covered' && <CoveredBadge node={end} ctx={ctx} />}
        {end.kind === 'decision' && (
          <button
            className="rounded bg-warn/15 px-1.5 py-0.5 text-xs font-medium text-warn hover:bg-warn/25"
            onClick={() => ctx.toggle(id)}
          >
            {decisionOpen ? 'Choose ▾' : 'Choose your answer ▸'}
          </button>
        )}
        {end.kind === 'stop' && <span className="text-xs text-muted">deep enough for now</span>}
        {!node.counted && <span className="text-xs text-muted">(second answer, not counted)</span>}
      </div>
      {(extra.length > 0 || end.kind === 'replies' || decisionOpen) && (
        <ul>
          {extra.map((x, i) => (
            <ChainRow
              key={`x${i}`}
              node={x.node}
              level={level + 1}
              ctx={ctx}
              reply={{ san: x.san, ply: x.ply, name: `also in ${x.reps.map((r) => r.name).join(', ')}`, share: null }}
            />
          ))}
          {end.kind === 'replies' && <RepliesItems node={end} level={level + 1} ctx={ctx} />}
          {decisionOpen && end.kind === 'decision' && (
            <li style={indent(level + 1)} className="py-1">
              <DecisionCard node={end} ctx={ctx} />
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

function RepliesView({ node, level, ctx }: { node: RepliesNode; level: number; ctx: Ctx }) {
  return (
    <ul>
      <RepliesItems node={node} level={level} ctx={ctx} />
    </ul>
  )
}

function RepliesItems({ node, level, ctx }: { node: RepliesNode; level: number; ctx: Ctx }) {
  const name = ctx.explorer.get(node.key)?.opening?.name
  return (
    <>
      {node.replies.map((r) => (
        <ChainRow
          key={r.uci}
          node={r.child}
          level={level}
          ctx={ctx}
          reply={{ san: r.san, ply: node.path.length, name: r.name, share: r.share }}
        />
      ))}
      {!node.replies.length && (
        <li className="py-1 text-xs text-muted" style={indent(level)}>
          {node.hasData ? 'No games in the database from here.' : 'Waiting for opponent statistics…'}
        </li>
      )}
      {node.others.length > 0 && (
        <li className="py-1 text-xs text-muted" style={indent(level)} title={node.others.map((o) => o.san).join(' ')}>
          Other replies · {pct(node.othersShare, 1)}:{' '}
          {node.others
            .slice(0, 5)
            .map((o) => o.san)
            .join(', ')}
          {node.others.length > 5 && '…'}
        </li>
      )}
      {node.afterChoice && node.counted && (
        <li className="py-1 text-xs" style={indent(level)}>
          <button
            className="text-muted underline underline-offset-2 hover:text-ink"
            onClick={() => ctx.create(name ?? formatMoves(node.sans), node.path, node.path)}
          >
            Or answer all of these in one repertoire
          </button>
        </li>
      )}
    </>
  )
}

function DecisionView({ node, level, ctx }: { node: DecisionNode; level: number; ctx: Ctx }) {
  return (
    <div id={`plan-${node.path.join(',')}`} style={indent(level)}>
      <DecisionCard node={node} ctx={ctx} />
    </div>
  )
}

function DecisionCard({ node, ctx }: { node: DecisionNode; ctx: Ctx }) {
  const here = ctx.explorer.get(node.key)
  const optionMoves = new Set(node.slot?.options.map((o) => o.uci))
  const total = here ? totalGames(here) : 0
  const otherMoves = (here?.moves ?? [])
    .map((m) => ({ ...m, share: total ? totalGames(m) / total : 0 }))
    .filter((m) => m.share >= 0.02 && !optionMoves.has(m.uci))
    .slice(0, 6)
  const name = here?.opening?.name

  return (
    <div className="rounded-lg border border-warn/40 bg-bg/40 p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold">{node.title}</h3>
        {node.sans.length > 0 && <span className="text-xs text-muted">after {formatMoves(node.sans)}</span>}
        {node.reach !== null && <span className="ml-auto text-xs text-muted">{fmtReach(node.reach)} of games</span>}
      </div>
      {node.slot && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
          {node.slot.options.map((o) => (
            <OptionCard key={o.name} option={o} node={node} ctx={ctx} />
          ))}
        </div>
      )}
      {otherMoves.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs text-muted">{node.slot ? 'Other moves played here' : 'Moves played here'}</div>
          <div className="flex flex-wrap gap-1.5">
            {otherMoves.map((m) => {
              const s = scoreFor(ctx.color, m)
              return (
                <button
                  key={m.uci}
                  className="btn-ghost px-2 py-1 text-xs"
                  title="Play this move and choose answers to the replies"
                  onClick={() => setPlanChoice(ctx.color, node.key, m.uci)}
                >
                  <span className="font-medium">{formatMoves([m.san], node.path.length)}</span>
                  <span className="text-muted">
                    {pct(m.share)}
                    {s !== null && ` · scores ${pct(s)}`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className="mt-3 text-xs">
        <button
          className="text-muted underline underline-offset-2 hover:text-ink"
          onClick={() => ctx.create(name ? `vs ${name}` : node.title, node.path, node.path)}
        >
          Build your own repertoire from here
        </button>
        {!node.slot && !here && <span className="ml-2 text-muted">(waiting for statistics to suggest moves)</span>}
      </div>
    </div>
  )
}

function OptionCard({ option: o, node, ctx }: { option: ResolvedOption; node: DecisionNode; ctx: Ctx }) {
  // Popularity and score of the move that defines the option, where it is played.
  const before = startOf(o.startUci.slice(0, -1))
  const data = ctx.explorer.get(before.key)
  const defining = o.startUci.at(-1)!
  const share = moveShare(data, defining)
  const stats = data?.moves.find((m) => m.uci === defining)
  const score = stats ? scoreFor(ctx.color, stats) : null
  const played = ctx.games.filter((g) => startsWith(g.moves, o.startUci)).length
  const line = startOf(o.lineUci).sans.slice(node.path.length)
  const definingSan = formatMoves([startOf(o.startUci).sans.at(-1)!], o.startUci.length - 1)

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-surface-2 p-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{o.name}</span>
        <span className="ml-auto flex shrink-0 gap-1 text-[10px]">
          <span className={`rounded px-1 ${STYLE_CLS[o.style]}`}>{o.style}</span>
          <span className="rounded bg-line px-1 text-muted">{THEORY_LABEL[o.theory]}</span>
        </span>
      </div>
      <div className="text-xs text-muted">{formatMoves(line, node.path.length)}</div>
      <p className="text-xs leading-snug">{o.about}</p>
      <div className="text-[11px] text-muted">
        {share !== undefined && (
          <>
            {definingSan} is played in {pct(share)} of games
            {score !== null && `, scores ${pct(score)}`}
          </>
        )}
        {played > 0 && (
          <span className="text-info">
            {share !== undefined && ' · '}
            you played it in {played} game{played > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <button
        className={`${o.kind === 'branch' ? 'btn border border-accent/60 text-accent hover:bg-accent/10' : 'btn-primary'} mt-auto px-2 py-1 text-xs`}
        onClick={() =>
          o.kind === 'branch'
            ? setPlanChoice(ctx.color, node.key, o.uci)
            : ctx.create(repName(node.title, o), o.startUci, o.lineUci)
        }
      >
        {o.kind === 'branch' ? `Play ${formatMoves([o.san], node.path.length)}` : 'Build this repertoire'}
      </button>
    </div>
  )
}

/** A repertoire answering a line, with its preparedness (reported for the overall score). */
function CoveredBadge({ node, ctx }: { node: Extract<PlanNode, { kind: 'covered' }>; ctx: Ctx }) {
  const data = useRepertoire(node.rep.id)
  const prep = usePreparedness(data, ctx.settings.explorerFilter, ctx.settings.prepDepth)
  const score = data && data.moves.length ? prep?.result.score : data ? 0 : undefined
  const { report } = ctx
  useEffect(() => {
    if (score !== undefined) report(node.rep.id, score)
  }, [score, node.rep.id, report])
  const now = new Date()
  const due = data ? data.cards.filter((c) => isDue(c.fsrs, now)).length : 0
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <Link to={`/rep/${node.rep.id}`} className="font-medium text-accent hover:underline">
        ✓ {node.rep.name}
      </Link>
      {data && data.moves.length === 0 ? (
        <Link to={builderUrl(node.rep.id, [])} className="rounded bg-warn/15 px-1.5 text-xs text-warn hover:bg-warn/25">
          empty: build it
        </Link>
      ) : (
        score !== undefined && (
          <span className={`text-xs ${scoreColor(score)}`} title={`Prepared ${ctx.settings.prepDepth} moves deep`}>
            {pct(score)} prepared
          </span>
        )
      )}
      {due > 0 && (
        <Link to={`/train?mode=review&rep=${node.rep.id}`} className="text-xs text-info hover:underline">
          {due} due
        </Link>
      )}
      {node.others.length > 0 && (
        <span className="text-xs text-muted">also in {node.others.map((r) => r.name).join(', ')}</span>
      )}
    </span>
  )
}
