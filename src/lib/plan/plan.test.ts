import { describe, expect, it } from 'vitest'
import type { RepMove, Repertoire } from '../../db/schema'
import { buildGraph } from '../chess/graph'
import { playUci, positionKey, type Color } from '../chess/position'
import { startOf } from '../chess/start'
import type { ExplorerData } from '../explorer/explorer'
import { buildPlan, planScore, type DecisionNode, type MoveNode, type PlanNode, type PlanRep, type RepliesNode } from './plan'

let t = 0
/** A repertoire starting after `start` with the given lines (UCI, continuing from the start). */
function rep(name: string, color: Color, start: string[], lines: string[][] = []): PlanRep {
  const r: Repertoire = { id: name, name, color, startMoves: start, createdAt: t++, updatedAt: 0 }
  const moves = new Map<string, RepMove>()
  for (const line of lines) {
    let fen = startOf(start).fen
    for (const uci of line) {
      const p = playUci(fen, uci)!
      const id = `${positionKey(fen)}|${p.uci}`
      if (!moves.has(id))
        moves.set(id, {
          id,
          repertoireId: r.id,
          fromKey: positionKey(fen),
          toKey: positionKey(p.fen),
          fromFen: fen,
          uci: p.uci,
          san: p.san,
          byMe: fen.split(' ')[1] === color[0],
          comment: '',
          createdAt: t++,
          updatedAt: 0,
        })
      fen = p.fen
    }
  }
  return { rep: r, graph: buildGraph([...moves.values()], color, startOf(start).key) }
}

const keyAfter = (uci: string[]) => startOf(uci).key
const data = (moves: [string, string, number][]): ExplorerData => ({
  white: moves.reduce((s, m) => s + m[2], 0),
  draws: 0,
  black: 0,
  opening: null,
  moves: moves.map(([uci, san, games]) => ({ uci, san, white: games, draws: 0, black: 0 })),
})

const E4 = ['e2e4']
const E4E5 = ['e2e4', 'e7e5']

/** Follows a line of SAN moves through the plan. */
function at(node: PlanNode, sans: string[]): PlanNode {
  let cur = node
  for (const san of sans) {
    if (cur.kind === 'move') cur = cur.moves.find((m) => m.san === san)!.child
    else if (cur.kind === 'replies') cur = cur.replies.find((m) => m.san === san)!.child
    else throw new Error(`No move ${san} at a ${cur.kind} node`)
    if (!cur) throw new Error(`Missing ${san}`)
  }
  return cur
}

describe('repertoire plan', () => {
  it('starts with a choice of first move for White', () => {
    const plan = buildPlan({ color: 'white', reps: [], choices: {}, explorer: new Map() })
    expect(plan.empty).toBe(true)
    const root = plan.root as DecisionNode
    expect(root.kind).toBe('decision')
    expect(root.slot?.options.map((o) => o.san)).toEqual(['e4', 'd4', 'c4', 'Nf3'])
    expect(plan.decisions).toHaveLength(1)
    expect(plan.coverage).toBe(0)
  })

  it('lists White’s first moves as replies for Black', () => {
    const plan = buildPlan({ color: 'black', reps: [], choices: {}, explorer: new Map() })
    const root = plan.root as RepliesNode
    expect(root.kind).toBe('replies')
    expect(root.replies.map((r) => r.san)).toEqual(['e4', 'd4', 'c4', 'Nf3'])
    expect(root.replies[0].child.kind).toBe('decision')
    expect(plan.needed).toContain(root.key)
    // Without explorer data nothing is known about how often you get there.
    expect(plan.coverage).toBeNull()
  })

  it('follows a chosen move and splits replies by frequency', () => {
    const explorer = new Map([
      [keyAfter(E4), data([['e7e5', 'e5', 50], ['c7c5', 'c5', 30], ['e7e6', 'e6', 18], ['b7b6', 'b6', 2]])],
    ])
    const plan = buildPlan({ color: 'white', reps: [], choices: { [keyAfter([])]: 'e2e4' }, explorer })
    expect(plan.empty).toBe(false)
    const move = plan.root as MoveNode
    expect(move.moves[0]).toMatchObject({ san: 'e4', source: 'choice' })
    const replies = move.moves[0].child as RepliesNode
    expect(replies.afterChoice).toBe(true)
    expect(replies.replies.map((r) => [r.san, r.share, r.name])).toEqual([
      ['e5', 0.5, 'Open Game'],
      ['c5', 0.3, 'Sicilian Defence'],
      ['e6', 0.18, 'French Defence'],
    ])
    expect(replies.othersShare).toBeCloseTo(0.02)
    // Most frequent decision first.
    expect(plan.decisions.map((d) => [d.title, d.reach])).toEqual([
      ['Against 1...e5', 0.5],
      ['Against the Sicilian', 0.3],
      ['Against the French', 0.18],
    ])
  })

  it('follows the moves implied by a repertoire start and covers its position', () => {
    const vienna = rep('Vienna', 'white', ['e2e4', 'e7e5', 'b1c3'], [['g8f6', 'f2f4']])
    const explorer = new Map([[keyAfter(E4), data([['e7e5', 'e5', 60], ['c7c5', 'c5', 40]])]])
    const plan = buildPlan({ color: 'white', reps: [vienna], choices: {}, explorer })
    const root = plan.root as MoveNode
    expect(root.moves[0]).toMatchObject({ san: 'e4', source: 'repertoire' })
    const afterE5 = at(plan.root, ['e4', 'e5']) as MoveNode
    expect(afterE5.moves.map((m) => m.san)).toEqual(['Nc3'])
    expect(afterE5.moves[0].child).toMatchObject({ kind: 'covered', rep: { name: 'Vienna' } })
    expect(plan.coverage).toBeCloseTo(0.6)
    expect(plan.decisions.map((d) => d.title)).toEqual(['Against the Sicilian'])
    expect(planScore(plan, new Map([['Vienna', 0.5]]))).toBeCloseTo(0.3)
    expect(planScore(plan, new Map())).toBeNull()
  })

  it('brings up the Petrov when the Italian starts after 3.Bc4', () => {
    const italian = rep('Italian', 'white', ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'])
    const explorer = new Map([
      [keyAfter(E4), data([['e7e5', 'e5', 100]])],
      [keyAfter([...E4E5, 'g1f3']), data([['b8c6', 'Nc6', 80], ['g8f6', 'Nf6', 12], ['d7d6', 'd6', 8]])],
    ])
    const plan = buildPlan({ color: 'white', reps: [italian], choices: {}, explorer })
    expect(at(plan.root, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']).kind).toBe('covered')
    expect(plan.decisions.map((d) => [d.title, d.reach])).toEqual([
      ['Against the Petrov', 0.12],
      ['Against the Philidor', 0.08],
    ])
    expect(plan.coverage).toBeCloseTo(0.8)
  })

  it('counts only the first of two answers to the same position', () => {
    const italian = rep('Italian', 'white', ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'])
    const vienna = rep('Vienna', 'white', ['e2e4', 'e7e5', 'b1c3'])
    const plan = buildPlan({ color: 'white', reps: [italian, vienna], choices: {}, explorer: new Map() })
    const afterE5 = at(plan.root, ['e4', 'e5']) as MoveNode
    expect(afterE5.moves.map((m) => [m.san, m.child.counted])).toEqual([
      ['Nf3', true],
      ['Nc3', false],
    ])
    expect(plan.covered.map((c) => c.rep.name)).toEqual(['Italian'])
    expect(plan.offPlan).toEqual([])
    // An explicit choice comes first.
    const chosen = buildPlan({
      color: 'white',
      reps: [italian, vienna],
      choices: { [keyAfter(E4E5)]: 'b1c3' },
      explorer: new Map(),
    })
    expect((at(chosen.root, ['e4', 'e5']) as MoveNode).moves.map((m) => m.san)).toEqual(['Nc3', 'Nf3'])
  })

  it('covers everything under a repertoire and lists repertoires off the plan', () => {
    const french = rep('French', 'black', ['e2e4', 'e7e6'])
    const kid = rep('KID', 'black', ['d2d4', 'g8f6', 'c2c4', 'g7g6'])
    const whole = rep('Everything', 'white', [])
    const plan = buildPlan({ color: 'black', reps: [french, kid], choices: {}, explorer: new Map() })
    expect(at(plan.root, ['e4', 'e6']).kind).toBe('covered')
    // 1.d4 leads to the KID's start, so 1...Nf6 is implied there.
    expect((at(plan.root, ['d4']) as MoveNode).moves[0].san).toBe('Nf6')
    expect(plan.offPlan).toEqual([])

    const d4 = buildPlan({ color: 'black', reps: [french], choices: { [keyAfter(['d2d4'])]: 'd7d5' }, explorer: new Map() })
    expect(d4.decisions.map((d) => d.title)).toContain("Against the Queen's Gambit")

    // A repertoire from the initial position covers everything; one inside it is off the plan.
    const white = buildPlan({ color: 'white', reps: [whole, rep('Inside', 'white', ['e2e4', 'e7e5', 'b1c3'])], choices: {}, explorer: new Map() })
    expect(white.root.kind).toBe('covered')
    expect(white.coverage).toBe(1)
    expect(white.offPlan.map((r) => r.name)).toEqual(['Inside'])

    const moved = buildPlan({ color: 'white', reps: [rep('Vienna', 'white', ['e2e4', 'e7e5', 'b1c3'])], choices: { [keyAfter([])]: 'd2d4' }, explorer: new Map() })
    // After switching to 1.d4, the old 1.e4 repertoire is still shown but no longer counted.
    expect((moved.root as MoveNode).moves.map((m) => m.san)).toEqual(['d4', 'e4'])
    expect((moved.root as MoveNode).moves[1].child.counted).toBe(false)
  })
})
