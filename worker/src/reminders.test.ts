import { describe, expect, it } from 'vitest'
import { addDays, dayKey, nextFire, parseStatus, reminderMessage, type TrainingStatus } from './reminders'

describe('nextFire', () => {
  it('fires later today, or tomorrow once the time has passed', () => {
    const morning = Date.parse('2026-10-06T06:00:00Z') // 08:00 in Paris (UTC+2)
    expect(new Date(nextFire('19:00', 'Europe/Paris', morning)).toISOString()).toBe('2026-10-06T17:00:00.000Z')
    const evening = Date.parse('2026-10-06T18:00:00Z')
    expect(new Date(nextFire('19:00', 'Europe/Paris', evening)).toISOString()).toBe('2026-10-07T17:00:00.000Z')
  })

  it('keeps the local time across a DST change', () => {
    // Paris goes back to UTC+1 on 25 October 2026.
    const before = Date.parse('2026-10-24T18:00:00Z')
    expect(new Date(nextFire('19:00', 'Europe/Paris', before)).toISOString()).toBe('2026-10-25T18:00:00.000Z')
  })

  it('works west of UTC across midnight UTC', () => {
    const t = Date.parse('2026-10-07T02:00:00Z') // 19:00 on the 6th in Los Angeles (UTC-7)
    expect(new Date(nextFire('21:30', 'America/Los_Angeles', t)).toISOString()).toBe('2026-10-07T04:30:00.000Z')
  })
})

describe('days', () => {
  it('reads the local day and steps across months', () => {
    expect(dayKey(Date.parse('2026-10-06T23:30:00Z'), 'Europe/Paris')).toBe('2026-10-07')
    expect(dayKey(Date.parse('2026-10-06T23:30:00Z'), 'UTC')).toBe('2026-10-06')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('reminderMessage', () => {
  const now = Date.parse('2026-10-06T17:00:00Z')
  const hour = (iso: string) => Math.floor(Date.parse(iso) / 3_600_000)
  const status: TrainingStatus = {
    goal: 10,
    recent: { '2026-10-05': 12 },
    lastGoalDay: '2026-10-05',
    streak: 6,
    due: [
      [hour('2026-10-01T09:00:00Z'), 3],
      [hour('2026-10-06T16:20:00Z'), 2],
      [hour('2026-10-07T09:00:00Z'), 5],
    ],
  }

  it('asks to keep the streak and counts the moves due by now', () => {
    expect(reminderMessage(status, 'UTC', now)).toEqual({
      title: 'Keep your 6-day streak',
      body: '5 moves to review. Answer 10 moves today to keep it going.',
      url: 'train?mode=review',
      badge: 5,
    })
  })

  it('counts what is left of the goal', () => {
    const m = reminderMessage({ ...status, recent: { '2026-10-06': 9 }, due: [] }, 'UTC', now)
    expect(m?.body).toBe('1 more move today to keep it going.')
    expect(m?.url).toBe('')
  })

  it('says nothing once the goal is met', () => {
    expect(reminderMessage({ ...status, recent: { '2026-10-06': 10 } }, 'UTC', now)).toBeNull()
  })

  it('offers a new streak when the last one ended', () => {
    const m = reminderMessage({ ...status, lastGoalDay: '2026-10-03', due: [] }, 'UTC', now)
    expect(m).toMatchObject({ title: 'Time to train', body: 'Answer 10 moves today to start a streak.' })
  })
})

describe('parseStatus', () => {
  it('accepts a status and rejects malformed ones', () => {
    const ok = { goal: 10, recent: { '2026-10-06': 3 }, streak: 0, due: [[1, 2]] }
    expect(parseStatus(ok)).toEqual({ ...ok, lastGoalDay: undefined })
    expect(parseStatus({ ...ok, goal: 0 })).toBeNull()
    expect(parseStatus({ ...ok, recent: { yesterday: 3 } })).toBeNull()
    expect(parseStatus({ ...ok, due: [[1]] })).toBeNull()
  })
})
