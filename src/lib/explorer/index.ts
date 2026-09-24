import { useEffect, useState } from 'react'
import { getToken } from '../auth/lichess'
import { ExplorerClient, filterHash, type ExplorerData, type ExplorerFilter } from './explorer'

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
