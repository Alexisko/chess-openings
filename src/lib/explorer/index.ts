import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../../db/schema'
import { getToken } from '../auth/lichess'
import { ExplorerClient, filterHash, totalGames, type ExplorerData, type ExplorerFilter } from './explorer'

export * from './explorer'

export const explorer = new ExplorerClient(getToken)

export interface ExplorerState {
  data?: ExplorerData
  error?: Error
  loading: boolean
}

/** Explorer data for a position (cached, fetched through the throttled queue). */
export function useExplorer(fen: string | null, filter: ExplorerFilter | undefined, reloadKey?: unknown): ExplorerState {
  const [state, setState] = useState<ExplorerState>({ loading: false })
  const hash = filter ? filterHash(filter) : ''
  useEffect(() => {
    if (!fen || !filter) return
    let cancelled = false
    setState((s) => ({ data: s.data, loading: true }))
    explorer
      .get(fen, filter)
      .then((data) => !cancelled && setState({ data, loading: false }))
      .catch((error: Error) => !cancelled && setState({ error, loading: false }))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, hash, reloadKey])
  return state
}

/** Explorer data already in the cache for these positions (never fetches). */
export function useCachedExplorer(keys: string[], filter: ExplorerFilter | undefined): Map<string, ExplorerData> {
  const hash = filter ? filterHash(filter) : ''
  const joined = keys.join('\n')
  return (
    useLiveQuery(
      async () => {
        const list = joined ? joined.split('\n') : []
        const rows = await db.explorerCache.bulkGet(list.map((k) => `${hash}|${k}`))
        const map = new Map<string, ExplorerData>()
        rows.forEach((r, i) => r && map.set(list[i], r.data as ExplorerData))
        return map
      },
      [joined, hash],
    ) ?? EMPTY
  )
}

const EMPTY = new Map<string, ExplorerData>()

/** Share of games (0–1) in which `uci` is played from a position, if known. */
export function moveShare(data: ExplorerData | undefined, uci: string): number | undefined {
  if (!data) return undefined
  const total = totalGames(data)
  if (!total) return undefined
  const m = data.moves.find((x) => x.uci === uci)
  return m ? totalGames(m) / total : 0
}
