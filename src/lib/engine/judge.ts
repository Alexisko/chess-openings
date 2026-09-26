import type { Glyph } from '../chess/glyphs'
import { turnOf } from '../chess/position'
import { scoreValue, type Evaluation, type PvLine } from './uci'

/**
 * Lichess's winning chances, in [-1, 1], for a White-relative score. Scores
 * are capped at ±10 pawns and a mate counts as that cap.
 */
export function winningChances(line: Pick<PvLine, 'cp' | 'mate'>): number {
  const cp = Math.max(-1000, Math.min(1000, scoreValue(line)))
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1
}

/** Drops in winning chances (for the side that moved) that make a move a blunder, a mistake or an inaccuracy, as on Lichess. */
const BLUNDER = 0.3
const MISTAKE = 0.2
const INACCURACY = 0.1

/**
 * The symbol the engine gives a move: '??', '?' or '?!' when it gives up enough
 * winning chances compared with the best move, nothing otherwise. `before`
 * evaluates the position the move is played in; `after`, the position it
 * reaches, is only needed when the move isn't one of `before`'s lines.
 * Undefined when there isn't enough to judge.
 */
export function judgeMove(before: Evaluation, uci: string, after?: Evaluation | null): Glyph | undefined {
  const best = before.lines[0]
  if (!best || best.pv[0] === uci) return undefined
  const played = before.lines.find((l) => l.pv[0] === uci) ?? after?.lines[0]
  if (!played) return undefined
  const sign = turnOf(before.fen) === 'white' ? 1 : -1
  const drop = (winningChances(best) - winningChances(played)) * sign
  return drop >= BLUNDER ? '??' : drop >= MISTAKE ? '?' : drop >= INACCURACY ? '?!' : undefined
}
