import { useEffect, useState } from 'react'
import type { OpeningName } from './names'

/**
 * The Lichess opening names (the same ones the explorer gives), bundled so
 * every position has its name at once, without an explorer download. The
 * table is loaded on first use, in its own chunk.
 */
export type EcoTable = ReadonlyMap<string, OpeningName>

let table: Promise<EcoTable> | undefined

export function loadEco(): Promise<EcoTable> {
  table ??= import('./eco.json').then(({ default: rows }) => ecoTable(rows))
  return table
}

export const ecoTable = (rows: Record<string, [string, string]>): EcoTable =>
  new Map(Object.entries(rows).map(([key, [eco, name]]) => [key, { eco, name }]))

/** The opening names table, once loaded. */
export function useEco(): EcoTable | undefined {
  const [eco, setEco] = useState<EcoTable>()
  useEffect(() => {
    let live = true
    void loadEco().then((t) => live && setEco(t))
    return () => {
      live = false
    }
  }, [])
  return eco
}
