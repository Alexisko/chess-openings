import { createEmptyCard, type Card as FsrsCard } from 'ts-fsrs'
import { beforeEach, describe, expect, it } from 'vitest'
import { addLine, createRepertoire, loadMoves } from '../../db/repertoire'
import { AppDB } from '../../db/schema'
import { buildGraph, enumerateLines, ROOT_KEY } from '../chess/graph'
import { positionKey, replay } from '../chess/position'
import { withResult, type MoveRecord } from '../srs/knowledge'
import { State } from '../srs/scheduler'
import { lineDepths } from './lineDepths'

const now = new Date('2026-10-01T12:00:00Z')
const day = 86400e3
const learned = (): FsrsCard => ({
  ...createEmptyCard(now),
  state: State.Review,
  stability: 40,
  difficulty: 5,
  reps: 8,
  last_review: new Date(now.getTime() - day),
  due: new Date(now.getTime() + 40 * day),
})
const answers = (...results: boolean[]): MoveRecord =>
  results.reduce<MoveRecord | undefined>((r, ok, i) => withResult(r, ok, i), undefined)!
const keyAfter = (uci: string[]) => positionKey(replay(uci).at(-1)!.fen)

let d: AppDB
let n = 0
beforeEach(() => {
  d = new AppDB(`line-depths-${n++}`)
})

async function repertoire(color: 'white' | 'black', ...lines: string[][]) {
  const rep = await createRepertoire('Lines', color, d)
  for (const l of lines) await addLine(rep, l, {}, d)
  const graph = buildGraph(await loadMoves(rep.id, d), color)
  return { graph, lines: enumerateLines(graph) }
}

describe('line depths', () => {
  const ruyLopez = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']
  const philidor = ['e2e4', 'e7e5', 'g1f3', 'd7d6', 'd2d4']

  it('measures the lines through a reply in your moves, and counts your moves there once', async () => {
    const { graph, lines } = await repertoire('white', ruyLopez, philidor, ['e2e4', 'c7c5'])
    const facts = lineDepths(graph, lines, new Map(), new Map(), keyAfter(['e2e4', 'e7e5']), 0, now)
    expect(facts.lines.map((l) => l.depth)).toEqual([3, 3])
    expect(facts.moves).toBe(3) // Nf3, then Bb5 or d4
    // Counted from move 1: a repertoire starting after two of your moves adds them.
    expect(lineDepths(graph, lines, new Map(), new Map(), graph.root, 2, now).lines.map((l) => l.depth)).toEqual([5, 5, 3])
  })

  it('grades a line by its weakest move', async () => {
    const { graph, lines } = await repertoire('white', ruyLopez, philidor)
    const cards = new Map([...graph.movesFrom.keys()].map((k) => [k, learned()]))
    const records = new Map([...cards.keys()].map((k) => [k, answers(...Array(8).fill(true))]))
    records.set(keyAfter(ruyLopez.slice(0, 4)), answers(true, true, false))
    const facts = lineDepths(graph, lines, cards, records, graph.root, 0, now)
    expect(facts.lines.map((l) => l.level)).toEqual(['shaky', 'mastered'])
  })

  it('treats a reply you have no answer to as not learned', async () => {
    const { graph, lines } = await repertoire('white', ['e2e4', 'c7c5'])
    expect(lineDepths(graph, lines, new Map(), new Map(), ROOT_KEY, 0, now).lines).toEqual([
      { id: keyAfter(['e2e4', 'c7c5']), depth: 1, level: 'new' },
    ])
  })

  it('follows a transposition as deep as the line it joins', async () => {
    // 1.Nf3 Nf6 2.d4 is 1.d4 Nf6 2.Nf3, where the repertoire goes on with 2...e6.
    const { graph, lines } = await repertoire('black', ['d2d4', 'g8f6', 'g1f3', 'e7e6'], ['g1f3', 'g8f6', 'd2d4'])
    expect(lines.map((l) => l.end)).toEqual(['leaf', 'transposition'])
    expect(lineDepths(graph, lines, new Map(), new Map(), ROOT_KEY, 0, now).lines.map((l) => l.depth)).toEqual([2, 2])
  })
})
