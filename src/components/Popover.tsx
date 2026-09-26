import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/**
 * A small panel floating under (or above) an element, outside any scroll box
 * that would clip it. Closes on Escape and on a press outside it and its anchor.
 */
export function Popover({
  anchor,
  onClose,
  label,
  children,
}: {
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  label: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>()
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current
      const el = ref.current
      if (!a || !el) return
      const r = a.getBoundingClientRect()
      const left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))
      const above = r.top - el.offsetHeight - 6
      const top = r.bottom + 6 + el.offsetHeight > window.innerHeight - 8 && above > 8 ? above : r.bottom + 6
      setPos((p) => (p?.top === top && p.left === left ? p : { top, left }))
    }
    place()
    const ro = new ResizeObserver(place)
    if (ref.current) ro.observe(ref.current)
    if (anchor.current) ro.observe(anchor.current)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) close.current()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="fixed z-40 w-max max-w-[calc(100vw-1rem)] animate-pop rounded-xl border border-line-strong bg-surface p-3 shadow-[var(--card-shadow)]"
      style={pos ?? { top: 0, left: 0, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}
