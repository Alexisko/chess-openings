import { useEffect, useRef, useState, type ReactNode } from 'react'
import { moveNumber, type TreeNode } from '../lib/chess/tree'
import { pct } from './format'

interface Props {
  root: TreeNode
  /** Path (UCI from the start) of the node shown on the board. */
  current: string[]
  onJump: (path: string[]) => void
  /** Share of games for an opponent move at a branch point, if known. */
  share?: (parent: TreeNode, child: TreeNode) => number | undefined
}

const id = (path: string[]) => path.join(',')

/**
 * Compact move tree, like a Lichess study: the main line flows as text and
 * side lines are indented below the move they branch from. Deep side lines
 * that don't contain the current move start collapsed.
 */
export function MoveTree({ root, current, onJump, share }: Props) {
  const currentId = id(current)
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const currentRef = useRef<HTMLButtonElement>(null)

  // Keep the current move visible inside the tree's own scroll box. Never scroll
  // the page itself: that would pull the board out of view on every move.
  useEffect(() => {
    const el = currentRef.current
    const box = el?.closest<HTMLElement>('[data-tree-scroll]')
    if (!el || !box || box.scrollHeight <= box.clientHeight) return
    const e = el.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (e.top < b.top) box.scrollTop -= b.top - e.top + 8
    else if (e.bottom > b.bottom) box.scrollTop += e.bottom - b.bottom + 8
  }, [currentId])

  const toggle = (key: string) =>
    setToggled((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const containsCurrent = (node: TreeNode) => currentId === id(node.path) || currentId.startsWith(`${id(node.path)},`)

  const move = (parent: TreeNode, node: TreeNode, showNumber: boolean) => {
    const isCurrent = id(node.path) === currentId
    const s = parent.children.length > 1 && !node.byMe && share ? share(parent, node) : undefined
    return (
      <span key={id(node.path)} className="inline-flex items-baseline">
        {(showNumber || (node.ply - 1) % 2 === 0) && (
          <span className="mr-0.5 text-muted">{moveNumber(node.ply - 1, showNumber)}</span>
        )}
        <button
          ref={isCurrent ? currentRef : undefined}
          onClick={() => onJump(node.path)}
          title={node.draft ? 'Not saved yet' : node.comment || undefined}
          className={`rounded px-1 ${isCurrent ? 'bg-accent-strong text-white' : 'hover:bg-surface-2'} ${
            node.draft ? 'border border-dashed border-warn/70 italic text-warn' : ''
          }`}
        >
          {node.san}
          {node.transposition && <span title="Transposes to another line"> ↪</span>}
        </button>
        {s !== undefined && <span className="ml-0.5 text-[10px] text-muted">{pct(s)}</span>}
      </span>
    )
  }

  /** Renders a line starting after `from`, with side lines nested below their branch point. */
  const line = (from: TreeNode, level: number, firstNumbered: boolean, prefix: ReactNode[] = []): ReactNode[] => {
    const out: ReactNode[] = []
    let inline: ReactNode[] = prefix
    const flush = () => {
      if (inline.length) out.push(<div key={`l${out.length}`} className="flex flex-wrap gap-x-0.5">{inline}</div>)
      inline = []
    }
    let cur = from
    let numbered = firstNumbered
    while (cur.children.length) {
      const [main, ...others] = cur.children
      inline.push(move(cur, main, numbered))
      numbered = false
      if (others.length) {
        flush()
        for (const v of others) out.push(variation(cur, v, level + 1))
        numbered = true
      }
      cur = main
    }
    flush()
    return out
  }

  const variation = (parent: TreeNode, v: TreeNode, level: number) => {
    const key = id(v.path)
    const defaultOpen = level < 2 || containsCurrent(v)
    const open = toggled.has(key) ? !defaultOpen : defaultOpen
    return (
      <div key={key} className="my-0.5 ml-2 border-l-2 border-line pl-2">
        {open ? (
          line(v, level, false, [
            ...(level >= 2
              ? [
                  <button
                    key="collapse"
                    className="px-0.5 text-[10px] text-muted hover:text-ink"
                    onClick={() => toggle(key)}
                    aria-label="Collapse"
                  >
                    ▴
                  </button>,
                ]
              : []),
            move(parent, v, true),
          ])
        ) : (
          <button className="text-xs text-muted hover:text-ink" onClick={() => toggle(key)}>
            {moveNumber(v.ply - 1, true)} {v.san} … ({countLeaves(v)} line{countLeaves(v) === 1 ? '' : 's'}) ▾
          </button>
        )}
      </div>
    )
  }

  if (!root.children.length) return null
  return <div className="text-sm leading-7">{line(root, 0, true)}</div>
}

function countLeaves(n: TreeNode): number {
  return n.children.length ? n.children.reduce((s, c) => s + countLeaves(c), 0) : 1
}
