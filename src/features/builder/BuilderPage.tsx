import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Board } from '../../components/Board'
import { MoveTree } from '../../components/MoveTree'
import { ColorDot, Section } from '../../components/ui'
import {
  addLine,
  findOverlaps,
  MoveConflictError,
  previewRemoval,
  previewStartChange,
  removeMoves,
  setMoveComment,
  setPositionNote,
  setRepertoireStart,
} from '../../db/repertoire'
import { db } from '../../db/schema'
import { useSettings } from '../../db/settings'
import { useRepertoire } from '../../db/useRepertoire'
import { myMove, pathTo } from '../../lib/chess/graph'
import { formatMoves, moveSquares, playUci, positionKey, replay, START_FEN, turnOf } from '../../lib/chess/position'
import { useMoveLoss } from '../../lib/engine/useMoveLoss'
import { useEval } from '../../lib/engine/useEval'
import { moveShare, useCachedExplorer, useExplorer } from '../../lib/explorer'
import { buildTree, findNode, opponentBranchKeys, orderTree, type TreeNode } from '../../lib/chess/tree'
import { repStart, startOf, startsWith } from '../../lib/chess/start'
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
  const start = data ? repStart(data.rep) : startOf()
  const rawPathStr = params.get('m') ?? ''
  const focusStr = params.get('f') ?? ''
  // Lines always begin with the repertoire's starting moves; anything else opens at the start.
  const path = useMemo(() => {
    const p = rawPathStr ? rawPathStr.split(',') : []
    return startsWith(p, start.moves) ? p : start.moves
  }, [rawPathStr, start.moves])
  const pathStr = path.join(',')
  const played = useMemo(() => {
    try {
      return replay(path)
    } catch {
      return []
    }
  }, [path])
  // Focus narrows the tree to one branch; it only applies while the line starts with it.
  const focus = useMemo(() => {
    const f = focusStr ? focusStr.split(',') : []
    return f.length > start.moves.length && f.length <= played.length && startsWith(path, f) ? f : []
  }, [focusStr, path, played.length, start.moves.length])
  // The board never goes back before the repertoire's start (or the focus).
  const floor = Math.max(start.moves.length, focus.length)

  // The cursor resets to the end of the line whenever the line itself changes.
  const [cursorState, setCursorState] = useState({ pathStr, cursor: played.length })
  const rawCursor = cursorState.pathStr === pathStr ? cursorState.cursor : played.length
  const cursor = Math.max(floor, Math.min(rawCursor, played.length))
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
  const fen = fens[cursor]
  const key = positionKey(fen)
  const graph = data?.graph
  const color = data?.rep.color ?? 'white'
  const myTurn = turnOf(fen) === color

  const inRep = useMemo(
    () => played.map((p, i) => graph?.movesFrom.get(positionKey(fens[i]))?.find((m) => m.uci === p.uci)),
    [played, fens, graph],
  )
  const firstDraft = inRep.findIndex((m, i) => i >= start.moves.length && !m)
  const unsaved = firstDraft !== -1 && firstDraft < cursor
  const repMovesHere = useMemo(() => new Set((graph?.movesFrom.get(key) ?? []).map((m) => m.uci)), [graph, key])
  const mine = graph ? myMove(graph, key) : undefined

  const explorerState = useExplorer(fen, settings?.explorerFilter)
  const evaluation = useEval(fen, engineOn)
  const loss = useMoveLoss(fen, mine?.uci, color, evaluation)

  // Tree of the repertoire (from the focus) with the explored line grafted on.
  const treeRoot = focus.length ? focus : start.moves
  const rawTree = useMemo(() => (graph ? buildTree(graph, treeRoot, path) : null), [graph, treeRoot, path])
  const branchKeys = useMemo(() => (rawTree ? opponentBranchKeys(rawTree) : []), [rawTree])
  const focusKey = positionKey(fens[focus.length])
  const cached = useCachedExplorer([focusKey, ...branchKeys], settings?.explorerFilter)
  const shareOf = useCallback(
    (parent: TreeNode, child: TreeNode) => moveShare(cached.get(parent.key), child.uci),
    [cached],
  )
  const tree = useMemo(() => (rawTree ? orderTree(rawTree, shareOf) : null), [rawTree, shareOf])

  const goTo = useCallback(
    (uci: string[], newFocus: string[] = focus) => {
      setStatus(undefined)
      const next: Record<string, string> = {}
      if (uci.length) next.m = uci.join(',')
      if (newFocus.length) next.f = newFocus.join(',')
      setParams(next, { replace: true })
    },
    [setParams, focus],
  )

  const play = (uci: string) => {
    const m = playUci(fen, uci)
    if (!m) return
    // Stay on the existing line if the move matches it.
    if (path[cursor] === m.uci) setCursor(cursor + 1)
    else goTo([...path.slice(0, cursor), m.uci])
  }

  const forward = useCallback(() => {
    if (cursor < played.length) return setCursor(cursor + 1)
    // At the end of the explored line, follow the tree's main line.
    const next = tree && findNode(tree, path)?.children[0]
    if (next) goTo(next.path)
  }, [cursor, played.length, setCursor, tree, path, goTo])

  const save = async () => {
    if (!data) return
    const rep = data.rep
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
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea') || e.metaKey || e.ctrlKey) return
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(floor, c - 1))
      if (e.key === 'ArrowRight') forward()
      if (e.key === 's' && unsaved) saveRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setCursor, floor, forward, unsaved])

  if (data === undefined || !settings) return null
  if (data === null || !tree) return <p className="text-muted">Repertoire not found.</p>
  const rep = data.rep

  const incoming = cursor > start.moves.length ? inRep[cursor - 1] : undefined
  const remove = async () => {
    if (!incoming) return
    const removed = await previewRemoval(rep, incoming.id)
    if (!confirm(`Delete ${incoming.san} and the ${removed.length - 1} moves that follow only from it?`)) return
    await removeMoves(rep, new Set([incoming.id]))
    goTo(path.slice(0, cursor - 1))
    setStatus(`Deleted ${removed.length} move${removed.length === 1 ? '' : 's'}.`)
  }

  const startHere = async () => {
    const newStart = path.slice(0, cursor)
    const removed = await previewStartChange(rep, newStart)
    const overlaps = await findOverlaps(rep.color, newStart, rep.id)
    const where = formatMoves(played.slice(0, cursor).map((p) => p.san))
    const ok = confirm(
      `Start "${rep.name}" after ${where}?\n` +
        (overlaps.length ? `Note: this overlaps with ${overlaps.map((r) => `"${r.name}"`).join(', ')}.\n` : '') +
        (removed.length
          ? `This deletes ${removed.length} move${removed.length === 1 ? '' : 's'} before that position or outside it, with their review history.`
          : 'No moves are deleted.'),
    )
    if (!ok) return
    await setRepertoireStart(rep, newStart)
    goTo(path, [])
    setStatus(`The repertoire now starts after ${where}.`)
  }

  // Same position reached through a different move order in the repertoire.
  const canonical = graph ? [...start.moves, ...pathTo(graph, key).map((m) => m.uci)] : []
  const isTransposition =
    canonical.length > start.moves.length && canonical.join(',') !== path.slice(0, cursor).join(',') && graph?.depth.has(key)

  const last = cursor > 0 ? played[cursor - 1] : undefined
  const lastSquares = last ? (moveSquares(fens[cursor - 1], last.uci) ?? undefined) : undefined
  const arrows = mine ? [{ ...squaresOf(fen, mine.uci), brush: 'green' as const }] : []
  const focusSans = played.slice(0, focus.length).map((p) => p.san)
  const focusName = cached.get(focusKey)?.opening?.name
  const openingHere = explorerState.data?.opening?.name

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <ColorDot color={rep.color} />
          <Link to={`/rep/${rep.id}`} className="font-medium hover:underline">
            {rep.name}
          </Link>
          <Link to={`/rep/${rep.id}/tree`} className="text-xs text-muted hover:text-ink">
            Overview
          </Link>
          <span className="ml-auto truncate text-xs text-muted" title={openingHere}>
            {openingHere ?? (myTurn ? 'Your move' : 'Opponent to move')}
          </span>
        </div>
        <Board
          fen={fen}
          orientation={rep.color}
          lastMove={lastSquares}
          arrows={arrows.filter((a) => a.from)}
          onMove={play}
        />
        <div className="flex gap-2">
          <button
            className="btn-ghost flex-1"
            onClick={() => setCursor(floor)}
            disabled={cursor <= floor}
            aria-label="Start"
          >
            ⏮
          </button>
          <button
            className="btn-ghost flex-1"
            onClick={() => setCursor(cursor - 1)}
            disabled={cursor <= floor}
            aria-label="Back"
          >
            ◀
          </button>
          <button className="btn-ghost flex-1" onClick={forward} aria-label="Forward">
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

        {(unsaved || incoming || status) && (
          <div className="flex flex-wrap items-center gap-2">
            {unsaved && (
              <>
                <button className="btn-primary" onClick={save} title="Keyboard: S">
                  Save new moves
                </button>
                <button className="btn-ghost" onClick={() => goTo(path.slice(0, firstDraft))}>
                  Discard
                </button>
              </>
            )}
            {incoming && !unsaved && (
              <>
                <button className="btn-ghost" onClick={remove}>
                  Delete {incoming.san}…
                </button>
                <button
                  className="btn-ghost"
                  onClick={startHere}
                  title="Make this position the start of the repertoire: earlier moves are set up, not drilled, and scores are measured from here"
                >
                  Start repertoire here…
                </button>
              </>
            )}
            {status && <span className="text-sm text-muted">{status}</span>}
          </div>
        )}

        <section className="card">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs">
            {focus.length ? (
              <>
                <span className="text-muted">Focus</span>
                <span className="truncate font-medium" title={focusName}>
                  {focusName ?? formatMoves(focusSans)}
                </span>
                <button className="ml-auto shrink-0 text-muted hover:text-ink" onClick={() => goTo(path, [])}>
                  Show whole repertoire
                </button>
              </>
            ) : (
              <>
                <span className="shrink-0 font-medium">Lines</span>
                {start.moves.length > 0 && (
                  <span className="truncate text-muted" title="The repertoire starts here">
                    from {formatMoves(start.sans)}
                  </span>
                )}
                {cursor > start.moves.length && (
                  <button
                    className="ml-auto shrink-0 text-muted hover:text-ink"
                    onClick={() => goTo(path, path.slice(0, cursor))}
                    title="Show only the lines from this position"
                  >
                    Focus here
                  </button>
                )}
              </>
            )}
          </div>
          <div data-tree-scroll className="px-3 py-2 md:max-h-[40vh] md:overflow-y-auto">
            {tree.children.length ? (
              <MoveTree root={tree} current={path.slice(0, cursor)} onJump={(p) => goTo(p)} share={shareOf} />
            ) : (
              <p className="text-sm text-muted">Play a move on the board or pick one from the explorer.</p>
            )}
          </div>
        </section>
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
              <Link className="underline" to={builderUrl(rep.id, canonical)}>
                {formatMoves(replay(canonical).map((m) => m.san))}
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
