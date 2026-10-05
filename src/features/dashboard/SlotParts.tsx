import { Link } from 'react-router'
import { TrainIcon } from '../../components/icons'
import type { Slot, SlotAction } from './slots'

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
 * The games a reply loses from your preparation, as a bar scaled to the
 * costliest reply: what isn't built, then what is built but forgotten.
 */
export function CostBar({ cost, max, open = false }: { cost: NonNullable<Slot['cost']>; max: number; open?: boolean }) {
  const w = (x: number) => `${max ? (x / max) * 100 : 0}%`
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-line/50" aria-hidden>
      <div
        className={open ? 'border border-dashed border-warn/60 bg-warn/15' : 'bg-line-strong'}
        style={{ width: w(cost.notBuilt), borderRadius: 'inherit' }}
      />
      <div className="bg-maple" style={{ width: w(cost.forgotten) }} />
    </div>
  )
}
