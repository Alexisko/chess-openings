import { Chess } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import { opposite } from 'chessops/util'
import { replay, setupPosition, type Color } from '../chess/position'
import { cachedEval, cloudEval, storeEval } from './eval'
import { threatEngine } from './stockfish'
import { scoreValue, type Evaluation, type PvLine } from './uci'

/** Depth of the two quick searches behind a threat (well under a second each in the opening). */
export const THREAT_DEPTH = 15

/**
 * How much a free extra move must gain, in centipawns, to count as a threat.
 * A spare tempo alone is worth about 70–90 in the opening (1.e4, 2.Nc3, 3.Bb5);
 * threatening to win a pawn (2.Nf3, 3...Nf6 against e4) gains 120 or more.
 */
export const THREAT_GAIN = 110

/** What the side that just moved would play if it could move again. */
export interface Threat {
  /** The position with the side to move flipped. */
  fen: string
  uci: string
  san: string
  /** The engine's line from the threat on, in SAN. */
  line: string[]
  /** Centipawns the free move gains for the mover over the real position; null when that is unknown. */
  gain: number | null
  /** Mate in this many moves for the mover. */
  mate?: number
  /** Whether it's a real threat rather than just a useful next move. */
  real: boolean
}

/**
 * The position with the other side to move, as if the side to move passed.
 * Null when that is impossible: the side to move is in check (the mover could
 * take the king), or the mover would have no legal move.
 */
export function flipTurn(fen: string): string | null {
  const pos = setupPosition(fen)
  if (pos.isCheck()) return null
  const setup = pos.toSetup()
  setup.turn = opposite(setup.turn)
  setup.epSquare = undefined
  // Keep move numbers moving forward so the threat reads as the next move.
  if (setup.turn === 'white') setup.fullmoves++
  const flipped = Chess.fromSetup(setup)
  if (flipped.isErr || !flipped.value.hasDests()) return null
  return makeFen(flipped.value.toSetup())
}

/** Builds a threat from the engine's best line in the flipped position and the eval of the real one. */
export function toThreat(flippedFen: string, best: PvLine, actual: PvLine | undefined): Threat | null {
  if (!best.pv.length) return null
  const mover: Color = setupPosition(flippedFen).turn
  const sign = mover === 'white' ? 1 : -1
  let san: string[]
  try {
    san = replay(best.pv.slice(0, 5), flippedFen).map((m) => m.san)
  } catch {
    san = []
  }
  if (!san.length) return null
  const mate = best.mate !== undefined && best.mate * sign > 0 ? best.mate * sign : undefined
  const gain = actual ? scoreValue(best) * sign - scoreValue(actual) * sign : null
  // Already mating anyway? Then the mate isn't what the move threatens.
  const alreadyMating = actual?.mate !== undefined && actual.mate * sign > 0
  return {
    fen: flippedFen,
    uci: best.pv[0],
    san: san[0],
    line: san,
    gain,
    mate,
    real: (mate !== undefined && !alreadyMating) || (gain !== null && gain >= THREAT_GAIN),
  }
}

/**
 * What the last move threatens in `fen` (the position after it): the engine's
 * best move with the side to move flipped, measured against the eval of the
 * real position. Null when the move gave check, or when a newer search
 * replaced this one.
 */
export async function findThreat(fen: string): Promise<Threat | null> {
  const flipped = flipTurn(fen)
  if (!flipped) return null
  const actual = await quickEval(fen, true)
  if (actual === undefined) return null
  const threat = await quickEval(flipped, false)
  if (!threat?.lines[0]) return null
  return toThreat(flipped, threat.lines[0], actual?.lines[0])
}

/**
 * A shallow evaluation: the cache, then (for real positions) the Lichess cloud,
 * then the threat engine. Undefined when the search was superseded.
 */
async function quickEval(fen: string, cloud: boolean): Promise<Evaluation | null | undefined> {
  const hit = await cachedEval(fen)
  if (hit && hit.depth >= THREAT_DEPTH && hit.lines.length) return hit
  if (cloud) {
    // Flipped positions never occur in games, so they're never in the cloud.
    const ev = await cloudEval(fen, 1).catch(() => null)
    if (ev?.lines.length) {
      await storeEval(ev)
      return ev
    }
  }
  const local = await threatEngine.analyse(fen, { depth: THREAT_DEPTH, multiPv: 1 })
  if (!local) return undefined
  if (local.lines.length) await storeEval(local)
  return local
}

export function stopThreat() {
  threatEngine.stop()
}
