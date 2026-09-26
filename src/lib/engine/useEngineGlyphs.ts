import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo } from 'react'
import { db } from '../../db/schema'
import type { Glyph } from '../chess/glyphs'
import type { TreeNode } from '../chess/tree'
import { cloudEval, storeEval } from './eval'
import { judgeMove } from './judge'
import type { Evaluation } from './uci'

interface Target {
  /** Position the opponent moves in, and its FEN. */
  fromKey: string
  fromFen: string
  uci: string
  toKey: string
  toFen: string
}

const targetId = (fromKey: string, uci: string) => `${fromKey}|${uci}`

/** Opponent moves in a tree, main lines first. */
function opponentMoves(root: TreeNode): Target[] {
  const out: Target[] = []
  const walk = (node: TreeNode) => {
    for (const c of node.children) {
      if (!c.byMe && !c.draft) out.push({ fromKey: node.key, fromFen: node.fen, uci: c.uci, toKey: c.key, toFen: c.fen })
      walk(c)
    }
  }
  walk(root)
  return out
}

/** Positions already asked for this session, so unknown ones aren't asked again. */
const asked = new Set<string>()

/**
 * Downloads the Lichess cloud evaluations still missing to judge the given
 * moves, one at a time, into the evaluation cache. Only the cloud is used:
 * running Stockfish here would stop the analysis on screen.
 */
async function fill(targets: Target[], have: ReadonlyMap<string, Evaluation>, cancelled: () => boolean) {
  const ask = async (fen: string, key: string, multiPv: number) => {
    if (asked.has(key)) return undefined
    asked.add(key)
    const e = await cloudEval(fen, multiPv).catch(() => null)
    if (e?.lines.length) await storeEval(e)
    await new Promise((r) => setTimeout(r, 250))
    return e ?? undefined
  }
  for (const t of targets) {
    if (cancelled()) return
    const before = have.get(t.fromKey) ?? (await ask(t.fromFen, t.fromKey, 3))
    if (cancelled() || !before?.lines.length) continue
    if (!before.lines.some((l) => l.pv[0] === t.uci) && !have.has(t.toKey)) await ask(t.toFen, t.toKey, 1)
  }
}

/**
 * The engine's symbols ('?' and '??') for the opponent's moves in a tree,
 * from cached evaluations. With `download`, missing cloud evaluations are
 * fetched in the background. `glyphOf` is the symbol to show on a node: the
 * one the user set, else the engine's (none if the user cleared it).
 */
export function useEngineGlyphs(tree: TreeNode | null | undefined, download = false) {
  const targets = useMemo(() => (tree ? opponentMoves(tree) : []), [tree])
  const keys = useMemo(() => [...new Set(targets.flatMap((t) => [t.fromKey, t.toKey]))], [targets])
  const evals = useLiveQuery(async () => {
    const rows = await db.evalCache.bulkGet(keys)
    const map = new Map<string, Evaluation>()
    rows.forEach((r, i) => r && map.set(keys[i], r.data as Evaluation))
    return map
  }, [keys])

  const engine = useMemo(() => {
    const out = new Map<string, Glyph>()
    if (!evals) return out
    for (const t of targets) {
      const g = engineGlyphOf(evals, t.fromKey, t.fromFen, t.uci, t.toKey)
      if (g) out.set(targetId(t.fromKey, t.uci), g)
    }
    return out
  }, [targets, evals])

  // Evaluations only arrive one by one: start once the cache has been read, not on every update.
  const ready = evals !== undefined
  useEffect(() => {
    if (!download || !ready) return
    let stop = false
    void db.evalCache.bulkGet(keys).then((rows) => {
      const have = new Map<string, Evaluation>()
      rows.forEach((r, i) => r && have.set(keys[i], r.data as Evaluation))
      return fill(targets, have, () => stop)
    })
    return () => {
      stop = true
    }
  }, [download, ready, targets, keys])

  const engineGlyph = useCallback((fromKey: string, uci: string) => engine.get(targetId(fromKey, uci)), [engine])
  const glyphOf = useCallback(
    (node: TreeNode, parent: Pick<TreeNode, 'key'>): Glyph | undefined =>
      node.glyph !== undefined ? node.glyph || undefined : node.byMe ? undefined : engineGlyph(parent.key, node.uci),
    [engineGlyph],
  )
  return { glyphOf, engineGlyph }
}

/** The engine's symbol for one move, from evaluations by position key. */
export function engineGlyphOf(evals: ReadonlyMap<string, Evaluation>, fromKey: string, fromFen: string, uci: string, toKey: string) {
  const before = evals.get(fromKey)
  return before ? judgeMove({ ...before, fen: fromFen }, uci, evals.get(toKey)) : undefined
}
