import { pct } from '../../components/format'
import type { Repertoire } from '../../db/schema'
import { formatMoves, replay, type Color } from '../../lib/chess/position'
import type { CoveredNode, DecisionNode, MoveNode, PlanNode, PlannedMove, RepScore } from '../../lib/plan/plan'
import type { PrepGap } from '../../lib/prep/usePreparedness'
import { builderUrl, trainUrl } from '../../lib/routes'

/** A reply of the opponent that needs an answer: one of your repertoires gives it, or it is still to choose. */
export type SlotNode = CoveredNode | DecisionNode

/** What a repertoire line knows about itself, reported by the row that computes it. */
export interface SlotFacts {
  score: RepScore
  /** Moves due for review (none while the repertoire is paused). */
  due: number
  /** Moves never studied. */
  fresh: number
  /** The repertoire has no moves yet. */
  empty: boolean
  /** Gaps inside this line, biggest first. */
  gaps: PrepGap[]
}

export interface Slot {
  id: string
  node: SlotNode
  /** Share of all games of this colour that reach it (null without opponent statistics). */
  reach: number | null
  facts?: SlotFacts
  /**
   * Share of all games that leave your preparation here before your N-th move:
   * because nothing is prepared (`notBuilt`) or because you would forget it
   * (`forgotten`). An open choice loses all of its games.
   */
  cost: { notBuilt: number; forgotten: number; total: number } | null
}

/** A slot's id, also its `at` in the URL: its moves, or "start" for your first move. */
export const slotId = (path: string[]) => (path.length ? path.join(',') : 'start')

/** The replies the plan needs an answer to, answered or not, in the plan's order. */
export function slotsOf(root: PlanNode): SlotNode[] {
  const out: SlotNode[] = []
  const walk = (n: PlanNode) => {
    if (n.kind === 'covered' || n.kind === 'decision') {
      if (n.counted) out.push(n)
    } else if (n.kind === 'move') walk(n.moves[0].child)
    else if (n.kind === 'replies') for (const r of n.replies) walk(r.child)
  }
  walk(root)
  return out
}

/** The moves you chose in the plan (not set by a repertoire), along your main answers. */
export function choicesOf(root: PlanNode) {
  const out: { node: MoveNode; move: PlannedMove }[] = []
  const walk = (n: PlanNode) => {
    if (n.kind === 'move') {
      if (n.moves[0].source === 'choice') out.push({ node: n, move: n.moves[0] })
      walk(n.moves[0].child)
    } else if (n.kind === 'replies') for (const r of n.replies) walk(r.child)
  }
  walk(root)
  return out
}

export function costOf(node: SlotNode, facts: SlotFacts | undefined): Slot['cost'] {
  if (node.reach === null) return null
  if (node.kind === 'decision') return { notBuilt: node.reach, forgotten: 0, total: node.reach }
  if (!facts) return null
  const notBuilt = node.reach * (1 - facts.score.built)
  const forgotten = node.reach * Math.max(0, facts.score.built - facts.score.remembered)
  return { notBuilt, forgotten, total: notBuilt + forgotten }
}

/**
 * Slots with their cost, most costly first once every line is measured.
 * Until then (or without opponent statistics) the most frequent come first,
 * so rows don't jump around while scores arrive one by one.
 */
export function rankSlots(nodes: SlotNode[], facts: Map<string, SlotFacts>): Slot[] {
  const slots = nodes.map((node): Slot => {
    const f = node.kind === 'covered' ? facts.get(node.key) : undefined
    return { id: slotId(node.path), node, reach: node.reach, facts: f, cost: costOf(node, f) }
  })
  const measured = slots.every((s) => s.cost !== null)
  return slots.sort((a, b) =>
    measured ? b.cost!.total - a.cost!.total : (b.reach ?? -1) - (a.reach ?? -1),
  )
}

/** The opponent's move that makes this reply a slot ("1…e5", "2.c4"), or null at the start. */
export function replyLabel(sans: string[], color: Color) {
  for (let i = sans.length - 1; i >= 0; i--) {
    const theirs = color === 'white' ? i % 2 === 1 : i % 2 === 0
    if (theirs) return formatMoves([sans[i]], i)
  }
  return null
}

/** "1. e4 c6" with the last move apart, numbered only when it starts a move pair. */
export function splitLast(sans: string[]) {
  const ply = sans.length - 1
  const before = formatMoves(sans.slice(0, -1))
  const last = ply % 2 === 1 && before ? sans[ply] : formatMoves([sans[ply]], ply)
  return { before, last }
}

export type ActionKind = 'review' | 'build' | 'reply' | 'extend'

export interface SlotAction {
  kind: ActionKind
  to: string
  /** The due count, or the move it is about. */
  detail?: string
  title: string
}

/** A gap is offered as the next step when at least this share of the repertoire's games reach it. */
export const MIN_GAP = 0.02

/** What to do next in a repertoire line: review what's due, else fill its biggest gap. */
export function slotAction(rep: Repertoire, facts: SlotFacts | undefined): SlotAction | null {
  if (!facts || rep.paused) return null
  if (facts.due)
    return {
      kind: 'review',
      to: trainUrl('review', { repId: rep.id }),
      detail: String(facts.due),
      title: `Review the ${facts.due} ${facts.due === 1 ? 'move' : 'moves'} due in ${rep.name}`,
    }
  if (facts.empty) return { kind: 'build', to: builderUrl(rep.id, []), title: `Add the first moves of ${rep.name}` }
  const gap = facts.gaps.find((g) => isBuildGap(g) && g.reach >= MIN_GAP)
  return gap ? gapAction(gap) : null
}

/** A gap to fill in the builder: an opponent move without an answer, or a line that stops too early. */
export function gapAction(gap: PrepGap): SlotAction | null {
  const sans = replay(gap.path).map((m) => m.san)
  if (gap.kind === 'unprepared-reply' && gap.uci && gap.san)
    return {
      kind: 'reply',
      to: builderUrl(gap.rep.id, [...gap.path, gap.uci]),
      detail: formatMoves([gap.san], gap.path.length),
      title: `No answer prepared to ${formatMoves([...sans, gap.san])}`,
    }
  if (gap.kind === 'line-ends' && sans.length)
    return {
      kind: 'extend',
      to: builderUrl(gap.rep.id, gap.path),
      detail: formatMoves(sans.slice(-1), sans.length - 1),
      title: `The line ${formatMoves(sans)} stops too early`,
    }
  return null
}

/** Gaps you fix by building, not by training. */
export const isBuildGap = (g: PrepGap) => g.kind === 'unprepared-reply' || g.kind === 'line-ends'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Squarified treemap: lays out values as rectangles filling `w`×`h`, each
 * with an area proportional to its value and as close to square as possible.
 */
export function squarify<T>(items: { value: number; item: T }[], w: number, h: number): (Rect & { item: T })[] {
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0)
  if (!total || w <= 0 || h <= 0) return []
  const scale = (w * h) / total
  const nodes = items
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((i) => ({ item: i.item, area: i.value * scale }))
  const out: (Rect & { item: T })[] = []
  let x = 0
  let y = 0
  let rw = w
  let rh = h
  const worst = (row: typeof nodes, side: number) => {
    const s = row.reduce((t, n) => t + n.area, 0)
    const max = Math.max(...row.map((n) => n.area))
    const min = Math.min(...row.map((n) => n.area))
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min))
  }
  const place = (row: typeof nodes) => {
    const s = row.reduce((t, n) => t + n.area, 0)
    if (rw >= rh) {
      const cw = s / rh
      let cy = y
      for (const n of row) {
        const nh = n.area / cw
        out.push({ x, y: cy, w: cw, h: nh, item: n.item })
        cy += nh
      }
      x += cw
      rw -= cw
    } else {
      const ch = s / rw
      let cx = x
      for (const n of row) {
        const nw = n.area / ch
        out.push({ x: cx, y, w: nw, h: ch, item: n.item })
        cx += nw
      }
      y += ch
      rh -= ch
    }
  }
  let row: typeof nodes = []
  for (const n of nodes) {
    const side = Math.min(rw, rh)
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n)
    else {
      place(row)
      row = [n]
    }
  }
  if (row.length) place(row)
  return out
}

/** "13.2%": shares of games, with one decimal under 10%. */
export const share = (x: number) => pct(x, x < 0.1 ? 1 : 0)
