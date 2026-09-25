import { describe, expect, it } from 'vitest'
import { describeFact, isThreatening, moveFacts } from './moveFacts'
import { replay, START_FEN } from './position'

/** Facts (as sentences) for the last move of a line. */
function factsOf(line: string[]): string[] {
  const fen = line.length > 1 ? replay(line.slice(0, -1)).at(-1)!.fen : START_FEN
  return moveFacts(fen, line.at(-1)!).map(describeFact)
}

describe('moveFacts', () => {
  it('sees lines opened by a pawn move', () => {
    expect(factsOf(['e2e4'])).toEqual(['Opens lines for the queen on d1 and the bishop on f1.'])
  })

  it('sees development and an attack on an undefended pawn', () => {
    expect(factsOf(['e2e4', 'e7e5', 'g1f3'])).toEqual(['Attacks the undefended pawn on e5.', 'Develops the knight to f3.'])
  })

  it('puts a pawn attacking a piece first', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Nxe5 Nxe5 4.d4: the pawn hits the knight before anything else.
    const facts = factsOf(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f3e5', 'c6e5', 'd2d4'])
    expect(facts[0]).toBe('Attacks the undefended knight on e5.')
  })

  it('finds pins to the king and to the queen', () => {
    // French Winawer: 3...Bb4 pins the knight on c3.
    expect(factsOf(['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'f8b4'])).toContain('Pins the knight on c3 to the king.')
    // Queen's Gambit Declined: 4.Bg5 pins the knight on f6 to the queen.
    expect(factsOf(['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c1g5'])).toContain('Pins the knight on f6 to the queen.')
  })

  it('does not call a defended attack a threat', () => {
    // Ruy Lopez: 3.Bb5 attacks the knight, which pawns defend.
    const line = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']
    const facts = moveFacts(replay(line.slice(0, -1)).at(-1)!.fen, line.at(-1)!)
    const attack = facts.find((f) => f.kind === 'attacks')
    expect(attack).toMatchObject({ role: 'knight', square: 'c6', undefended: false, byLower: false })
    expect(isThreatening(attack!)).toBe(false)
  })

  it('reports check and castling', () => {
    expect(factsOf(['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5a5', 'd2d4', 'c7c6', 'f1c4', 'g8f6', 'g1f3', 'c8f5', 'e1h1'])).toContain(
      'Castles kingside: the king is safe and a rook joins the game.',
    )
    expect(factsOf(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'c4f7'])[0]).toBe('Gives check.')
  })

  it('reports discovered attacks', () => {
    // 1.Nf3 d5 2.g3 Nc6 3.Bg2 e5 4.Nxe5: the knight leaves the long diagonal.
    const facts = factsOf(['g1f3', 'd7d5', 'g2g3', 'b8c6', 'f1g2', 'e7e5', 'f3e5'])
    expect(facts).toContain('Uncovers an attack on the pawn on d5.')
    expect(facts).toContain('Attacks the knight on c6.')
    expect(facts).toContain('Opens lines for the bishop on g2.')
  })

  it('returns nothing for an illegal move', () => {
    expect(moveFacts(START_FEN, 'e2e5')).toEqual([])
  })
})
