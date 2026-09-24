import type { RepMove } from '../../db/schema'
import { positionKey, START_FEN, turnOf, type Color } from './position'

export const ROOT_KEY = positionKey(START_FEN)

/**
 * A repertoire is a directed graph of positions. Transpositions make it a DAG:
 * the same position can be reached by several move orders.
 *
 * For learning, the graph is turned into a tree. Each position gets one
 * canonical path from the root: the shortest, ties broken by the move added
 * first. A move that reaches an already-reached position by another route
 * *cuts* the line there and is marked as a transposition.
 */
export interface RepGraph {
  color: Color
  movesFrom: Map<string, RepMove[]>
  /** Canonical incoming move for every reachable position (root excluded). */
  parent: Map<string, RepMove>
  /** Plies from the root along the canonical path. */
  depth: Map<string, number>
  /** Moves that lead to a position already reached another way. */
  transpositions: Set<string>
  /** Reachable positions in BFS order (root first). */
  order: string[]
}

export function buildGraph(moves: RepMove[], color: Color): RepGraph {
  const movesFrom = new Map<string, RepMove[]>()
  const sorted = [...moves].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  for (const m of sorted) {
    const list = movesFrom.get(m.fromKey)
    if (list) list.push(m)
    else movesFrom.set(m.fromKey, [m])
  }

  const parent = new Map<string, RepMove>()
  const depth = new Map<string, number>([[ROOT_KEY, 0]])
  const transpositions = new Set<string>()
  const order = [ROOT_KEY]
  for (let i = 0; i < order.length; i++) {
    const key = order[i]
    for (const m of movesFrom.get(key) ?? []) {
      if (depth.has(m.toKey)) {
        transpositions.add(m.id)
        continue
      }
      depth.set(m.toKey, depth.get(key)! + 1)
      parent.set(m.toKey, m)
      order.push(m.toKey)
    }
  }
  return { color, movesFrom, parent, depth, transpositions, order }
}

export function isMyTurn(g: RepGraph, key: string): boolean {
  return turnOf(key) === g.color
}

/** The owner's move in a position, if any (at most one by construction). */
export function myMove(g: RepGraph, key: string): RepMove | undefined {
  if (!isMyTurn(g, key)) return undefined
  return g.movesFrom.get(key)?.[0]
}

/** Canonical moves from the root to a position. */
export function pathTo(g: RepGraph, key: string): RepMove[] {
  const path: RepMove[] = []
  let cur = key
  while (cur !== ROOT_KEY) {
    const m = g.parent.get(cur)
    if (!m) return []
    path.push(m)
    cur = m.fromKey
  }
  return path.reverse()
}

export interface Line {
  /** Stable id: the key of the final position (or the transposing move id). */
  id: string
  moves: RepMove[]
  /** Positions in this line where the owner has to find a move. */
  cardKeys: string[]
  end: 'leaf' | 'transposition'
  /** For transposition endings, the position the line joins. */
  transposesTo?: string
}

/**
 * All learnable lines: root-to-leaf paths of the canonical tree. A line that
 * reaches a transposition stops there.
 */
export function enumerateLines(g: RepGraph): Line[] {
  const lines: Line[] = []
  const walk = (key: string, path: RepMove[]) => {
    const out = g.movesFrom.get(key) ?? []
    const tree = out.filter((m) => !g.transpositions.has(m.id))
    for (const m of out) {
      if (g.transpositions.has(m.id)) lines.push(makeLine([...path, m], 'transposition', m.toKey, m.id))
    }
    if (tree.length === 0) {
      if (path.length > 0 && !out.length) lines.push(makeLine(path, 'leaf'))
      return
    }
    for (const m of tree) walk(m.toKey, [...path, m])
  }
  walk(ROOT_KEY, [])
  return lines
}

function makeLine(moves: RepMove[], end: Line['end'], transposesTo?: string, id?: string): Line {
  const cardKeys = moves.filter((m) => m.byMe).map((m) => m.fromKey)
  return {
    id: id ?? moves[moves.length - 1].toKey,
    moves,
    cardKeys,
    end,
    transposesTo,
  }
}

/** Positions reachable from the root where the owner has a move (= card positions). */
export function cardPositions(g: RepGraph): string[] {
  return g.order.filter((k) => myMove(g, k))
}

/**
 * Moves that disappear when `removeIds` are deleted: those moves plus every
 * move left unreachable from the root. Positions still reachable through a
 * transposition are kept.
 */
export function movesToRemove(moves: RepMove[], color: Color, removeIds: Set<string>): RepMove[] {
  const kept = moves.filter((m) => !removeIds.has(m.id))
  const g = buildGraph(kept, color)
  return moves.filter((m) => removeIds.has(m.id) || !g.depth.has(m.fromKey))
}

/**
 * Reachable positions ordered so every position comes after all positions
 * with a move into it (needed to sum probabilities over transpositions).
 * Positions caught in a repetition cycle are appended in BFS order.
 */
export function topoOrder(g: RepGraph): string[] {
  const reachable = new Set(g.order)
  const indegree = new Map<string, number>(g.order.map((k) => [k, 0]))
  for (const key of g.order)
    for (const m of g.movesFrom.get(key) ?? []) if (reachable.has(m.toKey)) indegree.set(m.toKey, indegree.get(m.toKey)! + 1)
  const queue = g.order.filter((k) => indegree.get(k) === 0)
  const out: string[] = []
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i]
    out.push(key)
    for (const m of g.movesFrom.get(key) ?? []) {
      const n = indegree.get(m.toKey)
      if (n === undefined) continue
      indegree.set(m.toKey, n - 1)
      if (n - 1 === 0) queue.push(m.toKey)
    }
  }
  if (out.length < g.order.length) {
    const done = new Set(out)
    out.push(...g.order.filter((k) => !done.has(k)))
  }
  return out
}
