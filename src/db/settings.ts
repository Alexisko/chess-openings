import { useLiveQuery } from 'dexie-react-hooks'
import type { Color } from '../lib/chess/position'
import { DEFAULT_FILTER, type ExplorerFilter } from '../lib/explorer/explorer'
import { db, type AppDB } from './schema'

export interface Settings {
  lichessToken?: string
  lichessUser?: string
  chesscomUser: string
  explorerFilter: ExplorerFilter
  /** Preparedness target: number of own moves you should know. */
  prepDepth: number
  /** New cards introduced per day. */
  newPerDay: number
  /** Eval loss (centipawns) above which a repertoire move is flagged. */
  blunderThreshold: number
  /** Which game import rules the stored games were fetched with (see lib/games/import). */
  gamesImportVersion?: number
  /**
   * Repertoire plan choices that aren't a repertoire themselves, e.g. "as
   * White I play 1.e4": your move (UCI) per position key.
   */
  planChoices: Record<Color, Record<string, string>>
}

export const DEFAULT_SETTINGS: Settings = {
  chesscomUser: 'Demyriad',
  explorerFilter: DEFAULT_FILTER,
  prepDepth: 6,
  newPerDay: 10,
  blunderThreshold: 50,
  planChoices: { white: {}, black: {} },
}

export async function getSettings(d: AppDB = db): Promise<Settings> {
  const rows = await d.settings.toArray()
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>
  for (const r of rows) out[r.key] = r.value
  return out as unknown as Settings
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K], d: AppDB = db) {
  if (value === undefined) await d.settings.delete(key)
  else await d.settings.put({ key, value })
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => getSettings(), [])
}

/** Records (or with no move, forgets) your move at a position of the repertoire plan. */
export async function setPlanChoice(color: Color, key: string, uci: string | undefined, d: AppDB = db) {
  const { planChoices } = await getSettings(d)
  const mine = { ...planChoices[color] }
  if (uci) mine[key] = uci
  else delete mine[key]
  await setSetting('planChoices', { ...planChoices, [color]: mine }, d)
}
