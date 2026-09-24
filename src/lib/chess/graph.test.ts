import { beforeEach, describe, expect, it } from 'vitest'
import { addLine, createRepertoire, loadMoves, MoveConflictError, removeMoves } from '../../db/repertoire'
import { AppDB } from '../../db/schema'
import { buildGraph, enumerateLines, myMove, ROOT_KEY } from './graph'
import { graphToPgn, pgnToLines } from './pgn'
import { canonicalUci, positionKey, replay, START_FEN } from './position'

let d: AppDB
let n = 0
beforeEach(() => {
  d = new AppDB(`test-${n++}`)
})

describe('positionKey', () => {
  it('ignores move counters so transpositions match', () => {
    const a = replay(['g1f3', 'g8f6', 'd2d4']).at(-1)!.fen
    const b = replay(['d2d4', 'g8f6', 'g1f3']).at(-1)!.fen
    expect(positionKey(a)).toBe(positionKey(b))
  })

  it('drops an en-passant square that cannot be captured', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
    expect(positionKey(fen)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -')
  })

  it('treats both castling notations the same', () => {
    const fen = replay(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5']).at(-1)!.fen
    expect(canonicalUci(fen, 'e1g1')).toBe(canonicalUci(fen, 'e1h1'))
  })
})

describe('repertoire graph', () => {
  it('adds lines, reuses shared moves and creates one card per own move', async () => {
    const rep = await createRepertoire('White', 'white', d)
    await addLine(rep, ['e2e4', 'e7e5', 'g1f3'], {}, d)
    await addLine(rep, ['e2e4', 'c7c5', 'g1f3'], {}, d)
    const moves = await loadMoves(rep.id, d)
    expect(moves).toHaveLength(5)
    expect(await d.cards.count()).toBe(3) // start, after 1...e5, after 1...c5
    const g = buildGraph(moves, 'white')
    expect(myMove(g, ROOT_KEY)?.san).toBe('e4')
    expect(enumerateLines(g).map((l) => l.moves.map((m) => m.san).join(' '))).toEqual([
      'e4 e5 Nf3',
      'e4 c5 Nf3',
    ])
  })

  it('refuses a second own move in a position unless replacing', async () => {
    const rep = await createRepertoire('White', 'white', d)
    await addLine(rep, ['e2e4', 'e7e5', 'g1f3', 'b8c6'], {}, d)
    await expect(addLine(rep, ['e2e4', 'e7e5', 'f1c4'], {}, d)).rejects.toBeInstanceOf(MoveConflictError)
    await addLine(rep, ['e2e4', 'e7e5', 'f1c4'], { replace: true }, d)
    const sans = (await loadMoves(rep.id, d)).map((m) => m.san).sort()
    expect(sans).toEqual(['Bc4', 'e4', 'e5'])
  })

  it('cuts a line at a transposition', async () => {
    const rep = await createRepertoire('Black', 'black', d)
    await addLine(rep, ['d2d4', 'g8f6', 'g1f3', 'e7e6'], {}, d)
    await addLine(rep, ['g1f3', 'g8f6', 'd2d4'], {}, d)
    const g = buildGraph(await loadMoves(rep.id, d), 'black')
    const lines = enumerateLines(g)
    expect(lines).toHaveLength(2)
    const t = lines.find((l) => l.end === 'transposition')!
    expect(t.moves.map((m) => m.san)).toEqual(['Nf3', 'Nf6', 'd4'])
    // After 1.d4, after 1.Nf3, and the shared position after 1.d4 Nf6 2.Nf3 (one card, not two).
    expect(await d.cards.count()).toBe(3)
  })

  it('keeps positions reachable through a transposition when a move is removed', async () => {
    const rep = await createRepertoire('Black', 'black', d)
    await addLine(rep, ['d2d4', 'g8f6', 'g1f3', 'e7e6'], {}, d)
    await addLine(rep, ['g1f3', 'g8f6', 'd2d4'], {}, d)
    const d4 = (await loadMoves(rep.id, d)).find((m) => m.san === 'd4' && m.fromKey === positionKey(START_FEN))!
    const gone = await removeMoves(rep, new Set([d4.id]), d)
    expect(gone.map((m) => m.san).sort()).toEqual(['Nf3', 'Nf6', 'd4'])
    const left = (await loadMoves(rep.id, d)).map((m) => m.san)
    expect(left).toContain('e6')
  })

  it('round-trips PGN with variations', async () => {
    const rep = await createRepertoire('White', 'white', d)
    const { lines } = pgnToLines('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 3. Bb5 *')
    expect(lines).toHaveLength(2)
    for (const l of lines) await addLine(rep, l, {}, d)
    const pgn = graphToPgn(buildGraph(await loadMoves(rep.id, d), 'white'), 'Test')
    expect(pgn).toContain('1. e4 e5 ( 1... c5 2. Nf3 ) 2. Nf3 Nc6 3. Bb5')
  })
})
