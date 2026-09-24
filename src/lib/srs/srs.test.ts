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
      ['x', learned(10)],
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
    expect(runs[0]).toMatchObject({ startPly: 2, focus: ['y'] })
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
    const run = new LineRun({ line: l, startPly: 0, focus: [] }, 'review')
    expect(run.advanceOpponent().san).toBe('e4')
    const wrong = run.submit('e7e5') // a good move, but not the repertoire move
    expect(wrong).toMatchObject({ kind: 'wrong', graded: true })
    expect(run.submit('e7e6')).toMatchObject({ kind: 'retry-wrong' })
    expect(run.submit('c7c5')).toMatchObject({ kind: 'correct', graded: false })
    run.advanceOpponent()
    expect(run.submit('d7d6')).toMatchObject({ kind: 'correct', graded: true })
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
