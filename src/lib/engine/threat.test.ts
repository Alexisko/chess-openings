import { describe, expect, it } from 'vitest'
import { replay } from '../chess/position'
import { flipTurn, THREAT_GAIN, toThreat } from './threat'

const after = (line: string[]) => replay(line).at(-1)!.fen

describe('flipTurn', () => {
  it('gives the move back to the side that just moved', () => {
    // 1.e4 e5 2.Nc3 Nf6 3.f4: White to move again, on move 4.
    expect(flipTurn(after(['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f2f4']))).toBe(
      'rnbqkb1r/pppp1ppp/5n2/4p3/4PP2/2N5/PPPP2PP/R1BQKBNR w KQkq - 0 4',
    )
  })

  it('drops the en-passant square', () => {
    expect(flipTurn(after(['e2e4']))).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2')
  })

  it('is impossible after a check', () => {
    expect(flipTurn(after(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'c4f7']))).toBeNull()
  })
})

describe('toThreat', () => {
  const flipped = flipTurn(after(['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f2f4']))!

  it('measures the gain for the side that moved', () => {
    // Real position about equal; with a free move White wins a pawn and chases the knight.
    const t = toThreat(flipped, { cp: 424, pv: ['f4e5', 'f6g8', 'd2d4'] }, { cp: -11, pv: ['d7d5'] })!
    expect(t).toMatchObject({ san: 'fxe5', line: ['fxe5', 'Ng8', 'd4'], gain: 435, real: true })
  })

  it('treats a spare tempo as no real threat', () => {
    const f = flipTurn(after(['e2e4', 'e7e5', 'b1c3']))!
    const t = toThreat(f, { cp: 92, pv: ['g1f3'] }, { cp: 19, pv: ['b8c6'] })!
    expect(t.gain).toBeLessThan(THREAT_GAIN)
    expect(t.real).toBe(false)
  })

  it('scores from Black’s point of view after a Black move', () => {
    // Two Knights: 3...Nf6 threatens Nxe4.
    const f = flipTurn(after(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6']))!
    const t = toThreat(f, { cp: -104, pv: ['f6e4'] }, { cp: 17, pv: ['d2d3'] })!
    expect(t).toMatchObject({ san: 'Nxe4', gain: 121, real: true })
  })

  it('flags mate threats, unless already mating', () => {
    // Scholar's mate setup: after 3.Qh5, White threatens Qxf7#.
    const g = flipTurn(after(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5']))!
    expect(toThreat(g, { mate: 1, pv: ['h5f7'] }, { cp: 0, pv: ['g7g6'] })).toMatchObject({ san: 'Qxf7#', mate: 1, real: true })
    expect(toThreat(g, { mate: 1, pv: ['h5f7'] }, { mate: 2, pv: ['g7g6'] })?.real).toBe(false)
  })

  it('has no gain without an eval of the real position', () => {
    expect(toThreat(flipped, { cp: 424, pv: ['f4e5'] }, undefined)).toMatchObject({ gain: null, real: false })
  })
})
