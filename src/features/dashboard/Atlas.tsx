import { useLayoutEffect, useRef, useState } from 'react'
import { pct, scoreTone } from '../../components/format'
import { BoltIcon } from '../../components/icons'
import type { Color } from '../../lib/chess/position'
import { replyLabel, share, squarify, type Slot } from './slots'

/** Room between tiles, in pixels. */
const GAP = 3

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

type Item = { slot: Slot } | { other: number }

/** How much a tile has room to say: everything, the reply and its share, the reply alone, nothing. */
type Size = 'full' | 'mid' | 'short' | 'none'

/**
 * Where your games go: one tile per reply, its area the share of your games
 * that reach it. A tile fills up with how much of it is built (light) and
 * remembered (strong), coloured by built like the rings; open choices are
 * empty, dashed sockets.
 */
export function Atlas({
  slots,
  color,
  selected,
  onSelect,
}: {
  slots: Slot[]
  color: Color
  selected: string | undefined
  onSelect: (id: string) => void
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const known = slots.every((s) => s.reach !== null)
  // Without opponent statistics every reply gets the same room.
  const items: { value: number; item: Item }[] = slots.map((slot) => ({ value: known ? slot.reach! : 1, item: { slot } }))
  const rest = known ? 1 - slots.reduce((t, s) => t + s.reach!, 0) : 0
  if (rest >= 0.005) items.push({ value: rest, item: { other: rest } })
  const rects = squarify(items, w + GAP, h + GAP)

  return (
    <div ref={ref} className="relative h-full min-h-56 w-full" role="list" aria-label="Replies, sized by how often you meet them">
      {rects.map(({ x, y, w: tw, h: th, item }) => {
        const box = { left: x, top: y, width: Math.max(0, tw - GAP), height: Math.max(0, th - GAP) }
        const size: Size =
          box.width >= 110 && box.height >= 78
            ? 'full'
            : box.width >= 64 && box.height >= 50
              ? 'mid'
              : box.width >= 40 && box.height >= 26
                ? 'short'
                : 'none'
        if ('other' in item)
          return (
            <div
              key="other"
              role="listitem"
              className="absolute flex flex-col justify-between overflow-hidden rounded-md border border-dashed border-line-strong/70 p-2 text-[11px] text-faint"
              style={box}
              title={`Rarer replies, too rare for the plan: ${share(item.other)} of games`}
            >
              {size === 'full' && <span>Rarer replies</span>}
              {size !== 'none' && <span className="tabular-nums">{share(item.other)}</span>}
            </div>
          )
        const { slot } = item
        return (
          <div key={slot.id} role="listitem" className="absolute" style={box}>
            <Tile slot={slot} color={color} size={size} selected={selected === slot.id} onSelect={() => onSelect(slot.id)} />
          </div>
        )
      })}
    </div>
  )
}

function Tile({
  slot,
  color,
  size,
  selected,
  onSelect,
}: {
  slot: Slot
  color: Color
  size: Size
  selected: boolean
  onSelect: () => void
}) {
  const { node, facts } = slot
  const reply = replyLabel(node.sans, color) ?? 'Move 1'
  const name = node.kind === 'covered' ? node.rep.name : node.title
  const paused = node.kind === 'covered' && node.rep.paused
  const ring = selected ? 'ring-2 ring-brass ring-offset-2 ring-offset-surface' : ''
  const label = [
    reply,
    name,
    slot.reach !== null ? `met in ${share(slot.reach)}` : '',
    facts ? `${pct(facts.score.built)} built, ${pct(facts.score.remembered)} remembered` : node.kind === 'decision' ? 'still to choose' : '',
    paused ? 'paused' : '',
  ]
    .filter(Boolean)
    .join(' · ')

  if (node.kind === 'decision')
    return (
      <button
        className={`group flex h-full w-full flex-col justify-between overflow-hidden rounded-md border border-dashed border-warn/55 bg-warn/[0.05] p-2 text-left transition hover:border-solid hover:bg-warn/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${ring}`}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={label}
        title={label}
      >
        {size !== 'none' && (
          <span className="flex min-w-0 items-center gap-1.5 text-warn">
            <BoltIcon size={13} className="shrink-0" />
            <span className="truncate font-display text-sm font-medium">{reply}</span>
          </span>
        )}
        {size === 'full' && <span className="line-clamp-2 text-xs leading-snug text-ink/80">{name}</span>}
        {(size === 'full' || size === 'mid') && slot.reach !== null && (
          <span className="text-[11px] text-warn tabular-nums">
            {share(slot.reach)}
            {size === 'full' && ' · choose'}
          </span>
        )}
      </button>
    )

  const tone = facts ? scoreTone(facts.score.built) : 'var(--color-line-strong)'
  const fill = (x: number, strength: number) => ({
    height: `${Math.max(0, Math.min(1, x)) * 100}%`,
    background: `color-mix(in oklab, ${tone} ${strength}%, transparent)`,
  })
  return (
    <button
      className={`group relative flex h-full w-full flex-col justify-between overflow-hidden rounded-md border border-line/70 bg-surface-2/70 p-2 text-left transition hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${paused ? 'opacity-55' : ''} ${ring}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={label}
      title={label}
    >
      {facts && (
        <>
          <span className="absolute inset-x-0 bottom-0 transition-[height] duration-700 ease-out" style={fill(facts.score.built, 14)} />
          <span
            className="absolute inset-x-0 bottom-0 border-t transition-[height] duration-700 ease-out"
            style={{ ...fill(facts.score.remembered, 30), borderColor: `color-mix(in oklab, ${tone} 60%, transparent)` }}
          />
        </>
      )}
      {size !== 'none' && (
        <span className="relative min-w-0">
          <span className="block truncate font-display text-sm font-medium">{reply}</span>
          {size === 'full' && (
            <span className="block truncate text-xs text-ink/75">
              {name}
              {paused && <span className="text-faint"> · paused</span>}
            </span>
          )}
        </span>
      )}
      {(size === 'full' || size === 'mid') && (
        <span className="relative flex items-baseline justify-between gap-2">
          {slot.reach !== null && (
            <span className={`font-display tabular-nums ${size === 'full' ? 'text-xl' : 'text-sm'} leading-none font-medium`}>{share(slot.reach)}</span>
          )}
          {size === 'full' && facts && (
            <span className="whitespace-nowrap text-[11px] text-ink/75 tabular-nums">
              {pct(facts.score.built)} · {pct(facts.score.remembered)}
            </span>
          )}
        </span>
      )}
    </button>
  )
}
