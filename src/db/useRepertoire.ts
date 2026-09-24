import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import type { Card as FsrsCard } from 'ts-fsrs'
import { buildGraph, enumerateLines, type Line, type RepGraph } from '../lib/chess/graph'
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
    const graph = buildGraph(raw.moves, raw.rep.color)
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
