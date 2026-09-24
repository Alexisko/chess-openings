import { beforeEach, describe, expect, it } from 'vitest'
import { addLine, createRepertoire, loadMoves } from '../../db/repertoire'
import { AppDB } from '../../db/schema'
import { buildGraph } from './graph'
import { buildTree, findNode } from './tree'

let d: AppDB
let n = 0
beforeEach(() => {
  d = new AppDB(`tree-${n++}`)
})

const sans = (node: { san: string; children: { san: string }[] }) => node.children.map((c) => c.san)

describe('buildTree', () => {
  it('builds variations, marks transpositions and grafts draft moves', async () => {
    const rep = await createRepertoire('Black', 'black', d)
    await addLine(rep, ['d2d4', 'g8f6', 'g1f3', 'e7e6'], {}, d)
    await addLine(rep, ['d2d4', 'g8f6', 'c2c4', 'e7e6'], {}, d)
    await addLine(rep, ['g1f3', 'g8f6', 'd2d4'], {}, d)
    const g = buildGraph(await loadMoves(rep.id, d), 'black')

    const root = buildTree(g, [], ['d2d4', 'g8f6', 'c1g5'])
    expect(sans(root)).toEqual(['d4', 'Nf3'])
    const afterNf6 = findNode(root, ['d2d4', 'g8f6'])!
    expect(sans(afterNf6)).toEqual(['Nf3', 'c4', 'Bg5'])
    const bg5 = afterNf6.children[2]
    expect(bg5).toMatchObject({ draft: true, byMe: false, ply: 3 })
    const nf3d4 = findNode(root, ['g1f3', 'g8f6', 'd2d4'])!
    expect(nf3d4.transposition).toBe(true)
    expect(nf3d4.children).toEqual([])
  })

  it('roots the tree at a focus position', async () => {
    const rep = await createRepertoire('White', 'white', d)
    await addLine(rep, ['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f2f4'], {}, d)
    await addLine(rep, ['e2e4', 'c7c5', 'g1f3'], {}, d)
    const g = buildGraph(await loadMoves(rep.id, d), 'white')
    const vienna = buildTree(g, ['e2e4', 'e7e5', 'b1c3'])
    expect(vienna.ply).toBe(3)
    expect(sans(vienna)).toEqual(['Nf6'])
    expect(findNode(vienna, ['e2e4', 'c7c5'])).toBeUndefined()
    expect(findNode(vienna, ['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f2f4'])?.byMe).toBe(true)
  })
})
