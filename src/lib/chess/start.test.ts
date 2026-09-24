import { beforeEach, describe, expect, it } from 'vitest'
import {
  addLine,
  createRepertoire,
  findOverlaps,
  loadMoves,
  OutsideRepertoireError,
  previewStartChange,
  setRepertoireStart,
} from '../../db/repertoire'
import { AppDB } from '../../db/schema'
import type { ExplorerData } from '../explorer/explorer'
import { findGaps, preparedness } from '../prep/preparedness'
import { buildGraph, enumerateLines } from './graph'
import { graphToPgn } from './pgn'
import { positionKey, replay } from './position'
import { parseMoves, plyOfFen, repStart } from './start'
import { buildTree } from './tree'

let d: AppDB
let n = 0
beforeEach(() => {
  d = new AppDB(`start-${n++}`)
})

const VIENNA = ['e2e4', 'e7e5', 'b1c3']
const keyAfter = (uci: string[]) => positionKey(replay(uci).at(-1)!.fen)
const explorerData = (moves: [string, string, number][]): ExplorerData => ({
  white: moves.reduce((s, m) => s + m[2], 0),
  draws: 0,
  black: 0,
  opening: null,
  moves: moves.map(([uci, san, games]) => ({ uci, san, white: games, draws: 0, black: 0 })),
})

describe('repertoire starting position', () => {
  it('parses typed starting moves', () => {
    expect(parseMoves('1.e4 e5 2.Nc3')).toEqual(VIENNA)
    expect(parseMoves('')).toEqual([])
    expect(() => parseMoves('1.e4 e5 2.Ke3')).toThrow()
    expect(plyOfFen(replay(VIENNA).at(-1)!.fen)).toBe(3)
  })

  it('skips the setup moves: no cards for them and lines start after them', async () => {
    const rep = await createRepertoire('Vienna', 'white', d, VIENNA)
    await addLine(rep, [...VIENNA, 'g8f6', 'f2f4', 'd7d5'], {}, d)
    await addLine(rep, [...VIENNA, 'b8c6', 'f2f4'], {}, d)
    const moves = await loadMoves(rep.id, d)
    expect(moves.map((m) => m.san).sort()).toEqual(['Nc6', 'Nf6', 'd5', 'f4', 'f4'])
    // Only White's 3.f4 in each line is a card, not 1.e4 or 2.Nc3.
    expect(await d.cards.count()).toBe(2)
    const g = buildGraph(moves, 'white', repStart(rep).key)
    expect(enumerateLines(g).map((l) => l.moves.map((m) => m.san).join(' '))).toEqual(['Nf6 f4 d5', 'Nc6 f4'])
    await expect(addLine(rep, ['d2d4', 'd7d5'], {}, d)).rejects.toBeInstanceOf(OutsideRepertoireError)
  })

  it('scores the Vienna without the Sicilian counting against it', async () => {
    const rep = await createRepertoire('Vienna', 'white', d, VIENNA)
    await addLine(rep, [...VIENNA, 'g8f6', 'f2f4'], {}, d)
    await addLine(rep, [...VIENNA, 'b8c6', 'f2f4'], {}, d)
    const g = buildGraph(await loadMoves(rep.id, d), 'white', repStart(rep).key)
    const explorer = new Map([
      // What Black plays after 1.e4 is irrelevant to the Vienna...
      [keyAfter(['e2e4']), explorerData([['c7c5', 'c5', 40], ['e7e5', 'e5', 60]])],
      // ...only the replies to 2.Nc3 matter.
      [repStart(rep).key, explorerData([['g8f6', 'Nf6', 50], ['b8c6', 'Nc6', 30], ['f8c5', 'Bc5', 20]])],
    ])
    const recall = new Map(g.order.map((k) => [k, 1]))
    // Depth counts own moves after 2.Nc3: one move (3.f4) is prepared vs Nf6 and Nc6.
    expect(preparedness({ graph: g, explorer, recall, depth: 1 }).score).toBeCloseTo(0.8)
    const gaps = findGaps({ graph: g, explorer, recall, depth: 1 })
    expect(gaps.map((x) => x.san)).toEqual(['Bc5'])
  })

  it('moves the start, deleting the setup moves and branches outside it', async () => {
    const rep = await createRepertoire('White', 'white', d)
    await addLine(rep, [...VIENNA, 'g8f6', 'f2f4'], {}, d)
    await addLine(rep, [...VIENNA, 'b8c6', 'f2f4'], {}, d)
    await addLine(rep, ['e2e4', 'c7c5', 'g1f3'], {}, d)
    // White moves: 1.e4, 2.Nc3, 3.f4 (vs Nf6), 3.f4 (vs Nc6), 2.Nf3 (vs c5).
    expect(await d.cards.count()).toBe(5)
    const gone = await previewStartChange(rep, VIENNA, d)
    expect(gone.map((m) => m.san).sort()).toEqual(['Nc3', 'Nf3', 'c5', 'e4', 'e5'])
    const updated = await setRepertoireStart(rep, VIENNA, d)
    expect(updated.startMoves).toEqual(VIENNA)
    expect((await loadMoves(rep.id, d)).map((m) => m.san).sort()).toEqual(['Nc6', 'Nf6', 'f4', 'f4'])
    expect(await d.cards.count()).toBe(2)
  })

  it('detects overlapping repertoires of the same colour', async () => {
    const vienna = await createRepertoire('Vienna', 'white', d, VIENNA)
    await addLine(vienna, [...VIENNA, 'b8c6', 'f2f4'], {}, d)
    await createRepertoire('Sicilian', 'white', d, ['e2e4', 'c7c5'])
    await createRepertoire('Black stuff', 'black', d, VIENNA)
    const names = async (moves: string[]) => (await findOverlaps('white', moves, undefined, d)).map((r) => r.name)
    expect(await names([...VIENNA, 'b8c6'])).toEqual(['Vienna']) // inside the Vienna's lines
    expect(await names(['e2e4'])).toEqual(['Vienna', 'Sicilian']) // both start after 1.e4
    expect(await names(['d2d4'])).toEqual([])
  })

  it('builds the tree and PGN from the start', async () => {
    const rep = await createRepertoire('Vienna', 'white', d, VIENNA)
    await addLine(rep, [...VIENNA, 'g8f6', 'f2f4'], {}, d)
    const g = buildGraph(await loadMoves(rep.id, d), 'white', repStart(rep).key)
    const tree = buildTree(g, VIENNA)
    expect(tree.ply).toBe(3)
    expect(tree.children.map((c) => c.san)).toEqual(['Nf6'])
    expect(graphToPgn(g, 'Vienna', repStart(rep).sans)).toContain('1. e4 e5 2. Nc3 Nf6 3. f4')
  })
})
