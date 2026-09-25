import type { AppDB } from '../../db/schema'
import { readSnapshot, snapshotTables, type Snapshot } from '../../db/snapshot'
import { applyChanges, getSyncBase, repairAfterMerge, setSyncBase } from '../../db/sync'
import { fingerprints, mergeSnapshots, sameFingerprints, type Fingerprints } from './merge'

export interface SyncApi {
  /**
   * The server copy and its version (0 when there is none). The snapshot is
   * left out when version `have` is still current.
   */
  pull(user: string, have: number | undefined): Promise<{ version: number; snapshot?: Snapshot }>
  /** Uploads a copy based on version `base`; returns the new version, or null if the server moved on. */
  push(user: string, base: number, snapshot: Snapshot): Promise<number | null>
}

/**
 * How to start syncing a device that holds data but never synced as this
 * user: combine both copies, or replace this device's data with the server's.
 */
export type FirstSyncMode = 'merge' | 'replace'

export type SyncResult =
  | { outcome: 'unchanged' | 'pulled' | 'pushed' }
  /** Both this device and the server hold data: the user decides (see FirstSyncMode). */
  | { outcome: 'needs-choice'; previousUser?: string }

const EMPTY: Snapshot = { repertoires: [], positions: [], moves: [], cards: [], reviews: [], settings: [] }
const hasData = (s: Snapshot) => s.repertoires.length > 0 || s.positions.length > 0

/** One round: download the server copy if it changed, merge it in, upload the result if it differs. */
export async function syncOnce(d: AppDB, api: SyncApi, username: string, mode?: FirstSyncMode): Promise<SyncResult> {
  const user = username.toLowerCase()
  for (let attempt = 0; attempt < 3; attempt++) {
    const saved = await getSyncBase(d)
    let base = saved?.user === user ? saved : undefined
    const remote = await api.pull(user, base?.version)
    // The server lost the copy we agreed on: start over rather than read it as deletions.
    if (base && remote.version < base.version) base = undefined
    const remoteSnap = remote.snapshot ?? (base ? undefined : EMPTY)

    let pulled = false
    const merged = await d.transaction('rw', [...snapshotTables(d), d.syncState], async () => {
      const local = await readSnapshot(d)
      if (!remoteSnap) return local
      let ancestor: Fingerprints | undefined = base?.fingerprints
      if (!base && hasData(local) && hasData(remoteSnap)) {
        if (!mode) return null
        // Replacing: pretend this device hasn't changed anything since the server copy.
        if (mode === 'replace') ancestor = fingerprints(local)
      }
      const { changes, fromRemote } = mergeSnapshots(local, remoteSnap, ancestor)
      if (!fromRemote) return local
      await applyChanges(d, changes)
      await repairAfterMerge(d)
      pulled = true
      return readSnapshot(d)
    })
    if (!merged) return { outcome: 'needs-choice', previousUser: saved && saved.user !== user ? saved.user : undefined }

    const mine = fingerprints(merged)
    const theirs = remoteSnap ? fingerprints(remoteSnap) : base!.fingerprints
    if (sameFingerprints(mine, theirs)) {
      await setSyncBase(d, { user, version: remote.version, fingerprints: mine, syncedAt: Date.now() })
      return { outcome: pulled ? 'pulled' : 'unchanged' }
    }
    const version = await api.push(user, remote.version, merged)
    if (version === null) continue
    await setSyncBase(d, { user, version, fingerprints: mine, syncedAt: Date.now() })
    return { outcome: 'pushed' }
  }
  throw new Error('The server copy kept changing during the sync; try again')
}
