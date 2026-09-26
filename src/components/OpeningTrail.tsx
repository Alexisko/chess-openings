import { shortName, type NameStep } from '../lib/openings/names'

/**
 * The opening name of the current position, after the name it changed from
 * ("Vienna Game → Vienna Gambit"). The whole trail is in the tooltip.
 */
export function OpeningTrail({ trail, compact = false, className = '' }: { trail: NameStep[]; compact?: boolean; className?: string }) {
  const current = trail.at(-1)
  if (!current) return null
  const previous = trail.at(-2)
  const label = shortName(current.opening.name, previous?.opening.name)
  const title = trail.map((s) => s.opening.name).join(' → ')

  if (compact)
    return (
      <span className={`flex min-w-0 items-baseline gap-1 italic ${className}`} title={title}>
        {previous && (
          <>
            <span className="min-w-0 truncate text-faint">{previous.opening.name}</span>
            <span className="shrink-0 text-faint not-italic">→</span>
          </>
        )}
        <span className="max-w-[75%] shrink-0 truncate text-muted">{label}</span>
      </span>
    )

  return (
    <div className={`flex min-w-0 items-baseline gap-2 ${className}`} title={title}>
      {current.opening.eco && (
        <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-brass">
          {current.opening.eco}
        </span>
      )}
      {previous && (
        <>
          <span className="min-w-0 truncate text-sm text-muted">{previous.opening.name}</span>
          <span className="shrink-0 text-sm text-faint">→</span>
        </>
      )}
      <span key={current.opening.name} className="max-w-[75%] shrink-0 animate-pop truncate font-display text-[15px] italic">
        {label}
      </span>
    </div>
  )
}
