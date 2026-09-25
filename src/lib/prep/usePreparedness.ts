import { useMemo } from 'react'
import type { RepertoireData } from '../../db/useRepertoire'
import { isMyTurn, myMove } from '../chess/graph'
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

export interface PrepState {
  result: PrepResult
  gaps: Gap[]
  branches: Branch[]
  /** Explorer positions still to download. */
  pending: number
  fetchError?: Error
}

/**
 * Preparedness and gaps for a repertoire. Explorer data needed for the
 * calculation is downloaded in the background (throttled) and cached.
 */
export function usePreparedness(
  data: RepertoireData | null | undefined,
  filter: ExplorerFilter | undefined,
  depth: number,
): PrepState | undefined {
  const graph = data?.graph
  const needed = useMemo(() => (graph ? positionsNeedingData(graph, depth) : []), [graph, depth])

  const { cached, pending, fetchError } = useExplorerData(needed, filter)

  return useMemo(() => {
    if (!data || !cached) return undefined
    const now = new Date()
    const recall = new Map<string, number>()
    for (const [k, c] of data.cardMap) recall.set(k, retrievability(c, now))
    const inp: PrepInputs = { graph: data.graph, explorer: cached, recall, depth }
    const result = preparedness(inp)
    const gaps = findGaps(inp)

    // Scores per first opponent reply (e.g. "vs 1...c5").
    const root = data.graph.root
    let branchFrom: string | undefined = root
    if (isMyTurn(data.graph, root)) branchFrom = myMove(data.graph, root)?.toKey
    const branches: Branch[] = []
    const ex = branchFrom ? cached.get(branchFrom) : undefined
    for (const m of branchFrom ? (data.graph.movesFrom.get(branchFrom) ?? []) : []) {
      const games = ex?.moves.find((x) => x.uci === m.uci)
      const share = ex ? (games ? totalGames(games) / Math.max(1, totalGames(ex)) : 0) : null
      const ownBefore = isMyTurn(data.graph, root) ? 1 : 0
      const sub = preparedness({ ...inp, depth: depth - ownBefore }, m.toKey)
      branches.push({ san: m.san, uci: m.uci, toKey: m.toKey, share, score: sub.score })
    }
    branches.sort((a, b) => (b.share ?? 0) - (a.share ?? 0))

    return { result, gaps, branches, pending, fetchError }
  }, [data, cached, depth, pending, fetchError])
}
