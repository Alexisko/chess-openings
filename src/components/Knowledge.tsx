import { ChevronDown } from './icons'
import { KNOWLEDGE_HELP, KNOWLEDGE_LABEL, KNOWLEDGE_ORDER, type Knowledge } from '../lib/srs/knowledge'

// Graded like every score: moss for known, amber in between, oxblood for weak.
const KNOWLEDGE_BG: Record<Knowledge, string> = {
  mastered: 'bg-accent',
  solid: 'bg-accent/40',
  learning: 'bg-warn',
  shaky: 'bg-bad',
  new: 'bg-line-strong',
}

const KNOWLEDGE_TEXT: Record<Knowledge, string> = {
  mastered: 'text-accent',
  solid: 'text-accent',
  learning: 'text-warn',
  shaky: 'text-bad',
  new: 'text-faint',
}

/** A knowledge level as a coloured dot and its name. */
export function KnowledgeChip({ level, className = '' }: { level: Knowledge; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${KNOWLEDGE_TEXT[level]} ${className}`} title={KNOWLEDGE_HELP[level]}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${KNOWLEDGE_BG[level]}`} />
      {KNOWLEDGE_LABEL[level]}
    </span>
  )
}

/** How many moves are at each level, as one stacked bar with a legend. */
export function KnowledgeBar({
  counts,
  hideNew = false,
  explain = false,
}: {
  counts: Record<Knowledge, number>
  hideNew?: boolean
  /** Adds "What the levels mean": the legend's tooltips don't exist on a phone. */
  explain?: boolean
}) {
  const levels = KNOWLEDGE_ORDER.filter((l) => !hideNew || l !== 'new')
  const total = levels.reduce((s, l) => s + counts[l], 0)
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-line/70">
        {total > 0 &&
          levels.map((l) =>
            counts[l] ? (
              <div
                key={l}
                className={`${KNOWLEDGE_BG[l]} transition-[width] duration-700 ease-out`}
                style={{ width: `${(counts[l] / total) * 100}%` }}
                title={`${counts[l]} ${KNOWLEDGE_LABEL[l].toLowerCase()}`}
              />
            ) : null,
          )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted">
        {levels.map((l) => (
          <span key={l} className="flex items-center gap-1.5" title={KNOWLEDGE_HELP[l]}>
            <span className={`h-2 w-2 rounded-full ${KNOWLEDGE_BG[l]}`} />
            <span className="font-medium text-ink tabular-nums">{counts[l]}</span> {KNOWLEDGE_LABEL[l].toLowerCase()}
          </span>
        ))}
      </div>
      {explain && (
        <details className="group mt-2 text-xs text-muted">
          <summary className="inline-flex cursor-pointer items-center gap-1 select-none hover:text-ink">
            What the levels mean <ChevronDown size={12} className="transition group-open:rotate-180" />
          </summary>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {levels.map((l) => (
              <div key={l} className="contents">
                <dt>
                  <KnowledgeChip level={l} />
                </dt>
                <dd>{KNOWLEDGE_HELP[l]}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  )
}
