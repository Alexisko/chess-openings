import { addDays, type Streak } from '../lib/srs/streak'
import { FlameIcon } from './icons'

const moves = (n: number) => `${n} move${n === 1 ? '' : 's'}`
const more = (n: number) => `${n} more move${n === 1 ? '' : 's'}`

/** What's left to do today, as a sentence. */
function todayText(s: Streak): string {
  if (s.goalMet) return s.best > s.current ? `Daily goal met · best ${s.best} days` : 'Daily goal met'
  const todo = s.done ? `${more(s.goal - s.done)} today` : `Answer ${moves(s.goal)} today`
  return `${todo} to ${s.current ? 'keep it' : 'start one'}`
}

/** The streak, today's progress towards the goal and the last seven days. */
export function StreakRow({ streak: s }: { streak: Streak }) {
  const week = Array.from({ length: 7 }, (_, i) => addDays(s.today, i - 6))
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <FlameIcon size={24} className={`shrink-0 ${s.goalMet ? 'text-brass' : s.current ? 'text-maple' : 'text-faint'}`} />
      <div className="min-w-0 flex-1">
        <div className="font-display text-[15px] leading-tight font-medium">
          {s.current ? `${s.current}-day streak` : 'No streak yet'}
        </div>
        <div className="mt-0.5 text-xs text-muted">{todayText(s)}</div>
      </div>
      <ol className="flex shrink-0 gap-1.5" aria-label="The last seven days">
        {week.map((day) => {
          const n = s.days.get(day) ?? 0
          const met = n >= s.goal
          const isToday = day === s.today
          const progress = Math.min(1, n / s.goal)
          const weekday = new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'narrow' })
          return (
            <li key={day} className="flex flex-col items-center gap-1" title={`${day}: ${moves(n)}`}>
              <span
                className={`block h-3.5 w-3.5 rounded-full ${met ? 'bg-brass' : ''} ${isToday && !met ? 'ring-1 ring-brass/60' : ''}`}
                style={
                  met
                    ? undefined
                    : { background: `conic-gradient(var(--color-brass) ${progress * 360}deg, var(--color-surface-3) 0)` }
                }
              />
              <span className={`text-[10px] leading-none ${isToday ? 'font-semibold text-ink' : 'text-faint'}`}>{weekday}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** One line for the end of a session. */
export function StreakNote({ streak: s }: { streak: Streak }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <FlameIcon size={17} className={`shrink-0 ${s.goalMet ? 'text-brass' : 'text-faint'}`} />
      {s.goalMet ? (
        <span>
          <span className="font-medium text-ink">{s.current}-day streak</span> · daily goal met
        </span>
      ) : (
        <span>
          {more(s.goal - s.done)} today to {s.current ? `keep your ${s.current}-day streak` : 'start a streak'}.
        </span>
      )}
    </p>
  )
}
