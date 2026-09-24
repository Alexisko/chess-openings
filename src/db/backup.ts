import { db, type AppDB, type Card } from './schema'

const VERSION = 1

/** Everything except caches and the Lichess token. */
export async function exportBackup(d: AppDB = db): Promise<string> {
  const [repertoires, positions, moves, cards, reviews, settings] = await Promise.all([
    d.repertoires.toArray(),
    d.positions.toArray(),
    d.moves.toArray(),
    d.cards.toArray(),
    d.reviews.toArray(),
    d.settings.toArray(),
  ])
  return JSON.stringify({
    app: 'opening-trainer',
    version: VERSION,
    exportedAt: new Date().toISOString(),
    repertoires,
    positions,
    moves,
    cards,
    reviews,
    settings: settings.filter((s) => s.key !== 'lichessToken'),
  })
}

const reviveCard = (c: Card): Card => ({
  ...c,
  fsrs: {
    ...c.fsrs,
    due: new Date(c.fsrs.due),
    last_review: c.fsrs.last_review ? new Date(c.fsrs.last_review) : undefined,
  },
})

/** Replaces all data with a backup (keeps the current Lichess login). */
export async function importBackup(json: string, d: AppDB = db) {
  const data = JSON.parse(json)
  if (data.app !== 'opening-trainer') throw new Error('This is not an Opening Trainer backup')
  if (data.version > VERSION) throw new Error('This backup comes from a newer version of the app')
  const tables = [d.repertoires, d.positions, d.moves, d.cards, d.reviews, d.settings]
  await d.transaction('rw', tables, async () => {
    const token = await d.settings.get('lichessToken')
    const user = await d.settings.get('lichessUser')
    await Promise.all(tables.map((t) => t.clear()))
    await d.repertoires.bulkAdd(data.repertoires)
    await d.positions.bulkAdd(data.positions)
    await d.moves.bulkAdd(data.moves)
    await d.cards.bulkAdd((data.cards as Card[]).map(reviveCard))
    await d.reviews.bulkAdd(data.reviews)
    await d.settings.bulkPut(data.settings.filter((s: { key: string }) => s.key !== 'lichessToken'))
    if (token) await d.settings.put(token)
    if (user) await d.settings.put(user)
  })
}
