import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, type PositionNote } from '../../db/schema'
import type { TreeNode } from '../chess/tree'
import { buildChapters, type ChapterBreak, type Chapters } from './chapters'
import { useEco, type EcoTable } from './eco'
import type { OpeningName } from './names'

/** Where the names of positions come from: the user's names first, then the standard opening names. */
export interface Naming {
  eco: EcoTable
  notes: ReadonlyMap<string, PositionNote>
  /** Standard opening name of a position. */
  opening: (key: string) => OpeningName | undefined
  /** Name the user gave a position. */
  custom: (key: string) => string | undefined
  breaks: (key: string) => ChapterBreak | undefined
  /** Name to show for a position: the user's (with the standard ECO code), else the standard one. */
  display: (key: string) => OpeningName | undefined
}

export function useNaming(): Naming | undefined {
  const eco = useEco()
  const rows = useLiveQuery(() => db.positions.toArray(), [])
  return useMemo(() => {
    if (!eco || !rows) return undefined
    const notes = new Map(rows.map((r) => [r.key, r]))
    const opening = (key: string) => eco.get(key)
    const custom = (key: string) => notes.get(key)?.name || undefined
    return {
      eco,
      notes,
      opening,
      custom,
      breaks: (key) => notes.get(key)?.chapter,
      display: (key) => {
        const name = custom(key)
        return name ? { eco: opening(key)?.eco ?? '', name } : opening(key)
      },
    }
  }, [eco, rows])
}

/** Chapters of a line tree, once the names are loaded. */
export function useChapters(tree: TreeNode | null | undefined, naming: Naming | undefined): Chapters | undefined {
  return useMemo(() => (tree && naming ? buildChapters(tree, naming) : undefined), [tree, naming])
}
