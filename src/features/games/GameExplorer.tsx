import { useEffect, useMemo, useRef } from 'react'
import { Board, type Arrow } from '../../components/Board'
import { pct, resultColor } from '../../components/format'
import { CheckIcon, CrossIcon, FirstIcon, NextIcon, PrevIcon } from '../../components/icons'
import { OpeningTrail } from '../../components/OpeningTrail'
import { ResultBar, Section } from '../../components/ui'
import { moveSquares, playUci, positionKey, START_FEN, turnOf, type Color, type PlayedMove } from '../../lib/chess/position'
import { scoreOf, type GameAnalysis, type RepIndex } from '../../lib/games/analyze'
import { builderTarget, buildGameTree, moveMark, wdlOf, type MoveMark } from '../../lib/games/gameTree'
import { useNaming } from '../../lib/openings/naming'
import { openingTrail } from '../../lib/openings/names'
import { GameLinks } from './Findings'
import { TargetLink } from './OpeningOverview'

interface Props {
  analyses: GameAnalysis[]
  color: Color
  reps: RepIndex[]
  /** The line shown (UCI from the initial position). */
  at: string[]
  onGo: (line: string[]) => void
}

const ARROWS: Record<MoveMark, Arrow['brush']> = { rep: 'green', deviates: 'red', unanswered: 'yellow', none: 'paleGrey' }

/** An opening explorer of your own games with one colour, compared with your repertoires. */
export function GameExplorer({ analyses, color, reps, at, onGo }: Props) {
  const tree = useMemo(() => buildGameTree(analyses.map((a) => a.game)), [analyses])
  const naming = useNaming()

  // The line, cut at its first illegal move.
  const played = useMemo(() => {
    const out: PlayedMove[] = []
    for (const uci of at) {
      const m = playUci(out.at(-1)?.fen ?? START_FEN, uci)
      if (!m) break
      out.push(m)
    }
    return out
  }, [at])
  const path = useMemo(() => played.map((m) => m.uci), [played])
  const fens = [START_FEN, ...played.map((m) => m.fen)]
  const fen = fens.at(-1)!
  const key = positionKey(fen)
  const node = tree.get(key)
  const trail = useMemo(
    () => (naming ? openingTrail([START_FEN, ...played.map((m) => m.fen)].map((f) => naming.display(positionKey(f)))) : []),
    [naming, played],
  )

  const back = () => played.length && onGo(path.slice(0, -1))
  const forward = () => node?.moves[0] && onGo([...path, node.moves[0].uci])
  const keys = useRef({ back, forward })
  useEffect(() => {
    keys.current = { back, forward }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea') || e.metaKey || e.ctrlKey) return
      if (e.key === 'ArrowLeft') keys.current.back()
      if (e.key === 'ArrowRight') keys.current.forward()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const moves = (node?.moves ?? []).map((m) => ({ ...m, mark: moveMark(key, m.uci, color, reps) }))
  const arrows = moves.slice(0, 3).flatMap((m): Arrow[] => {
    const sq = moveSquares(fen, m.uci)
    return sq ? [{ from: sq[0], to: sq[1], brush: ARROWS[m.mark] }] : []
  })
  const last = played.at(-1)
  const lastMove = last ? (moveSquares(fens.at(-2)!, last.uci) ?? undefined) : undefined
  const myTurn = turnOf(fen) === color
  const target = builderTarget(
    path,
    played.map((m) => m.san),
    color,
    reps,
  )

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div className="flex min-h-6 items-center gap-2">
          <OpeningTrail trail={trail} />
          <span className={`ml-auto flex shrink-0 items-center gap-1.5 text-xs ${myTurn ? 'text-maple' : 'text-muted'}`}>
            <span className={`h-2 w-2 rounded-full ${myTurn ? 'bg-maple' : 'bg-faint'}`} />
            {myTurn ? 'Your move' : 'Their move'}
          </span>
        </div>
        <Board fen={fen} orientation={color} lastMove={lastMove} arrows={arrows} onMove={(uci) => onGo([...path, uci])} />
        <div className="grid grid-cols-3 gap-2" title="Keyboard: ← →">
          <button className="btn-ghost" onClick={() => onGo([])} disabled={!played.length} aria-label="Start">
            <FirstIcon />
          </button>
          <button className="btn-ghost" onClick={back} disabled={!played.length} aria-label="Back">
            <PrevIcon />
          </button>
          <button className="btn-ghost" onClick={forward} disabled={!moves.length} aria-label="Most played move">
            <NextIcon />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Section
          title={node ? `${node.games.length} game${node.games.length === 1 ? '' : 's'} reached this position` : 'Not reached in your games'}
          right={<TargetLink target={target} />}
        >
          <MoveTrail played={played} onGo={onGo} />
          {node && (
            <div className="mb-4 flex items-center gap-3 text-xs text-muted">
              <ResultBar {...wdlOf(node.games)} className="flex-1" />
              <span>
                score <span className={`font-semibold tabular-nums ${resultColor(scoreOf(node.games))}`}>{pct(scoreOf(node.games))}</span>
              </span>
            </div>
          )}
          {moves.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] tracking-wide text-faint uppercase">
                <tr>
                  <th className="w-16 font-normal">Move</th>
                  <th className="w-12 text-right font-normal">Games</th>
                  <th className="w-12 text-right font-normal">%</th>
                  <th className="pl-3 font-normal">Score</th>
                  <th className="w-8 pl-3 font-normal sm:w-28">
                    <span className="hidden sm:inline">Repertoire</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => {
                  const score = scoreOf(m.games)
                  return (
                    <tr
                      key={m.uci}
                      className="cursor-pointer border-t border-line/60 hover:bg-surface-2"
                      onClick={() => onGo([...path, m.uci])}
                    >
                      <td className="py-1.5 font-display font-semibold">{m.san}</td>
                      <td className="text-right tabular-nums">{m.games.length}</td>
                      <td className="text-right text-muted tabular-nums">{pct(m.games.length / node!.games.length)}</td>
                      <td className="pl-3">
                        <div className="flex items-center gap-2">
                          <ResultBar {...wdlOf(m.games)} className="flex-1" />
                          <span className={`w-9 text-right text-xs font-medium tabular-nums ${resultColor(score)}`}>{pct(score)}</span>
                        </div>
                      </td>
                      <td className="pl-3">
                        <Mark mark={m.mark} mine={myTurn} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted">{node ? 'Your games stop here (only the opening moves are imported).' : 'Go back, or play a move on the board.'}</p>
          )}
          {node && <GameLinks games={node.games} />}
        </Section>
      </div>
    </div>
  )
}

function Mark({ mark, mine }: { mark: MoveMark; mine: boolean }) {
  if (mark === 'rep')
    return (
      <span className="flex items-center gap-1 text-xs text-accent" title={mine ? 'Your repertoire move' : 'A reply you have prepared'}>
        <CheckIcon size={14} /> <span className="hidden sm:inline">{mine ? 'yours' : 'prepared'}</span>
      </span>
    )
  if (mark === 'deviates')
    return (
      <span className="flex items-center gap-1 text-xs text-bad" title="Your repertoire plays another move here">
        <CrossIcon size={14} /> <span className="hidden sm:inline">not yours</span>
      </span>
    )
  if (mark === 'unanswered')
    return (
      <span className="flex items-center gap-1 text-xs text-warn" title="Your repertoire has no answer to this move">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-current" /> <span className="hidden sm:inline">no answer</span>
      </span>
    )
  return <span className="text-xs text-faint" title="No repertoire covers this position">–</span>
}

/** The line so far; click a move to go back to it. */
function MoveTrail({ played, onGo }: { played: PlayedMove[]; onGo: (line: string[]) => void }) {
  if (!played.length) return <p className="mb-3 font-display text-sm text-muted">Starting position</p>
  return (
    <p className="mb-3 flex flex-wrap gap-x-1.5 font-display text-sm">
      {played.map((m, i) => (
        <button
          key={i}
          className={`hover:text-maple ${i === played.length - 1 ? 'font-semibold text-ink' : 'text-muted'}`}
          onClick={() => onGo(played.slice(0, i + 1).map((p) => p.uci))}
        >
          {i % 2 === 0 ? `${i / 2 + 1}.` : ''}
          {m.san}
        </button>
      ))}
    </p>
  )
}
