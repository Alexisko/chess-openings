import { createEmptyCard } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { describeRecord, knowledgeOf, recordsFromLogs, weakness, withResult, type MoveRecord } from './knowledge'
import { State } from './scheduler'

const now = new Date('2026-09-30T12:00:00Z')
const day = 86400e3

/** A learned card last reviewed `ago` days ago, with a memory lasting `stability` days. */
const card = (stability: number, ago = 1) => ({
  ...createEmptyCard(now),
  state: State.Review,
  stability,
  difficulty: 5,
  reps: 5,
  last_review: new Date(now.getTime() - ago * day),
  due: new Date(now.getTime() + stability * day),
})

const answers = (...results: boolean[]): MoveRecord =>
  results.reduce<MoveRecord | undefined>((r, ok, i) => withResult(r, ok, i), undefined)!

describe('move knowledge', () => {
  it('builds records from logs in time order', () => {
    const recs = recordsFromLogs([
      { cardId: 'a', ts: 3, correct: true },
      { cardId: 'a', ts: 1, correct: false },
      { cardId: 'a', ts: 2, correct: true },
      { cardId: 'b', ts: 1, correct: true },
    ])
    expect(recs.get('a')).toEqual({ attempts: 3, correct: 2, streak: 2, recent: [true, true, false], lastTs: 3 })
    expect(recs.get('b')?.streak).toBe(1)
  })

  it('forgets old mistakes once the move is played right again and again', () => {
    // Missed three times, long ago; right a dozen times since.
    const rec = answers(false, false, false, ...Array(12).fill(true))
    expect(weakness(card(40), rec, now)).toBeLessThan(0.05)
    expect(knowledgeOf(card(40), rec, now)).toBe('mastered')
  })

  it('treats a fresh miss as weak, fading with each right answer', () => {
    const c = card(10)
    const missed = answers(true, true, true, false)
    const w0 = weakness(c, missed, now)
    const w1 = weakness(c, withResult(missed, true, 9), now)
    const w3 = weakness(c, answers(true, true, true, false, true, true, true), now)
    expect(w0).toBeGreaterThan(0.7)
    expect(w1).toBeLessThan(w0)
    expect(w3).toBeLessThan(0.15)
    expect(knowledgeOf(c, missed, now)).toBe('shaky')
  })

  it('grades levels', () => {
    expect(knowledgeOf(createEmptyCard(now), undefined, now)).toBe('new')
    expect(knowledgeOf(card(10), answers(true), now)).toBe('learning')
    expect(knowledgeOf(card(10), answers(true, true, true), now)).toBe('solid')
    expect(knowledgeOf(card(10), answers(false, true, false, true, true), now)).toBe('shaky')
    // Long overdue: probably forgotten, whatever the streak.
    expect(knowledgeOf(card(2, 60), answers(true, true, true, true), now)).toBe('shaky')
  })

  it('describes a record', () => {
    expect(describeRecord(undefined)).toBe('never asked yet')
    expect(describeRecord(answers(false, true, true, true))).toBe('3 in a row · 3/4 right')
    expect(describeRecord(answers(true, false))).toBe('missed last time · 1/2 right')
  })
})
