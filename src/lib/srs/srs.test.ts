import { createEmptyCard } from 'ts-fsrs'
import { beforeEach, describe, expect, it } from 'vitest'
import { addLine, createRepertoire, loadMoves } from '../../db/repertoire'
import { recordAttempt } from '../../db/reviews'
import { AppDB } from '../../db/schema'
import { buildGraph, enumerateLines, type Line } from '../chess/graph'
import { planDrill, planLearn, planReview, type CardMap } from './plan'
import { gradeCard, isDue, State } from './scheduler'
import { LineRun } from './session'

const line = (id: string, cardKeys: string[], len = cardKeys.length * 2): Line => ({
  id,
  moves: Array.from({ length: len }, () => ({}) as never),
  cardKeys,
  end: 'leaf',
})

describe('planning', () => {
  const now = new Date('2026-09-24T12:00:00Z')
  const learned = (dueInDays: number) => {
    let c = createEmptyCard(new Date('2026-09-01'))
    c = gradeCard(c, true, new Date('2026-09-01')).card
    return { ...c, state: State.Review, due: new Date(now.getTime() + dueInDays * 86400e3) }
  }
  /** A well-known card: just reviewed, long memory, not weak. */
  const strong = () => ({ ...learned(30), last_review: now, stability: 100 })

  it('covers all due cards with as few lines as possible', () => {
    const cards: CardMap = new Map([
      ['a', learned(-1)],
      ['b', learned(-1)],
      ['c', learned(-1)],
      ['d', learned(5)],
    ])
    const lines = [line('1', ['a', 'b']), line('2', ['a', 'c']), line('3', ['a', 'b', 'c']), line('4', ['d'])]
    const runs = planReview(lines, cards, now)
    expect(runs.map((r) => r.line.id)).toEqual(['3'])
    expect(runs[0].focus).toEqual(['a', 'b', 'c'])
  })

  it('introduces new cards by weight up to the daily limit', () => {
    const cards: CardMap = new Map([
      ['a', createEmptyCard()],
      ['b', createEmptyCard()],
      ['c', createEmptyCard()],
    ])
    const lines = [line('1', ['a']), line('2', ['b']), line('3', ['c'])]
    const runs = planLearn(lines, cards, 2, (l) => (l.id === '3' ? 10 : 1))
    expect(runs.map((r) => r.line.id)).toEqual(['3', '1'])
  })

  it('drills weak cards starting two moves earlier', () => {
    const weak = { ...learned(-30), lapses: 3 }
    const cards: CardMap = new Map([
      ['x', strong()],
      ['y', weak],
    ])
    const l: Line = {
      id: 'l',
      moves: [
        { byMe: true, fromKey: 'x' },
        { byMe: false },
        { byMe: true, fromKey: 'p' },
        { byMe: false },
        { byMe: true, fromKey: 'q' },
        { byMe: false },
        { byMe: true, fromKey: 'y' },
      ] as never,
      cardKeys: ['x', 'p', 'q', 'y'],
      end: 'leaf',
    }
    const runs = planDrill([l], cards, now)
    expect(runs[0]).toMatchObject({ startPly: 2, endPly: 7, focus: ['y'] })
  })

  /** A line of `plies` moves, the owner's at even plies with card keys `${prefix}${ply}`. */
  const chain = (id: string, plies: number, prefix = ''): Line => {
    const moves = Array.from({ length: plies }, (_, i) =>
      i % 2 === 0 ? { byMe: true, fromKey: `${i < 10 ? '' : prefix}${i}` } : { byMe: false },
    )
    return {
      id,
      moves: moves as never,
      cardKeys: moves.filter((m) => m.byMe).map((m) => m.fromKey!),
      end: 'leaf',
    }
  }

  it('starts similar variations near where they split and skips the mastered tail', () => {
    // Two lines share plies 0-9 and split at ply 10.
    const a = chain('a', 16, 'a')
    const b = chain('b', 16, 'b')
    const cards: CardMap = new Map([...new Set([...a.cardKeys, ...b.cardKeys])].map((k) => [k, learned(5)]))
    cards.set('a12', learned(-1))
    cards.set('b10', learned(-1))
    cards.set('b14', learned(-1))
    const runs = planReview([a, b], cards, now)
    expect(runs.map((r) => [r.line.id, r.startPly, r.endPly, r.focus])).toEqual([
      ['a', 8, 13, ['a12']],
      ['b', 6, 15, ['b10', 'b14']],
    ])
  })

  it('drills weak cards on the same line in one run', () => {
    const l = chain('l', 12)
    const cards: CardMap = new Map(l.cardKeys.map((k) => [k, strong()]))
    cards.set('4', { ...learned(-30), lapses: 3 })
    cards.set('8', { ...learned(-30), lapses: 2 })
    const runs = planDrill([l], cards, now)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ startPly: 0, endPly: 9 })
    expect(runs[0].focus.sort()).toEqual(['4', '8'])
  })

  it('learns a new branch from near the branch point', () => {
    const l = chain('l', 14)
    const cards: CardMap = new Map(l.cardKeys.map((k) => [k, learned(10)]))
    cards.set('12', createEmptyCard())
    expect(planLearn([l], cards, 5)[0]).toMatchObject({ startPly: 8, endPly: 13, focus: ['12'] })
  })
})

describe('line runs and grading', () => {
  let d: AppDB
  let n = 0
  beforeEach(() => {
    d = new AppDB(`srs-${n++}`)
  })

  it('counts only the first attempt and requires the correct move after a mistake', async () => {
    const rep = await createRepertoire('Black', 'black', d)
    await addLine(rep, ['e2e4', 'c7c5', 'g1f3', 'd7d6'], {}, d)
    const [l] = enumerateLines(buildGraph(await loadMoves(rep.id, d), 'black'))
    const run = new LineRun({ line: l, startPly: 0, endPly: l.moves.length, focus: l.cardKeys }, 'review')
    expect(run.advanceAuto().san).toBe('e4')
    const wrong = run.submit('e7e5') // a good move, but not the repertoire move
    expect(wrong).toMatchObject({ kind: 'wrong', graded: true })
    expect(run.submit('e7e6')).toMatchObject({ kind: 'retry-wrong' })
    expect(run.submit('c7c5')).toMatchObject({ kind: 'correct', graded: false })
    run.advanceAuto()
    expect(run.submit('d7d6')).toMatchObject({ kind: 'correct', graded: true })
    expect(run.finished).toBe(true)
  })

  it('plays mastered moves by itself and jumps over long mastered stretches', async () => {
    const rep = await createRepertoire('White', 'white', d)
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3
    const ucis = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3']
    await addLine(rep, ucis, {}, d)
    const [l] = enumerateLines(buildGraph(await loadMoves(rep.id, d), 'white'))
    const focus = [l.moves[0].fromKey, l.moves[12].fromKey]
    const run = new LineRun({ line: l, startPly: 0, endPly: 13, focus }, 'review')
    expect(run.submit('e2e4')).toMatchObject({ kind: 'correct', graded: true })
    // The next focus move is 12 plies away: skip to its lead-in.
    expect(run.ply).toBe(8)
    expect(run.awaitingUser).toBe(false)
    expect(run.advanceAuto().san).toBe('O-O') // mastered, played for you
    run.advanceAuto()
    expect(run.advanceAuto().san).toBe('Re1')
    run.advanceAuto()
    expect(run.awaitingUser).toBe(true)
    expect(() => run.advanceAuto()).toThrow()
    expect(run.submit('a4b3')).toMatchObject({ kind: 'correct', graded: true })
    expect(run.finished).toBe(true)
  })

  it('reschedules new cards and only penalises early mistakes on cards not due', async () => {
    const rep = await createRepertoire('White', 'white', d)
    await addLine(rep, ['e2e4'], {}, d)
    const [card] = await d.cards.toArray()
    await recordAttempt(rep.id, card.positionKey, true, 'e2e4', 'learn', d)
    let c = (await d.cards.get(card.id))!
    expect(c.fsrs.state).not.toBe(State.New)
    // Force it into long-term review, far from due.
    await d.cards.update(card.id, { fsrs: { ...c.fsrs, state: State.Review, due: new Date(Date.now() + 10 * 86400e3) } })
    await recordAttempt(rep.id, card.positionKey, true, 'e2e4', 'review', d)
    c = (await d.cards.get(card.id))!
    expect(isDue(c.fsrs, new Date(Date.now() + 9 * 86400e3))).toBe(false)
    await recordAttempt(rep.id, card.positionKey, false, 'd2d4', 'review', d)
    c = (await d.cards.get(card.id))!
    expect(c.fsrs.lapses).toBe(1)
    expect(await d.reviews.count()).toBe(3)
  })
})
