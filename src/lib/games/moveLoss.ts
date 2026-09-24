import { useEffect, useState } from 'react'
import { keyToFen, playUci, turnOf } from '../chess/position'
import { cachedEval, cloudEval, storeEval } from '../engine/eval'
import { stockfish } from '../engine/stockfish'
import { scoreValue, type Evaluation } from '../engine/uci'

/** Depth used when Stockfish has to run locally: enough to spot opening mistakes, quick on a phone. */
const CHECK_DEPTH = 16

/** Best available evaluation: cache, then Lichess cloud eval, then local Stockfish. */
async function quickEval(fen: string): Promise<Evaluation | null> {
  const cached = await cachedEval(fen)
  if (cached && cached.depth >= CHECK_DEPTH && cached.lines.length) return cached
  const cloud = await cloudEval(fen, 1).catch(() => null)
  if (cloud?.lines.length) {
    await storeEval(cloud)
    return cloud
  }
  const local = await stockfish.analyse(fen, { depth: CHECK_DEPTH, multiPv: 1 })
  if (local?.lines.length) await storeEval(local)
  return local?.lines.length ? local : null
}

/**
 * Centipawns the move gives up compared with the engine's best move, from the
 * mover's point of view (0 when it is the best move). Null when no evaluation
 * could be made, e.g. the game ended with that move.
 */
export async function moveLoss(key: string, uci: string): Promise<number | null> {
  const fen = keyToFen(key)
  const sign = turnOf(fen) === 'white' ? 1 : -1
  const before = await quickEval(fen)
  if (!before) return null
  const best = before.lines[0]
  if (best.pv[0] === uci) return 0
  const listed = before.lines.find((l) => l.pv[0] === uci)
  let after = listed ? scoreValue(listed) : undefined
  if (after === undefined) {
    const next = playUci(fen, uci)
    if (!next) return null
    const e = await quickEval(next.fen)
    if (!e) return null
    after = scoreValue(e.lines[0])
  }
  return Math.max(0, (scoreValue(best) - after) * sign)
}

export interface LossTarget {
  key: string
  uci: string
}

const lossKey = (t: LossTarget) => `${t.key}|${t.uci}`
const known = new Map<string, number | null>()

/**
 * Evaluates moves one at a time in the background. Results are kept for the
 * session; the evaluations themselves are cached in the database.
 */
export function useMoveLosses(targets: LossTarget[]): { losses: Map<string, number | null>; pending: number } {
  const [, setVersion] = useState(0)
  const joined = targets.map(lossKey).join('\n')
  useEffect(() => {
    const todo = (joined ? joined.split('\n') : []).filter((k) => !known.has(k))
    if (!todo.length) return
    let cancelled = false
    ;(async () => {
      for (const k of todo) {
        if (cancelled) return
        const [key, uci] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)]
        const loss = await moveLoss(key, uci).catch(() => null)
        if (cancelled) return
        known.set(k, loss)
        setVersion((v) => v + 1)
      }
    })()
    return () => {
      cancelled = true
      stockfish.stop()
    }
  }, [joined])
  const losses = new Map<string, number | null>()
  let pending = 0
  for (const t of targets) {
    const k = lossKey(t)
    if (known.has(k)) losses.set(k, known.get(k)!)
    else pending++
  }
  return { losses, pending }
}

export { lossKey }
