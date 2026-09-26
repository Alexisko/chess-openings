import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { useEffect, useRef } from 'react'
import { GLYPH_BADGE, type Glyph } from '../lib/chess/glyphs'
import { isCheck, legalDests, moveBetween, setupPosition, turnOf, type Color } from '../lib/chess/position'
import { playSound } from '../lib/sound'

export interface Arrow {
  from: string
  to: string
  brush?: 'green' | 'red' | 'blue' | 'yellow' | 'paleBlue' | 'paleGreen' | 'paleRed' | 'paleGrey'
}

interface Props {
  fen: string
  orientation: Color
  /** Which side may move pieces; 'none' makes the board view-only. */
  movable?: Color | 'both' | 'none'
  lastMove?: [string, string]
  arrows?: Arrow[]
  /** A move symbol shown as a badge in the corner of a square. */
  glyph?: { square: string; glyph: Glyph }
  onMove?: (uci: string) => void
  /** Glows around the board once; a new id replays it. */
  flash?: { kind: 'correct' | 'wrong'; id: number }
}

// Arrow colours that read on maple and walnut.
const BRUSHES = {
  green: { key: 'g', color: '#2a7412', opacity: 0.95, lineWidth: 10 },
  red: { key: 'r', color: '#b0220f', opacity: 0.95, lineWidth: 10 },
  blue: { key: 'b', color: '#1f4f86', opacity: 0.85, lineWidth: 10 },
  yellow: { key: 'y', color: '#c98a12', opacity: 0.9, lineWidth: 10 },
}

/** Chessground board. Promotions are always to a queen. */
export function Board({ fen, orientation, movable = 'both', lastMove, arrows, glyph, onMove, flash }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  useEffect(() => {
    if (!el.current) return
    api.current = Chessground(el.current, {
      coordinates: true,
      animation: { duration: 180 },
      movable: { free: false, showDests: true },
      draggable: { showGhost: true },
      premovable: { enabled: false },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: true, brushes: BRUSHES },
    })
    return () => api.current?.destroy()
  }, [])

  // A move sound whenever the position goes on by one move: played, replied or stepped through.
  const prevFen = useRef<string>(undefined)
  useEffect(() => {
    const prev = prevFen.current
    prevFen.current = fen
    const step = prev && prev !== fen ? moveBetween(prev, fen) : null
    if (step) playSound(step.capture ? 'capture' : 'move')
  }, [fen])

  useEffect(() => {
    const turn = turnOf(fen)
    const canMove = movable === 'both' || movable === turn
    api.current?.set({
      fen,
      orientation,
      turnColor: turn,
      check: isCheck(fen) ? turn : false,
      lastMove: lastMove as Key[] | undefined,
      movable: {
        color: canMove ? turn : undefined,
        dests: canMove ? (legalDests(fen) as Map<Key, Key[]>) : new Map(),
        events: {
          after: (orig, dest) => {
            const pos = setupPosition(fen)
            const piece = pos.board.get(squareIndex(orig))
            const promo = piece?.role === 'pawn' && (dest[1] === '8' || dest[1] === '1') ? 'q' : ''
            onMoveRef.current?.(`${orig}${dest}${promo}`)
          },
        },
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, orientation, movable, lastMove?.join()])

  useEffect(() => {
    const shapes: DrawShape[] = (arrows ?? []).map((a) => ({
      orig: a.from as Key,
      dest: a.to as Key,
      brush: a.brush ?? 'green',
    }))
    if (glyph) shapes.push({ orig: glyph.square as Key, customSvg: { html: glyphBadge(glyph.glyph) } })
    api.current?.setAutoShapes(shapes)
  }, [arrows, glyph?.square, glyph?.glyph]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="board-frame">
      <div className="board-wrap aspect-square w-full select-none">
        <div ref={el} className="h-full w-full" />
      </div>
      {flash && <div key={flash.id} className="board-flash" data-kind={flash.kind} />}
    </div>
  )
}

/** Badge in the square's top-right corner, overhanging it (square = 100 units). */
function glyphBadge(g: Glyph) {
  return `<defs>
    <filter id="glyph-shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.35" />
    </filter>
  </defs>
  <g transform="translate(62 -8)">
    <circle cx="23" cy="23" r="22" fill="${GLYPH_BADGE[g]}" filter="url(#glyph-shadow)" />
    <text x="23" y="23" dy="0.36em" text-anchor="middle" fill="#fff" font-family="Instrument Sans Variable, system-ui, sans-serif"
      font-weight="700" font-size="${g.length > 1 ? 24 : 30}" letter-spacing="-1">${g}</text>
  </g>`
}

function squareIndex(key: string): number {
  return (key.charCodeAt(1) - 49) * 8 + (key.charCodeAt(0) - 97)
}
