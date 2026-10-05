import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Board } from '../../components/Board'
import { pct } from '../../components/format'
import { ArrowRight, BoltIcon, ChevronDown } from '../../components/icons'
import { ColorDot, ScoreRing, Section } from '../../components/ui'
import { createRepertoire, findOverlaps } from '../../db/repertoire'
import { db, type Repertoire } from '../../db/schema'
import { setPlanChoice, useSettings, type Settings } from '../../db/settings'
import { useRepertoire, type RepertoireData } from '../../db/useRepertoire'
import { startLogin } from '../../lib/auth/lichess'
import { formatMoves, replay, START_FEN, type Color } from '../../lib/chess/position'
import { parseMoves, repStart, startsWith } from '../../lib/chess/start'
import { AuthRequiredError } from '../../lib/explorer'
import { planScore, sideBranches, type CoveredNode, type Plan, type RepScore } from '../../lib/plan/plan'
import { useLineScore, usePlan, type PlanState } from '../../lib/plan/usePlan'
import { usePreparedness } from '../../lib/prep/usePreparedness'
import { builderUrl, planUrl, repertoireUrl } from '../../lib/routes'
import { confirmOverlap } from '../../lib/dialog'
import { isDue, isNew } from '../../lib/srs/scheduler'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { Atlas } from './Atlas'
import { SlotDetail } from './SlotDetail'
import { ActionLink, CostBar } from './SlotParts'
import { choicesOf, rankSlots, replyLabel, share, slotAction, slotsOf, splitLast, type Slot, type SlotFacts } from './slots'

export const COLOR_NAME = { white: 'White', black: 'Black' } as const

/**
 * Your repertoire of one colour, as the plan sees it: where your games go,
 * how ready you are there, and where your preparation leaks most. Every reply
 * that needs an answer is a slot: one of your repertoires fills it, or it is a
 * choice still to make, right here.
 */
export function RepertoiresPage() {
  const [params] = useSearchParams()
  const settings = useSettings()
  // The Games page links here with the colour and moves of an opening you meet but haven't prepared.
  const color: Color = (params.get('newColor') ?? params.get('color')) === 'black' ? 'black' : 'white'

  if (!settings) return null
  // Every score here weighs opponents' replies by the explorer: without it they'd read 100% built.
  if (!settings.lichessToken) return <LoginGate />

  return (
    <div className="stagger flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="page-title">Repertoire</h1>
        <div className="flex rounded-full border border-line bg-surface p-1 max-sm:w-full" role="group" aria-label="Colour">
          {(['white', 'black'] as const).map((c) => (
            <Link
              key={c}
              to={repertoireUrl(c)}
              replace
              aria-current={color === c ? 'page' : undefined}
              className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition ${
                c === color ? 'bg-surface-3 text-ink shadow-[inset_0_0_0_1px_rgb(217_170_85/0.45)]' : 'text-muted hover:text-ink'
              }`}
            >
              <ColorDot color={c} /> {COLOR_NAME[c]}
            </Link>
          ))}
        </div>
      </header>

      <ColorRepertoire key={color} color={color} settings={settings} />
    </div>
  )
}

/** The repertoire needs the opening explorer, and the explorer needs a Lichess login. */
function LoginGate() {
  return (
    <div className="stagger flex flex-col gap-5">
      <h1 className="page-title">Repertoire</h1>
      <section className="card max-w-xl p-6">
        <h2 className="font-display text-xl font-medium tracking-tight">Connect Lichess to see your repertoire</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your repertoire is measured against what opponents actually play, from the Lichess opening explorer, and the
          explorer needs a Lichess login. No permissions are requested.
        </p>
        <button className="btn-primary mt-5" onClick={() => startLogin()}>
          Log in with Lichess
        </button>
      </section>
    </div>
  )
}

/** Facts per covered position key, reported by the probes that compute them. */
function useFacts(): [Map<string, SlotFacts>, (key: string, f: SlotFacts) => void] {
  const [facts, setFacts] = useState(() => new Map<string, SlotFacts>())
  const report = useCallback((key: string, f: SlotFacts) => {
    setFacts((m) => {
      const cur = m.get(key)
      const same =
        cur &&
        cur.score.built === f.score.built &&
        cur.score.remembered === f.score.remembered &&
        cur.due === f.due &&
        cur.fresh === f.fresh &&
        cur.empty === f.empty &&
        cur.gaps.length === f.gaps.length &&
        cur.gaps.every((g, i) => g.key === f.gaps[i].key && g.kind === f.gaps[i].kind && g.reach === f.gaps[i].reach)
      return same ? m : new Map(m).set(key, f)
    })
  }, [])
  return [facts, report]
}

function ColorRepertoire({ color, settings }: { color: Color; settings: Settings }) {
  const state = usePlan(color, settings)
  const [facts, report] = useFacts()
  const [params, setParams] = useSearchParams()
  const wide = useMediaQuery('(min-width: 1024px)')
  const games = useLiveQuery(() => db.games.toArray().then((g) => g.filter((x) => x.color === color)), [color])
  const [preview, setPreview] = useState<string[] | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  const plan = state?.plan
  const nodes = useMemo(() => (plan ? slotsOf(plan.root) : []), [plan])
  const slots = useMemo(() => rankSlots(nodes, facts), [nodes, facts])

  // The slot in the URL (or the first one past a line the URL points at); on a wide screen the costliest by default.
  const at = params.get('at') ?? ''
  const atPath = at && at !== 'start' ? at.split(',') : []
  const target = at ? (slots.find((s) => s.id === at) ?? slots.find((s) => startsWith(s.node.path, atPath))) : undefined
  const selected = target ?? (wide ? slots[0] : undefined)
  const select = (id: string | undefined) => {
    setPreview(null)
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (id) next.set('at', id)
        else next.delete('at')
        return next
      },
      { replace: true },
    )
  }

  // Arriving with a slot in the URL: bring it into view once.
  const targetId = target?.id
  useEffect(() => {
    if (targetId) document.getElementById(`slot-${targetId}`)?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId === undefined])

  if (!state || !plan) return <p className="animate-pulse text-sm text-muted">Building your {COLOR_NAME[color]} plan…</p>
  const scores = new Map<string, RepScore>([...facts].map(([k, f]) => [k, f.score]))
  const score = planScore(plan, scores)
  const sides = sideBranches(plan.root)
  const maxCost = Math.max(0, ...slots.map((s) => s.cost?.total ?? 0))
  const probes = nodes.filter((n): n is CoveredNode => n.kind === 'covered')
  const detail = (s: Slot, compact = false) => (
    <SlotDetail
      slot={s}
      color={color}
      settings={settings}
      explorer={state.explorer}
      games={games}
      onPreview={setPreview}
      compact={compact}
    />
  )
  const pick = (id: string) => {
    if (wide) {
      select(id)
      detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    } else select(selected?.id === id ? undefined : id)
  }

  const ledger = (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line/70 px-4 py-3">
        <h2 className="font-display text-[15px] font-medium tracking-tight">Where your prep leaks</h2>
        <span className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-full bg-line-strong" /> not built
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-full bg-maple" /> forgotten
          </span>
        </span>
      </div>
      <ul className="divide-y divide-line/60">
        {slots.map((s) => (
          <LedgerRow
            key={s.id}
            slot={s}
            color={color}
            maxCost={maxCost}
            selected={selected?.id === s.id}
            onPick={() => pick(s.id)}
            detail={!wide && selected?.id === s.id ? detail(s, true) : null}
            expandable={!wide}
          />
        ))}
      </ul>
    </section>
  )

  return (
    <>
      {probes.map((n) => (
        <SlotProbe key={n.key} node={n} color={color} settings={settings} onFacts={report} />
      ))}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Summary state={state} color={color} settings={settings} score={score} slots={slots} onSelect={pick} />
        {!plan.empty && (
          <section className="card flex flex-col p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
              <h2 className="font-display text-[15px] font-medium tracking-tight">Where your games go</h2>
              <span className="text-xs text-muted">Size: how often you meet it · fill: built, then remembered</span>
            </div>
            <div className="h-60 sm:h-72 lg:h-auto lg:min-h-60 lg:flex-1">
              <Atlas slots={slots} color={color} selected={selected?.id} onSelect={pick} />
            </div>
          </section>
        )}
      </div>

      {wide ? (
        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-5">
          <div className="sticky top-20">{selected && <SlotBoard path={preview ?? selected.node.path} color={color} />}</div>
          <div className="flex flex-col gap-5">
            {selected && (
              <div ref={detailRef} className="card scroll-mt-24 p-5" id={`slot-${selected.id}`}>
                {detail(selected)}
              </div>
            )}
            {ledger}
          </div>
        </div>
      ) : (
        ledger
      )}

      {(sides.length > 0 || plan.offPlan.length > 0) && (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
          {sides.length > 0 && (
            <Section title="Side lines" right={<span className="text-xs text-muted">not counted in your score</span>}>
              <p className="mb-3 text-xs leading-relaxed text-muted">Second answers you keep for specific opponents.</p>
              <ul className="flex flex-col gap-4">
                {sides.map((b) => {
                  const { before, last } = splitLast([...b.from.sans, b.move.san])
                  return (
                    <li key={`${b.from.key}|${b.move.uci}`}>
                      <div className="mb-2 flex items-baseline gap-3 px-1">
                        <span className="min-w-0 flex-1 font-display text-[15px]">
                          {before && <span className="text-muted">{before} </span>}
                          <span className="font-medium text-maple">{last}</span>
                        </span>
                        <button
                          className="shrink-0 text-xs text-muted underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-current"
                          title="Play this move by default and keep the current answer as a side line"
                          onClick={() => setPlanChoice(color, b.from.key, b.move.uci)}
                        >
                          make main
                        </button>
                      </div>
                      <ul className="flex flex-col gap-2">
                        {b.covered.length
                          ? b.covered.map((c) => <LineRow key={c.key} node={c} color={color} settings={settings} />)
                          : b.move.reps.map((r) => <LooseRow key={r.id} rep={r} settings={settings} />)}
                      </ul>
                    </li>
                  )
                })}
              </ul>
            </Section>
          )}
          {plan.offPlan.length > 0 && (
            <Section title="Outside the plan" right={<span className="text-xs text-muted">not counted in your score</span>}>
              <p className="mb-3 text-xs leading-relaxed text-muted">
                The plan doesn’t reach these: they start inside another repertoire, or too deep.
              </p>
              <ul className="flex flex-col gap-2">
                {plan.offPlan.map((r) => (
                  <LooseRow key={r.id} rep={r} settings={settings} />
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      <NewRepertoire color={color} />
    </>
  )
}

/** Computes a covered line's facts (score, due moves, gaps) for the page; renders nothing. */
function SlotProbe({
  node,
  color,
  settings,
  onFacts,
}: {
  node: CoveredNode
  color: Color
  settings: Settings
  onFacts: (key: string, f: SlotFacts) => void
}) {
  const { data, prep, score } = useLineScore(node, color, settings)
  useEffect(() => {
    if (!data || !score) return
    const now = new Date()
    onFacts(node.key, {
      score,
      due: node.rep.paused ? 0 : data.cards.filter((c) => isDue(c.fsrs, now)).length,
      fresh: node.rep.paused ? 0 : data.cards.filter((c) => isNew(c.fsrs)).length,
      empty: !data.moves.length,
      gaps: prep?.gaps.filter((g) => g.rep.id === node.rep.id && startsWith(g.path, node.path)) ?? [],
    })
  }, [data, prep, score, node, onFacts])
  return null
}

/**
 * The colour at a glance, in its two scores: how much is built, how much of
 * that you remember, and which reply falls short most on each.
 */
function Summary({
  state,
  color,
  settings,
  score,
  slots,
  onSelect,
}: {
  state: PlanState
  color: Color
  settings: Settings
  score: RepScore | null
  slots: Slot[]
  onSelect: (id: string) => void
}) {
  const { plan } = state
  const choices = choicesOf(plan.root)
  const open = slots.filter((s) => s.node.kind === 'decision').length
  // A repertoire can answer several replies: count its moves once.
  const reps = new Map(slots.flatMap((s) => (s.node.kind === 'covered' && s.facts ? [[s.node.rep.id, s.facts] as const] : [])))
  const due = [...reps.values()].reduce((t, f) => t + f.due, 0)
  const fresh = [...reps.values()].reduce((t, f) => t + f.fresh, 0)
  const most = (part: 'notBuilt' | 'forgotten') =>
    slots.reduce<Slot | undefined>((best, s) => ((s.cost?.[part] ?? 0) > (best?.cost?.[part] ?? 0) ? s : best), undefined)
  const missing = most('notBuilt')
  const forgotten = most('forgotten')
  const depth = settings.prepDepth

  return (
    <section className="card flex flex-col gap-5 p-5">
      {plan.empty ? (
        <p className="max-w-[60ch] text-sm leading-relaxed text-muted">
          {color === 'white'
            ? 'Start with your first move. The plan then asks for an answer to each of Black’s main replies, and every answer becomes a repertoire you build and train.'
            : 'Choose a defence against each of White’s main first moves. The plan then asks for an answer to White’s main tries, and every answer becomes a repertoire you build and train.'}
        </p>
      ) : score ? (
        <div className="grid flex-1 grid-cols-2 gap-x-6">
          <Big value={score.built} label="built" />
          <Big value={score.remembered} label="remembered" />
          <div className="col-span-2 my-4">
            <PrepTrack score={score} />
          </div>
          <Half
            text={`Games where your repertoire has an answer up to your move ${depth}.`}
            lead="Missing most"
            slot={missing}
            amount={missing?.cost?.notBuilt}
            onSelect={onSelect}
          >
            <Count value={String(open)} label="to choose" cls={open ? 'text-warn' : ''} />
          </Half>
          <Half
            text="The same games, if you also remember every move today."
            lead="Forgotten most"
            slot={forgotten}
            amount={forgotten?.cost?.forgotten}
            onSelect={onSelect}
          >
            <Count value={String(due)} label="due" cls={due ? 'text-maple' : ''} />
            <Count value={String(fresh)} label="not learned" />
          </Half>
          <p className="col-span-2 mt-4 text-[11px] leading-relaxed text-faint">
            Both weight opponents’ replies by how often they’re played in the Lichess explorer.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">{measuring(state)}</p>
      )}
      <ExplorerStatus state={state} />

      {choices.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-t border-line/70 pt-4">
          <span className="text-xs font-medium text-muted">You play</span>
          {choices.map(({ node, move }) => {
            const { before, last } = splitLast([...node.sans, move.san])
            return (
              <span key={node.key} className="flex items-baseline gap-2">
                <span className="font-display text-[15px]">
                  {before && <span className="text-muted">{before} </span>}
                  <span className="font-medium text-maple">{last}</span>
                </span>
                <button
                  className="text-xs text-muted underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-current"
                  title="Forget this choice"
                  onClick={() => setPlanChoice(color, node.key, undefined)}
                >
                  change
                </button>
              </span>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Big({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-display text-4xl leading-none font-medium tracking-tight tabular-nums">{pct(value)}</span>
      <span className="text-sm text-muted">{label}</span>
    </div>
  )
}

/** One score's side of the summary: what it measures, where it falls short most, and what's waiting. */
function Half({
  text,
  lead,
  slot,
  amount,
  onSelect,
  children,
}: {
  text: string
  lead: string
  slot: Slot | undefined
  amount: number | undefined
  onSelect: (id: string) => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs leading-relaxed text-muted">{text}</p>
      {slot && amount !== undefined && amount >= 0.005 && (
        <p className="text-xs leading-relaxed text-muted">
          {lead}:{' '}
          <button
            className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-current"
            onClick={() => onSelect(slot.id)}
          >
            {slot.node.kind === 'covered' ? slot.node.rep.name : slot.node.title}
          </button>
          , <span className="tabular-nums">{share(amount)}</span> of games
        </p>
      )}
      <dl className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1">{children}</dl>
    </div>
  )
}

/** Built behind, remembered in front of it in a stronger shade: the stretch between them is what reviewing wins back. */
function PrepTrack({ score }: { score: RepScore }) {
  const width = (x: number) => ({ width: `${Math.max(0, Math.min(1, x)) * 100}%` })
  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-line/70">
      <div className="absolute inset-y-0 left-0 rounded-full bg-maple/35 transition-[width] duration-700 ease-out" style={width(score.built)} />
      <div className="absolute inset-y-0 left-0 rounded-full bg-maple transition-[width] duration-700 ease-out" style={width(score.remembered)} />
    </div>
  )
}

function Count({ value, label, cls = '' }: { value: string; label: ReactNode; cls?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className={`font-display text-2xl leading-none font-medium tabular-nums ${cls}`}>{value}</dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  )
}

/** One reply in the ledger: what it costs you, and the next thing to do about it. */
function LedgerRow({
  slot,
  color,
  maxCost,
  selected,
  onPick,
  detail,
  expandable,
}: {
  slot: Slot
  color: Color
  maxCost: number
  selected: boolean
  onPick: () => void
  /** The slot's detail, open under the row (phones). */
  detail: ReactNode
  /** Picking the row opens its detail under it, rather than beside the list. */
  expandable: boolean
}) {
  const { node, facts, cost } = slot
  const decision = node.kind === 'decision'
  const paused = node.kind === 'covered' && node.rep.paused
  const action = node.kind === 'covered' ? slotAction(node.rep, facts) : null
  const reply = replyLabel(node.sans, color) ?? 'Move 1'
  return (
    <li id={expandable ? `slot-${slot.id}` : undefined} className={`scroll-mt-24 ${selected ? 'bg-brass/[0.07]' : ''}`}>
      <div className="relative flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2/60">
        {selected && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brass" aria-hidden />}
        <span className={`w-14 shrink-0 font-display text-[15px] font-medium ${decision ? 'text-warn' : ''} ${paused ? 'opacity-60' : ''}`}>
          {reply}
        </span>
        <div className={`min-w-0 flex-1 ${paused ? 'opacity-60' : ''}`}>
          <button
            className="block w-full truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-brass/60 focus-visible:after:ring-inset"
            aria-expanded={expandable ? selected : undefined}
            aria-pressed={expandable ? undefined : selected}
            onClick={onPick}
          >
            {decision ? (
              <span className="inline-flex items-center gap-1.5">
                <BoltIcon size={13} className="text-warn" /> {node.title}
              </span>
            ) : (
              node.rep.name
            )}
            {paused && <span className="ml-1.5 text-xs font-normal text-faint">paused</span>}
          </button>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="max-w-60 flex-1">{cost && <CostBar cost={cost} max={maxCost} open={decision} />}</div>
            {cost && (
              <span className="shrink-0 text-xs text-muted tabular-nums">
                <span className="font-medium text-ink">{share(cost.total)}</span> of games
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-xs text-muted">
            {slot.reach !== null && node.sans.length > 0 && <>met in {share(slot.reach)}</>}
            {facts && (
              <>
                {slot.reach !== null && node.sans.length > 0 && ' · '}
                {pct(facts.score.built)} built · {pct(facts.score.remembered)} remembered
              </>
            )}
            {decision && <>{slot.reach !== null && ' · '}still to choose</>}
          </div>
        </div>
        {action && <ActionLink action={action} className="relative z-10 max-sm:hidden" />}
        {!decision && facts && (
          <ScoreRing
            value={facts.score.remembered}
            under={facts.score.built}
            toneBy={facts.score.built}
            size={38}
            stroke={3.5}
            label={<span className="text-ink" style={{ fontSize: 10.5 }}>{pct(facts.score.built)}</span>}
            ariaLabel={`${pct(facts.score.built)} built, ${pct(facts.score.remembered)} remembered`}
          />
        )}
      </div>
      {detail && <div className="animate-pop border-t border-line/60 px-4 pt-3 pb-4">{detail}</div>}
    </li>
  )
}

/** The position of a slot (or a hovered gap), with the line's moves under it. */
function SlotBoard({ path, color }: { path: string[]; color: Color }) {
  const played = useMemo(() => {
    try {
      return replay(path)
    } catch {
      return []
    }
  }, [path])
  const last = played.at(-1)
  return (
    <div className="flex flex-col gap-3">
      <Board
        fen={last?.fen ?? START_FEN}
        orientation={color}
        movable="none"
        lastMove={last ? [last.uci.slice(0, 2), last.uci.slice(2, 4)] : undefined}
      />
      <p className="px-1 font-display text-[15px] text-muted">{formatMoves(played.map((m) => m.san)) || 'Starting position'}</p>
    </div>
  )
}

/** What the colour's score is waiting for. */
function measuring({ pending }: PlanState) {
  if (pending) return `Measuring: downloading opponent statistics, ${pending} ${pending === 1 ? 'position' : 'positions'} left.`
  return 'Measuring…'
}

/** Why opponent statistics are missing, and what to do about it. Silent while nothing is missing. */
function ExplorerStatus({ state: { plan, fetchError } }: { state: PlanState }) {
  if (fetchError instanceof AuthRequiredError && plan.needed.length)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
        <span className="min-w-0 flex-1 basis-60">Your Lichess login has expired: log in again to download opponent statistics.</span>
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => startLogin()}>
          Log in with Lichess
        </button>
      </div>
    )
  if (fetchError && !(fetchError instanceof AuthRequiredError))
    return (
      <p className="text-xs text-bad">
        The Lichess explorer didn’t answer ({fetchError.message}). The scores use what was downloaded before; reload to try
        again.
      </p>
    )
  return null
}

/**
 * A colour's preparedness as one rounded bar: built behind, remembered in
 * front of it in a stronger shade. The lighter stretch between them is what
 * reviewing wins back.
 */
export function PrepBar({
  score,
  depth,
  explain = true,
  extra,
}: {
  score: RepScore
  depth: number
  explain?: boolean
  /** Shown after the remembered score. */
  extra?: ReactNode
}) {
  const [help, setHelp] = useState(false)
  const width = (x: number) => ({ width: `${Math.max(0, Math.min(1, x)) * 100}%` })
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>
          <span className="font-display text-3xl leading-none font-medium tabular-nums">{pct(score.built)}</span>
          <span className="ml-1.5 text-sm text-muted">built</span>
        </span>
        <span className="text-sm text-muted">
          <span className="font-medium text-ink tabular-nums">{pct(score.remembered)}</span> remembered
          {extra && <> · {extra}</>}
        </span>
        {explain && (
          <button
            className="ml-auto text-xs text-muted underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-current"
            aria-expanded={help}
            onClick={() => setHelp((h) => !h)}
          >
            What these mean
          </button>
        )}
      </div>
      <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-line/70">
        <div className="absolute inset-y-0 left-0 rounded-full bg-maple/35 transition-[width] duration-700 ease-out" style={width(score.built)} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-maple transition-[width] duration-700 ease-out" style={width(score.remembered)} />
      </div>
      {explain && help && (
        <p className="mt-2.5 max-w-[68ch] animate-pop text-xs leading-relaxed text-muted">
          Share of games you reach your move {depth} still in prep, weighting opponents by the Lichess explorer.{' '}
          <span className="text-ink">Built</span> counts every prepared move as known;{' '}
          <span className="text-ink">remembered</span> counts each at your chance of recalling it today. In the rings the
          number and colour are built, the dark arc remembered.
        </p>
      )}
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
        {next.reach !== null && <span className="block text-xs text-muted tabular-nums">met in {share(next.reach)} of games</span>}
      </span>
      <ArrowRight size={15} className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-warn" />
    </Link>
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

/** A side line answered by a repertoire, scored from where the line enters it. */
function LineRow({ node, color, settings }: { node: CoveredNode; color: Color; settings: Settings }) {
  const { data, score } = useLineScore(node, color, settings)
  return <RepRow rep={node.rep} data={data} score={score} sans={node.sans} reach={node.reach} depth={settings.prepDepth} />
}

/** A repertoire the plan doesn't count, scored as a whole. */
function LooseRow({ rep, settings }: { rep: Repertoire; settings: Settings }) {
  const data = useRepertoire(rep.id)
  const prep = usePreparedness(data, settings.explorerFilter, settings.prepDepth)
  const score = data && !data.moves.length ? { built: 0, remembered: 0 } : prep && { built: prep.built.score, remembered: prep.result.score }
  return <RepRow rep={rep} data={data} score={score} sans={repStart(rep).sans} reach={null} depth={settings.prepDepth} />
}

function RepRow({
  rep,
  data,
  score,
  sans,
  reach,
  depth,
}: {
  rep: Repertoire
  data: RepertoireData | null | undefined
  score: RepScore | undefined
  /** Moves to the position the row is about. */
  sans: string[]
  /** Share of all games that reach it. */
  reach: number | null
  depth: number
}) {
  const due = data && !rep.paused ? data.cards.filter((c) => isDue(c.fsrs, new Date())).length : 0
  const action = data
    ? slotAction(rep, { score: score ?? { built: 0, remembered: 0 }, due, fresh: 0, empty: !data.moves.length, gaps: [] })
    : null
  return (
    <li className="group relative flex items-center gap-3 rounded-lg border border-line/60 bg-surface-2/60 px-3 py-2.5 transition hover:border-line-strong hover:bg-surface-2">
      <ScoreRing
        value={score?.remembered}
        under={score?.built}
        toneBy={score?.built}
        label={score ? <span className="text-ink" style={{ fontSize: 12 }}>{pct(score.built)}</span> : undefined}
        title={score ? `${pct(score.built)} built (number, light arc), ${pct(score.remembered)} remembered (dark arc), to your move ${depth}` : undefined}
        ariaLabel={score ? `${pct(score.built)} built, ${pct(score.remembered)} remembered` : 'Not measured'}
        size={44}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Link
            to={`/rep/${rep.id}`}
            className="truncate font-display text-base font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-brass/60"
          >
            {rep.name}
          </Link>
          {rep.paused && <span className="shrink-0 text-xs text-faint">paused</span>}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">
          {sans.length > 0 && <span className="font-display text-[13px] text-ink/75">{formatMoves(sans)}</span>}
          {reach !== null && <> · met in {share(reach)}</>}
          {score && <> · {pct(score.remembered)} remembered</>}
        </p>
      </div>
      {action && <ActionLink action={action} className="relative z-10" />}
    </li>
  )
}

function NewRepertoire({ color }: { color: Color }) {
  const [params] = useSearchParams()
  const [name, setName] = useState('')
  const [startText, setStartText] = useState(params.get('newStart') ?? '')
  const [error, setError] = useState<string>()
  const navigate = useNavigate()
  const fallback = `${COLOR_NAME[color]} repertoire`
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    let startMoves: string[]
    try {
      startMoves = parseMoves(startText)
    } catch (err) {
      return setError((err as Error).message)
    }
    const overlaps = await findOverlaps(color, startMoves)
    if (overlaps.length && !(await confirmOverlap(overlaps.map((r) => r.name)))) return
    const rep = await createRepertoire(name.trim() || fallback, color, undefined, startMoves)
    setName('')
    setStartText('')
    navigate(builderUrl(rep.id, startMoves))
  }
  return (
    <details className="group card" open={params.has('newStart')}>
      <summary className="flex cursor-pointer items-start gap-2 rounded-xl px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brass/60">
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[15px] font-medium">Custom {COLOR_NAME[color]} repertoire</span>
          <span className="block text-xs text-muted">For anything the plan doesn’t offer</span>
        </span>
        <ChevronDown size={16} className="mt-0.5 shrink-0 text-muted transition group-open:rotate-180" />
      </summary>
      <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line/70 p-4">
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Name
          <input
            className="input"
            placeholder={fallback}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={params.has('newStart')}
          />
        </label>
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
          <span className="leading-relaxed">These moves are set up, not drilled: your score counts them as known.</span>
        </label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <button className="btn-primary">Create and open builder</button>
      </form>
    </details>
  )
}
