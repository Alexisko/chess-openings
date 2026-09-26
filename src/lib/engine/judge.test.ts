import { describe, expect, it } from 'vitest'
import { START_FEN } from '../chess/position'
import { judgeMove, winningChances } from './judge'
import type { Evaluation } from './uci'

const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const ev = (fen: string, lines: [string, number][]): Evaluation => ({
  fen,
  depth: 30,
  source: 'cloud',
  lines: lines.map(([uci, cp]) => ({ cp, pv: [uci] })),
})

describe('winningChances', () => {
  it('is 0 for an equal position and saturates for mates', () => {
    expect(winningChances({ cp: 0 })).toBe(0)
    expect(winningChances({ mate: 3 })).toBeCloseTo(winningChances({ cp: 1000 }))
    expect(winningChances({ mate: -2 })).toBeLessThan(-0.95)
  })
})

describe('judgeMove', () => {
  it('marks blunders, mistakes and inaccuracies by the drop in winning chances', () => {
    const before = ev(START_FEN, [
      ['e2e4', 30],
      ['d2d4', 20],
      ['b2b3', -40],
      ['a2a3', -120],
      ['g2g4', -250],
    ])
    expect(judgeMove(before, 'e2e4')).toBeUndefined()
    expect(judgeMove(before, 'd2d4')).toBeUndefined()
    expect(judgeMove(before, 'b2b3')).toBe('?!')
    expect(judgeMove(before, 'a2a3')).toBe('?')
    expect(judgeMove(before, 'g2g4')).toBe('??')
  })

  it('judges from the side that moved', () => {
    // White-relative scores: Black's best keeps +0.3, Qh4 gives White +2.5.
    const before = ev(BLACK_TO_MOVE, [
      ['e7e5', 30],
      ['c7c5', 40],
    ])
    expect(judgeMove(before, 'c7c5')).toBeUndefined()
    expect(judgeMove(before, 'd8h4', ev('after', [['b1c3', 250]]))).toBe('??')
  })

  it("doesn't judge without the evaluation of the move", () => {
    expect(judgeMove(ev(START_FEN, [['e2e4', 30]]), 'g2g4')).toBeUndefined()
    expect(judgeMove(ev(START_FEN, []), 'g2g4', ev('after', [['e7e5', -300]]))).toBeUndefined()
  })

  it("doesn't flag small losses once the game is decided", () => {
    const before = ev(START_FEN, [
      ['e2e4', 900],
      ['d2d4', 700],
    ])
    expect(judgeMove(before, 'd2d4')).toBeUndefined()
  })
})
