import type { RepMove, ReviewMode } from '../../db/schema'
import { sameMove } from '../chess/position'
import type { PlannedRun } from './plan'

export type AttemptResult =
  | { kind: 'correct'; move: RepMove; graded: boolean }
  | { kind: 'wrong'; expected: RepMove; graded: boolean }
  | { kind: 'retry-wrong'; expected: RepMove }

/**
 * Plays one line: opponent moves are given, the owner's moves must be found.
 * Only the first attempt at each position counts; after a mistake the correct
 * move is shown and must be played before continuing.
 */
export class LineRun {
  ply: number
  /** Positions already attempted in this run (first attempt counted). */
  private attempted = new Set<number>()
  /** Set after a wrong move: the correct move must now be played. */
  mustRetry = false
  /** Learn mode first pass: the owner's moves are shown before being played. */
  readonly demo: boolean

  readonly run: PlannedRun
  readonly mode: ReviewMode

  constructor(run: PlannedRun, mode: ReviewMode, opts: { demo?: boolean } = {}) {
    this.run = run
    this.mode = mode
    this.ply = run.startPly
    this.demo = opts.demo ?? false
  }

  get moves() {
    return this.run.line.moves
  }

  get expected(): RepMove | undefined {
    return this.moves[this.ply]
  }

  get finished() {
    return this.ply >= this.moves.length
  }

  get awaitingUser() {
    return !this.finished && this.expected!.byMe
  }

  /** Plays the opponent's move; returns it. */
  advanceOpponent(): RepMove {
    const m = this.expected
    if (!m || m.byMe) throw new Error('Not the opponent to move')
    this.ply++
    return m
  }

  /**
   * Checks the owner's move. `graded` tells the caller to record the attempt
   * against the card (first attempt only, never in the demo pass).
   */
  submit(uci: string): AttemptResult {
    const expected = this.expected
    if (!expected || !expected.byMe) throw new Error('Not your move')
    const correct = sameMove(expected.fromFen, uci, expected.uci)
    const first = !this.attempted.has(this.ply)
    this.attempted.add(this.ply)
    const graded = first && !this.demo
    if (correct) {
      this.mustRetry = false
      this.ply++
      return { kind: 'correct', move: expected, graded: graded }
    }
    if (!first) return { kind: 'retry-wrong', expected }
    this.mustRetry = true
    return { kind: 'wrong', expected, graded }
  }
}
