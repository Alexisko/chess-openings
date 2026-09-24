import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Board } from '../../components/Board'
import { ColorDot, Section } from '../../components/ui'
import {
  addLine,
  MoveConflictError,
  previewRemoval,
  removeMoves,
  setMoveComment,
  setPositionNote,
} from '../../db/repertoire'
import { db } from '../../db/schema'
import { useSettings } from '../../db/settings'
import { useRepertoire } from '../../db/useRepertoire'
import { myMove, pathTo } from '../../lib/chess/graph'
import { formatMoves, moveSquares, playUci, positionKey, replay, START_FEN, turnOf } from '../../lib/chess/position'
import { useMoveLoss } from '../../lib/engine/useMoveLoss'
import { useEval } from '../../lib/engine/useEval'
import { useExplorer } from '../../lib/explorer'
import { EnginePanel } from '../board/EnginePanel'
import { ExplorerPanel } from '../board/ExplorerPanel'
import { builderUrl } from '../../lib/routes'

function readEngineToggle() {
  try {
    return localStorage.getItem('engine') !== 'off'
  } catch {
    return true
  }
}

export function BuilderPage() {
  const { id } = useParams()
  const data = useRepertoire(id)
  const settings = useSettings()
  const [params, setParams] = useSearchParams()
  const pathStr = params.get('m') ?? ''
  const path = useMemo(() => (pathStr ? pathStr.split(',') : []), [pathStr])
  const played = useMemo(() => {
    try {
      return replay(path)
    } catch {
      return []
    }
  }, [path])
  // The cursor resets to the end of the line whenever the line itself changes.
  const [cursorState, setCursorState] = useState({ pathStr, cursor: played.length })
  const cursor = cursorState.pathStr === pathStr ? cursorState.cursor : played.length
  const setCursor = useCallback(
    (c: number | ((c: number) => number)) =>
      setCursorState((st) => {
        const cur = st.pathStr === pathStr ? st.cursor : played.length
        return { pathStr, cursor: typeof c === 'function' ? c(cur) : c }
      }),
    [pathStr, played.length],
  )

  const [engineOn, setEngineOn] = useState(readEngineToggle)
  const [status, setStatus] = useState<string>()

  const fens = useMemo(() => [START_FEN, ...played.map((p) => p.fen)], [played])
  const fen = fens[Math.min(cursor, played.length)]
  const key = positionKey(fen)
  const graph = data?.graph
  const color = data?.rep.color ?? 'white'
  const myTurn = turnOf(fen) === color

  const inRep = useMemo(
    () => played.map((p, i) => graph?.movesFrom.get(positionKey(fens[i]))?.find((m) => m.uci === p.uci)),
    [played, fens, graph],
  )
  const unsaved = inRep.slice(0, cursor).some((m) => !m)
  const repMovesHere = useMemo(() => new Set((graph?.movesFrom.get(key) ?? []).map((m) => m.uci)), [graph, key])
  const mine = graph ? myMove(graph, key) : undefined

  const explorerState = useExplorer(fen, settings?.explorerFilter)
  const evaluation = useEval(fen, engineOn)
  const loss = useMoveLoss(fen, mine?.uci, color, evaluation)

  const goTo = useCallback(
    (uci: string[]) => {
      setStatus(undefined)
      setParams(uci.length ? { m: uci.join(',') } : {}, { replace: true })
    },
    [setParams],
  )

  const play = (uci: string) => {
    const m = playUci(fen, uci)
    if (!m) return
    const base = path.slice(0, cursor)
    // Stay on the existing line if the move matches it.
    if (path[cursor] === m.uci) setCursor(cursor + 1)
    else goTo([...base, m.uci])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, c - 1))
      if (e.key === 'ArrowRight') setCursor((c) => Math.min(played.length, c + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [played.length, setCursor])

  if (data === undefined || !settings) return null
  if (data === null) return <p className="text-muted">Repertoire not found.</p>
  const rep = data.rep

  const save = async () => {
    const line = path.slice(0, cursor)
    try {
      const { added } = await addLine(rep, line)
      setStatus(`Saved ${added.length} move${added.length === 1 ? '' : 's'}.`)
    } catch (e) {
      if (!(e instanceof MoveConflictError)) return setStatus((e as Error).message)
      const removed = await previewRemoval(rep, e.existing.id)
      const ok = confirm(
        `Your repertoire plays ${e.existing.san} here. Replace it with ${e.wantedSan}?\n` +
          `This removes ${removed.length} move${removed.length === 1 ? '' : 's'} and resets your progress on this position.`,
      )
      if (!ok) return
      const { added } = await addLine(rep, line, { replace: true })
      setStatus(`Replaced ${e.existing.san} with ${e.wantedSan}; saved ${added.length} moves.`)
    }
  }

  const incoming = cursor > 0 ? inRep[cursor - 1] : undefined
  const remove = async () => {
    if (!incoming) return
    const removed = await previewRemoval(rep, incoming.id)
    if (!confirm(`Delete ${incoming.san} and the ${removed.length - 1} moves that follow only from it?`)) return
    await removeMoves(rep, new Set([incoming.id]))
    setStatus(`Deleted ${removed.length} moves.`)
  }

  // Same position reached through a different move order in the repertoire.
  const canonical = graph ? pathTo(graph, key) : []
  const isTransposition =
    canonical.length > 0 && canonical.map((m) => m.uci).join(',') !== path.slice(0, cursor).join(',') && graph?.depth.has(key)

  const last = cursor > 0 ? played[cursor - 1] : undefined
  const lastSquares = last ? (moveSquares(fens[cursor - 1], last.uci) ?? undefined) : undefined
  const arrows = mine ? [{ ...squaresOf(fen, mine.uci), brush: 'green' as const }] : []

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <ColorDot color={rep.color} />
          <Link to={`/rep/${rep.id}`} className="font-medium hover:underline">
            {rep.name}
          </Link>
          <span className="ml-auto text-xs text-muted">{myTurn ? 'Your move' : 'Opponent to move'}</span>
        </div>
        <Board
          fen={fen}
          orientation={rep.color}
          lastMove={lastSquares}
          arrows={arrows.filter((a) => a.from)}
          onMove={play}
        />
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={() => setCursor(0)} disabled={cursor === 0} aria-label="Start">
            ⏮
          </button>
          <button className="btn-ghost flex-1" onClick={() => setCursor(cursor - 1)} disabled={cursor === 0} aria-label="Back">
            ◀
          </button>
          <button
            className="btn-ghost flex-1"
            onClick={() => setCursor(cursor + 1)}
            disabled={cursor >= played.length}
            aria-label="Forward"
          >
            ▶
          </button>
          <button
            className="btn-ghost flex-1"
            onClick={() => setCursor(played.length)}
            disabled={cursor >= played.length}
            aria-label="End"
          >
            ⏭
          </button>
        </div>
        <MoveList sans={played.map((p) => p.san)} saved={inRep.map(Boolean)} cursor={cursor} onJump={setCursor} />
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={save} disabled={!unsaved}>
            Save line to repertoire
          </button>
          {incoming && (
            <button className="btn-ghost" onClick={remove}>
              Delete {incoming.san}…
            </button>
          )}
          <button className="btn-ghost" onClick={() => goTo([])}>
            New line
          </button>
        </div>
        {status && <p className="text-sm text-muted">{status}</p>}
      </div>

      <div className="flex flex-col gap-4">
        <Section title={myTurn ? 'Your move' : 'Opponent replies'}>
          <div className="mb-3 text-sm">
            {myTurn ? (
              mine ? (
                <>
                  Repertoire move: <span className="font-semibold text-accent">{mine.san}</span>
                  {loss !== null && loss > settings.blunderThreshold && (
                    <span className="ml-2 text-warn">⚠ engine: loses ~{(loss / 100).toFixed(1)} pawns vs best</span>
                  )}
                </>
              ) : (
                <span className="text-muted">No move chosen yet. Pick one from the table or play it on the board.</span>
              )
            ) : repMovesHere.size ? (
              <span className="text-muted">Prepared replies are marked ✓. Add answers to the frequent ones.</span>
            ) : (
              <span className="text-muted">No replies prepared yet. Start with the most common ones.</span>
            )}
          </div>
          {isTransposition && (
            <p className="mb-3 rounded-md bg-info/10 px-2 py-1.5 text-xs">
              Transposition: this position is already in your repertoire via{' '}
              <Link className="underline" to={builderUrl(rep.id, canonical.map((m) => m.uci))}>
                {formatMoves(canonical.map((m) => m.san))}
              </Link>
              . Lines stop here and continue from there.
            </p>
          )}
          <ExplorerPanel
            state={explorerState}
            repMoves={repMovesHere}
            myTurn={myTurn}
            evaluation={engineOn ? evaluation : null}
            onPick={play}
          />
        </Section>

        <Section
          title="Engine"
          right={
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={engineOn}
                onChange={(e) => {
                  setEngineOn(e.target.checked)
                  try {
                    localStorage.setItem('engine', e.target.checked ? 'on' : 'off')
                  } catch {
                    // Preference is optional.
                  }
                }}
              />
              On
            </label>
          }
        >
          {engineOn ? <EnginePanel evaluation={evaluation} onPick={play} /> : <p className="text-sm text-muted">Off</p>}
        </Section>

        <Notes positionKey={key} incomingId={incoming?.id} incomingSan={incoming?.san} />
      </div>
    </div>
  )
}

function squaresOf(fen: string, uci: string) {
  const sq = moveSquares(fen, uci)
  return { from: sq?.[0] ?? '', to: sq?.[1] ?? '' }
}

function MoveList({
  sans,
  saved,
  cursor,
  onJump,
}: {
  sans: string[]
  saved: boolean[]
  cursor: number
  onJump: (i: number) => void
}) {
  if (!sans.length) return <p className="text-sm text-muted">Play a move on the board or pick one from the explorer.</p>
  return (
    <div className="flex flex-wrap gap-x-1 gap-y-0.5 text-sm">
      {sans.map((san, i) => (
        <span key={i} className="flex items-center">
          {i % 2 === 0 && <span className="mr-0.5 text-muted">{i / 2 + 1}.</span>}
          <button
            onClick={() => onJump(i + 1)}
            className={`rounded px-1 ${cursor === i + 1 ? 'bg-accent-strong text-white' : 'hover:bg-surface-2'} ${
              saved[i] ? '' : 'italic text-warn'
            }`}
            title={saved[i] ? 'In repertoire' : 'Not saved yet'}
          >
            {san}
          </button>
        </span>
      ))}
    </div>
  )
}

function Notes({ positionKey, incomingId, incomingSan }: { positionKey: string; incomingId?: string; incomingSan?: string }) {
  // null = loaded but empty, undefined = still loading (so defaultValue is set once loaded).
  const note = useLiveQuery(() => db.positions.get(positionKey).then((n) => n ?? null), [positionKey])
  const move = useLiveQuery(() => (incomingId ? db.moves.get(incomingId).then((m) => m ?? null) : null), [incomingId])
  return (
    <Section title="Ideas & notes">
      <label className="mb-1 block text-xs text-muted">Plans and ideas in this position (shared by all repertoires)</label>
      {note !== undefined && (
        <textarea
          key={`p-${positionKey}`}
          className="input mb-3 h-20 w-full"
          defaultValue={note?.note ?? ''}
          placeholder="e.g. Aim for c4–c5 and a queenside pawn storm; the light-squared bishop belongs on d3."
          onBlur={(e) => e.target.value !== (note?.note ?? '') && setPositionNote(positionKey, e.target.value)}
        />
      )}
      {incomingId && move !== undefined && (
        <>
          <label className="mb-1 block text-xs text-muted">Why {incomingSan}? (shown after you play it in training)</label>
          <textarea
            key={`m-${incomingId}`}
            className="input h-16 w-full"
            defaultValue={move?.comment ?? ''}
            onBlur={(e) => e.target.value !== (move?.comment ?? '') && setMoveComment(incomingId, e.target.value)}
          />
        </>
      )}
    </Section>
  )
}
