import { useEffect, useState } from 'react'
import { playUci, type Color } from '../chess/position'
import { cloudEval } from './eval'
import { scoreValue, type Evaluation } from './uci'

/**
 * How many centipawns a move gives up compared with the engine's best move,
 * from the mover's point of view. Uses the current MultiPV lines when the move
 * is among them, otherwise the Lichess cloud eval of the resulting position.
 */
export function useMoveLoss(fen: string, uci: string | undefined, color: Color, evaluation: Evaluation | null): number | null {
  const usable = !!uci && !!evaluation && evaluation.fen === fen && evaluation.lines.length > 0
  const sign = color === 'white' ? 1 : -1
  const best = usable ? scoreValue(evaluation.lines[0]) * sign : 0
  const own = usable ? evaluation.lines.find((l) => l.pv[0] === uci) : undefined
  const needsCloud = usable && !own
  const key = `${fen}|${uci}`

  // Only when the move isn't among the engine's top lines: evaluate the position after it.
  const [cloud, setCloud] = useState<{ key: string; value: number }>()
  useEffect(() => {
    if (!needsCloud || !uci) return
    const after = playUci(fen, uci)
    if (!after) return
    let live = true
    cloudEval(after.fen, 1)
      .then((e) => live && e?.lines[0] && setCloud({ key, value: scoreValue(e.lines[0]) * sign }))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [needsCloud, fen, uci, key, sign])

  if (!usable) return null
  if (own) return Math.max(0, best - scoreValue(own) * sign)
  return cloud?.key === key ? Math.max(0, best - cloud.value) : null
}
