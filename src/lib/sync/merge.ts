import { keyOfRow, SNAPSHOT_TABLES, type Snapshot, type SnapshotTable } from '../../db/snapshot'

// Three-way merge of this device's data with the server copy. The common
// ancestor is the copy both last agreed on, remembered as one fingerprint per
// record. Comparing each side with it tells a record created on one side from
// one deleted on the other, without tracking deletions.

/** Fingerprint of every record, per table. */
export type Fingerprints = Record<SnapshotTable, Record<string, string>>

/** JSON with sorted keys, so equal records have equal text whatever their key order. */
export function stableJson(value: unknown): string {
  const v = (value as { toJSON?: () => unknown } | null)?.toJSON ? (value as { toJSON: () => unknown }).toJSON() : value
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableJson(x))).join(',')}]`
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`
}

/** cyrb53: a fast 53-bit string hash. */
function hash(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export const fingerprint = (row: object) => hash(stableJson(row))

export function fingerprints(snap: Snapshot): Fingerprints {
  const out = {} as Fingerprints
  for (const t of SNAPSHOT_TABLES) {
    const table: Record<string, string> = {}
    for (const row of snap[t]) table[keyOfRow(t, row)] = fingerprint(row)
    out[t] = table
  }
  return out
}

export function sameFingerprints(a: Fingerprints, b: Fingerprints): boolean {
  return SNAPSHOT_TABLES.every((t) => {
    const ka = Object.keys(a[t] ?? {})
    return ka.length === Object.keys(b[t] ?? {}).length && ka.every((k) => a[t][k] === b[t]?.[k])
  })
}

/** Writes that turn this device's data into the merged data. */
export type LocalChanges = Record<SnapshotTable, { put: object[]; del: string[] }>

export interface MergeResult {
  changes: LocalChanges
  /** True when the merge brought in anything from the server. */
  fromRemote: boolean
}

/** When both sides changed a record, the most recent edit wins (the server's on a tie). */
const stamp = (row: object) => (row as { updatedAt?: number }).updatedAt ?? (row as { ts?: number }).ts ?? 0

/**
 * Merges the server copy into local data. `base` is the common ancestor
 * (undefined on a first sync, which keeps everything from both sides). A
 * change on one side wins over no change on the other, and an edit wins
 * over a deletion.
 */
export function mergeSnapshots(local: Snapshot, remote: Snapshot, base: Fingerprints | undefined): MergeResult {
  const changes = {} as LocalChanges
  let fromRemote = false
  for (const t of SNAPSHOT_TABLES) {
    const put: object[] = []
    const del: string[] = []
    const baseT = base?.[t] ?? {}
    const localRows = new Map<string, object>(local[t].map((r) => [keyOfRow(t, r), r]))
    const remoteRows = new Map<string, object>(remote[t].map((r) => [keyOfRow(t, r), r]))
    for (const [key, l] of localRows) {
      const r = remoteRows.get(key)
      const b = baseT[key]
      const lf = fingerprint(l)
      if (r) {
        const rf = fingerprint(r)
        if (lf === rf || rf === b) continue
        if (lf === b || stamp(r) >= stamp(l)) put.push(r)
      } else if (lf === b) {
        del.push(key)
      }
    }
    for (const [key, r] of remoteRows) {
      if (localRows.has(key)) continue
      const b = baseT[key]
      if (b === undefined || fingerprint(r) !== b) put.push(r)
    }
    if (put.length || del.length) fromRemote = true
    changes[t] = { put, del }
  }
  return { changes, fromRemote }
}
