import type { Repertoire } from '../../db/schema'
import type { RepGraph } from '../chess/graph'
import { playUci, positionKey, START_FEN, turnOf, type Color } from '../chess/position'
import { repStart, startOf, startsWith } from '../chess/start'
import { totalGames, type ExplorerData } from '../explorer/explorer'
import { catalogReplies, catalogSlot, type ResolvedSlot } from '../openings/catalog'

/**
 * The repertoire plan of one colour: a walk from the initial position that
 * shows, for every frequent opponent reply, which repertoire answers it, and
 * where you still have to choose an opening.
 *
 * - Opponent to move: the replies played in at least MIN_SHARE of games
 *   (explorer), or the catalogue's named replies when there is no data yet.
 * - Your move: a position inside one of your repertoires is covered. Otherwise
 *   the walk follows your plan choice (e.g. 1.e4) or the move implied by a
 *   repertoire that starts further down this line (the Italian implies 2.Nf3
 *   after 1.e4 e5). With neither, it is a decision.
 */

/** Replies are listed when at least this share of games plays them… */
export const MIN_SHARE = 0.03
/** …and they are reached in at least this share of all games. */
export const MIN_REACH = 0.005
/** The walk stops this deep. */
export const MAX_PLIES = 16

export interface PlanRep {
  rep: Repertoire
  graph: RepGraph
}

export interface PlanInput {
  color: Color
  /** Repertoires of this colour, oldest first. */
  reps: PlanRep[]
  /** Your chosen move per position key (plan moves that aren't a repertoire). */
  choices: Record<string, string>
  explorer: Map<string, ExplorerData>
}

interface Base {
  key: string
  fen: string
  /** UCI and SAN moves from the initial position. */
  path: string[]
  sans: string[]
  /** Share of all games that reach this position (null without explorer data). */
  reach: number | null
  /**
   * False inside a second answer to the same position (e.g. both the Italian
   * and the Vienna after 1.e4 e5): it is shown but not counted twice.
   */
  counted: boolean
}

export interface CoveredNode extends Base {
  kind: 'covered'
  rep: Repertoire
  /** Other repertoires that contain this position too. */
  others: Repertoire[]
}

export interface PlannedMove {
  uci: string
  san: string
  source: 'choice' | 'repertoire'
  /** Repertoires whose starting moves play this move. */
  reps: Repertoire[]
  child: PlanNode
}

export interface MoveNode extends Base {
  kind: 'move'
  /** The first move is the one that counts; others are extra answers you also have. */
  moves: PlannedMove[]
}

export interface Reply {
  uci: string
  san: string
  name?: string
  share: number | null
  child: PlanNode
}

export interface RepliesNode extends Base {
  kind: 'replies'
  replies: Reply[]
  /** Replies below the thresholds and their total share. */
  others: { uci: string; san: string; share: number }[]
  othersShare: number
  hasData: boolean
  /** Reached through a plan choice: you can still cover all replies with one repertoire. */
  afterChoice: boolean
}

export interface DecisionNode extends Base {
  kind: 'decision'
  slot?: ResolvedSlot
  title: string
}

export interface StopNode extends Base {
  kind: 'stop'
}

export type PlanNode = CoveredNode | MoveNode | RepliesNode | DecisionNode | StopNode

export interface Plan {
  color: Color
  root: PlanNode
  /** Covered positions that count (one per line). */
  covered: CoveredNode[]
  /** Share of games that reach one of your repertoires (null without explorer data). */
  coverage: number | null
  /** Positions where you still have to choose, most frequent first. */
  decisions: DecisionNode[]
  /** Explorer positions the plan looks at, and those missing from the cache. */
  keys: string[]
  needed: string[]
  /** Repertoires of this colour the plan never reaches. */
  offPlan: Repertoire[]
  /**
   * Repertoires reached only through a second answer, e.g. a Scotch prepared
   * against one opponent when your main answer to 1.e4 is the Caro-Kann.
   */
  sideLines: Repertoire[]
  /** Nothing chosen and no repertoire yet. */
  empty: boolean
}

/** Title for a decision without a catalogue entry. */
function decisionTitle(sans: string[], replyName?: string) {
  if (replyName) return `Against ${replyName}`
  const last = sans.at(-1)
  return last ? `Your answer to ${sans.length % 2 === 1 ? `${Math.ceil(sans.length / 2)}.` : `${sans.length / 2}...`}${last}` : 'Your first move'
}

export function buildPlan({ color, reps, choices, explorer }: PlanInput): Plan {
  const keys = new Set<string>()
  const covered: CoveredNode[] = []
  const decisions: DecisionNode[] = []
  const reached = new Set<string>()
  const reachedMain = new Set<string>()
  const starts = reps.map((r) => ({ rep: r.rep, moves: repStart(r.rep).moves }))
  /** Repertoire starts that pass through `path` and continue: the next move of each. */
  const onTheWay = (path: string[]) =>
    starts.filter((s) => s.moves.length > path.length && startsWith(s.moves, path)).map((s) => ({ rep: s.rep, uci: s.moves[path.length] }))

  const walk = (path: string[], sans: string[], fen: string, reach: number | null, counted: boolean, replyName?: string, afterChoice = false): PlanNode => {
    const key = positionKey(fen)
    const base: Base = { key, fen, path, sans, reach, counted }

    const inside = reps.filter((r) => r.graph.depth.has(key))
    if (inside.length) {
      for (const r of inside) {
        reached.add(r.rep.id)
        if (counted) reachedMain.add(r.rep.id)
      }
      const node: CoveredNode = { ...base, kind: 'covered', rep: inside[0].rep, others: inside.slice(1).map((r) => r.rep) }
      if (counted) covered.push(node)
      return node
    }
    if (path.length >= MAX_PLIES) return { ...base, kind: 'stop' }

    if (turnOf(fen) === color) {
      const candidates: Omit<PlannedMove, 'child'>[] = []
      const chosen = choices[key] ? playUci(fen, choices[key]) : null
      if (chosen) candidates.push({ uci: chosen.uci, san: chosen.san, source: 'choice', reps: [] })
      for (const { rep, uci } of onTheWay(path)) {
        const c = candidates.find((x) => x.uci === uci)
        if (c) c.reps.push(rep)
        else candidates.push({ uci, san: playUci(fen, uci)!.san, source: 'repertoire', reps: [rep] })
      }
      if (!candidates.length) {
        const slot = catalogSlot(key)
        keys.add(key)
        // Where each option's defining move is played, for its popularity and score.
        for (const o of slot?.options ?? []) keys.add(startOf(o.startUci.slice(0, -1)).key)
        const node: DecisionNode = { ...base, kind: 'decision', slot, title: slot?.title ?? decisionTitle(sans, replyName) }
        if (counted) decisions.push(node)
        return node
      }
      const moves = candidates.map((c, i): PlannedMove => {
        const played = playUci(fen, c.uci)!
        const child = walk([...path, played.uci], [...sans, played.san], played.fen, reach, counted && i === 0, undefined, c.source === 'choice')
        return { ...c, child }
      })
      return { ...base, kind: 'move', moves }
    }

    keys.add(key)
    const data = explorer.get(key)
    const total = data ? totalGames(data) : 0
    const named = catalogReplies(key)
    const listed = new Map<string, { san: string; share: number | null }>()
    const others: RepliesNode['others'] = []
    if (data) {
      for (const m of data.moves) {
        const share = total ? totalGames(m) / total : 0
        if (share >= MIN_SHARE && (reach === null || reach * share >= MIN_REACH)) listed.set(m.uci, { san: m.san, share })
        else others.push({ uci: m.uci, san: m.san, share })
      }
    } else for (const n of named) listed.set(n.uci, { san: n.san, share: null })
    // Replies leading to one of your repertoires are always shown.
    for (const { uci } of onTheWay(path)) {
      if (listed.has(uci)) continue
      const i = others.findIndex((o) => o.uci === uci)
      const share = i >= 0 ? others.splice(i, 1)[0].share : data ? 0 : null
      listed.set(uci, { san: playUci(fen, uci)!.san, share })
    }

    const replies: Reply[] = [...listed].map(([uci, { share }]) => {
      const played = playUci(fen, uci)!
      const name = named.find((n) => n.uci === played.uci)?.name
      const childReach = reach !== null && share !== null ? reach * share : null
      const child = walk([...path, played.uci], [...sans, played.san], played.fen, childReach, counted, name)
      return { uci: played.uci, san: played.san, name, share, child }
    })
    replies.sort((a, b) => (b.share ?? -1) - (a.share ?? -1))
    return {
      ...base,
      kind: 'replies',
      replies,
      others,
      othersShare: others.reduce((s, o) => s + o.share, 0),
      hasData: !!data,
      afterChoice,
    }
  }

  const root = walk([], [], START_FEN, 1, true)
  decisions.sort((a, b) => (b.reach ?? -1) - (a.reach ?? -1))
  const keyList = [...keys]
  return {
    color,
    root,
    covered,
    coverage: [...covered, ...decisions].some((n) => n.reach === null) ? null : covered.reduce((s, c) => s + c.reach!, 0),
    decisions,
    keys: keyList,
    needed: keyList.filter((k) => !explorer.has(k)),
    offPlan: reps.filter((r) => !reached.has(r.rep.id)).map((r) => r.rep),
    sideLines: reps.filter((r) => reached.has(r.rep.id) && !reachedMain.has(r.rep.id)).map((r) => r.rep),
    empty: !reps.length && !Object.keys(choices).length,
  }
}

/**
 * Overall preparedness of a colour: each covered line weighted by how often it
 * is reached, times its repertoire's preparedness. Null until every score is known.
 */
export function planScore(plan: Plan, scores: Map<string, number>): number | null {
  if (plan.coverage === null) return null
  let s = 0
  for (const c of plan.covered) {
    const score = scores.get(c.rep.id)
    if (score === undefined) return null
    s += (c.reach ?? 0) * score
  }
  return s
}

/** Your score with a move from the explorer's point of view (wins + half the draws). */
export function scoreFor(color: Color, x: { white: number; draws: number; black: number }): number | null {
  const total = totalGames(x)
  if (!total) return null
  return ((color === 'white' ? x.white : x.black) + x.draws / 2) / total
}
