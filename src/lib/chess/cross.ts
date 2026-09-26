import type { Card as FsrsCard } from 'ts-fsrs'
import type { Card, RepMove, Repertoire } from '../../db/schema'
import { buildGraph, myMove, pathTo, type RepGraph } from './graph'
import { repStart } from './start'

/**
 * Transpositions across repertoires: a line of one repertoire can reach a
 * position that another repertoire of the same colour continues from (e.g.
 * the Vienna 2...Nf6 3.Bc4 and the Bishop's Opening 2...Nf6 3.Nc3). Inside one
 * repertoire the graph handles this; across repertoires each repertoire keeps
 * its own moves and cards: the join is pointed out, and preparedness follows
 * into the other repertoire (see followInto).
 */
export interface CrossRef {
  rep: Repertoire
  graph: RepGraph
  /** FSRS card per position key. */
  cards: Map<string, FsrsCard>
}

/** Repertoires per position they continue from (reachable, with a move prepared there), oldest first. */
export type CrossIndex = Map<string, CrossRef[]>

export function crossIndex(reps: { rep: Repertoire; moves: RepMove[]; cards?: Card[] }[]): CrossIndex {
  const index: CrossIndex = new Map()
  const sorted = [...reps].sort((a, b) => a.rep.createdAt - b.rep.createdAt)
  for (const { rep, moves, cards = [] } of sorted) {
    const graph = buildGraph(moves, rep.color, repStart(rep).key)
    const ref = { rep, graph, cards: new Map(cards.map((c) => [c.positionKey, c.fsrs])) }
    for (const key of graph.order) {
      if (!graph.movesFrom.get(key)?.length) continue
      const list = index.get(key)
      if (list) list.push(ref)
      else index.set(key, [ref])
    }
  }
  return index
}

/** Other repertoires continuing from a position. */
export const crossAt = (index: CrossIndex | undefined, key: string, repId: string): CrossRef[] =>
  index?.get(key)?.filter((r) => r.rep.id !== repId) ?? []

/** Moves (UCI, from the initial position) to a position along another repertoire's own path. */
export const crossPath = (ref: CrossRef, key: string): string[] => [
  ...repStart(ref.rep).moves,
  ...pathTo(ref.graph, key).map((m) => m.uci),
]

/** The move another repertoire plays in a position, if it is the owner's turn there. */
export const crossMove = (ref: CrossRef, key: string): RepMove | undefined => myMove(ref.graph, key)

/**
 * Other repertoires a move enters: they continue from the position it reaches
 * but not from the one before, so a shared stretch of moves is flagged once.
 */
export function crossEntering(index: CrossIndex | undefined, fromKey: string | undefined, toKey: string, repId: string): CrossRef[] {
  const before = new Set(fromKey === undefined ? [] : crossAt(index, fromKey, repId).map((r) => r.rep.id))
  return crossAt(index, toKey, repId).filter((r) => !before.has(r.rep.id))
}

/** Every repertoire in the index, by id. */
export function crossReps(index: CrossIndex | undefined): Map<string, CrossRef> {
  const out = new Map<string, CrossRef>()
  for (const refs of index?.values() ?? []) for (const r of refs) out.set(r.rep.id, r)
  return out
}

/**
 * A repertoire's graph, extended where its lines stop but another repertoire
 * goes on: such a position takes that repertoire's moves (the oldest one's if
 * several), and so on from there, back to this repertoire's own moves when a
 * line returns to them. Moves keep their repertoireId, so every position can
 * be traced to the repertoire it belongs to. `cards` holds the other
 * repertoires' cards for the positions borrowed. Only for measuring
 * preparedness: training and the builder use the repertoire's own graph.
 */
export function followInto(
  graph: RepGraph,
  repId: string,
  index: CrossIndex | undefined,
): { graph: RepGraph; cards: Map<string, FsrsCard> } {
  const cards = new Map<string, FsrsCard>()
  const moves: RepMove[] = []
  const seen = new Set([graph.root])
  const queue = [graph.root]
  let borrowed = false
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i]
    let out = graph.movesFrom.get(key) ?? []
    if (!out.length) {
      const ref = crossAt(index, key, repId)[0]
      if (ref) {
        borrowed = true
        out = ref.graph.movesFrom.get(key) ?? []
        const card = ref.cards.get(key)
        if (card) cards.set(key, card)
      }
    }
    for (const m of out) {
      moves.push(m)
      if (!seen.has(m.toKey)) {
        seen.add(m.toKey)
        queue.push(m.toKey)
      }
    }
  }
  return borrowed ? { graph: buildGraph(moves, graph.color, graph.root), cards } : { graph, cards }
}

/** The repertoire a position belongs to in a followed graph: the one with moves there, else the one whose move reached it. */
export function ownerAt(graph: RepGraph, key: string): string | undefined {
  return graph.movesFrom.get(key)?.[0]?.repertoireId ?? graph.parent.get(key)?.repertoireId
}
