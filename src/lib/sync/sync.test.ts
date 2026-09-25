import { beforeEach, describe, expect, it } from 'vitest'
import { parseBackup, toBackupJson } from '../../db/backup'
import { addLine, createRepertoire, deleteRepertoire, loadMoves, removeMoves, renameRepertoire } from '../../db/repertoire'
import { recordAttempt } from '../../db/reviews'
import { AppDB } from '../../db/schema'
import { setPlanChoice, setSetting } from '../../db/settings'
import { keyOfRow, readSnapshot, SNAPSHOT_TABLES, type Snapshot } from '../../db/snapshot'
import { stableJson } from './merge'
import { syncOnce, type SyncApi } from './sync'

/** In-memory stand-in for the Worker: one JSON document per user and a version. */
class FakeServer implements SyncApi {
  docs = new Map<string, { version: number; json: string }>()
  pushes = 0
  /** Called between a pull and the next push, to simulate another device. */
  beforePush?: () => Promise<void>

  async pull(user: string, have: number | undefined) {
    const doc = this.docs.get(user)
    if (!doc) return { version: 0 }
    if (doc.version === have) return { version: doc.version }
    return { version: doc.version, snapshot: parseBackup(doc.json) }
  }

  async push(user: string, base: number, snapshot: Snapshot) {
    const hook = this.beforePush
    this.beforePush = undefined
    await hook?.()
    const version = this.docs.get(user)?.version ?? 0
    if (version !== base) return null
    this.pushes++
    this.docs.set(user, { version: version + 1, json: toBackupJson(snapshot) })
    return version + 1
  }
}

/** A snapshot as comparable text: rows sorted by key. */
async function canon(d: AppDB) {
  const snap = await readSnapshot(d)
  return SNAPSHOT_TABLES.map((t) =>
    snap[t]
      .map((r) => [keyOfRow(t, r), stableJson(r)])
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map((x) => x[1])
      .join('\n'),
  )
}

const VIENNA = ['e2e4', 'e7e5', 'b1c3']

let server: FakeServer
let a: AppDB
let b: AppDB
let n = 0
beforeEach(() => {
  server = new FakeServer()
  a = new AppDB(`sync-a-${n}`)
  b = new AppDB(`sync-b-${n++}`)
})

const sync = (d: AppDB, mode?: 'merge' | 'replace') => syncOnce(d, server, 'Demyriad', mode)
const repOf = async (d: AppDB) => (await d.repertoires.toArray())[0]

describe('sync', () => {
  it('copies a repertoire to a new device', async () => {
    const rep = await createRepertoire('Vienna', 'white', a)
    await addLine(rep, [...VIENNA, 'g8f6', 'f2f4'], {}, a)
    expect((await sync(a)).outcome).toBe('pushed')
    expect((await sync(b)).outcome).toBe('pulled')
    expect(await canon(b)).toEqual(await canon(a))
    expect((await sync(b)).outcome).toBe('unchanged')
    expect((await sync(a)).outcome).toBe('unchanged')
    expect(server.pushes).toBe(1)
  })

  it('merges edits made on both devices', async () => {
    const rep = await createRepertoire('Vienna', 'white', a)
    await addLine(rep, VIENNA, {}, a)
    await sync(a)
    await sync(b)

    await addLine(rep, [...VIENNA, 'g8f6', 'f2f4'], {}, a)
    await renameRepertoire(rep.id, 'Vienna Gambit', b)
    await recordAttempt(rep.id, (await b.cards.toArray())[0].positionKey, true, 'e2e4', 'learn', b)
    await setPlanChoice('white', 'somewhere', 'e2e4', b)

    await sync(a)
    await sync(b)
    await sync(a)
    expect(await canon(a)).toEqual(await canon(b))
    expect((await repOf(a)).name).toBe('Vienna Gambit')
    expect(await a.reviews.count()).toBe(1)
    expect((await loadMoves(rep.id, b)).map((m) => m.san)).toContain('f4')
  })

  it('propagates deletions without bringing them back', async () => {
    const rep = await createRepertoire('Vienna', 'white', a)
    await addLine(rep, [...VIENNA, 'g8f6', 'f2f4'], {}, a)
    await sync(a)
    await sync(b)
    const f4 = (await loadMoves(rep.id, a)).find((m) => m.san === 'f4')!
    await removeMoves(rep, new Set([f4.id]), a)
    await sync(a)
    await sync(b)
    await sync(a)
    expect((await loadMoves(rep.id, b)).map((m) => m.san)).not.toContain('f4')
    expect(await canon(a)).toEqual(await canon(b))
  })

  it('keeps one copy of a move added on both devices, and the newest of two different answers', async () => {
    const rep = await createRepertoire('Vienna', 'white', a)
    await addLine(rep, VIENNA, {}, a)
    await sync(a)
    await sync(b)
    await addLine(rep, [...VIENNA, 'g8f6'], {}, a) // an opponent move, added on both
    await addLine(rep, [...VIENNA, 'g8f6', 'f2f4'], {}, b)
    await new Promise((r) => setTimeout(r, 5))
    await addLine(rep, [...VIENNA, 'g8f6', 'f1c4'], {}, a) // a different answer, chosen later
    await sync(a)
    await sync(b)
    await sync(a)
    const sans = (await loadMoves(rep.id, a)).map((m) => m.san).sort()
    expect(sans).toEqual(['Bc4', 'Nc3', 'Nf6', 'e4', 'e5'].sort())
    expect(await canon(a)).toEqual(await canon(b))
    const keys = (await a.cards.toArray()).map((c) => c.positionKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('drops cards and reviews of a repertoire deleted on the other device', async () => {
    const rep = await createRepertoire('Vienna', 'white', a)
    await addLine(rep, VIENNA, {}, a)
    await sync(a)
    await sync(b)
    await deleteRepertoire(rep.id, a)
    await recordAttempt(rep.id, (await b.cards.toArray())[0].positionKey, true, 'e2e4', 'learn', b)
    await sync(a)
    await sync(b)
    await sync(a)
    expect(await b.repertoires.count()).toBe(0)
    expect(await b.cards.count()).toBe(0)
    expect(await b.reviews.count()).toBe(0)
    expect(await canon(a)).toEqual(await canon(b))
  })

  it('asks before combining data from two devices that never synced', async () => {
    await addLine(await createRepertoire('Vienna', 'white', a), VIENNA, {}, a)
    await addLine(await createRepertoire('Caro-Kann', 'black', b), ['e2e4', 'c7c6'], {}, b)
    await sync(a)
    expect(await sync(b)).toEqual({ outcome: 'needs-choice' })

    await sync(b, 'replace')
    expect(await canon(b)).toEqual(await canon(a))
  })

  it('merges two devices when asked', async () => {
    await addLine(await createRepertoire('Vienna', 'white', a), VIENNA, {}, a)
    await addLine(await createRepertoire('Caro-Kann', 'black', b), ['e2e4', 'c7c6'], {}, b)
    await sync(a)
    await sync(b, 'merge')
    await sync(a)
    expect((await a.repertoires.toArray()).map((r) => r.name).sort()).toEqual(['Caro-Kann', 'Vienna'])
    expect(await canon(a)).toEqual(await canon(b))
  })

  it('asks again when another user logs in on the device', async () => {
    await addLine(await createRepertoire('Vienna', 'white', a), VIENNA, {}, a)
    await sync(a)
    await addLine(await createRepertoire('Caro-Kann', 'black', b), ['e2e4', 'c7c6'], {}, b)
    await syncOnce(b, server, 'friend')
    expect(await sync(b)).toEqual({ outcome: 'needs-choice', previousUser: 'friend' })
  })

  it('merges again when the server changed between download and upload', async () => {
    const rep = await createRepertoire('Vienna', 'white', a)
    await addLine(rep, VIENNA, {}, a)
    await sync(a)
    await sync(b)
    await renameRepertoire(rep.id, 'Vienna Gambit', a)
    await recordAttempt(rep.id, (await b.cards.toArray())[0].positionKey, true, 'e2e4', 'learn', b)
    server.beforePush = async () => void (await sync(a))
    expect((await sync(b)).outcome).toBe('pushed')
    await sync(a)
    expect((await repOf(b)).name).toBe('Vienna Gambit')
    expect(await a.reviews.count()).toBe(1)
    expect(await canon(a)).toEqual(await canon(b))
  })

  it("doesn't sync this device's Lichess login", async () => {
    await setSetting('lichessToken', 'lip_secret', a)
    await setSetting('lichessUser', 'Demyriad', a)
    await setSetting('prepDepth', 9, a)
    await sync(a)
    await sync(b)
    expect(server.docs.get('demyriad')!.json).not.toContain('lip_secret')
    expect((await b.settings.get('prepDepth'))?.value).toBe(9)
    expect(await b.settings.get('lichessUser')).toBeUndefined()
  })
})
