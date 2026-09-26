import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Board, type Arrow } from '../../components/Board'
import { ChapterLines } from '../../components/ChapterLines'
import { ChapterList, ChapterMenu, ChapterNavToggle, ChapterStepper } from '../../components/ChapterNav'
import { useChapterNavStyle } from '../../lib/openings/useChapterNavStyle'
import { OpeningTrail } from '../../components/OpeningTrail'
import { FirstIcon, LastIcon, NextIcon, PencilIcon, PrevIcon } from '../../components/icons'
import { ColorDot, Notice, Section, Toggle } from '../../components/ui'
import {
  addLine,
  MoveConflictError,
  previewRemoval,
  removeMoves,
  setChapterBreak,
  setMoveComment,
  setMoveGlyph,
  setPositionName,
  setPositionNote,
} from '../../db/repertoire'
import { db, type RepMove } from '../../db/schema'
import { useSettings } from '../../db/settings'
import { useCrossIndex, useRepertoire } from '../../db/useRepertoire'
import { crossAt, crossEntering, crossMove, crossPath } from '../../lib/chess/cross'
import { myMove, pathTo } from '../../lib/chess/graph'
import { formatMoves, moveSquares, playUci, positionKey, replay, START_FEN, turnOf } from '../../lib/chess/position'
import { useMoveLoss } from '../../lib/engine/useMoveLoss'
import { useEval } from '../../lib/engine/useEval'
import { moveShare, useCachedExplorer, useExplorer, useOpeningNames, type ExplorerFilter } from '../../lib/explorer'
import { GLYPH_NAMES, GLYPH_TONE, GLYPHS } from '../../lib/chess/glyphs'
import type { Chapter, ChapterBreak } from '../../lib/openings/chapters'
import { useChapters, useNaming, type Naming } from '../../lib/openings/naming'
import { openingTrail } from '../../lib/openings/names'
import { buildTree, findNode, opponentBranchKeys, orderTree, type TreeNode } from '../../lib/chess/tree'
import { repStart, startOf, startsWith } from '../../lib/chess/start'
import { EnginePanel } from '../board/EnginePanel'
import { ExplorerPanel, ExplorerSourceToggle } from '../board/ExplorerPanel'
import { MoveInsight } from '../board/MoveInsight'
import { builderUrl } from '../../lib/routes'
import { confirmDialog, promptDialog } from '../../lib/dialog'

function readEngineToggle() {
  try {
    return localStorage.getItem('engine') !== 'off'
  } catch {
    return true
  }
}

/** The database picked on the explorer panel (on this device), if any. */
function readExplorerDb(): ExplorerFilter['db'] | undefined {
  try {
    const db = localStorage.getItem('explorerDb')
    return db === 'lichess' || db === 'masters' ? db : undefined
  } catch {
    return undefined
  }
}

export function BuilderPage() {
  const { id } = useParams()
  const data = useRepertoire(id)
  const cross = useCrossIndex(data?.rep)
  const settings = useSettings()
  const [params, setParams] = useSearchParams()
  const start = data ? repStart(data.rep) : startOf()
  const rawPathStr = params.get('m') ?? ''
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
  // The board never goes back before the repertoire's start.
  const floor = start.moves.length

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
  const [panelDb, setPanelDb] = useState(readExplorerDb)
  const [status, setStatus] = useState<string>()
  // The threat being hovered, drawn on the board for the position it belongs to.
  const [threatArrow, setThreatArrow] = useState<{ fen: string; arrow: Arrow }>()

  const fens = useMemo(() => [START_FEN, ...played.map((p) => p.fen)], [played])
  const fen = fens[cursor]
  const pathKeys = useMemo(() => fens.map(positionKey), [fens])
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

  // The panel can show the other database; scores and the tree keep the saved filter.
  const savedFilter = settings?.explorerFilter
  const panelFilter = useMemo(() => savedFilter && { ...savedFilter, db: panelDb ?? savedFilter.db }, [savedFilter, panelDb])
  const explorerState = useExplorer(fen, panelFilter)
  const evaluation = useEval(fen, engineOn)
  const loss = useMoveLoss(fen, mine?.uci, color, evaluation)

  // Tree of the repertoire with the explored line grafted on.
  const rawTree = useMemo(() => (graph ? buildTree(graph, start.moves, path) : null), [graph, start.moves, path])
  const branchKeys = useMemo(() => (rawTree ? opponentBranchKeys(rawTree) : []), [rawTree])
  const cached = useCachedExplorer(branchKeys, settings?.explorerFilter)
  const shareOf = useCallback(
    (parent: TreeNode, child: TreeNode) => moveShare(cached.get(parent.key), child.uci),
    [cached],
  )
  const tree = useMemo(() => (rawTree ? orderTree(rawTree, shareOf) : null), [rawTree, shareOf])
  const naming = useNaming()
  const chapters = useChapters(tree, naming)
  const [navStyle, setNavStyle] = useChapterNavStyle()
  const repId = data?.rep.id ?? ''
  const crossNote = useCallback(
    (parent: TreeNode, node: TreeNode) => crossEntering(cross, parent.key, node.key, repId).map((r) => r.rep.name),
    [cross, repId],
  )
  // Names along the line: the user's and the bundled opening names, else the explorer's while those load.
  // Explorer names are the same in both databases: take them from whichever has the position cached.
  const panelNames = useOpeningNames(pathKeys, panelFilter)
  const savedNames = useOpeningNames(pathKeys, savedFilter)
  const openings = useMemo(
    () => pathKeys.map((k, i) => (naming ? naming.display(k) : (panelNames[i] ?? savedNames[i]))),
    [pathKeys, naming, panelNames, savedNames],
  )
  const trail = useMemo(() => openingTrail(openings, cursor), [openings, cursor])

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
      const ok = await confirmDialog({
        title: `Replace ${e.existing.san} with ${e.wantedSan}?`,
        message: `Your repertoire plays ${e.existing.san} here. Replacing it removes ${removed.length} move${
          removed.length === 1 ? '' : 's'
        } and resets your progress on this position.`,
        confirmLabel: 'Replace',
        danger: true,
      })
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

  if (data === undefined || !settings || !panelFilter) return null
  if (data === null || !tree) return <p className="text-muted">Repertoire not found.</p>
  const rep = data.rep

  const incoming = cursor > start.moves.length ? inRep[cursor - 1] : undefined
  const remove = async () => {
    if (!incoming) return
    const removed = await previewRemoval(rep, incoming.id)
    const rest = removed.length - 1
    const ok = await confirmDialog({
      title: `Delete ${incoming.san}?`,
      message: rest
        ? `The ${rest} move${rest === 1 ? '' : 's'} that follow only from it are deleted too, with their review history.`
        : 'Its review history is deleted too.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    await removeMoves(rep, new Set([incoming.id]))
    goTo(path.slice(0, cursor - 1))
    setStatus(`Deleted ${removed.length} move${removed.length === 1 ? '' : 's'}.`)
  }

  // Same position reached through a different move order in the repertoire.
  const canonical = graph ? [...start.moves, ...pathTo(graph, key).map((m) => m.uci)] : []
  const isTransposition =
    canonical.length > start.moves.length && canonical.join(',') !== path.slice(0, cursor).join(',') && graph?.depth.has(key)
  // Other repertoires of this colour that continue from here.
  const elsewhere = crossAt(cross, key, rep.id).map((ref) => ({ ref, move: myTurn ? crossMove(ref, key) : undefined }))

  const last = cursor > 0 ? played[cursor - 1] : undefined
  const lastSquares = last ? (moveSquares(fens[cursor - 1], last.uci) ?? undefined) : undefined
  const arrows: Arrow[] = mine ? [{ ...squaresOf(fen, mine.uci), brush: 'green' }] : []
  // What the other repertoires play here, when it isn't this one's move.
  for (const { move } of elsewhere)
    if (move && move.uci !== mine?.uci && !arrows.some((a) => a.to === squaresOf(fen, move.uci).to))
      arrows.push({ ...squaresOf(fen, move.uci), brush: 'paleBlue' })
  if (threatArrow?.fen === fen) arrows.push(threatArrow.arrow)
  // The chapter of the position on the board (the first one at the start, which only leads into chapters).
  const currentPath = path.slice(0, cursor)
  const chapter = chapters && (chapters.of(currentPath) ?? chapters.list[0])
  const showList = navStyle === 'list' && !!chapters && chapters.list.length > 1
  const selectChapter = (ch: Chapter) => goTo(ch.node.path)
  const renameChapter = async (ch: Chapter) => {
    const name = await promptDialog({
      title: 'Rename chapter',
      message: 'The name shows wherever this position comes up. Leave it empty to use the opening name.',
      defaultValue: ch.custom ? ch.name : '',
      placeholder: ch.custom ? undefined : ch.name,
      confirmLabel: 'Rename',
    })
    if (name === null) return
    await setPositionName(ch.nameKey, name)
    // A name given from the chapter's first move would win over the new one.
    if (ch.nameKey !== ch.node.key && naming?.custom(ch.node.key)) await setPositionName(ch.node.key, '')
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <ColorDot color={rep.color} size={14} />
          <Link to={`/rep/${rep.id}`} className="truncate font-display text-xl font-medium tracking-tight hover:text-maple">
            {rep.name}
          </Link>
          <Link to={`/rep/${rep.id}/tree`} className="chip shrink-0 py-0.5">
            Overview
          </Link>
          <span className={`ml-auto flex shrink-0 items-center gap-1.5 text-xs ${myTurn ? 'text-maple' : 'text-muted'}`}>
            <span className={`h-2 w-2 rounded-full ${myTurn ? 'bg-maple' : 'bg-faint'}`} />
            {myTurn ? 'Your move' : 'Their move'}
          </span>
        </div>
        <div className="-mt-1 flex min-h-6 items-center">
          <OpeningTrail trail={trail} />
        </div>
        <Board
          fen={fen}
          orientation={rep.color}
          lastMove={lastSquares}
          arrows={arrows.filter((a) => a.from)}
          onMove={play}
        />
        <div className="grid grid-cols-4 gap-2" title="Keyboard: ← →">
          <button className="btn-ghost" onClick={() => setCursor(floor)} disabled={cursor <= floor} aria-label="Start">
            <FirstIcon />
          </button>
          <button className="btn-ghost" onClick={() => setCursor(cursor - 1)} disabled={cursor <= floor} aria-label="Back">
            <PrevIcon />
          </button>
          <button className="btn-ghost" onClick={forward} aria-label="Forward">
            <NextIcon />
          </button>
          <button
            className="btn-ghost"
            onClick={() => setCursor(played.length)}
            disabled={cursor >= played.length}
            aria-label="End"
          >
            <LastIcon />
          </button>
        </div>

        {(unsaved || incoming || status) && (
          <div
            className={`flex animate-pop flex-wrap items-center gap-2 ${
              unsaved ? 'rounded-xl border border-warn/40 bg-warn/8 p-2 pl-3' : ''
            }`}
          >
            {unsaved && (
              <>
                <span className="mr-auto text-sm text-warn">Unsaved moves</span>
                <button className="btn-primary" onClick={save} title="Keyboard: S">
                  Save <kbd className="rounded bg-black/10 px-1 text-[10px] font-semibold">S</kbd>
                </button>
                <button className="btn-ghost" onClick={() => goTo(path.slice(0, firstDraft))}>
                  Discard
                </button>
              </>
            )}
            {incoming && !unsaved && (
              <button className="btn-ghost text-xs" onClick={remove}>
                Delete {incoming.san}…
              </button>
            )}
            {status && <span className="text-sm text-accent">{status}</span>}
          </div>
        )}

        {showList && chapters && chapter && (
          <section className="card">
            <div className="flex min-h-10 items-center gap-2 border-b border-line/70 px-4 py-2 text-xs">
              <span className="shrink-0 font-display text-[15px] font-medium">Chapters</span>
              {start.moves.length > 0 && (
                <span className="truncate text-muted" title="The repertoire starts here">
                  from {formatMoves(start.sans)}
                </span>
              )}
              <span className="ml-auto" />
              <ChapterNavToggle style={navStyle} onChange={setNavStyle} />
            </div>
            <div className="max-h-[30vh] overflow-y-auto">
              <ChapterList tree={tree} chapters={chapters} selected={chapter} onSelect={selectChapter} share={shareOf} />
            </div>
          </section>
        )}

        <section className="card">
          <div className="flex min-h-10 items-center gap-2 border-b border-line/70 px-2 py-1.5 text-xs">
            {chapters && chapter ? (
              <ChapterStepper chapters={chapters} selected={chapter} onSelect={selectChapter}>
                {navStyle === 'menu' ? (
                  <ChapterMenu chapters={chapters} selected={chapter} onSelect={selectChapter} />
                ) : (
                  <span className="min-w-0 truncate font-display text-[15px] font-medium" title={chapter.name}>
                    {chapter.title}
                  </span>
                )}
                <button
                  className="shrink-0 rounded-md p-1 text-faint hover:bg-surface-3 hover:text-ink"
                  onClick={() => renameChapter(chapter)}
                  aria-label="Rename chapter"
                  title="Rename chapter"
                >
                  <PencilIcon size={14} />
                </button>
              </ChapterStepper>
            ) : (
              <span className="px-2 font-display text-[15px] font-medium">Lines</span>
            )}
            {!showList && chapters && <ChapterNavToggle style={navStyle} onChange={setNavStyle} />}
          </div>
          <div data-tree-scroll className="p-2.5 md:max-h-[45vh] md:overflow-y-auto">
            {!tree.children.length ? (
              <p className="px-1 text-sm text-muted">Play a move on the board or pick one from the explorer.</p>
            ) : (
              chapters &&
              chapter && (
                <ChapterLines
                  tree={tree}
                  chapters={chapters}
                  chapter={chapter}
                  current={currentPath}
                  onJump={goTo}
                  share={shareOf}
                  crossNote={crossNote}
                />
              )
            )}
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-5">
        <Section
          title={myTurn ? 'Your move' : 'Opponent replies'}
          right={
            <ExplorerSourceToggle
              filter={panelFilter}
              onChange={(db) => {
                // Only a choice that differs from Settings is kept, so Settings still decides otherwise.
                const override = db === settings.explorerFilter.db ? undefined : db
                setPanelDb(override)
                try {
                  if (override) localStorage.setItem('explorerDb', override)
                  else localStorage.removeItem('explorerDb')
                } catch {
                  // Preference is optional.
                }
              }}
            />
          }
        >
          <div className="mb-3 text-sm">
            {myTurn ? (
              mine ? (
                <>
                  <span className="text-muted">Your repertoire plays</span>{' '}
                  <span className="rounded-md bg-accent/15 px-1.5 py-0.5 font-semibold text-accent">{mine.san}</span>
                  {loss !== null && loss > settings.blunderThreshold && (
                    <div className="mt-2">
                      <Notice tone="warn">The engine says this loses about {(loss / 100).toFixed(1)} pawns compared with its best move.</Notice>
                    </div>
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
            <div className="mb-3">
              <Notice tone="info">
                Transposition: this position is already in your repertoire via{' '}
                <Link className="font-medium underline underline-offset-2" to={builderUrl(rep.id, canonical)}>
                  {formatMoves(replay(canonical).map((m) => m.san))}
                </Link>
                . Lines stop here and continue from there.
              </Notice>
            </div>
          )}
          {elsewhere.map(({ ref, move }) => {
            const there = crossPath(ref, key)
            const link = (
              <Link className="font-medium underline underline-offset-2" to={builderUrl(ref.rep.id, there)}>
                {ref.rep.name}
              </Link>
            )
            const conflict = move && mine && move.uci !== mine.uci
            return (
              <div key={ref.rep.id} className="mb-3">
                <Notice tone={conflict ? 'warn' : 'info'}>
                  {conflict ? (
                    <>
                      Same position, different move: your {link} repertoire plays <b>{move.san}</b> here, this one plays{' '}
                      <b>{mine.san}</b>.
                    </>
                  ) : move && !mine ? (
                    <>
                      This position is also in your {link} repertoire, which plays <b>{move.san}</b> here (blue arrow).
                    </>
                  ) : (
                    <>
                      This position is also in your {link} repertoire
                      {there.join(',') !== path.slice(0, cursor).join(',') && <>, via {formatMoves(replay(there).map((m) => m.san))}</>}.
                    </>
                  )}
                </Notice>
              </div>
            )
          })}
          <ExplorerPanel
            state={explorerState}
            filter={panelFilter}
            repMoves={repMovesHere}
            myTurn={myTurn}
            evaluation={engineOn ? evaluation : null}
            onPick={play}
          />
        </Section>

        {last && (
          <Section title={`What ${formatMoves([last.san], cursor - 1)} does`}>
            <MoveInsight
              key={`${fens[cursor - 1]}|${last.uci}`}
              fen={fens[cursor - 1]}
              uci={last.uci}
              engine={engineOn}
              onArrow={(arrow) => setThreatArrow(arrow ? { fen, arrow } : undefined)}
            />
          </Section>
        )}

        <Section
          title="Engine"
          right={
            <Toggle
              label={engineOn ? 'On' : 'Off'}
              checked={engineOn}
              onChange={(on) => {
                setEngineOn(on)
                try {
                  localStorage.setItem('engine', on ? 'on' : 'off')
                } catch {
                  // Preference is optional.
                }
              }}
            />
          }
        >
          {engineOn ? (
            <EnginePanel evaluation={evaluation} onPick={play} />
          ) : (
            <p className="text-sm text-muted">Stockfish is off. Turn it on to check your moves.</p>
          )}
        </Section>

        <Notes
          positionKey={key}
          incoming={incoming}
          naming={naming}
          startsChapter={!!chapters?.startingAt(currentPath)}
        />
      </div>
    </div>
  )
}

function squaresOf(fen: string, uci: string) {
  const sq = moveSquares(fen, uci)
  return { from: sq?.[0] ?? '', to: sq?.[1] ?? '' }
}

function Notes({
  positionKey,
  incoming,
  naming,
  startsChapter,
}: {
  positionKey: string
  incoming?: RepMove
  naming?: Naming
  /** The move to this position starts a chapter (as things stand). */
  startsChapter: boolean
}) {
  // null = loaded but empty, undefined = still loading (so defaultValue is set once loaded).
  const note = useLiveQuery(() => db.positions.get(positionKey).then((n) => n ?? null), [positionKey])
  const move = useLiveQuery(() => (incoming ? db.moves.get(incoming.id).then((m) => m ?? null) : null), [incoming?.id])
  const glyph = move?.glyph || undefined
  const breakHere = note?.chapter
  const setBreak = (b: ChapterBreak | undefined) => setChapterBreak(positionKey, b)
  return (
    <Section title="Notes">
      {incoming && move && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">
            Symbol for <span className="font-semibold text-ink">{incoming.san}</span>
          </span>
          {GLYPHS.map((g) => (
            <button
              key={g}
              title={GLYPH_NAMES[g]}
              onClick={() => setMoveGlyph(incoming.id, glyph === g ? undefined : g)}
              className={`min-w-8 rounded-md border px-1.5 py-0.5 text-sm font-semibold transition ${
                glyph === g ? `border-brass/70 bg-brass/12 ${GLYPH_TONE[g]}` : 'border-line text-muted hover:border-line-strong hover:text-ink'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      )}
      {incoming && move !== undefined && (
        <>
          <label className="mb-1.5 block text-xs text-muted">
            Why <span className="font-semibold text-ink">{incoming.san}</span>? Shown in the lines and after you play it in training.
          </label>
          <textarea
            key={`m-${incoming.id}`}
            className="input mb-3 h-16 w-full resize-y leading-relaxed"
            defaultValue={move?.comment ?? ''}
            onBlur={(e) => e.target.value !== (move?.comment ?? '') && setMoveComment(incoming.id, e.target.value)}
          />
        </>
      )}
      {incoming && note !== undefined && (
        <div className="mb-3 flex flex-col gap-1.5">
          <label className="text-xs text-muted" htmlFor={`name-${positionKey}`}>
            Name of the line after {incoming.san} (chapters, side lines and the name above the board)
          </label>
          <input
            id={`name-${positionKey}`}
            key={`n-${positionKey}`}
            className="input"
            defaultValue={note?.name ?? ''}
            placeholder={naming?.opening(positionKey)?.name ?? 'e.g. Hamppe line'}
            onBlur={(e) => e.target.value.trim() !== (note?.name ?? '') && setPositionName(positionKey, e.target.value)}
          />
          {!incoming.byMe && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="mr-1 text-muted">Chapter</span>
              {(
                [
                  [undefined, `Automatic${breakHere ? '' : startsChapter ? ' (new chapter)' : ' (same chapter)'}`],
                  ['split', 'New chapter'],
                  ['merge', 'Same chapter'],
                ] as const
              ).map(([b, label]) => (
                <button key={label} className={`chip py-0.5 ${breakHere === b ? 'chip-on' : ''}`} onClick={() => setBreak(b)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <label className="mb-1.5 block text-xs text-muted">Plans and ideas in this position (shared by all repertoires)</label>
      {note !== undefined && (
        <textarea
          key={`p-${positionKey}`}
          className="input h-20 w-full resize-y leading-relaxed"
          defaultValue={note?.note ?? ''}
          placeholder="e.g. Aim for c4–c5 and a queenside pawn storm; the light-squared bishop belongs on d3."
          onBlur={(e) => e.target.value !== (note?.note ?? '') && setPositionNote(positionKey, e.target.value)}
        />
      )}
    </Section>
  )
}
