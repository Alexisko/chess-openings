import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import type { Card as FsrsCard } from 'ts-fsrs'
import { crossIndex, type CrossIndex } from '../lib/chess/cross'
import { buildGraph, enumerateLines, type Line, type RepGraph } from '../lib/chess/graph'
import { repStart } from '../lib/chess/start'
import { db, type Card, type RepMove, type Repertoire } from './schema'

export interface RepertoireData {
  rep: Repertoire
  moves: RepMove[]
  cards: Card[]
  graph: RepGraph
  lines: Line[]
  /** FSRS card per position key. */
  cardMap: Map<string, FsrsCard>
}

/** Live repertoire with its graph, lines and cards. `null` if not found, `undefined` while loading. */
export function useRepertoire(id: string | undefined): RepertoireData | null | undefined {
  const raw = useLiveQuery(async () => {
    if (!id) return null
    const rep = await db.repertoires.get(id)
    if (!rep) return null
    const [moves, cards] = await Promise.all([
      db.moves.where({ repertoireId: id }).toArray(),
      db.cards.where({ repertoireId: id }).toArray(),
    ])
    return { rep, moves, cards }
  }, [id])
  return useMemo(() => {
    if (!raw) return raw
    const graph = buildGraph(raw.moves, raw.rep.color, repStart(raw.rep).key)
    return {
      ...raw,
      graph,
      lines: enumerateLines(graph),
      cardMap: new Map(raw.cards.map((c) => [c.positionKey, c.fsrs])),
    }
  }, [raw])
}

export function useRepertoires(): Repertoire[] | undefined {
  return useLiveQuery(() => db.repertoires.toArray().then((r) => r.sort((a, b) => a.createdAt - b.createdAt)), [])
}

/** The other repertoires of a colour, by the positions they continue from (see lib/chess/cross). */
export function useCrossIndex(rep: Repertoire | undefined): CrossIndex | undefined {
  const id = rep?.id
  const color = rep?.color
  const raw = useLiveQuery(async () => {
    const others = (await db.repertoires.toArray()).filter((r) => r.color === color && r.id !== id)
    return Promise.all(others.map(async (r) => ({ rep: r, moves: await db.moves.where({ repertoireId: r.id }).toArray() })))
  }, [id, color])
  return useMemo(() => raw && crossIndex(raw), [raw])
}
