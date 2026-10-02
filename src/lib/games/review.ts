import type { Game } from '../../db/schema'
import type { Glyph } from '../chess/glyphs'
import { setupPosition, turnOf, type Color } from '../chess/position'
import { winningChances } from '../engine/judge'
import { scoreValue, type Evaluation } from '../engine/uci'
import type { Naming } from '../openings/naming'
import type { OpeningName } from '../openings/names'
import { gameKeys, type GameAnalysis, type RepIndex } from './analyze'

// One game at a time: how its opening went compared with your repertoire, and
// what the engine thinks of the position you got out of it.

/** "Out of the opening" means after this many moves (or the end of the game, if earlier). */
export const OPENING_MOVES = 12

/** Engine depth for game positions: enough for opening evaluations, quick on a phone. */
export const REVIEW_DEPTH = 14

/** One position's evaluation, from White's point of view. */
export interface PosEval {
  /** Centipawns; mates are huge (see scoreValue). */
  white: number
  /** Moves to mate, White-relative; 0 when the side to move is mated. */
  mate?: number
  /** The engine's best move (UCI), if the game isn't over. */
  best?: string
}

export function toPosEval(e: Evaluation): PosEval | null {
  const l = e.lines[0]
  if (!l) return null
  return { white: scoreValue(l), mate: l.mate, best: l.pv[0] }
}

/** The result of a finished position (mate or draw), or null while the game goes on. */
export function terminalEval(fen: string): PosEval | null {
  const pos = setupPosition(fen)
  if (pos.isCheckmate()) return { white: turnOf(fen) === 'white' ? -100000 : 100000, mate: 0 }
  if (pos.isStalemate() || pos.isInsufficientMaterial()) return { white: 0 }
  return null
}

/** The evaluation from your side of the board, in centipawns. */
export const evalFor = (e: PosEval, color: Color) => (color === 'white' ? e.white : -e.white)

/** "+0.8", "−1.5", "M3" or "+#" (checkmate on the board), from your side of the board. */
export function formatEval(e: PosEval, color: Color): string {
  const sign = color === 'white' ? 1 : -1
  if (e.mate === 0) return evalFor(e, color) > 0 ? '+#' : '−#'
  if (e.mate !== undefined) return `${e.mate * sign > 0 ? '' : '−'}M${Math.abs(e.mate)}`
  const v = evalFor(e, color) / 100
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`
}

export type EvalTone = 'ahead' | 'equal' | 'behind'

/** About two thirds of a pawn either way is a real edge out of the opening. */
const EDGE = 70

export function evalTone(e: PosEval, color: Color): EvalTone {
  const v = evalFor(e, color)
  return v >= EDGE ? 'ahead' : v <= -EDGE ? 'behind' : 'equal'
}

/** Your winning chances in [-1, 1], as on Lichess's evaluation graph. */
export const chancesFor = (e: PosEval, color: Color) => winningChances({ cp: Math.max(-1000, Math.min(1000, evalFor(e, color))) })

/**
 * The engine's symbol for a move ('??', '?', '?!') from the evaluations
 * before and after it, with Lichess's thresholds on lost winning chances.
 */
export function moveGlyph(before: PosEval, after: PosEval, uci: string, mover: Color): Glyph | undefined {
  if (before.best === uci) return undefined
  const drop = chancesFor(before, mover) - chancesFor(after, mover)
  return drop >= 0.3 ? '??' : drop >= 0.2 ? '?' : drop >= 0.1 ? '?!' : undefined
}

/**
 * Each move of a game compared with the repertoire it reached:
 * - start:     a starting move of the repertoire (set up, not trained)
 * - rep:       a repertoire move, yours or a reply you have prepared
 * - forgot:    you played another move than your repertoire's
 * - opp-left:  the opponent played a move you have no answer to
 * - ended:     the first move after your line had ended
 * - after:     later moves, out of preparation
 * - uncovered: the move that left every repertoire's starting moves
 */
export type ReviewMark = 'start' | 'rep' | 'forgot' | 'opp-left' | 'ended' | 'after' | 'uncovered'

export interface ReviewMove {
  ply: number
  uci: string
  san: string
  mine: boolean
  mark: ReviewMark
}

export function reviewMoves(a: GameAnalysis, reps: RepIndex[]): ReviewMove[] {
  const { game } = a
  const r = a.repertoireId ? reps.find((x) => x.rep.id === a.repertoireId) : undefined
  const startPly = r ? gameKeys(game).indexOf(r.start.key) : a.ply
  const exit: ReviewMark =
    a.outcome === 'forgot' ? 'forgot' : a.outcome === 'opp-left' ? 'opp-left' : a.outcome === 'prep-ended' ? 'ended' : 'uncovered'
  return game.moves.map((uci, ply) => ({
    ply,
    uci,
    san: game.sans[ply],
    mine: (ply % 2 === 0) === (game.color === 'white'),
    mark: ply < startPly ? 'start' : ply < a.ply ? 'rep' : ply === a.ply ? exit : 'after',
  }))
}

/** "8.", "8…" for the move at a ply. */
export const moveNumber = (ply: number) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '…' : '.'}`

/** The move at a ply with its number, e.g. "8…Nf6". */
export const numbered = (game: Game, ply: number) => `${moveNumber(ply)}${game.sans[ply]}`

/** Where the game left preparation: the ply of the move that left it, if it did. */
export function exitPly(a: GameAnalysis): number | undefined {
  return a.outcome === 'forgot' || a.outcome === 'opp-left' || a.outcome === 'prep-ended' ? a.ply : undefined
}

/** The ply (= position index) "out of the opening": after OPENING_MOVES moves, or the last stored position. */
export const openingPly = (game: Game) => Math.min(OPENING_MOVES * 2, game.moves.length)

/** One sentence on how the game left your preparation. */
export function prepSummary(a: GameAnalysis): string {
  const { game } = a
  switch (a.outcome) {
    case 'forgot':
      return `You played ${numbered(game, a.ply)} instead of ${moveNumber(a.ply)}${a.expected?.san}`
    case 'opp-left':
      return `They left your prep with ${numbered(game, a.ply)}`
    case 'prep-ended':
      return `Your line ended before ${numbered(game, a.ply)}`
    case 'in-prep':
      return 'Still in your prep when the stored moves end'
    case 'not-covered':
      return game.moves[a.ply] ? `No repertoire covers ${numbered(game, a.ply)}` : 'No repertoire covers this game'
  }
}

/** The deepest opening name the game reached (your own names first). */
export function gameOpening(game: Game, naming: Pick<Naming, 'display'>): OpeningName | undefined {
  const keys = gameKeys(game)
  for (let i = keys.length - 1; i >= 0; i--) {
    const n = naming.display(keys[i])
    if (n) return n
  }
  return undefined
}
