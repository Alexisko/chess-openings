import { Link } from 'react-router'
import type { Card as FsrsCard } from 'ts-fsrs'
import type { Repertoire } from '../db/schema'
import { chapterNodes, type Chapter } from '../lib/openings/chapters'
import { chapterTrainUrl } from '../lib/routes'
import { isDue, isNew } from '../lib/srs/scheduler'
import { pct, scoreColor } from './format'
import { BookIcon, TargetIcon, TrainIcon } from './icons'

/** Review / Learn / Train for one chapter (with its sub-chapters), with its preparedness. */
export function ChapterTraining({
  rep,
  chapter,
  cards,
  score,
  built,
  compact = false,
}: {
  rep: Repertoire
  chapter: Chapter
  cards: ReadonlyMap<string, FsrsCard>
  /** Preparedness from the chapter's start, if known. */
  score?: number
  /** The same with every prepared move known: how complete the chapter is, to the target move. */
  built?: number
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
      {built !== undefined && (
        <span className="text-xs text-muted" title="Built: how complete this chapter is to your target move, counting every prepared move as known">
          Built <span className={`font-semibold tabular-nums ${scoreColor(built)}`}>{pct(built)}</span>
        </span>
      )}
      {score !== undefined && (
        <span className="mr-1 text-xs text-muted" title="Preparedness from the start of this chapter">
          {compact ? 'Prep' : 'Prepared'} <span className={`font-semibold tabular-nums ${scoreColor(score)}`}>{pct(score)}</span>
        </span>
      )}
      <Link className={`${btn} ${due ? '' : 'pointer-events-none opacity-40'}`} to={chapterTrainUrl('review', rep.id, chapter)}>
        <TrainIcon size={14} /> Review{due > 0 && <span className="tabular-nums text-brass">{due}</span>}
      </Link>
      <Link className={`${btn} ${fresh ? '' : 'pointer-events-none opacity-40'}`} to={chapterTrainUrl('learn', rep.id, chapter)}>
        <BookIcon size={14} /> Learn{fresh > 0 && <span className="tabular-nums text-brass">{fresh}</span>}
      </Link>
      <Link className={btn} to={chapterTrainUrl('train', rep.id, chapter)} title="Test any move you have learned, weak ones more often">
        <TargetIcon size={14} /> Train
      </Link>
    </div>
  )
}
