import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GLYPH_NAMES, GLYPH_TONE, type Glyph } from '../lib/chess/glyphs'
import { findNode, moveNumber, type TreeNode } from '../lib/chess/tree'
import type { Chapter, Chapters } from '../lib/openings/chapters'
import { pct } from './format'
import { Popover } from './Popover'

interface Props {
  tree: TreeNode
  chapters: Chapters
  chapter: Chapter
  /** Path (UCI from the start) of the node shown on the board. */
  current: string[]
  onJump: (path: string[]) => void
  /** Share of games for an opponent move at a branch point, if known. */
  share?: (parent: TreeNode, child: TreeNode) => number | undefined
  /** Names of other repertoires a move joins (transposition across repertoires). */
  crossNote?: (parent: TreeNode, child: TreeNode) => string[]
  /** Symbol to show on a move (default: the one set by the user). */
  glyphOf?: (node: TreeNode, parent: TreeNode) => Glyph | undefined
  /**
   * Editor for a move's annotations, opened by clicking the current move
   * (nothing for moves that can't be annotated).
   */
  annotate?: (node: TreeNode, parent: TreeNode, close: () => void) => ReactNode
}

const id = (path: string[]) => path.join(',')

interface Row {
  n: number
  white?: { node: TreeNode; parent: TreeNode }
  black?: { node: TreeNode; parent: TreeNode }
}

/**
 * One chapter's lines, laid out like the Lichess move list: the chapter's
 * main line in a two-column table, broken after a move by its comment and by
 * the other replies there. Each side line gets its own row, with the
 * branches inside it in parentheses; replies that start another chapter
 * link to it.
 */
export function ChapterLines({
  tree,
  chapters,
  chapter,
  current,
  onJump,
  share,
  crossNote,
  glyphOf = (n) => n.glyph || undefined,
  annotate,
}: Props) {
  const currentId = id(current)
  const currentRef = useRef<HTMLButtonElement>(null)
  // The editor is open on the current move; moving elsewhere closes it.
  const [editing, setEditing] = useState(false)
  const [editingAt, setEditingAt] = useState(currentId)
  if (editingAt !== currentId) {
    setEditingAt(currentId)
    setEditing(false)
  }
  const close = () => setEditing(false)

  // Keep the current move visible inside the panel's own scroll box, never scrolling the page.
  useEffect(() => {
    const el = currentRef.current
    const box = el?.closest<HTMLElement>('[data-tree-scroll]')
    if (!el || !box || box.scrollHeight <= box.clientHeight) return
    const e = el.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (e.top < b.top) box.scrollTop -= b.top - e.top + 8
    else if (e.bottom > b.bottom) box.scrollTop += e.bottom - b.bottom + 8
  }, [currentId])

  /** The reply that continues the line, the other replies in the chapter, and replies that start a chapter. */
  const split = (node: TreeNode) => {
    const stay = node.children.filter((c) => !chapters.startingAt(c.path))
    return { main: stay[0], sides: stay.slice(1), links: node.children.filter((c) => chapters.startingAt(c.path)) }
  }

  const shareOf = (parent: TreeNode, node: TreeNode) =>
    parent.children.length > 1 && !node.byMe && share ? share(parent, node) : undefined

  const move = (parent: TreeNode, node: TreeNode, number: boolean, cell = false) => {
    const isCurrent = id(node.path) === currentId
    const glyph = glyphOf(node, parent)
    const joins = crossNote?.(parent, node) ?? []
    const s = cell ? shareOf(parent, node) : undefined
    const editor = isCurrent && editing && annotate ? annotate(node, parent, close) : undefined
    const canAnnotate = isCurrent && !!annotate && !node.draft
    return (
      <span key={id(node.path)} className="inline-flex items-baseline">
        {number && !cell && <span className="mr-0.5 text-faint tabular-nums">{moveNumber(node.ply - 1, true)}</span>}
        <button
          ref={isCurrent ? currentRef : undefined}
          onClick={() => (isCurrent && annotate ? setEditing((e) => !e) : onJump(node.path))}
          title={
            node.draft
              ? 'Not saved yet'
              : [glyph && GLYPH_NAMES[glyph], canAnnotate && 'Click to add a symbol (!, ?, …)'].filter(Boolean).join(' · ') ||
                undefined
          }
          aria-expanded={canAnnotate ? !!editor : undefined}
          className={`rounded-md px-1 transition-colors ${
            isCurrent
              ? 'bg-maple font-semibold text-on-maple shadow-[0_1px_0_rgb(0_0_0/0.4)]'
              : node.byMe
                ? 'font-medium hover:bg-surface-3'
                : 'text-ink/85 hover:bg-surface-3'
          } ${node.draft ? `border border-dashed border-warn/70 italic ${isCurrent ? '' : 'text-warn'}` : ''}`}
        >
          {node.san}
          {glyph && <span className={`font-semibold ${isCurrent ? '' : GLYPH_TONE[glyph]}`}>{glyph}</span>}
          {node.transposition && <span title="Transposes to another line"> ↪</span>}
        </button>
        {editor && (
          <Popover anchor={currentRef} onClose={close} label={`Annotate ${node.san}`}>
            {editor}
          </Popover>
        )}
        {s !== undefined && <span className="ml-0.5 text-[10px] text-faint tabular-nums">{pct(s)}</span>}
        {joins.length > 0 && (
          <span className="ml-0.5 text-[10px] text-info" title={`This position is also in ${joins.join(', ')}`}>
            ↪ {joins.join(', ')}
          </span>
        )}
      </span>
    )
  }

  const comment = (node: TreeNode) => (
    <span key={`c${id(node.path)}`} className="text-[13px] text-muted italic">
      {node.comment}
    </span>
  )

  const lineLabel = (node: TreeNode) => {
    const name = chapters.lineName(node.path)
    return (
      name && (
        <span key={`n${id(node.path)}`} className="mr-0.5 self-center text-[10px] font-semibold tracking-[0.08em] text-brass uppercase">
          {name.name}
        </span>
      )
    )
  }

  const chapterLink = (parent: TreeNode, node: TreeNode, inline: boolean) => {
    const target = chapters.startingAt(node.path)!
    const s = shareOf(parent, node)
    return (
      <button
        key={`k${id(node.path)}`}
        onClick={() => onJump(node.path)}
        className={`inline-flex items-baseline gap-1 rounded-md px-1 text-left hover:bg-surface-3 ${inline ? 'italic' : ''}`}
        title={`Go to the chapter ${target.name}`}
      >
        <span className="text-faint tabular-nums">{moveNumber(node.ply - 1, true)}</span>
        <span className="text-ink/85">{node.san}</span>
        <span className="text-faint">→</span>
        <span className="font-medium text-brass">{target.title}</span>
        {s !== undefined && <span className="text-[10px] text-faint tabular-nums">{pct(s)}</span>}
      </button>
    )
  }

  /** A side line as flowing text, with its own branches in parentheses. */
  const inline = (parent: TreeNode, first: TreeNode): ReactNode[] => {
    const out: ReactNode[] = [lineLabel(first), move(parent, first, true)]
    let number = false
    if (first.comment) {
      out.push(comment(first))
      number = true
    }
    let node = first
    for (;;) {
      const { main, sides, links } = split(node)
      if (!main) {
        for (const l of links) out.push(chapterLink(node, l, true))
        break
      }
      out.push(move(node, main, number || (main.ply - 1) % 2 === 0))
      number = false
      if (main.comment) {
        out.push(comment(main))
        number = true
      }
      for (const s of sides) {
        out.push(
          <span key={`v${id(s.path)}`} className="inline-flex flex-wrap items-baseline gap-x-0.5 text-[13px] text-ink/75 italic">
            ({inline(node, s)})
          </span>,
        )
        number = true
      }
      for (const l of links) {
        out.push(<span key={`p${id(l.path)}`} className="text-[13px]">({chapterLink(node, l, true)})</span>)
        number = true
      }
      node = main
    }
    return out
  }

  // The chapter's main line, as table rows broken by comments and other replies.
  const blocks: ReactNode[] = []
  let row: Row | undefined
  const flush = (broken: boolean) => {
    if (!row) return
    const r = row
    const cell = (c: Row['white'], placeholder: boolean) =>
      c ? move(c.parent, c.node, false, true) : placeholder ? <span className="px-1 text-faint">…</span> : null
    blocks.push(
      <div key={`r${blocks.length}`} className="grid grid-cols-[2.25rem_1fr_1fr] border-b border-line/50 last:border-b-0">
        <span className="bg-surface-2/60 py-1 pr-2 text-right text-faint tabular-nums">{r.n}</span>
        <span className="py-1 pl-2">{cell(r.white, true)}</span>
        <span className="py-1 pl-2">{cell(r.black, broken)}</span>
      </div>,
    )
    row = undefined
  }
  const place = (parent: TreeNode, node: TreeNode) => {
    const n = Math.floor((node.ply - 1) / 2) + 1
    if ((node.ply - 1) % 2 === 0) {
      flush(false)
      row = { n, white: { node, parent } }
    } else {
      row ??= { n }
      row.black = { node, parent }
      flush(false)
    }
  }
  const breakRow = (key: string, content: ReactNode) => {
    flush(true)
    blocks.push(
      <div key={key} className="flex gap-1.5 border-b border-line/50 bg-surface-2/60 py-1 pr-2 pl-1.5 last:border-b-0">
        <span className="shrink-0 text-line-strong">└</span>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-0.5">{content}</div>
      </div>,
    )
  }
  const alternatives = (parent: TreeNode, sides: TreeNode[], links: TreeNode[]) => {
    for (const s of sides) breakRow(`s${id(s.path)}`, inline(parent, s))
    for (const l of links) breakRow(`l${id(l.path)}`, chapterLink(parent, l, false))
  }
  const noteAfter = (node: TreeNode) => node.comment && breakRow(`c${id(node.path)}`, comment(node))

  let node = chapter.node
  if (node.path.length && node.uci) {
    place(findNode(tree, node.path.slice(0, -1)) ?? tree, node)
    noteAfter(node)
  }
  for (;;) {
    const { main, sides, links } = split(node)
    if (!main) {
      alternatives(node, [], links)
      break
    }
    place(node, main)
    noteAfter(main)
    alternatives(node, sides, links)
    node = main
  }
  flush(false)

  return <div className="overflow-hidden rounded-lg border border-line/60 text-sm leading-6">{blocks}</div>
}
