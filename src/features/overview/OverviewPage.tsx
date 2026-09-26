import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { pct, scoreColor } from '../../components/format'
import { TargetIcon } from '../../components/icons'
import { OpeningTrail } from '../../components/OpeningTrail'
import { ColorDot, Notice } from '../../components/ui'
import { findOverlaps, previewStartChange, setRepertoireStart } from '../../db/repertoire'
import { confirmDialog, promptDialog } from '../../lib/dialog'
import { useSettings } from '../../db/settings'
import { useCrossIndex, useRepertoire } from '../../db/useRepertoire'
import { crossAt, crossEntering, crossPath, type CrossRef } from '../../lib/chess/cross'
import { formatMoves, positionKey, replay, START_FEN, turnOf } from '../../lib/chess/position'
import { parseMoves, repStart } from '../../lib/chess/start'
import { allKeys, buildTree, orderTree, type TreeNode } from '../../lib/chess/tree'
import { AuthRequiredError, moveShare, useCachedExplorer, type ExplorerData } from '../../lib/explorer'
import { openingTrail, type OpeningName } from '../../lib/openings/names'
import { preparedness } from '../../lib/prep/preparedness'
import { usePreparedness } from '../../lib/prep/usePreparedness'
import { builderUrl } from '../../lib/routes'

/** Replies you have no answer to are listed when at least this share of games plays them. */
const MIN_UNPREPARED_SHARE = 0.03

interface Row {
  /** First and last node of a run of moves without branching. */
  first: TreeNode
  last: TreeNode
  /** Moves in the run. */
  nodes: TreeNode[]
  children: Row[]
  unprepared: { parent: TreeNode; uci: string; san: string; share: number }[]
}

/** Frequent opponent replies at a position (opponent to move) that have no answer yet. */
function unpreparedAt(node: TreeNode, explorer: Map<string, ExplorerData>): Row['unprepared'] {
  const data = explorer.get(node.key)
  const total = data ? data.white + data.draws + data.black : 0
  if (!data || !total) return []
  return data.moves
    .map((m) => ({ parent: node, uci: m.uci, san: m.san, share: (m.white + m.draws + m.black) / total }))
    .filter((u) => u.share >= MIN_UNPREPARED_SHARE && !node.children.some((c) => c.uci === u.uci))
}

/** Groups the tree into rows: each row is a run of moves up to the next branch point. */
function toRows(start: TreeNode, explorer: Map<string, ExplorerData>): Row[] {
  return start.children.map((first) => {
    const nodes = [first]
    let last = first
    while (last.children.length === 1 && !last.transposition) {
      last = last.children[0]
      nodes.push(last)
    }
    // Positions in this run where the opponent is to move (after your move),
    // except where the line simply ends: that is flagged as "ends at move N".
    const unprepared = nodes
      .filter((n) => n.byMe && !n.transposition && n.children.length > 0)
      .flatMap((n) => unpreparedAt(n, explorer))
    return { first, last, nodes, children: toRows(last, explorer), unprepared }
  })
}

export function OverviewPage() {
  const { id } = useParams()
  const data = useRepertoire(id)
  const cross = useCrossIndex(data?.rep)
  const settings = useSettings()
  const depth = settings?.prepDepth ?? 6
  // Downloads the explorer data needed for the scores in the background.
  const prep = usePreparedness(data, settings?.explorerFilter, depth)

  const start = data ? repStart(data.rep) : undefined
  const rawTree = useMemo(() => (data && start ? buildTree(data.graph, start.moves) : null), [data, start])
  // Positions up to the start give the name the lines begin with.
  const startKeys = useMemo(
    () => (start ? [positionKey(START_FEN), ...replay(start.moves).map((p) => positionKey(p.fen))] : []),
    [start],
  )
  // All positions: opponent branch points give frequencies, any position may give an opening name.
  const keys = useMemo(() => (rawTree ? [...startKeys, ...allKeys(rawTree)] : []), [rawTree, startKeys])
  const explorer = useCachedExplorer(keys, settings?.explorerFilter)
  const tree = useMemo(
    () => (rawTree ? orderTree(rawTree, (p, c) => moveShare(explorer.get(p.key), c.uci)) : null),
    [rawTree, explorer],
  )
  const rows = useMemo(() => (tree ? toRows(tree, explorer) : []), [tree, explorer])
  // When the opponent moves first from the start (e.g. Black repertoires), list unanswered replies at the top.
  const rootUnprepared = useMemo(
    () => (tree && data && turnOf(tree.fen) !== data.rep.color ? unpreparedAt(tree, explorer) : []),
    [tree, explorer, data],
  )

  const startName = useMemo(
    () => openingTrail(startKeys.map((k) => explorer.get(k)?.opening)).at(-1)?.opening,
    [startKeys, explorer],
  )

  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const [startMsg, setStartMsg] = useState<string>()

  if (!data || !settings || !tree) return data === null ? <p className="text-muted">Repertoire not found.</p> : null
  const { rep } = data

  /** Asks for new starting moves, shows what that deletes, then moves the start. */
  const changeStart = async () => {
    let text = formatMoves(repStart(rep).sans)
    let error: string | undefined
    for (;;) {
      const input = await promptDialog({
        title: 'Change the starting position',
        message: error ?? [
          'These moves are set up, not drilled, and scores are measured from the position after them.',
          'Leave empty to start from the initial position.',
        ],
        defaultValue: text,
        placeholder: '1.e4 e5 2.Nc3',
        confirmLabel: 'Continue',
      })
      if (input === null) return
      text = input
      try {
        const moves = parseMoves(input)
        if (moves.join(',') === repStart(rep).moves.join(',')) return
        const removed = await previewStartChange(rep, moves)
        const overlaps = await findOverlaps(rep.color, moves, rep.id)
        const where = moves.length ? `after ${formatMoves(repStart({ ...rep, startMoves: moves }).sans)}` : 'from the initial position'
        const ok = await confirmDialog({
          title: `Start “${rep.name}” ${where}?`,
          message: [
            ...(overlaps.length ? [`This overlaps with ${overlaps.map((r) => `“${r.name}”`).join(', ')}.`] : []),
            removed.length
              ? `This deletes ${removed.length} move${removed.length === 1 ? '' : 's'} before that position or outside it, with their review history.`
              : 'No moves are deleted.',
          ],
          confirmLabel: 'Change start',
          danger: removed.length > 0,
        })
        if (!ok) return
        await setRepertoireStart(rep, moves)
        setStartMsg(`The repertoire now starts ${where}.`)
        return
      } catch (e) {
        error = (e as Error).message
      }
    }
  }

  /** Moves from the repertoire's start to a node. */
  const fromStart = (node: TreeNode) => node.path.slice(tree.path.length)

  /** Share of games from the starting position that reach a node (product of opponent move frequencies). */
  const reach = (node: TreeNode): number | undefined => {
    let p = 1
    let parent: TreeNode | undefined = tree
    for (const uci of fromStart(node)) {
      const child: TreeNode | undefined = parent?.children.find((c) => c.uci === uci)
      if (!parent || !child) return undefined
      if (!child.byMe) {
        const s = moveShare(explorer.get(parent.key), uci)
        if (s === undefined) return undefined
        p *= s
      }
      parent = child
    }
    return p
  }

  const ownMovesUpTo = (node: TreeNode) => {
    let n = 0
    let cur: TreeNode | undefined = tree
    for (const uci of fromStart(node)) {
      cur = cur?.children.find((c) => c.uci === uci)
      if (cur?.byMe) n++
    }
    return n
  }

  const parentKey = (node: TreeNode) => {
    let cur: TreeNode = tree
    for (const uci of fromStart(node).slice(0, -1)) cur = cur.children.find((c) => c.uci === uci) ?? cur
    return cur.key
  }

  /** Preparedness of a branch, measured from where it starts. */
  const rowPrep = (row: Row): number | undefined => {
    // An own move is scored from the position before it (it is the only move there).
    const ownBefore = ownMovesUpTo(row.first) - (row.first.byMe ? 1 : 0)
    const remaining = depth - ownBefore
    if (remaining <= 0 || !prep) return undefined
    const from = row.first.byMe ? parentKey(row.first) : row.first.key
    // Same inputs as the overall score, so lines that go on in another repertoire follow into it.
    return preparedness({ ...prep.inputs, depth: remaining }, from).score
  }

  const renderUnprepared = (u: Row['unprepared'][number], level: number) => {
    const path = [...u.parent.path, u.uci]
    const ur = reach(u.parent)
    return (
      <li key={path.join(',')}>
        <div
          className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_1.75rem] items-center gap-2 rounded-md py-1 pr-1 text-bad hover:bg-bad/8"
          style={{ paddingLeft: `${level * 1.1 + 1.25}rem` }}
        >
          <Link to={builderUrl(rep.id, path)} className="truncate text-sm hover:underline">
            {formatMoves([u.san], u.parent.ply)} · no answer prepared
          </Link>
          <span className="text-right text-xs tabular-nums">{ur === undefined ? '–' : pct(ur * u.share, 1)}</span>
          <span className="text-right text-xs font-semibold tabular-nums">0%</span>
          <span />
        </div>
      </li>
    )
  }

  /** `before`: the opening name of the position the row starts from. */
  const renderRow = (row: Row, level: number, before: OpeningName | undefined): ReactNode => {
    const rowId = row.first.path.join(',')
    const hasKids = row.children.length > 0 || row.unprepared.length > 0
    const defaultOpen = level < 2
    const open = hasKids && (toggled.has(rowId) ? !defaultOpen : defaultOpen)
    const r = reach(row.first)
    const p = rowPrep(row)
    const own = ownMovesUpTo(row.last)
    // The line ends where another repertoire goes on, or joins one on the way.
    const continues = row.last.children.length ? [] : crossAt(cross, row.last.key, rep.id)
    const joins = new Map<string, { ref: CrossRef; key: string }>()
    if (!continues.length)
      row.nodes.forEach((n, i) => {
        for (const ref of crossEntering(cross, i ? row.nodes[i - 1].key : parentKey(row.first), n.key, rep.id))
          if (!joins.has(ref.rep.id)) joins.set(ref.rep.id, { ref, key: n.key })
      })
    const elsewhere = continues.length ? continues.map((ref) => ({ ref, key: row.last.key })) : [...joins.values()]
    const endsEarly = !row.last.children.length && !row.last.transposition && !continues.length && own < depth
    // Names that start within this row, after the one it inherits.
    const trail = openingTrail([before, ...row.nodes.map((n) => explorer.get(n.key)?.opening)])
    const named = trail.length > 0 && trail.at(-1)!.ply > 0
    return (
      <li key={rowId}>
        <div
          className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_1.75rem] items-start gap-2 rounded-md py-1.5 pr-1 transition-colors hover:bg-surface-2"
          style={{ paddingLeft: `${level * 1.1 + 0.25}rem` }}
        >
          <div className="flex min-w-0 items-start gap-1">
            <button
              className={`w-4 shrink-0 text-xs leading-5 text-muted ${hasKids ? 'hover:text-ink' : 'invisible'}`}
              onClick={() =>
                setToggled((s) => {
                  const next = new Set(s)
                  if (next.has(rowId)) next.delete(rowId)
                  else next.add(rowId)
                  return next
                })
              }
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              {open ? '▾' : '▸'}
            </button>
            <div className="min-w-0">
              <Link to={builderUrl(rep.id, row.last.path)} className="font-display text-[15px] break-words hover:text-maple">
                {formatMoves(
                  row.nodes.map((n) => n.san),
                  row.first.ply - 1,
                )}
                {row.last.transposition && <span className="text-muted"> ↪ transposes</span>}
              </Link>
              {(endsEarly || named || elsewhere.length > 0) && (
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] leading-4">
                  {elsewhere.map(({ ref, key }) => (
                    <Link
                      key={ref.rep.id}
                      to={builderUrl(ref.rep.id, crossPath(ref, key))}
                      className="shrink-0 rounded bg-info/15 px-1 text-info hover:bg-info/25"
                      title={continues.length ? 'This position is prepared further in another repertoire' : 'The line joins another repertoire here'}
                    >
                      ↪ {continues.length ? 'continues in' : 'joins'} {ref.rep.name}
                    </Link>
                  ))}
                  {endsEarly && (
                    <span
                      className="shrink-0 rounded bg-warn/15 px-1 text-warn"
                      title={`Your target is ${depth} moves deep from the start`}
                    >
                      ends {own}/{depth} deep
                    </span>
                  )}
                  {named && <OpeningTrail trail={trail} compact />}
                </div>
              )}
            </div>
          </div>
          <span className="text-right text-xs text-muted tabular-nums">{r === undefined ? '–' : pct(r, r < 0.1 ? 1 : 0)}</span>
          <span className={`text-right text-xs font-semibold tabular-nums ${p === undefined ? 'text-muted' : scoreColor(p)}`}>
            {p === undefined ? '–' : pct(p)}
          </span>
          <Link
            to={builderUrl(rep.id, row.first.path)}
            className="grid place-items-center pt-0.5 text-faint hover:text-brass"
            title="Work on this line in the builder"
          >
            <TargetIcon size={15} />
          </Link>
        </div>
        {open && (
          <ul>
            {row.unprepared.map((u) => renderUnprepared(u, level + 1))}
            {row.children.map((c) => renderRow(c, level + 1, trail.at(-1)?.opening))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div className="stagger flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <ColorDot color={rep.color} size={16} />
        <h1 className="page-title">
          <Link to={`/rep/${rep.id}`} className="hover:text-maple">
            {rep.name}
          </Link>{' '}
          <span className="text-muted italic">overview</span>
        </h1>
        {prep && (
          <span className={`text-sm font-medium ${scoreColor(prep.result.score)}`}>
            {pct(prep.result.score)} prepared, {depth} moves deep
          </span>
        )}
        {start && start.moves.length > 0 && (
          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-display text-sm text-muted">{formatMoves(start.sans)}</span>
        )}
        {startName && <span className="text-sm text-muted italic">{startName.name}</span>}
        <button
          className="text-xs text-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
          onClick={changeStart}
          title="The position this repertoire is drilled and scored from"
        >
          Change start…
        </button>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" onClick={() => setToggled(new Set())}>
            Reset folding
          </button>
          <Link className="btn-primary" to={builderUrl(rep.id, [])}>
            Open builder
          </Link>
        </div>
      </div>

      {startMsg && <p className="text-sm text-accent">{startMsg}</p>}

      {prep && prep.pending > 0 && (
        <Notice>
          {prep.fetchError instanceof AuthRequiredError
            ? 'Log in with Lichess (Settings) to see how often each line is played.'
            : `Downloading opponent statistics… ${prep.pending} positions left.`}
        </Notice>
      )}

      <section className="card p-3">
        <div className="mb-1 grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_1.75rem] gap-2 border-b border-line/70 px-1 pb-2 text-[11px] tracking-wide text-faint uppercase">
          <span className="pl-5">Line</span>
          <span className="text-right" title="Share of games from the starting position that reach this line">
            Games
          </span>
          <span className="text-right" title={`Chance to stay in remembered prep until ${depth} moves deep`}>
            Prep
          </span>
          <span />
        </div>
        {rows.length ? (
          <ul>
            {rootUnprepared.map((u) => renderUnprepared(u, 0))}
            {rows.map((r) => renderRow(r, 0, startName))}
          </ul>
        ) : (
          <p className="p-2 text-sm text-muted">This repertoire is empty. Add lines in the builder.</p>
        )}
      </section>
      <p className="text-xs leading-relaxed text-faint">
        Games = share of games from the repertoire's starting position (with your explorer filter) that reach the line.
        Prep = chance to stay in moves you remember until you are {depth} moves deep.{' '}
        <TargetIcon size={12} className="inline align-[-2px]" /> opens the line in the builder, focused on that branch.
      </p>
    </div>
  )
}
