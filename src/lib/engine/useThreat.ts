import { useEffect, useState } from 'react'
import { findThreat, stopThreat, type Threat } from './threat'

/**
 * What the last move threatens in `fen` (the position after it) while
 * `enabled`: undefined while searching, null when there's nothing to show.
 */
export function useThreat(fen: string | null, enabled: boolean): Threat | null | undefined {
  const [result, setResult] = useState<{ fen: string; threat: Threat | null }>()
  useEffect(() => {
    if (!fen || !enabled) return
    let live = true
    findThreat(fen)
      .then((threat) => live && setResult({ fen, threat }))
      .catch(() => live && setResult({ fen, threat: null }))
    return () => {
      live = false
      stopThreat()
    }
  }, [fen, enabled])
  if (!fen || !enabled) return null
  return result?.fen === fen ? result.threat : undefined
}
