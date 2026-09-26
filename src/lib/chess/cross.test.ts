import { beforeEach, describe, expect, it } from 'vitest'
import { addLine, createRepertoire, loadMoves } from '../../db/repertoire'
import { AppDB, type Repertoire } from '../../db/schema'
import { findGaps, preparedness } from '../prep/preparedness'
import { crossAt, crossEntering, crossIndex, crossMove, crossPath, followInto, ownerAt } from './cross'
import { buildGraph } from './graph'
import { positionKey, replay } from './position'
import { repStart } from './start'

let d: AppDB
let n = 0
beforeEach(() => {
  d = new AppDB(`cross-${n++}`)
})

const keyAfter = (uci: string[]) => positionKey(replay(uci).at(-1)!.fen)
const load = async (reps: Repertoire[]) =>
  crossIndex(
    await Promise.all(
      reps.map(async (rep) => ({ rep, moves: await loadMoves(rep.id, d), cards: await d.cards.where({ repertoireId: rep.id }).toArray() })),
    ),
  )

describe('transpositions across repertoires', () => {
  it('finds positions another repertoire continues from', async () => {
    // Vienna 2...Nf6 3.Bc4 and Bishop's Opening 2...Nf6 3.Nc3 reach the same position.
    const vienna = await createRepertoire('Vienna', 'white', d, ['e2e4', 'e7e5', 'b1c3'])
    await addLine(vienna, ['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f1c4', 'f8c5'], {}, d)
    const bishop = await createRepertoire('Bishop', 'white', d, ['e2e4', 'e7e5', 'f1c4'])
    await addLine(bishop, ['e2e4', 'e7e5', 'f1c4', 'g8f6', 'b1c3', 'f8c5', 'd2d3'], {}, d)
    const index = await load([vienna, bishop])

    const joined = keyAfter(['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f1c4'])
    expect(crossAt(index, joined, vienna.id).map((r) => r.rep.name)).toEqual(['Bishop'])
    expect(crossAt(index, joined, bishop.id).map((r) => r.rep.name)).toEqual(['Vienna'])

    // The Vienna line ends after 3...Bc5, where the Bishop's Opening goes on with 4.d3.
    const end = keyAfter(['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f1c4', 'f8c5'])
    const [ref] = crossAt(index, end, vienna.id)
    expect(crossMove(ref, end)?.san).toBe('d3')
    expect(crossPath(ref, end)).toEqual(['e2e4', 'e7e5', 'f1c4', 'g8f6', 'b1c3', 'f8c5'])
    // Nothing continues from the Bishop's last position.
    expect(crossAt(index, keyAfter(['e2e4', 'e7e5', 'f1c4', 'g8f6', 'b1c3', 'f8c5', 'd2d3']), vienna.id)).toEqual([])

    // Flagged where the line joins, not again on the next move.
    const before = keyAfter(['e2e4', 'e7e5', 'b1c3', 'g8f6'])
    expect(crossEntering(index, before, joined, vienna.id).map((r) => r.rep.name)).toEqual(['Bishop'])
    expect(crossEntering(index, joined, end, vienna.id)).toEqual([])
  })

  it('follows preparedness into the repertoire a line continues in', async () => {
    const vienna = await createRepertoire('Vienna', 'white', d, ['e2e4', 'e7e5', 'b1c3'])
    await addLine(vienna, ['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f1c4', 'f8c5'], {}, d)
    const bishop = await createRepertoire('Bishop', 'white', d, ['e2e4', 'e7e5', 'f1c4'])
    await addLine(bishop, ['e2e4', 'e7e5', 'f1c4', 'g8f6', 'b1c3', 'f8c5', 'd2d3'], {}, d)
    const index = await load([vienna, bishop])
    const own = buildGraph(await loadMoves(vienna.id, d), 'white', repStart(vienna).key)
    const followed = followInto(own, vienna.id, index)

    const end = keyAfter(['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f1c4', 'f8c5'])
    expect(followed.graph.movesFrom.get(end)?.map((m) => m.san)).toEqual(['d3'])
    expect(followed.cards.has(end)).toBe(true) // the Bishop's card for 4.d3
    expect(ownerAt(followed.graph, end)).toBe(bishop.id)
    expect(ownerAt(followed.graph, keyAfter(['e2e4', 'e7e5', 'b1c3', 'g8f6']))).toBe(vienna.id)

    // Everything remembered, no explorer data (replies count equally): two own moves deep.
    const recall = new Map([...own.order, ...followed.graph.order].map((k) => [k, 1]))
    const inputs = { explorer: new Map(), recall, depth: 2 }
    expect(preparedness({ ...inputs, graph: own }).score).toBe(0) // the Vienna alone stops after 3.Bc4
    expect(preparedness({ ...inputs, graph: followed.graph }).score).toBe(1)
    expect(findGaps({ ...inputs, graph: own }).map((g) => g.kind)).toEqual(['line-ends'])
    expect(findGaps({ ...inputs, graph: followed.graph })).toEqual([])

    // Nothing to follow: the graph is kept as is.
    expect(followInto(own, vienna.id, new Map()).graph).toBe(own)
  })
})
