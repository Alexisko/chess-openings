import type { Game } from '../../db/schema'
import { formatMoves, type Color } from '../chess/position'
import type { Naming } from '../openings/naming'
import { shortName } from '../openings/names'
import { gameKeys, scoreOf, type RepIndex } from './analyze'
import { moveMark, wdlOf, type Wdl } from './gameTree'

// A "tech tree" of your games with one colour: the positions where your games
// branch, from the initial position on. Chains of moves every game (that is
// still shown) agrees on are collapsed into one edge, and branches with fewer
// than `minGames` games are left out.

/**
 * How the moves leading to a node compare with your repertoires (the worst one wins):
 * - deviated:   you played another move than your repertoire's
 * - unanswered: the opponent played a move your repertoire has no answer to
 * - right:      every move covered by a repertoire was the repertoire's
 * - none:       no repertoire covers these moves
 */
export type MapMark = 'deviated' | 'unanswered' | 'right' | 'none'

export interface MapNode {
  /** Moves (UCI from the initial position) to this position, and their SAN. */
  path: string[]
  sans: string[]
  /** Ply of the parent node: the edge to this node shows the moves `sans.slice(from)`. */
  from: number
  games: Game[]
  wdl: Wdl
  score: number
  mark: MapMark
  /** Deepest standard opening name reached so far. */
  opening?: string
  /** The opening name, if it changed on the way from the parent (without the part they share). */
  newName?: string
  children: MapNode[]
  /** Games that went into branches too rare to show (or ended) between this node and its children. */
  rare: number
}

const WORST: MapMark[] = ['deviated', 'unanswered', 'right', 'none']

function segmentMark(keys: string[], path: string[], from: number, color: Color, reps: RepIndex[]): MapMark {
  let best: MapMark = 'none'
  for (let ply = from; ply < path.length; ply++) {
    const m = moveMark(keys[ply], path[ply], color, reps)
    const mark: MapMark = m === 'rep' ? 'right' : m === 'deviates' ? 'deviated' : m
    if (WORST.indexOf(mark) < WORST.indexOf(best)) best = mark
  }
  return best
}

/**
 * The map of a set of games you played with `color`. Games are followed move
 * by move (not by position), so every node's games are a subset of its
 * parent's. A node is where at least two shown branches split, or where the
 * shown games stop agreeing (a leaf).
 */
export function buildOpeningMap(
  games: Game[],
  color: Color,
  reps: RepIndex[],
  naming: Pick<Naming, 'opening'> | undefined,
  minGames: number,
): MapNode | undefined {
  if (!games.length) return undefined
  const mine = reps.filter((r) => r.rep.color === color)

  const make = (group: Game[], ply: number, from: number, parent?: MapNode): MapNode => {
    const g0 = group[0]
    const path = g0.moves.slice(0, ply)
    const keys = gameKeys(g0)
    let opening = parent?.opening
    if (naming)
      for (let p = ply; p >= (parent ? from + 1 : 0); p--) {
        const name = naming.opening(keys[p])?.name
        if (name) {
          opening = name
          break
        }
      }
    const node: MapNode = {
      path,
      sans: g0.sans.slice(0, ply),
      from,
      games: group,
      wdl: wdlOf(group),
      score: scoreOf(group),
      mark: segmentMark(keys, path, from, color, mine),
      opening,
      newName: opening && opening !== parent?.opening ? shortName(opening, parent?.opening) : undefined,
      children: [],
      rare: 0,
    }
    // Each shown move from here leads to the next node of its branch.
    node.children = splitGames(group, ply, minGames).map((l) => {
      const c = chainEnd(l, ply + 1, minGames)
      return make(c.games, c.ply, ply, node)
    })
    node.rare = group.length - node.children.reduce((s, c) => s + c.games.length, 0)
    return node
  }

  return make(games, 0, 0)
}

/** The games grouped by their move at `ply`, keeping groups of at least `minGames`, largest first. */
function splitGames(games: Game[], ply: number, minGames: number): Game[][] {
  const byMove = new Map<string, Game[]>()
  for (const g of games) {
    const uci = g.moves[ply]
    if (uci === undefined) continue
    const list = byMove.get(uci)
    if (list) list.push(g)
    else byMove.set(uci, [g])
  }
  return [...byMove.values()].filter((l) => l.length >= minGames).sort((a, b) => b.length - a.length)
}

/** From `ply` on, follows the games while a single shown move continues; returns where they split or stop. */
function chainEnd(games: Game[], ply: number, minGames: number): { games: Game[]; ply: number } {
  let current = games
  let p = ply
  for (;;) {
    const shown = splitGames(current, p, minGames)
    if (shown.length !== 1) return { games: current, ply: p }
    current = shown[0]
    p++
  }
}

export function mapNodes(root: MapNode): MapNode[] {
  const out: MapNode[] = []
  const walk = (n: MapNode) => {
    out.push(n)
    n.children.forEach(walk)
  }
  walk(root)
  return out
}

const leafCount = (n: MapNode): number => (n.children.length ? n.children.reduce((s, c) => s + leafCount(c), 0) : 1)

/** Minimum branch sizes offered, smallest first. */
export const MAP_DETAILS = [2, 3, 5, 10, 20, 50]

/** The most detailed setting whose map stays readable (at most `maxLeaves` lines). */
export function defaultMinGames(games: Game[], color: Color, reps: RepIndex[], maxLeaves = 30): number {
  for (const min of MAP_DETAILS) {
    const root = buildOpeningMap(games, color, reps, undefined, min)
    if (!root || leafCount(root) <= maxLeaves) return min
  }
  return MAP_DETAILS.at(-1)!
}

/** The moves of the edge into a node ("3. f4 d5 4. fxe5"). */
export const edgeMoves = (n: MapNode) => formatMoves(n.sans.slice(n.from), n.from)

export interface PlacedNode {
  node: MapNode
  parent?: PlacedNode
  x: number
  y: number
  r: number
  /** Room for the edge labels into this node. */
  labelX: number
  labelWidth: number
}

export interface MapLayout {
  nodes: PlacedNode[]
  width: number
  height: number
}

export const MAP_ROW = 46

/**
 * Places the nodes: one column per branching level, as wide as its widest
 * label (within limits), and one row per leaf. A node sits on the row of its
 * most played child, so the main line of each branch runs straight across and
 * sidelines drop below it.
 */
export function layoutMap(
  root: MapNode,
  measure: (node: MapNode) => number,
  { row = MAP_ROW, minCol = 80, maxCol = 210, pad = 22, fit = 0 } = {},
): MapLayout {
  const total = root.games.length
  const radius = (n: MapNode) => 5 + 11 * Math.sqrt(n.games.length / total)
  // Column widths per level.
  const widths: number[] = [0]
  const levelOf = new Map<MapNode, number>()
  const visit = (n: MapNode, level: number) => {
    levelOf.set(n, level)
    if (level > 0) widths[level] = Math.max(widths[level] ?? minCol, Math.min(maxCol, measure(n) + 2 * radius(n) + 26))
    n.children.forEach((c) => visit(c, level + 1))
  }
  visit(root, 0)
  // Spread the columns over the width available (`fit`), up to half as wide again.
  const natural = widths.reduce((a, b) => a + b, 0) + pad + radius(root) + 40
  const stretch = Math.min(1.5, Math.max(1, fit / natural))
  const xs = [pad + radius(root)]
  for (let l = 1; l < widths.length; l++) xs[l] = xs[l - 1] + widths[l] * stretch

  const nodes: PlacedNode[] = []
  let rows = 0
  const place = (n: MapNode, parent?: PlacedNode): PlacedNode => {
    const level = levelOf.get(n)!
    const p: PlacedNode = { node: n, parent, x: xs[level], y: 0, r: radius(n), labelX: 0, labelWidth: 0 }
    nodes.push(p)
    if (!n.children.length) p.y = pad + (rows++ + 0.5) * row
    else {
      const kids = n.children.map((c) => place(c, p))
      p.y = kids[0].y
    }
    return p
  }
  place(root)
  for (const p of nodes) {
    if (!p.parent) continue
    // Straight on from the parent, or after the bend below it.
    p.labelX = p.y === p.parent.y ? p.parent.x + p.parent.r + 11 : p.parent.x + 14
    p.labelWidth = Math.max(0, p.x - p.r - 6 - p.labelX)
  }
  return { nodes, width: Math.ceil(xs.at(-1)! + 40), height: pad * 2 + rows * row }
}
