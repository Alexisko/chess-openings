import type { RepMove, ReviewMode } from '../../db/schema'
import { sameMove } from '../chess/position'
import { LEAD_IN, focusPlies, type PlannedRun } from './plan'

export type AttemptResult =
  | { kind: 'correct'; move: RepMove; graded: boolean }
  | { kind: 'wrong'; expected: RepMove; graded: boolean }
  | { kind: 'retry-wrong'; expected: RepMove }

/**
 * Plays one line: opponent moves are given, the owner's moves must be found.
 * Only the run's focus moves are asked; the owner's mastered moves play by
 * themselves, and a long mastered stretch between two focus moves is skipped
 * down to a short lead-in. Only the first attempt at each position counts;
 * after a mistake the correct move is shown and must be played before
 * continuing. A practice run (a line played again) is never graded.
 */
export class LineRun {
  ply: number
  /** Positions already attempted in this run (first attempt counted). */
  private attempted = new Set<number>()
  /** Set after a wrong move: the correct move must now be played. */
  mustRetry = false
  /** Learn mode first pass: the owner's moves are shown before being played. */
  readonly demo: boolean
  /** A line played again: nothing is graded. */
  readonly practice: boolean

  readonly run: PlannedRun
  readonly mode: ReviewMode
  private readonly focusPlies: number[]

  constructor(run: PlannedRun, mode: ReviewMode, opts: { demo?: boolean; practice?: boolean } = {}) {
    this.run = run
    this.mode = mode
    this.ply = run.startPly
    this.focusPlies = focusPlies(run.line, run.focus)
    this.demo = opts.demo ?? false
    this.practice = opts.practice ?? false
  }

  get moves() {
    return this.run.line.moves
  }

  get expected(): RepMove | undefined {
    return this.moves[this.ply]
  }

  get finished() {
    return this.ply >= this.run.endPly
  }

  get awaitingUser() {
    return !this.finished && this.focusPlies.includes(this.ply)
  }

  /** Plays the next move that isn't asked (the opponent's or a mastered one of the owner's); returns it. */
  advanceAuto(): RepMove {
    const m = this.expected
    if (!m || this.finished || this.awaitingUser) throw new Error('Nothing to play automatically')
    this.ply++
    return m
  }

  /**
   * Checks the owner's move. `graded` tells the caller to record the attempt
   * against the card (first attempt only, never in the demo pass or practice).
   */
  submit(uci: string): AttemptResult {
    const expected = this.expected
    if (!expected || !this.awaitingUser) throw new Error('Not your move')
    const correct = sameMove(expected.fromFen, uci, expected.uci)
    const first = !this.attempted.has(this.ply)
    this.attempted.add(this.ply)
    const graded = first && !this.demo && !this.practice
    if (correct) {
      this.mustRetry = false
      this.ply++
      const next = this.focusPlies.find((p) => p >= this.ply)
      if (next !== undefined && next - this.ply > LEAD_IN) this.ply = next - LEAD_IN
      return { kind: 'correct', move: expected, graded: graded }
    }
    if (!first) return { kind: 'retry-wrong', expected }
    this.mustRetry = true
    return { kind: 'wrong', expected, graded }
  }
}
