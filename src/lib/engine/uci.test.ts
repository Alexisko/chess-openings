import { describe, expect, it } from 'vitest'
import { replay } from '../chess/position'
import { formatScore, parseInfo, scoreValue, toPvLine } from './uci'

describe('UCI parsing', () => {
  it('parses a multipv info line', () => {
    const info = parseInfo('info depth 18 seldepth 24 multipv 2 score cp -35 nodes 1 nps 2 pv e7e5 g1f3 b8c6')
    expect(info).toEqual({ depth: 18, multipv: 2, cp: -35, pv: ['e7e5', 'g1f3', 'b8c6'] })
  })

  it('ignores bound scores and non-pv output', () => {
    expect(parseInfo('info depth 10 score cp 20 lowerbound nodes 5 pv e2e4')).toBeNull()
    expect(parseInfo('info string NNUE evaluation using nn.nnue')).toBeNull()
  })

  it('converts side-to-move scores to White-relative and canonicalises castling', () => {
    const fen = replay(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'd2d3']).at(-1)!.fen
    // Black to move and better by 0.4 => White-relative -40.
    expect(toPvLine(fen, { cp: 40, pv: ['g8f6'] }).cp).toBe(-40)
    const whiteFen = replay(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5']).at(-1)!.fen
    expect(toPvLine(whiteFen, { cp: 30, pv: ['e1g1'] }).pv[0]).toBe('e1h1')
  })

  it('orders and formats scores', () => {
    expect(scoreValue({ mate: 3 })).toBeGreaterThan(scoreValue({ cp: 900 }))
    expect(scoreValue({ mate: -2 })).toBeLessThan(scoreValue({ cp: -900 }))
    expect(formatScore({ cp: 34 })).toBe('+0.34')
    expect(formatScore({ mate: -4 })).toBe('-M4')
  })
})
