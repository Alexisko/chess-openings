import { describe, expect, it } from 'vitest'
import { moveBetween, replay, START_FEN } from './position'

const fens = (uci: string[]) => [START_FEN, ...replay(uci).map((m) => m.fen)]

describe('moveBetween', () => {
  it('tells a quiet move from a capture', () => {
    const [start, e4, d5, exd5] = fens(['e2e4', 'd7d5', 'e4d5'])
    expect(moveBetween(start, e4)).toEqual({ capture: false })
    expect(moveBetween(e4, d5)).toEqual({ capture: false })
    expect(moveBetween(d5, exd5)).toEqual({ capture: true })
  })

  it('counts en passant as a capture and castling as a quiet move', () => {
    const ep = fens(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6'])
    expect(moveBetween(ep[4], ep[5])).toEqual({ capture: true })
    const castle = fens(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1h1'])
    expect(moveBetween(castle[6], castle[7])).toEqual({ capture: false })
  })

  it('is null for positions that are not one move apart', () => {
    const [start, e4, e5] = fens(['e2e4', 'e7e5'])
    expect(moveBetween(start, start)).toBeNull()
    expect(moveBetween(start, e5)).toBeNull()
    expect(moveBetween(e4, start)).toBeNull()
  })
})
