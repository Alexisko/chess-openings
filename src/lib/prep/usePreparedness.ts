import { useMemo } from 'react'
import type { Repertoire } from '../../db/schema'
import { useCrossIndex, type RepertoireData } from '../../db/useRepertoire'
import { crossPath, crossReps, followInto, ownerAt } from '../chess/cross'
import { isMyTurn, myMove, pathTo } from '../chess/graph'
import { repStart } from '../chess/start'
import { totalGames, useExplorerData, type ExplorerFilter } from '../explorer'
import { retrievability } from '../srs/scheduler'
import { findGaps, positionsNeedingData, preparedness, type Gap, type PrepInputs, type PrepResult } from './preparedness'

export interface Branch {
  /** The opponent's reply this branch starts with. */
  san: string
  uci: string
  toKey: string
  /** Share of games with this reply (null until explorer data is available). */
  share: number | null
  score: number
}

/** A gap, with the repertoire it is in (another one, when a line goes on there). */
export interface PrepGap extends Gap {
  rep: Repertoire
  /** Moves (UCI, from the initial position) to the gap's position, along that repertoire's own path. */
  path: string[]
}

export interface PrepState {
  result: PrepResult
  gaps: PrepGap[]
  /** What the scores were computed from: the graph followed into other repertoires, with their recall. */
  inputs: PrepInputs
  branches: Branch[]
  /** Explorer positions still to download. */
  pending: number
  fetchError?: Error
}

/**
 * Preparedness and gaps for a repertoire. Where a line stops but another
 * repertoire of the same colour goes on (a transposition), preparedness
 * follows into it, with that repertoire's moves and recall. Explorer data
 * needed for the calculation is downloaded in the background (throttled) and
 * cached.
 */
export function usePreparedness(
  data: RepertoireData | null | undefined,
  filter: ExplorerFilter | undefined,
  depth: number,
): PrepState | undefined {
  const cross = useCrossIndex(data?.rep)
  const followed = useMemo(() => (data && cross ? followInto(data.graph, data.rep.id, cross) : undefined), [data, cross])
  const graph = followed?.graph
  const needed = useMemo(() => (graph ? positionsNeedingData(graph, depth) : []), [graph, depth])

  const { cached, pending, fetchError } = useExplorerData(needed, filter)

  return useMemo(() => {
    if (!data || !cached || !followed || !graph) return undefined
    const now = new Date()
    const recall = new Map<string, number>()
    for (const [k, c] of [...data.cardMap, ...followed.cards]) recall.set(k, retrievability(c, now))
    const inp: PrepInputs = { graph, explorer: cached, recall, depth }
    const result = preparedness(inp)
    const others = crossReps(cross)
    const start = repStart(data.rep).moves
    const gaps = findGaps(inp).map((g): PrepGap => {
      const other = others.get(ownerAt(graph, g.key) ?? data.rep.id)
      return other
        ? { ...g, rep: other.rep, path: crossPath(other, g.key) }
        : { ...g, rep: data.rep, path: [...start, ...pathTo(data.graph, g.key).map((m) => m.uci)] }
    })

    // Scores per first opponent reply (e.g. "vs 1...c5").
    const root = graph.root
    let branchFrom: string | undefined = root
    if (isMyTurn(graph, root)) branchFrom = myMove(graph, root)?.toKey
    const branches: Branch[] = []
    const ex = branchFrom ? cached.get(branchFrom) : undefined
    for (const m of branchFrom ? (graph.movesFrom.get(branchFrom) ?? []) : []) {
      const games = ex?.moves.find((x) => x.uci === m.uci)
      const share = ex ? (games ? totalGames(games) / Math.max(1, totalGames(ex)) : 0) : null
      const ownBefore = isMyTurn(graph, root) ? 1 : 0
      const sub = preparedness({ ...inp, depth: depth - ownBefore }, m.toKey)
      branches.push({ san: m.san, uci: m.uci, toKey: m.toKey, share, score: sub.score })
    }
    branches.sort((a, b) => (b.share ?? 0) - (a.share ?? 0))

    return { result, gaps, inputs: inp, branches, pending, fetchError }
  }, [data, cached, depth, pending, fetchError, followed, graph, cross])
}
