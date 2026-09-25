import { describe, expect, it } from 'vitest'
import { replay, turnOf } from '../chess/position'
import { startOf, startsWith } from '../chess/start'
import { allSlots, catalogReplies, catalogSlot, slotColor } from './catalog'

describe('opening catalogue', () => {
  it('has legal lines that continue from their slot', () => {
    const slots = allSlots()
    expect(slots.length).toBeGreaterThan(30)
    for (const s of slots) {
      const names = new Set<string>()
      for (const o of s.options) {
        expect(() => replay(o.lineUci), `${s.title}: ${o.name}`).not.toThrow()
        expect(startsWith(o.lineUci, s.path), o.name).toBe(true)
        expect(startsWith(o.lineUci, o.startUci), o.name).toBe(true)
        expect(o.startUci.length).toBeGreaterThan(s.path.length)
        expect(o.uci).toBe(o.lineUci[s.path.length])
        expect(names.has(o.name), `duplicate ${o.name}`).toBe(false)
        names.add(o.name)
      }
      // You choose at a slot: the side to move is the side whose repertoire it belongs to.
      expect(turnOf(s.key)).toBe(slotColor(s))
    }
  })

  it('finds slots for both colours', () => {
    const start = catalogSlot(startOf([]).key)!
    expect(start.options.map((o) => o.san)).toEqual(['e4', 'd4', 'c4', 'Nf3'])
    const vsE4 = catalogSlot(startOf(['e2e4']).key)!
    expect(slotColor(vsE4)).toBe('black')
    expect(vsE4.options.find((o) => o.name === 'French Defence')!.startUci).toEqual(['e2e4', 'e7e6'])
    const italian = catalogSlot(startOf(['e2e4', 'e7e5']).key)!.options.find((o) => o.name === 'Italian Game')!
    expect(italian.startUci).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'])
  })

  it('names opponent replies', () => {
    const replies = catalogReplies(startOf(['e2e4']).key)
    expect(replies.find((m) => m.uci === 'c7c5')?.name).toBe('Sicilian Defence')
    expect(catalogReplies(startOf(['e2e4', 'e7e5', 'g1f3']).key).map((m) => m.san)).toContain('Nf6')
  })
})
