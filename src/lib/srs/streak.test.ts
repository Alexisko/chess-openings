import { describe, expect, it } from 'vitest'
import type { ReviewMode } from '../../db/schema'
import { addDays, computeStreak, localDay } from './streak'

/** `n` answers at noon on a local day. */
const answers = (day: string, n: number, mode: ReviewMode = 'review') => {
  const [y, m, d] = day.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => ({ ts: new Date(y, m - 1, d, 12, 0, i).getTime(), mode }))
}
const noon = (day: string) => answers(day, 1)[0].ts

describe('computeStreak', () => {
  it('counts the days in a row up to today', () => {
    const logs = [...answers('2026-10-03', 10), ...answers('2026-10-04', 12), ...answers('2026-10-05', 10), ...answers('2026-10-06', 11)]
    const s = computeStreak(logs, 10, noon('2026-10-06'))
    expect(s).toMatchObject({ today: '2026-10-06', done: 11, goalMet: true, current: 4, best: 4, lastGoalDay: '2026-10-06', lastStreak: 4 })
  })

  it("keeps yesterday's streak alive until today is over", () => {
    const logs = [...answers('2026-10-04', 10), ...answers('2026-10-05', 10), ...answers('2026-10-06', 3)]
    const s = computeStreak(logs, 10, noon('2026-10-06'))
    expect(s).toMatchObject({ done: 3, goalMet: false, current: 2, lastGoalDay: '2026-10-05', lastStreak: 2 })
  })

  it('breaks on a missed day and remembers the best run', () => {
    const logs = [...answers('2026-09-01', 10), ...answers('2026-09-02', 10), ...answers('2026-09-03', 10), ...answers('2026-10-05', 10)]
    expect(computeStreak(logs, 10, noon('2026-10-07'))).toMatchObject({ current: 0, best: 3, lastGoalDay: '2026-10-05', lastStreak: 1 })
  })

  it('needs the whole goal, and ignores moves from games', () => {
    const logs = [...answers('2026-10-06', 9), ...answers('2026-10-06', 5, 'game')]
    expect(computeStreak(logs, 10, noon('2026-10-06'))).toMatchObject({ done: 9, goalMet: false, current: 0, best: 0, lastStreak: 0 })
  })
})

describe('jokers', () => {
  it('saves a missed day and keeps the streak going', () => {
    const logs = [...answers('2026-10-03', 10), ...answers('2026-10-04', 10), ...answers('2026-10-06', 10)]
    const s = computeStreak(logs, 10, noon('2026-10-06'), ['2026-10-03'])
    expect(s).toMatchObject({ current: 3, best: 3, jokers: 0, lastGoalDay: '2026-10-06' })
    expect([...s.saved]).toEqual(['2026-10-05'])
  })

  it('is spent once, and only from the day after it was earned', () => {
    const logs = [...answers('2026-10-03', 10), ...answers('2026-10-04', 10)]
    // Earned on the missed day itself: too late for it.
    expect(computeStreak(logs, 10, noon('2026-10-06'), ['2026-10-05'])).toMatchObject({ current: 0, jokers: 1 })
    // One joker, two missed days.
    const s = computeStreak(logs, 10, noon('2026-10-07'), ['2026-10-04'])
    expect(s).toMatchObject({ current: 0, best: 2, jokers: 0 })
    expect([...s.saved]).toEqual(['2026-10-05'])
  })

  it('is kept for later when there is no streak to save', () => {
    const logs = [...answers('2026-10-01', 3), ...answers('2026-10-04', 10), ...answers('2026-10-06', 10)]
    const s = computeStreak(logs, 10, noon('2026-10-06'), ['2026-10-01'])
    expect(s).toMatchObject({ current: 2, jokers: 0 })
    expect([...s.saved]).toEqual(['2026-10-05'])
  })

  it('adds up, one a day', () => {
    const earned = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
    expect(computeStreak([], 10, noon('2026-10-06'), earned)).toMatchObject({ jokers: 4, jokerToday: false })
    expect(computeStreak([], 10, noon('2026-10-04'), earned)).toMatchObject({ jokers: 4, jokerToday: true })
    // Three of them save three missed days.
    const logs = [...answers('2026-10-04', 10), ...answers('2026-10-08', 10)]
    expect(computeStreak(logs, 10, noon('2026-10-08'), earned)).toMatchObject({ current: 2, jokers: 1 })
  })

  it('tells how long the streak lasts without training', () => {
    const logs = [...answers('2026-10-04', 10), ...answers('2026-10-05', 10)]
    expect(computeStreak(logs, 10, noon('2026-10-06')).keptUntil).toBe('2026-10-06')
    expect(computeStreak(logs, 10, noon('2026-10-06'), ['2026-10-04']).keptUntil).toBe('2026-10-07')
    // Today's joker can't save today, but it can save tomorrow.
    expect(computeStreak(logs, 10, noon('2026-10-06'), ['2026-10-06']).keptUntil).toBe('2026-10-06')
    expect(computeStreak(logs, 10, noon('2026-10-06'), ['2026-10-04', '2026-10-06']).keptUntil).toBe('2026-10-08')
    // Met today: tomorrow, then one more day per joker.
    expect(computeStreak(logs, 10, noon('2026-10-05'), ['2026-10-05']).keptUntil).toBe('2026-10-07')
    expect(computeStreak([], 10, noon('2026-10-06'), ['2026-10-04']).keptUntil).toBeUndefined()
  })
})

describe('days', () => {
  it('steps across months and years', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
  })
})
