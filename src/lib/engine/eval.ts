import { db } from '../../db/schema'
import { positionKey } from '../chess/position'
import { stockfish } from './stockfish'
import { toPvLine, type Evaluation } from './uci'

export const TARGET_DEPTH = 20
export const MULTI_PV = 3

/** Lichess cloud evaluations: instant for common positions, null when unknown. */
export async function cloudEval(fen: string, multiPv = MULTI_PV): Promise<Evaluation | null> {
  const params = new URLSearchParams({ fen, multiPv: String(multiPv) })
  const res = await fetch(`https://lichess.org/api/cloud-eval?${params}`)
  if (!res.ok) return null
  const data = (await res.json()) as { depth: number; pvs: { cp?: number; mate?: number; moves: string }[] }
  return {
    fen,
    depth: data.depth,
    source: 'cloud',
    lines: data.pvs.map((p) => toPvLine(fen, { cp: p.cp, mate: p.mate, pv: p.moves.split(' ') }, 'white')),
  }
}

export async function cachedEval(fen: string): Promise<Evaluation | null> {
  const hit = await db.evalCache.get(positionKey(fen))
  return hit ? { ...(hit.data as Evaluation), fen } : null
}

export async function storeEval(e: Evaluation) {
  const key = positionKey(e.fen)
  const prev = await db.evalCache.get(key)
  const prevLines = (prev?.data as Evaluation | undefined)?.lines.length ?? 0
  if (prev && prev.depth >= e.depth && prevLines >= e.lines.length) return
  await db.evalCache.put({ positionKey: key, depth: e.depth, data: e, source: e.source, updatedAt: Date.now() })
}

/**
 * Evaluates a position: local cache, then Lichess cloud eval, then local
 * Stockfish (streamed through `onUpdate`).
 */
export async function evaluate(fen: string, onUpdate: (e: Evaluation) => void): Promise<Evaluation | null> {
  const cached = await cachedEval(fen)
  if (cached && cached.depth >= TARGET_DEPTH && cached.lines.length >= MULTI_PV) {
    onUpdate(cached)
    return cached
  }
  const cloud = await cloudEval(fen).catch(() => null)
  if (cloud && cloud.lines.length) {
    onUpdate(cloud)
    await storeEval(cloud)
    if (cloud.lines.length >= MULTI_PV) return cloud
  }
  const local = await stockfish.analyse(fen, { depth: TARGET_DEPTH, multiPv: MULTI_PV }, onUpdate)
  if (local) await storeEval(local)
  return local
}

export function stopEval() {
  stockfish.stop()
}
