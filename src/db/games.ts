import { buildGraph } from '../lib/chess/graph'
import { repStart } from '../lib/chess/start'
import { analyzeGame, type GameAnalysis, type RepIndex } from '../lib/games/analyze'
import { gradeCard, isNew } from '../lib/srs/scheduler'
import { loadMoves } from './repertoire'
import { db, now, uuid, type AppDB, type Game } from './schema'

export async function loadRepIndex(d: AppDB = db): Promise<RepIndex[]> {
  const reps = (await d.repertoires.toArray()).sort((a, b) => a.createdAt - b.createdAt)
  return Promise.all(
    reps.map(async (rep) => {
      const start = repStart(rep)
      return { rep, start, graph: buildGraph(await loadMoves(rep.id, d), rep.color, start.key) }
    }),
  )
}

/**
 * A wrong repertoire move in a real game counts as a failed review ("Again"),
 * dated when the game was played. Only games played after the card's last
 * review count: earlier games say nothing about what you remember now, and a
 * game already graded has moved the card's last review to its own date, so
 * running this again changes nothing. Returns the number of cards graded.
 */
export async function gradeForgottenMoves(analyses: GameAnalysis[], d: AppDB = db): Promise<number> {
  const forgot = analyses
    .filter((a) => a.outcome === 'forgot' && a.repertoireId)
    .sort((a, b) => a.game.playedAt - b.game.playedAt)
  if (!forgot.length) return 0
  let graded = 0
  await d.transaction('rw', [d.cards, d.reviews], async () => {
    for (const a of forgot) {
      const card = await d.cards.where({ repertoireId: a.repertoireId!, positionKey: a.key }).first()
      if (!card || isNew(card.fsrs)) continue
      const last = card.fsrs.last_review ? new Date(card.fsrs.last_review).getTime() : 0
      if (a.game.playedAt <= last) continue
      const next = gradeCard(card.fsrs, false, new Date(a.game.playedAt))
      const t = now()
      await d.cards.update(card.id, { fsrs: next.card, updatedAt: t })
      await d.reviews.add({
        id: uuid(),
        cardId: card.id,
        repertoireId: a.repertoireId!,
        ts: t,
        rating: next.rating,
        playedUci: a.game.moves[a.ply],
        correct: false,
        mode: 'game',
        gameId: a.game.id,
      })
      graded++
    }
  })
  return graded
}

/** Re-checks every stored game against the current repertoires and grades forgotten moves. */
export async function gradeAllGames(d: AppDB = db): Promise<number> {
  const [games, reps] = await Promise.all([d.games.toArray(), loadRepIndex(d)])
  return gradeForgottenMoves(
    games.map((g: Game) => analyzeGame(g, reps)),
    d,
  )
}

export async function deleteAllGames(d: AppDB = db) {
  await d.games.clear()
}
