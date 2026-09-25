import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../../db/schema'
import { getToken } from '../auth/lichess'
import { keyToFen } from '../chess/position'
import type { OpeningName } from '../openings/names'
import { AuthRequiredError, ExplorerClient, filterHash, totalGames, type ExplorerData, type ExplorerFilter } from './explorer'

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

/**
 * Opening name of each position along a line, from the explorer cache (never
 * fetches): null past the last named position, undefined when not cached.
 */
export function useOpeningNames(keys: string[], filter: ExplorerFilter | undefined): (OpeningName | null | undefined)[] {
  const cached = useCachedExplorer(keys, filter)
  return useMemo(() => keys.map((k) => cached.get(k)?.opening), [keys, cached])
}

export interface ExplorerDataState {
  /** Cached data per position key (undefined while the cache is read). */
  cached?: Map<string, ExplorerData>
  /** Positions still to download. */
  pending: number
  fetchError?: Error
}

/**
 * Explorer data for many positions: what is cached, with the missing
 * positions downloaded in the background (one at a time, through the queue).
 */
export function useExplorerData(keys: string[], filter: ExplorerFilter | undefined): ExplorerDataState {
  const hash = filter ? filterHash(filter) : ''
  const joined = keys.join('\n')
  const cached = useLiveQuery(
    async () => {
      const list = joined ? joined.split('\n') : []
      const rows = await db.explorerCache.bulkGet(list.map((k) => `${hash}|${k}`))
      const map = new Map<string, ExplorerData>()
      rows.forEach((r, i) => r && map.set(list[i], r.data as ExplorerData))
      return map
    },
    [joined, hash],
  )

  const [fetchError, setFetchError] = useState<Error>()
  useEffect(() => {
    if (!filter || !cached) return
    const missing = keys.filter((k) => !cached.has(k))
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
    // Re-run only when the set of positions or the filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, hash, cached === undefined])

  const pending = cached ? keys.filter((k) => !cached.has(k)).length : keys.length
  return { cached, pending, fetchError }
}

/** Share of games (0–1) in which `uci` is played from a position, if known. */
export function moveShare(data: ExplorerData | undefined, uci: string): number | undefined {
  if (!data) return undefined
  const total = totalGames(data)
  if (!total) return undefined
  const m = data.moves.find((x) => x.uci === uci)
  return m ? totalGames(m) / total : 0
}
