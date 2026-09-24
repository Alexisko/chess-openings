import { useEffect, useState } from 'react'
import { evaluate, stopEval } from './eval'
import type { Evaluation } from './uci'

/** Streams an evaluation for the position while `enabled`. */
export function useEval(fen: string | null, enabled: boolean): Evaluation | null {
  const [ev, setEv] = useState<Evaluation | null>(null)
  useEffect(() => {
    if (!fen || !enabled) return
    let live = true
    evaluate(fen, (e) => live && setEv(e)).catch(() => undefined)
    return () => {
      live = false
      stopEval()
    }
  }, [fen, enabled])
  return enabled && ev && ev.fen === fen ? ev : null
}
