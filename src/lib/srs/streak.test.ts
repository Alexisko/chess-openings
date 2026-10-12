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

describe('days', () => {
  it('steps across months and years', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
  })
})
