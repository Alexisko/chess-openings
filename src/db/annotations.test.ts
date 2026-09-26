import { beforeEach, describe, expect, it } from 'vitest'
import { buildGraph } from '../lib/chess/graph'
import { nagToGlyph } from '../lib/chess/glyphs'
import { graphToPgn } from '../lib/chess/pgn'
import { addLine, createRepertoire, loadMoves, setChapterBreak, setMoveGlyph, setPositionName, setPositionNote } from './repertoire'
import { AppDB } from './schema'

let d: AppDB
let n = 0
beforeEach(() => {
  d = new AppDB(`annotations-${n++}`)
})

describe('position names and chapter breaks', () => {
  it('keep the note and each other', async () => {
    await setPositionNote('k', 'Watch for Bb4', d)
    await setPositionName('k', '  Falkbeer  ', d)
    await setChapterBreak('k', 'split', d)
    expect(await d.positions.get('k')).toMatchObject({ note: 'Watch for Bb4', tags: [], name: 'Falkbeer', chapter: 'split' })

    await setPositionName('k', '', d)
    await setChapterBreak('k', undefined, d)
    const row = await d.positions.get('k')
    expect(row).toMatchObject({ note: 'Watch for Bb4' })
    expect(row?.name).toBeUndefined()
    expect(row?.chapter).toBeUndefined()
  })

  it('create the position record when there is none', async () => {
    await setPositionName('new', 'Main line', d)
    expect(await d.positions.get('new')).toMatchObject({ key: 'new', note: '', tags: [], name: 'Main line' })
  })
})

describe('move symbols', () => {
  it('are stored on the move and exported as PGN glyphs', async () => {
    const rep = await createRepertoire('Vienna', 'white', d)
    await addLine(rep, ['e2e4', 'e7e5', 'b1c3', 'd8h4'], {}, d)
    const qh4 = (await loadMoves(rep.id, d)).find((m) => m.san === 'Qh4')!
    await setMoveGlyph(qh4.id, '?', d)
    const moves = await loadMoves(rep.id, d)
    expect(moves.find((m) => m.id === qh4.id)?.glyph).toBe('?')
    expect(graphToPgn(buildGraph(moves, 'white'), 'Vienna')).toContain('Qh4 $2')
    expect(nagToGlyph(2)).toBe('?')
  })
})
