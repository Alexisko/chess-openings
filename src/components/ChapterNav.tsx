import type { ReactNode } from 'react'
import type { TreeNode } from '../lib/chess/tree'
import { chapterShare, firstMove, type Chapter, type Chapters } from '../lib/openings/chapters'
import { pct } from './format'
import { NextIcon, PrevIcon } from './icons'

const depthOf = (ch: Chapter) => {
  let d = 0
  for (let p = ch.parent; p; p = p.parent) d++
  return d
}

/** Chapters as an outline: sub-chapters indented below the chapter they branch from. */
export function ChapterList({
  tree,
  chapters,
  selected,
  onSelect,
  share,
  extra,
}: {
  tree: TreeNode
  chapters: Chapters
  selected: Chapter
  onSelect: (ch: Chapter) => void
  share?: (parent: TreeNode, child: TreeNode) => number | undefined
  /** Something to show on a chapter's row, e.g. its preparedness. */
  extra?: (ch: Chapter) => ReactNode
}) {
  return (
    <ol className="flex flex-col py-1">
      {chapters.list.map((ch, i) => {
        const on = ch === selected
        const s = chapterShare(tree, ch, share)
        return (
          <li key={ch.id}>
            <button
              onClick={() => onSelect(ch)}
              style={{ paddingLeft: `${0.75 + depthOf(ch) * 1.1}rem` }}
              className={`flex w-full items-baseline gap-2 border-l-2 py-1.5 pr-3 text-left text-sm transition ${
                on ? 'border-brass bg-brass/10' : 'border-transparent hover:bg-surface-2'
              }`}
            >
              <span className="w-5 shrink-0 text-right text-[11px] text-faint tabular-nums">{i + 1}</span>
              <span className={`min-w-0 truncate font-display text-[15px] ${on ? 'text-ink' : 'text-ink/90'}`} title={ch.name}>
                {ch.title}
              </span>
              <span className="shrink-0 text-xs text-faint">{firstMove(ch)}</span>
              <span className="ml-auto flex shrink-0 items-baseline gap-2 text-[11px] text-faint tabular-nums">
                {extra?.(ch)}
                {s !== undefined && <span>{pct(s)}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** Previous / next chapter buttons around a title or a menu. */
export function ChapterStepper({
  chapters,
  selected,
  onSelect,
  children,
}: {
  chapters: Chapters
  selected: Chapter
  onSelect: (ch: Chapter) => void
  children: ReactNode
}) {
  const i = chapters.list.indexOf(selected)
  const step = (d: number) => {
    const ch = chapters.list[i + d]
    if (ch) onSelect(ch)
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <button className="rounded-md p-1 text-muted hover:bg-surface-3 hover:text-ink disabled:opacity-30" onClick={() => step(-1)} disabled={i <= 0} aria-label="Previous chapter">
        <PrevIcon size={15} />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
      <button
        className="rounded-md p-1 text-muted hover:bg-surface-3 hover:text-ink disabled:opacity-30"
        onClick={() => step(1)}
        disabled={i < 0 || i >= chapters.list.length - 1}
        aria-label="Next chapter"
      >
        <NextIcon size={15} />
      </button>
    </div>
  )
}
