import { describe, expect, it } from 'vitest'
import { addLine, createRepertoire, loadMoves } from '../../db/repertoire'
import { AppDB } from '../../db/schema'
import { buildGraph } from '../chess/graph'
import { parseMoves, startOf } from '../chess/start'
import { buildTree, findNode } from '../chess/tree'
import { buildChapters, chapterNodes, type Chapter, type ChapterBreak } from './chapters'
import rows from './eco.json'
import { ecoTable } from './eco'

const eco = ecoTable(rows)
let n = 0

async function vienna(lines: string[]) {
  const d = new AppDB(`chapters-${n++}`)
  const start = parseMoves('1.e4 e5 2.Nc3')
  const rep = await createRepertoire('Vienna', 'white', d, start)
  for (const l of lines) await addLine(rep, parseMoves(`1.e4 e5 2.Nc3 ${l}`), {}, d)
  const g = buildGraph(await loadMoves(rep.id, d), 'white', startOf(start).key)
  return buildTree(g, start)
}

const outline = (chs: Chapter[], depth = 0): string[] =>
  chs.flatMap((c) => [`${'  '.repeat(depth)}${c.title} | ${c.name} | ${c.lines}`, ...outline(c.children, depth + 1)])

const LINES = [
  '2...Nc6 3.f4 exf4 4.Nf3 g5 5.h4',
  '2...Nc6 3.f4 exf4 4.Nf3 Nf6 5.d4',
  '2...Nf6 3.f4 exf4 4.e5 Ng8 5.Nf3 d6 6.d4',
  '2...Nf6 3.f4 exf4 4.e5 Qe7 5.Qe2',
  '2...Nf6 3.f4 d5 4.fxe5 Nxe4 5.Qf3',
  '2...Nf6 3.f4 d6 4.Nf3',
  '2...Bc5 3.Bc4 Nf6 4.d3',
  '2...d6 3.f4',
]

const path = (moves: string) => parseMoves(`1.e4 e5 2.Nc3 ${moves}`)

describe('buildChapters', () => {
  it('starts a chapter at each opponent reply that leads to another variation', async () => {
    const chs = buildChapters(await vienna(LINES), { opening: (k) => eco.get(k) })
    // The start position only leads into chapters, so they are the top level.
    expect(outline(chs.roots)).toEqual([
      'Vienna Gambit, with Max Lange Defense | Vienna Gambit, with Max Lange Defense | 2',
      // Named after the reply: 2...Nf6 is the Falkbeer, 3.f4 makes it the Vienna Gambit.
      'Vienna Gambit | Vienna Game: Vienna Gambit | 4',
      'Anderssen Defense | Vienna Game: Anderssen Defense | 1',
      'Omaha Gambit | Vienna Game: Omaha Gambit | 1',
    ])
    expect(chs.list.map((c) => c.id)).toEqual(chs.roots.map((c) => c.id))
    expect(chs.of(path(''))).toBeUndefined()
  })

  it('keeps replies within the variation as side lines, named by their sub-variation', async () => {
    const chs = buildChapters(await vienna(LINES), { opening: (k) => eco.get(k) })
    const gambit = chs.roots[1]
    expect(chs.startingAt(path('2...Nf6'))).toBe(gambit)
    expect(chs.of(path('2...Nf6 3.f4 d5 4.fxe5'))).toBe(gambit)
    expect(chs.of(path('2...Nf6 3.f4 exf4 4.e5 Qe7'))).toBe(gambit)
    expect(chs.lineName(path('2...Nf6 3.f4 d5'))).toEqual({ name: 'Main Line', custom: false })
    // The main reply continues the chapter's line and has no name of its own; unnamed side lines have none either.
    expect(chs.lineName(path('2...Nf6 3.f4 exf4'))).toBeUndefined()
    expect(chs.lineName(path('2...Nf6 3.f4 d6'))).toBeUndefined()
    expect(chapterNodes(gambit).map((n) => n.san).slice(0, 4)).toEqual(['Nf6', 'f4', 'exf4', 'e5'])
  })

  it("doesn't split a line where the opponent has a single reply", async () => {
    const chs = buildChapters(await vienna(['2...Nf6 3.f4 exf4 4.e5']), { opening: (k) => eco.get(k) })
    expect(outline(chs.roots)).toEqual(['Vienna Game | Vienna Game | 1'])
    expect(chs.of(path('2...Nf6 3.f4 exf4'))).toBe(chs.roots[0])
  })

  it('uses names the user gave, without changing the chapters', async () => {
    const tree = await vienna(LINES)
    const custom = new Map([
      [findNode(tree, path('2...Nf6'))!.key, 'Falkbeer'],
      [findNode(tree, path('2...Nf6 3.f4 d5'))!.key, 'Counter-strike'],
    ])
    const chs = buildChapters(tree, { opening: (k) => eco.get(k), custom: (k) => custom.get(k) })
    expect(chs.roots[1]).toMatchObject({ name: 'Falkbeer', title: 'Falkbeer', custom: true, lines: 4 })
    expect(chs.lineName(path('2...Nf6 3.f4 d5'))).toEqual({ name: 'Counter-strike', custom: true })
    // A chapter is named after the position following your reply, where a new name is stored.
    expect(chs.roots[1].nameKey).toBe(findNode(tree, path('2...Nf6 3.f4'))!.key)
    custom.clear()
    custom.set(chs.roots[1].nameKey, 'Gambit!')
    expect(buildChapters(tree, { opening: (k) => eco.get(k), custom: (k) => custom.get(k) }).roots[1].title).toBe('Gambit!')
  })

  it('follows chapter starts forced or prevented by the user', async () => {
    const tree = await vienna(LINES)
    const breaks = new Map<string, ChapterBreak>([
      [findNode(tree, path('2...Bc5'))!.key, 'merge'],
      [findNode(tree, path('2...Nf6 3.f4 d6'))!.key, 'split'],
    ])
    const chs = buildChapters(tree, { opening: (k) => eco.get(k), breaks: (k) => breaks.get(k) })
    // 2...Bc5 stays in the first chapter, which now has a line of its own.
    expect(chs.roots.map((c) => c.title)).toEqual(['Vienna Game'])
    expect(chs.of(path('2...Bc5 3.Bc4'))).toBe(chs.roots[0])
    const gambit = chs.startingAt(path('2...Nf6'))!
    // Same variation as the chapter above, so the move tells them apart.
    expect(gambit.children.map((c) => c.title)).toEqual(['Vienna Gambit (3...d6)'])
    expect(chapterNodes(gambit, false).some((n) => n.san === 'd6' && n.ply === 6)).toBe(false)
    expect(chapterNodes(gambit).some((n) => n.san === 'd6' && n.ply === 6)).toBe(true)
  })

  it('tells apart sibling chapters with the same name', async () => {
    const tree = await vienna(['2...Nf6 3.f4', '2...Nc6 3.f4'])
    const same = { eco: 'C29', name: 'Vienna Game: Vienna Gambit' }
    const chs = buildChapters(tree, { opening: (k) => (k === tree.key ? eco.get(k) : same) })
    expect(chs.roots.map((c) => c.title)).toEqual(['Vienna Gambit (2...Nf6)', 'Vienna Gambit (2...Nc6)'])
  })

  it('makes a single chapter without opening names', async () => {
    const chs = buildChapters(await vienna(LINES), { opening: () => undefined })
    expect(outline(chs.roots)).toEqual(['Main line | Main line | 8'])
  })
})
