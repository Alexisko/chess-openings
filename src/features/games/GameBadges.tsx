import type { ReactNode } from 'react'
import type { Game } from '../../db/schema'
import type { GameAnalysis, Outcome } from '../../lib/games/analyze'
import { evalTone, formatEval, type PosEval } from '../../lib/games/review'

// Small pieces shared by the recent games list and the game review.

const OUTCOME_TONE: Record<Outcome, { cls: string; label: string }> = {
  'in-prep': { cls: 'text-accent', label: 'Stayed in prep' },
  'opp-left': { cls: 'text-info', label: 'Opponent left your prep' },
  'prep-ended': { cls: 'text-warn', label: 'Your line ended' },
  forgot: { cls: 'text-bad', label: 'You forgot your move' },
  'not-covered': { cls: 'text-faint', label: 'No repertoire' },
}

const TONE_CLS = {
  ahead: 'bg-accent/15 text-accent',
  equal: 'bg-surface-3 text-ink',
  behind: 'bg-bad/15 text-bad',
}

/** Your moves played from your repertoire, coloured by how the game left it. */
export function PrepMoves({ a, suffix, className = '' }: { a: GameAnalysis; suffix?: ReactNode; className?: string }) {
  const tone = OUTCOME_TONE[a.outcome]
  return (
    <span className={`font-semibold ${tone.cls} ${className}`} title={tone.label}>
      {a.repertoireId ? `${a.ownMoves} ${suffix ?? `move${a.ownMoves === 1 ? '' : 's'}`}` : '–'}
    </span>
  )
}

export function EvalChip({ e, color, title }: { e: PosEval | null | undefined; color: Game['color']; title?: string }) {
  if (e === undefined) return <span className="h-6 w-12 animate-pulse rounded-md bg-surface-3" title="Evaluating…" />
  if (e === null) return <span className="w-12 rounded-md bg-surface-3 px-1.5 py-0.5 text-center text-sm text-faint">–</span>
  return (
    <span className={`w-12 rounded-md px-1.5 py-0.5 text-center text-sm font-semibold tabular-nums ${TONE_CLS[evalTone(e, color)]}`} title={title}>
      {formatEval(e, color)}
    </span>
  )
}

export function ResultBadge({ result, size = 'h-8 w-8' }: { result: Game['result']; size?: string }) {
  const [label, cls, title] =
    result === 'win' ? ['W', 'bg-accent/20 text-accent', 'Won'] : result === 'loss' ? ['L', 'bg-bad/20 text-bad', 'Lost'] : ['½', 'bg-surface-3 text-muted', 'Drawn']
  return (
    <span className={`grid ${size} shrink-0 place-items-center rounded-lg font-display text-base font-semibold ${cls}`} title={title}>
      {label}
    </span>
  )
}

