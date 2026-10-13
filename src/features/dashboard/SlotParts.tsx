import { Link } from 'react-router'
import { TrainIcon } from '../../components/icons'
import { KNOWLEDGE_FILL } from '../../components/knowledgeColors'
import type { LineEnd } from '../../lib/prep/lineDepths'
import { KNOWLEDGE_ORDER } from '../../lib/srs/knowledge'
import type { SlotAction } from './slots'

const ACTION_VERB: Record<SlotAction['kind'], string> = {
  review: 'Review',
  build: 'Build it',
  reply: 'Reply to',
  extend: 'Extend after',
}

/** A slot's next step as a small button: Review 4, Reply to 2…b6, Extend after 6.Bb5. */
export function ActionLink({ action, primary = false, className = '' }: { action: SlotAction; primary?: boolean; className?: string }) {
  return (
    <Link
      to={action.to}
      title={action.title}
      onClick={(e) => e.stopPropagation()}
      className={`${primary ? 'btn-primary' : 'btn-ghost'} shrink-0 gap-1.5 px-2.5 py-1.5 text-xs ${className}`}
    >
      {action.kind === 'review' && <TrainIcon size={14} />}
      {ACTION_VERB[action.kind]}
      {action.detail &&
        (action.kind === 'review' ? (
          <span className={`font-semibold tabular-nums ${primary ? '' : 'text-maple'}`}>{action.detail}</span>
        ) : (
          <span className="font-display text-[13px]">{action.detail}</span>
        ))}
    </Link>
  )
}

/**
 * A reply's lines along your move numbers: one dot per line, at the move
 * where it ends, coloured by its weakest move. The dashed mark is the prep
 * depth target; lines left of it stop before you get there. Dots on one move
 * stack from best to weakest. Lines deeper than `max` sit at its edge.
 */
export function DepthStrip({ lines, target, max }: { lines: LineEnd[]; target: number; max: number }) {
  const W = 240
  const x = (m: number) => 6 + (Math.min(m, max) / max) * (W - 12)
  const columns = new Map<number, LineEnd[]>()
  for (const l of lines) {
    const m = Math.min(l.depth, max)
    columns.set(m, [...(columns.get(m) ?? []), l])
  }
  const edge = x(target - 0.5)
  return (
    <svg viewBox={`0 0 ${W} 34`} className="block h-auto w-full overflow-visible" aria-hidden>
      <rect x="0" y="0" width={edge} height="26" rx="3" className="fill-warn/10" />
      <line x1="0" x2={W} y1="25.5" y2="25.5" className="stroke-line" />
      <line x1={edge} x2={edge} y1="0" y2="26" strokeDasharray="2 2" className="stroke-brass" />
      {[...columns].flatMap(([m, col]) => {
        const sorted = [...col].sort((a, b) => KNOWLEDGE_ORDER.indexOf(a.level) - KNOWLEDGE_ORDER.indexOf(b.level))
        const step = sorted.length > 4 ? 18 / (sorted.length - 1) : 5.2
        return sorted.map((l, i) => (
          <circle
            key={l.id}
            cx={x(m)}
            cy={22 - i * step}
            r={l.level === 'new' ? 2.1 : 2.3}
            strokeWidth={l.level === 'new' ? 1.1 : 0}
            className={KNOWLEDGE_FILL[l.level]}
          />
        ))
      })}
      <text x={x(target)} y="33" textAnchor="middle" className="fill-brass text-[8px] tabular-nums">
        move {target}
      </text>
      <text x={x(max)} y="33" textAnchor="middle" className="fill-faint text-[8px] tabular-nums">
        {max}
      </text>
    </svg>
  )
}
