import { Link } from 'react-router'
import type { Card as FsrsCard } from 'ts-fsrs'
import type { Repertoire } from '../db/schema'
import { chapterNodes, type Chapter } from '../lib/openings/chapters'
import { trainUrl } from '../lib/routes'
import { isDue, isNew } from '../lib/srs/scheduler'
import { pct, scoreColor } from './format'
import { BookIcon, TargetIcon, TrainIcon } from './icons'

/** Review / Learn / Drill for one chapter (with its sub-chapters), with its preparedness. */
export function ChapterTraining({
  rep,
  chapter,
  cards,
  score,
  compact = false,
}: {
  rep: Repertoire
  chapter: Chapter
  cards: ReadonlyMap<string, FsrsCard>
  /** Preparedness from the chapter's start, if known. */
  score?: number
  compact?: boolean
}) {
  const now = new Date()
  const keys = new Set(chapterNodes(chapter).map((n) => n.key))
  const own = [...keys].map((k) => cards.get(k)).filter((c) => c !== undefined)
  const due = own.filter((c) => isDue(c, now)).length
  const fresh = own.filter((c) => isNew(c)).length
  const btn = `btn-ghost ${compact ? 'gap-1.5 px-2 py-1 text-xs' : ''}`
  return (
    <div className={`flex flex-wrap items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
      {score !== undefined && (
        <span className="mr-1 text-xs text-muted" title="Preparedness from the start of this chapter">
          {compact ? 'Prep' : 'Prepared'} <span className={`font-semibold tabular-nums ${scoreColor(score)}`}>{pct(score)}</span>
        </span>
      )}
      <Link className={`${btn} ${due ? '' : 'pointer-events-none opacity-40'}`} to={trainUrl('review', rep.id, chapter)}>
        <TrainIcon size={14} /> Review{due > 0 && <span className="tabular-nums text-brass">{due}</span>}
      </Link>
      <Link className={`${btn} ${fresh ? '' : 'pointer-events-none opacity-40'}`} to={trainUrl('learn', rep.id, chapter)}>
        <BookIcon size={14} /> Learn{fresh > 0 && <span className="tabular-nums text-brass">{fresh}</span>}
      </Link>
      <Link className={btn} to={trainUrl('drill', rep.id, chapter)}>
        <TargetIcon size={14} /> Drill
      </Link>
    </div>
  )
}
