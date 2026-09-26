import type { ExplorerData } from '../explorer/explorer'
import { totalGames } from '../explorer/explorer'
import { isMyTurn, myMove, topoOrder, type RepGraph } from '../chess/graph'

/**
 * Preparedness@N: the probability that you play N more moves from the
 * repertoire's starting position while still in preparation you actually
 * remember, when opponents choose their moves with the frequencies found in
 * the opening explorer. What happens before the start (e.g. 1...c5 for a
 * Vienna repertoire) doesn't count.
 *
 *   own move:      P(pos, k) = R(card) × P(child, k − 1)   (0 if no move prepared)
 *   opponent move: P(pos, k) = Σ freq(reply) × P(child, k) (0 for unprepared replies)
 *   k = 0:         P = 1
 *
 * A position no one has played in the database counts as "out of book", i.e.
 * the opponent has left theory and your preparation did its job (P = 1).
 */

export interface PrepInputs {
  graph: RepGraph
  /** Explorer data per position key (opponent-to-move positions are needed). */
  explorer: Map<string, ExplorerData>
  /** Recall probability per own-move position key (0 if never learned). */
  recall: Map<string, number>
  /** Target: number of own moves after the starting position. */
  depth: number
}

export interface PrepResult {
  /** Probability of reaching own move N within remembered preparation. */
  score: number
  /** Expected number of own moves played from remembered preparation (≤ depth). */
  expectedDepth: number
  /** Opponent positions whose explorer data was missing (score assumes even replies). */
  missingData: string[]
}

interface Value {
  p: number
  d: number
}

export function preparedness(inp: PrepInputs, from = inp.graph.root): PrepResult {
  const { graph, explorer, recall } = inp
  const memo = new Map<string, Value>()
  const missing = new Set<string>()

  const value = (key: string, k: number): Value => {
    if (k <= 0) return { p: 1, d: 0 }
    const mk = `${k}|${key}`
    const hit = memo.get(mk)
    if (hit) return hit
    let v: Value
    if (isMyTurn(graph, key)) {
      const m = myMove(graph, key)
      if (!m) v = { p: 0, d: 0 }
      else {
        const r = recall.get(key) ?? 0
        const child = value(m.toKey, k - 1)
        v = { p: r * child.p, d: r * (1 + child.d) }
      }
    } else {
      const prepared = graph.movesFrom.get(key) ?? []
      const data = explorer.get(key)
      if (!data) {
        missing.add(key)
        // Unknown frequencies: assume the prepared replies are equally likely.
        if (!prepared.length) v = { p: 0, d: 0 }
        else {
          const parts = prepared.map((m) => value(m.toKey, k))
          v = {
            p: parts.reduce((s, x) => s + x.p, 0) / parts.length,
            d: parts.reduce((s, x) => s + x.d, 0) / parts.length,
          }
        }
      } else {
        const total = totalGames(data)
        if (total === 0) v = { p: 1, d: k }
        else {
          v = { p: 0, d: 0 }
          for (const m of prepared) {
            const games = data.moves.find((x) => x.uci === m.uci)
            if (!games) continue
            const f = totalGames(games) / total
            const child = value(m.toKey, k)
            v.p += f * child.p
            v.d += f * child.d
          }
        }
      }
    }
    memo.set(mk, v)
    return v
  }

  const v = value(from, inp.depth)
  return { score: v.p, expectedDepth: v.d, missingData: [...missing] }
}

export type GapKind = 'unprepared-reply' | 'line-ends' | 'not-learned' | 'weak'

export interface Gap {
  kind: GapKind
  /** Position where the problem is. */
  key: string
  /** For unprepared replies: the opponent move you have no answer to. */
  uci?: string
  san?: string
  /** How often you reach this problem (0–1), assuming you play your moves. */
  reach: number
  /** reach × how badly it hurts; used for ranking. */
  weight: number
  /** Own moves already played before reaching this position. */
  ownMoves: number
}

/**
 * Lists the leaks in a repertoire ranked by impact: how often the problem
 * position arises (from real opponent frequencies) times how much of your
 * preparation is lost there.
 */
export function findGaps(inp: PrepInputs, minReach = 0.001): Gap[] {
  const { graph, explorer, recall, depth } = inp
  // Reach probability per position with own-move count, accumulated over all paths.
  const reach = new Map<string, { p: number; own: number }>()
  const add = (key: string, p: number, own: number) => {
    const cur = reach.get(key)
    if (cur) {
      cur.p += p
      cur.own = Math.min(cur.own, own)
    } else reach.set(key, { p, own })
  }
  add(graph.root, 1, 0)
  const gaps: Gap[] = []

  for (const key of topoOrder(graph)) {
    const r = reach.get(key)
    if (!r || r.p < minReach || r.own >= depth) continue
    if (isMyTurn(graph, key)) {
      const m = myMove(graph, key)
      if (!m) {
        gaps.push({ kind: 'line-ends', key, reach: r.p, weight: r.p, ownMoves: r.own })
        continue
      }
      const rec = recall.get(key) ?? 0
      if (rec < 0.9) {
        const kind: GapKind = rec === 0 ? 'not-learned' : 'weak'
        gaps.push({ kind, key, reach: r.p, weight: r.p * (1 - rec), ownMoves: r.own })
      }
      add(m.toKey, r.p, r.own + 1)
    } else {
      const data = explorer.get(key)
      const prepared = graph.movesFrom.get(key) ?? []
      if (!prepared.length) {
        // The line stops here: whatever the opponent plays, you're on your own.
        if (!data || totalGames(data) > 0) gaps.push({ kind: 'line-ends', key, reach: r.p, weight: r.p, ownMoves: r.own })
        continue
      }
      if (!data) {
        for (const m of prepared) add(m.toKey, r.p / prepared.length, r.own)
        continue
      }
      const total = totalGames(data)
      if (total === 0) continue
      for (const mv of data.moves) {
        const f = totalGames(mv) / total
        const m = prepared.find((x) => x.uci === mv.uci)
        if (m) add(m.toKey, r.p * f, r.own)
        else if (r.p * f >= minReach)
          gaps.push({ kind: 'unprepared-reply', key, uci: mv.uci, san: mv.san, reach: r.p * f, weight: r.p * f, ownMoves: r.own })
      }
    }
  }
  return gaps.sort((a, b) => b.weight - a.weight || a.ownMoves - b.ownMoves)
}

/**
 * Preparedness from a position inside the repertoire (e.g. where a chapter
 * starts), with the target depth reduced by the own moves already played to
 * get there. `ownBefore` counts those moves.
 */
export function preparednessFrom(inp: PrepInputs, key: string, ownBefore: number): PrepResult {
  return preparedness({ ...inp, depth: Math.max(1, inp.depth - ownBefore) }, key)
}

/** Own moves among the plies `from`…end of a path from the initial position. */
export function ownMovesIn(path: string[], from: number, color: 'white' | 'black'): number {
  let n = 0
  for (let i = from; i < path.length; i++) if ((i % 2 === 0) === (color === 'white')) n++
  return n
}

/** Opponent-to-move positions whose explorer data is needed, within the depth target. */
export function positionsNeedingData(graph: RepGraph, depth: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (key: string, own: number) => {
    if (own >= depth || seen.has(`${own}|${key}`)) return
    seen.add(`${own}|${key}`)
    if (isMyTurn(graph, key)) {
      const m = myMove(graph, key)
      if (m) walk(m.toKey, own + 1)
    } else {
      if (!out.includes(key)) out.push(key)
      for (const m of graph.movesFrom.get(key) ?? []) walk(m.toKey, own)
    }
  }
  walk(graph.root, 0)
  return out
}
