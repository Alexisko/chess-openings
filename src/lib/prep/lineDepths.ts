import type { Card as FsrsCard } from 'ts-fsrs'
import type { Line, RepGraph } from '../chess/graph'
import { KNOWLEDGE_ORDER, knowledgeOf, type Knowledge, type MoveRecord } from '../srs/knowledge'

export interface LineEnd {
  id: string
  /**
   * Your moves from the start of the game to the end of the line. A line cut
   * at a transposition goes on as deep as the line it joins.
   */
  depth: number
  /**
   * The weakest of your moves on the line, from where the reply starts: one
   * move you'd miss and you're out of the line. A line with no move of yours
   * there (a reply you have no answer to) is `new`.
   */
  level: Knowledge
}

export interface LineFacts {
  /** Your moves from the reply on, each counted once. */
  moves: number
  lines: LineEnd[]
}

/** How weak a level is: higher is weaker (KNOWLEDGE_ORDER lists the best first). */
const WEAKNESS = new Map(KNOWLEDGE_ORDER.map((l, i) => [l, i]))

/**
 * The lines of a repertoire through `from`, each with how deep it goes and how
 * well you know it. `startOwn` counts your moves before the repertoire's
 * starting position, so depths are your move numbers in the game.
 */
export function lineDepths(
  graph: RepGraph,
  lines: Line[],
  cards: Map<string, FsrsCard>,
  records: Map<string, MoveRecord>,
  from: string,
  startOwn: number,
  now: Date,
): LineFacts {
  // Your moves on the deepest line from a position, along the canonical tree.
  const deepest = new Map<string, number>()
  const deepestFrom = (key: string): number => {
    const hit = deepest.get(key)
    if (hit !== undefined) return hit
    let d = 0
    for (const m of graph.movesFrom.get(key) ?? [])
      if (!graph.transpositions.has(m.id)) d = Math.max(d, (m.byMe ? 1 : 0) + deepestFrom(m.toKey))
    deepest.set(key, d)
    return d
  }

  const levels = new Map<string, Knowledge>()
  const levelAt = (key: string) => {
    let l = levels.get(key)
    if (!l) {
      const card = cards.get(key)
      l = card ? knowledgeOf(card, records.get(key), now) : 'new'
      levels.set(key, l)
    }
    return l
  }

  const own = new Set<string>()
  const out: LineEnd[] = []
  for (const line of lines) {
    const start = from === graph.root ? 0 : line.moves.findIndex((m) => m.toKey === from) + 1
    if (start === 0 && from !== graph.root) continue
    let level: Knowledge | undefined
    for (const m of line.moves.slice(start)) {
      if (!m.byMe) continue
      own.add(m.fromKey)
      const l = levelAt(m.fromKey)
      if (!level || WEAKNESS.get(l)! > WEAKNESS.get(level)!) level = l
    }
    const played = line.moves.filter((m) => m.byMe).length
    const further = line.end === 'transposition' && line.transposesTo ? deepestFrom(line.transposesTo) : 0
    out.push({ id: line.id, depth: startOwn + played + further, level: level ?? 'new' })
  }
  return { moves: own.size, lines: out }
}
