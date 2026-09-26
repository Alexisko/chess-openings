import type { RepMove, Repertoire } from '../../db/schema'
import { buildGraph, myMove, pathTo, type RepGraph } from './graph'
import { repStart } from './start'

/**
 * Transpositions across repertoires: a line of one repertoire can reach a
 * position that another repertoire of the same colour continues from (e.g.
 * the Vienna 2...Nf6 3.Bc4 and the Bishop's Opening 2...Nf6 3.Nc3). Inside one
 * repertoire the graph handles this; across repertoires it is only pointed
 * out, each repertoire keeping its own moves and cards.
 */
export interface CrossRef {
  rep: Repertoire
  graph: RepGraph
}

/** Repertoires per position they continue from (reachable, with a move prepared there), oldest first. */
export type CrossIndex = Map<string, CrossRef[]>

export function crossIndex(reps: { rep: Repertoire; moves: RepMove[] }[]): CrossIndex {
  const index: CrossIndex = new Map()
  const sorted = [...reps].sort((a, b) => a.rep.createdAt - b.rep.createdAt)
  for (const { rep, moves } of sorted) {
    const graph = buildGraph(moves, rep.color, repStart(rep).key)
    const ref = { rep, graph }
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

