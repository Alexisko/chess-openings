import { describe, expect, it } from 'vitest'
import type { RepMove } from '../../db/schema'
import { buildGraph, ROOT_KEY } from '../chess/graph'
import { playUci, positionKey, START_FEN, turnOf, type Color } from '../chess/position'
import type { ExplorerData } from '../explorer/explorer'
import { findGaps, positionsNeedingData, preparedness } from './preparedness'

let t = 0
/** Builds repertoire moves from lines of UCI moves. */
function rep(color: Color, lines: string[][]): RepMove[] {
  const moves = new Map<string, RepMove>()
  for (const line of lines) {
    let fen = START_FEN
    for (const uci of line) {
      const p = playUci(fen, uci)!
      const id = `${positionKey(fen)}|${p.uci}`
      if (!moves.has(id))
        moves.set(id, {
          id,
          repertoireId: 'r',
          fromKey: positionKey(fen),
          toKey: positionKey(p.fen),
          fromFen: fen,
          uci: p.uci,
          san: p.san,
          byMe: turnOf(fen) === color,
          comment: '',
          createdAt: t++,
          updatedAt: 0,
        })
      fen = p.fen
    }
  }
  return [...moves.values()]
}

const keyAfter = (uci: string[]) => {
  let fen = START_FEN
  for (const u of uci) fen = playUci(fen, u)!.fen
  return positionKey(fen)
}

function explorerData(moves: [string, string, number][]): ExplorerData {
  return {
    white: moves.reduce((s, m) => s + m[2], 0),
    draws: 0,
    black: 0,
    opening: null,
    moves: moves.map(([uci, san, n]) => ({ uci, san, white: n, draws: 0, black: 0 })),
  }
}

describe('preparedness', () => {
  // White: 1.e4, then vs 1...e5 2.Nf3 and vs 1...c5 2.Nf3. 1...e6 (20%) unprepared.
  const moves = rep('white', [
    ['e2e4', 'e7e5', 'g1f3'],
    ['e2e4', 'c7c5', 'g1f3'],
  ])
  const graph = buildGraph(moves, 'white')
  const afterE4 = keyAfter(['e2e4'])
  const explorer = new Map([
    [
      afterE4,
      explorerData([
        ['e7e5', 'e5', 50],
        ['c7c5', 'c5', 30],
        ['e7e6', 'e6', 20],
      ]),
    ],
  ])

  it('matches a hand-computed value', () => {
    const recall = new Map([
      [ROOT_KEY, 1],
      [keyAfter(['e2e4', 'e7e5']), 0.9],
      [keyAfter(['e2e4', 'c7c5']), 0.5],
    ])
    // P = 1 × (0.5 × 0.9 + 0.3 × 0.5 + 0.2 × 0) = 0.6
    const r = preparedness({ graph, explorer, recall, depth: 2 })
    expect(r.score).toBeCloseTo(0.6)
    // E[depth] = 1 × (1 + 0.5×0.9 + 0.3×0.5) = 1.6
    expect(r.expectedDepth).toBeCloseTo(1.6)
    expect(r.missingData).toEqual([])
  })

  it('counts lines ending before the target depth as unprepared', () => {
    const recall = new Map([...graph.order].map((k) => [k, 1]))
    expect(preparedness({ graph, explorer, recall, depth: 3 }).score).toBe(0)
    expect(preparedness({ graph, explorer, recall, depth: 2 }).score).toBeCloseTo(0.8)
  })

  it('lists gaps ranked by impact', () => {
    const recall = new Map([
      [ROOT_KEY, 1],
      [keyAfter(['e2e4', 'e7e5']), 1],
    ])
    const gaps = findGaps({ graph, explorer, recall, depth: 3 })
    expect(gaps[0]).toMatchObject({ kind: 'line-ends', reach: 0.5 })
    expect(gaps.map((g) => `${g.kind}:${g.reach.toFixed(2)}`)).toEqual([
      'line-ends:0.50',
      'not-learned:0.30',
      'line-ends:0.30',
      'unprepared-reply:0.20',
    ])
    expect(gaps.find((g) => g.kind === 'unprepared-reply')?.san).toBe('e6')
  })

  it('sums reach over transpositions', () => {
    const black = rep('black', [
      ['d2d4', 'g8f6', 'g1f3', 'e7e6'],
      ['g1f3', 'g8f6', 'd2d4'],
    ])
    const g = buildGraph(black, 'black')
    const ex = new Map([
      [ROOT_KEY, explorerData([['d2d4', 'd4', 60], ['g1f3', 'Nf3', 40]])],
      [keyAfter(['d2d4', 'g8f6']), explorerData([['g1f3', 'Nf3', 100]])],
      [keyAfter(['g1f3', 'g8f6']), explorerData([['d2d4', 'd4', 100]])],
    ])
    const recall = new Map(g.order.map((k) => [k, 1]))
    const shared = keyAfter(['d2d4', 'g8f6', 'g1f3'])
    const gaps = findGaps({ graph: g, explorer: ex, recall: new Map([...recall].filter(([k]) => k !== shared)), depth: 3 })
    expect(gaps.find((x) => x.key === shared)?.reach).toBeCloseTo(1)
    expect(preparedness({ graph: g, explorer: ex, recall, depth: 2 }).score).toBeCloseTo(1)
    expect(positionsNeedingData(g, 2).sort()).toEqual(
      [ROOT_KEY, keyAfter(['d2d4', 'g8f6']), keyAfter(['g1f3', 'g8f6'])].sort(),
    )
  })
})
