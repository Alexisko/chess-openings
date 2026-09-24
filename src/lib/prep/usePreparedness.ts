import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../../db/schema'
import type { RepertoireData } from '../../db/useRepertoire'
import { isMyTurn, myMove, ROOT_KEY } from '../chess/graph'
import { keyToFen } from '../chess/position'
import { AuthRequiredError, explorer, filterHash, totalGames, type ExplorerData, type ExplorerFilter } from '../explorer'
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
  const hash = filter ? filterHash(filter) : ''
  const needed = useMemo(() => (graph ? positionsNeedingData(graph, depth) : []), [graph, depth])

  const cached = useLiveQuery(
    async () => {
      const rows = await db.explorerCache.bulkGet(needed.map((k) => `${hash}|${k}`))
      const map = new Map<string, ExplorerData>()
      rows.forEach((r, i) => r && map.set(needed[i], r.data as ExplorerData))
      return map
    },
    [needed, hash],
  )

  const [fetchError, setFetchError] = useState<Error>()
  useEffect(() => {
    if (!filter || !cached) return
    const missing = needed.filter((k) => !cached.has(k))
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      for (const key of missing) {
        if (cancelled) return
        try {
          await explorer.get(keyToFen(key), filter)
          setFetchError(undefined)
        } catch (e) {
          setFetchError(e as Error)
          if (e instanceof AuthRequiredError) return
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // Re-run only when the set of needed positions or the filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed, hash, cached === undefined])

  return useMemo(() => {
    if (!data || !cached) return undefined
    const now = new Date()
    const recall = new Map<string, number>()
    for (const [k, c] of data.cardMap) recall.set(k, retrievability(c, now))
    const inp: PrepInputs = { graph: data.graph, explorer: cached, recall, depth }
    const result = preparedness(inp)
    const gaps = findGaps(inp)

    // Scores per first opponent reply (e.g. "vs 1...c5").
    let branchFrom: string | undefined = ROOT_KEY
    if (isMyTurn(data.graph, ROOT_KEY)) branchFrom = myMove(data.graph, ROOT_KEY)?.toKey
    const branches: Branch[] = []
    const ex = branchFrom ? cached.get(branchFrom) : undefined
    for (const m of branchFrom ? (data.graph.movesFrom.get(branchFrom) ?? []) : []) {
      const games = ex?.moves.find((x) => x.uci === m.uci)
      const share = ex ? (games ? totalGames(games) / Math.max(1, totalGames(ex)) : 0) : null
      const ownBefore = isMyTurn(data.graph, ROOT_KEY) ? 1 : 0
      const sub = preparedness({ ...inp, depth: depth - ownBefore }, m.toKey)
      branches.push({ san: m.san, uci: m.uci, toKey: m.toKey, share, score: sub.score })
    }
    branches.sort((a, b) => (b.share ?? 0) - (a.share ?? 0))

    const pending = needed.filter((k) => !cached.has(k)).length
    return { result, gaps, branches, pending, fetchError }
  }, [data, cached, depth, needed, fetchError])
}
