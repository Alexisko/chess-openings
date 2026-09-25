import { db, type AppDB } from './schema'
import { LOCAL_SETTINGS, parseSnapshot, readSnapshot, snapshotTables, type Snapshot } from './snapshot'

const VERSION = 1

/** A snapshot in the backup format (also the format of the synced copy). */
export const toBackupJson = (snap: Snapshot) =>
  JSON.stringify({ app: 'opening-trainer', version: VERSION, exportedAt: new Date().toISOString(), ...snap })

export function parseBackup(json: string): Snapshot {
  const data = JSON.parse(json)
  if (data.app !== 'opening-trainer') throw new Error('This is not an Opening Trainer backup')
  if (data.version > VERSION) throw new Error('This backup comes from a newer version of the app')
  return parseSnapshot(data)
}

/** Everything except caches, games and the Lichess login. */
export async function exportBackup(d: AppDB = db): Promise<string> {
  return toBackupJson(await readSnapshot(d))
}

/** Replaces all data with a backup (keeps the settings that belong to this device). */
export async function importBackup(json: string, d: AppDB = db) {
  const snap = parseBackup(json)
  await d.transaction('rw', snapshotTables(d), async () => {
    await Promise.all([
      d.repertoires.clear(),
      d.positions.clear(),
      d.moves.clear(),
      d.cards.clear(),
      d.reviews.clear(),
      d.settings.where('key').noneOf([...LOCAL_SETTINGS]).delete(),
    ])
    await d.repertoires.bulkAdd(snap.repertoires)
    await d.positions.bulkAdd(snap.positions)
    await d.moves.bulkAdd(snap.moves)
    await d.cards.bulkAdd(snap.cards)
    await d.reviews.bulkAdd(snap.reviews)
    await d.settings.bulkPut(snap.settings)
  })
}
