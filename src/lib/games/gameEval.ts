import { useEffect, useState } from 'react'
import { positionKey } from '../chess/position'
import { cachedEval, cloudEval, storeEval } from '../engine/eval'
import { Stockfish } from '../engine/stockfish'
import { REVIEW_DEPTH, terminalEval, toPosEval, type PosEval } from './review'

// Evaluations of positions from your games, made one at a time in the
// background. They have their own engine, so they never interrupt the
// analysis shown on a board, and are kept in the evaluation cache.

const engine = new Stockfish({ hashMb: 16 })

export interface EvalRequest {
  fen: string
  /** The position before it: once the cloud doesn't know a position, it won't know what follows. */
  parent?: string
}

/** Known evaluations by position key; null when none could be made. */
const known = new Map<string, PosEval | null>()
/** Positions the Lichess cloud doesn't have. */
const notInCloud = new Set<string>()
/** The cloud is skipped until then after it asks us to slow down. */
let cloudPausedUntil = 0

async function evalPosition({ fen, parent }: EvalRequest): Promise<PosEval | null | undefined> {
  const done = terminalEval(fen)
  if (done) return done
  const cached = await cachedEval(fen)
  if (cached && cached.depth >= REVIEW_DEPTH && cached.lines.length) return toPosEval(cached)
  const key = positionKey(fen)
  if (!(parent && notInCloud.has(parent)) && Date.now() > cloudPausedUntil) {
    try {
      const cloud = await cloudEval(fen, 1)
      if (cloud?.lines.length) {
        await storeEval(cloud)
        return toPosEval(cloud)
      }
      notInCloud.add(key)
    } catch {
      cloudPausedUntil = Date.now() + 60_000
    }
  }
  const local = await engine.analyse(fen, { depth: REVIEW_DEPTH, multiPv: 1 })
  // Null means the search was interrupted: leave it unknown so it is asked for again.
  if (!local) return undefined
  if (local.lines.length) await storeEval(local)
  return toPosEval(local)
}

// One queue for every component: the latest requests go first, and positions
// no component wants any more are dropped.
let queue: EvalRequest[] = []
const wanted = new Map<string, number>()
const listeners = new Set<() => void>()
let running = false

async function run() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const req = queue.shift()!
      const key = positionKey(req.fen)
      if (known.has(key) || !wanted.get(key)) continue
      const e = await evalPosition(req).catch(() => null)
      if (e === undefined) continue
      known.set(key, e)
      for (const l of listeners) l()
    }
  } finally {
    running = false
  }
}

/**
 * Evaluations of positions (by position key), made in the order asked. `pending`
 * counts the positions still waiting.
 */
export function usePositionEvals(requests: EvalRequest[]): { evals: Map<string, PosEval | null>; pending: number } {
  const [, setVersion] = useState(0)
  const joined = requests.map((r) => `${r.fen}|${r.parent ?? ''}`).join('\n')
  useEffect(() => {
    const reqs = (joined ? joined.split('\n') : []).map((line) => {
      const [fen, parent] = line.split('|')
      return { fen, parent: parent || undefined }
    })
    const keys = reqs.map((r) => positionKey(r.fen))
    for (const k of keys) wanted.set(k, (wanted.get(k) ?? 0) + 1)
    const onEval = () => setVersion((v) => v + 1)
    listeners.add(onEval)
    queue = [...reqs.filter((_, i) => !known.has(keys[i])), ...queue]
    void run()
    return () => {
      listeners.delete(onEval)
      for (const k of keys) {
        const n = (wanted.get(k) ?? 1) - 1
        if (n > 0) wanted.set(k, n)
        else wanted.delete(k)
      }
    }
  }, [joined])

  const evals = new Map<string, PosEval | null>()
  let pending = 0
  for (const r of requests) {
    const k = positionKey(r.fen)
    if (known.has(k)) evals.set(k, known.get(k)!)
    else pending++
  }
  return { evals, pending }
}
