import { useMemo } from 'react'
import type { Arrow } from '../../components/Board'
import { describeFact, isThreatening, moveFacts } from '../../lib/chess/moveFacts'
import { moveSquares, playUci } from '../../lib/chess/position'
import type { Threat } from '../../lib/engine/threat'
import { useThreat } from '../../lib/engine/useThreat'

/** At most this many board facts, most telling first. */
const MAX_FACTS = 4

/**
 * What a move does: what it threatens (Stockfish, with the mover to move again)
 * and what it changes on the board (attacks, pins, development, open lines).
 */
export function MoveInsight({
  fen,
  uci,
  engine = true,
  onArrow,
}: {
  /** The position before the move. */
  fen: string
  uci: string
  /** Whether to ask the engine for the threat. */
  engine?: boolean
  /** Hovering the threat shows it on the board. */
  onArrow?: (arrow: Arrow | null) => void
}) {
  const facts = useMemo(() => moveFacts(fen, uci).slice(0, MAX_FACTS), [fen, uci])
  const after = useMemo(() => playUci(fen, uci)?.fen ?? null, [fen, uci])
  const threat = useThreat(after, engine)

  return (
    <div className="flex flex-col gap-2.5 text-sm">
      {engine && <ThreatLine threat={threat} onArrow={onArrow} />}
      {facts.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {facts.map((f, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${isThreatening(f) ? 'bg-warn' : 'bg-faint'}`} />
              <span className={isThreatening(f) ? 'text-ink' : 'text-muted'}>{describeFact(f)}</span>
            </li>
          ))}
        </ul>
      ) : (
        !engine && <p className="text-muted">A quiet move: nothing changes on the board right away.</p>
      )}
    </div>
  )
}

function ThreatLine({ threat, onArrow }: { threat: Threat | null | undefined; onArrow?: (arrow: Arrow | null) => void }) {
  if (threat === undefined) return <p className="animate-pulse text-muted">Looking for threats…</p>
  // The move gave check (or left no legal move to try): the check is the threat.
  if (threat === null) return null
  const squares = moveSquares(threat.fen, threat.uci)
  const hover = {
    onMouseEnter: () => squares && onArrow?.({ from: squares[0], to: squares[1], brush: 'red' }),
    onMouseLeave: () => onArrow?.(null),
  }
  const move = (
    <span
      {...hover}
      className={`cursor-default rounded-md px-1.5 py-0.5 font-semibold ${threat.real ? 'bg-bad/15 text-bad' : 'bg-surface-3 text-ink'}`}
    >
      {threat.san}
    </span>
  )
  const rest = threat.line.slice(1, 4).join(' ')

  return (
    <div className="flex flex-col gap-1">
      <p className="leading-relaxed">
        {threat.real ? (
          <>
            <span className="text-muted">Threatens</span> {move}
            {threat.mate !== undefined ? (
              <span className="ml-1.5 text-xs font-semibold text-bad">mate in {threat.mate}</span>
            ) : (
              threat.gain !== null && (
                <span className="ml-1.5 text-xs text-muted tabular-nums" title="What a free move would gain, in pawns">
                  +{(threat.gain / 100).toFixed(1)}
                </span>
              )
            )}
          </>
        ) : (
          <>
            <span className="text-muted">No direct threat. Given another move, it would play</span> {move}
          </>
        )}
      </p>
      {rest && <p className="text-xs text-faint">then {rest}</p>}
    </div>
  )
}
