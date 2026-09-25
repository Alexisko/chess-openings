import { describe, expect, it } from 'vitest'
import { openingTrail, shortName } from './names'

const kp = { eco: 'C20', name: "King's Pawn Game" }
const vienna = { eco: 'C25', name: 'Vienna Game' }
const falkbeer = { eco: 'C26', name: 'Vienna Game: Falkbeer Variation' }
const gambit = { eco: 'C29', name: 'Vienna Game: Vienna Gambit' }

describe('openingTrail', () => {
  it('lists each name where it starts', () => {
    // start, 1.e4, 1...e5, 2.Nc3, 2...Nf6, 3.f4
    const trail = openingTrail([null, kp, kp, vienna, falkbeer, gambit])
    expect(trail).toEqual([
      { ply: 1, opening: kp },
      { ply: 3, opening: vienna },
      { ply: 4, opening: falkbeer },
      { ply: 5, opening: gambit },
    ])
  })

  it('keeps the last known name past the named positions and over gaps in the cache', () => {
    const trail = openingTrail([null, kp, undefined, vienna, null, null, undefined])
    expect(trail.at(-1)).toEqual({ ply: 3, opening: vienna })
    expect(trail).toHaveLength(2)
  })

  it('is empty when no position has a name', () => {
    expect(openingTrail([null, undefined])).toEqual([])
    expect(openingTrail([])).toEqual([])
  })

  it('ignores positions after upTo (the position a pending move would reach)', () => {
    const openings = [kp, vienna, falkbeer, gambit]
    expect(openingTrail(openings, 2).at(-1)?.opening).toBe(falkbeer)
    expect(openingTrail(openings, 0)).toEqual([{ ply: 0, opening: kp }])
  })

  it('shows a name again when the line comes back to it', () => {
    const trail = openingTrail([vienna, falkbeer, vienna])
    expect(trail.map((s) => s.ply)).toEqual([0, 1, 2])
  })
})

describe('shortName', () => {
  it('drops the family shared with the previous name', () => {
    expect(shortName(gambit.name, vienna.name)).toBe('Vienna Gambit')
    expect(shortName(gambit.name, falkbeer.name)).toBe('Vienna Gambit')
  })

  it('drops the whole previous name when the new one extends it', () => {
    expect(shortName('Sicilian Defense: Najdorf Variation, English Attack', 'Sicilian Defense: Najdorf Variation')).toBe(
      'English Attack',
    )
  })

  it('keeps names from another family, and names with no previous one', () => {
    expect(shortName(vienna.name, kp.name)).toBe('Vienna Game')
    expect(shortName(gambit.name)).toBe('Vienna Game: Vienna Gambit')
  })
})
