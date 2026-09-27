import { beforeEach, describe, expect, it } from 'vitest'
import { gradeForgottenMoves, loadRepIndex } from '../../db/games'
import { addLine, createRepertoire } from '../../db/repertoire'
import { AppDB, type Game } from '../../db/schema'
import { gradeCard } from '../srs/scheduler'
import { analyzeGame, collectFindings, summarizeByRepertoire } from './analyze'
import { getSettings, setSetting } from '../../db/settings'
import { IMPORT_VERSION, IMPORT_WINDOW_MS, importChesscom, importGames, importLichess, readNdjson } from './import'
import { parseChesscomGame, parseLichessGame, sansToUci } from './parse'
import { builderTarget, buildGameTree, moveMark, openingGroups, pathKeys, wdlOf } from './gameTree'
import { buildOpeningMap, defaultMinGames, edgeMoves, layoutMap, mapNodes } from './openingMap'

let d: AppDB
let n = 0
beforeEach(() => {
  d = new AppDB(`games-test-${n++}`)
})

let gameNo = 0
function game(color: 'white' | 'black', sans: string, extra: Partial<Game> = {}): Game {
  const parsed = sansToUci(sans.split(' '))
  return {
    id: `test:${gameNo++}`,
    source: 'lichess',
    url: 'https://lichess.org/x',
    playedAt: Date.UTC(2026, 8, 1),
    speed: 'blitz',
    color,
    opponent: 'someone',
    result: 'win',
    ...parsed,
    createdAt: 0,
    ...extra,
  }
}

const uci = (sans: string) => sansToUci(sans.split(' ')).moves

describe('parsing', () => {
  it('reads a Lichess export row from the owner’s side', () => {
    const g = parseLichessGame(
      {
        id: 'abcd1234',
        variant: 'standard',
        speed: 'blitz',
        status: 'resign',
        createdAt: 1000,
        players: { white: { user: { name: 'Other', id: 'other' }, rating: 1500 }, black: { user: { name: 'Demyriad', id: 'demyriad' }, rating: 1600 } },
        winner: 'black',
        moves: 'e4 c5 Nf3 d6 O-O',
      },
      'demyriad',
    )
    expect(g).toMatchObject({ id: 'lichess:abcd1234', color: 'black', result: 'win', opponent: 'Other', opponentRating: 1500 })
    // Stops at the first illegal move.
    expect(g?.moves).toEqual(['e2e4', 'c7c5', 'g1f3', 'd7d6'])
  })

  it('keeps bullet but skips ultrabullet, variants and games from a position', () => {
    const base = {
      id: 'x',
      variant: 'standard',
      speed: 'blitz',
      status: 'mate',
      createdAt: 0,
      players: { white: { user: { name: 'Demyriad', id: 'demyriad' } }, black: { user: { name: 'B', id: 'b' } } },
      moves: 'e4 e5',
    }
    expect(parseLichessGame(base, 'Demyriad')).not.toBeNull()
    expect(parseLichessGame({ ...base, speed: 'bullet' }, 'Demyriad')).toMatchObject({ speed: 'bullet' })
    expect(parseLichessGame({ ...base, speed: 'correspondence' }, 'Demyriad')).toMatchObject({ speed: 'daily' })
    expect(parseLichessGame({ ...base, speed: 'ultraBullet' }, 'Demyriad')).toBeNull()
    expect(parseLichessGame({ ...base, variant: 'chess960' }, 'Demyriad')).toBeNull()
    expect(parseLichessGame({ ...base, initialFen: '8/8/8/8/8/8/8/8 w - - 0 1' }, 'Demyriad')).toBeNull()
  })

  it('reads a Chess.com archive game, with draws and castling', () => {
    const g = parseChesscomGame(
      {
        url: 'https://www.chess.com/game/live/1',
        uuid: 'u1',
        pgn: '[White "Demyriad"]\n[Black "Other"]\n\n1. e4 {[%clk 0:03:00]} 1... e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O 1/2-1/2',
        end_time: 1790000000,
        time_class: 'blitz',
        rules: 'chess',
        initial_setup: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        white: { username: 'Demyriad', rating: 1000, result: 'repetition' },
        black: { username: 'Other', rating: 990, result: 'repetition' },
      },
      'demyriad',
    )
    expect(g).toMatchObject({ id: 'chesscom:u1', color: 'white', result: 'draw', playedAt: 1790000000000 })
    expect(g?.moves.at(-1)).toBe('e1h1')
  })

  it('reads NDJSON split across chunks', async () => {
    const body = new ReadableStream({
      start(c) {
        const enc = new TextEncoder()
        c.enqueue(enc.encode('{"a":1}\n{"a"'))
        c.enqueue(enc.encode(':2}\n{"a":3}'))
        c.close()
      },
    })
    const rows: unknown[] = []
    await readNdjson(new Response(body), (r) => void rows.push(r))
    expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })
})

describe('analyzeGame', () => {
  async function vienna() {
    const rep = await createRepertoire('Vienna', 'white', d, uci('e4 e5 Nc3'))
    await addLine(rep, uci('e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4'), {}, d)
    await addLine(rep, uci('e4 e5 Nc3 Nc6 Bc4'), {}, d)
    return { rep, reps: await loadRepIndex(d) }
  }

  it('classifies where a game left preparation', async () => {
    const { rep, reps } = await vienna()
    const forgot = analyzeGame(game('white', 'e4 e5 Nc3 Nf6 d4'), reps)
    expect(forgot).toMatchObject({ outcome: 'forgot', repertoireId: rep.id, ply: 4, ownMoves: 0, expected: { san: 'f4' } })

    const oppLeft = analyzeGame(game('white', 'e4 e5 Nc3 Bc5 Nf3'), reps)
    expect(oppLeft).toMatchObject({ outcome: 'opp-left', ply: 3, ownMoves: 0 })

    // After 4...Nxe4 the line ends: your next move is on your own.
    const ended = analyzeGame(game('white', 'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7'), reps)
    expect(ended).toMatchObject({ outcome: 'prep-ended', ply: 8, ownMoves: 2 })

    // After 3.Bc4 you have no replies prepared: the opponent's move ends the line.
    expect(analyzeGame(game('white', 'e4 e5 Nc3 Nc6 Bc4 Nf6'), reps)).toMatchObject({ outcome: 'prep-ended', ply: 5, ownMoves: 1 })
    expect(analyzeGame(game('white', 'e4 e5 Nc3 Nf6 f4'), reps)).toMatchObject({ outcome: 'in-prep', ownMoves: 1 })
  })

  it('finds a repertoire reached by another move order', async () => {
    const { rep, reps } = await vienna()
    // 1.Nc3 e5 2.e4 reaches the Vienna starting position.
    const a = analyzeGame(game('white', 'Nc3 e5 e4 Nc6 Bc4 Nf6'), reps)
    expect(a).toMatchObject({ repertoireId: rep.id, outcome: 'prep-ended', ownMoves: 1 })
    const [f] = collectFindings([a], reps)
    // The link into the builder follows the repertoire's own move order.
    expect(f.path).toEqual(uci('e4 e5 Nc3 Nc6 Bc4'))
  })

  it('reports games outside every repertoire at the move that left them', async () => {
    const { reps } = await vienna()
    const a = analyzeGame(game('white', 'e4 c5 Nf3'), reps)
    expect(a).toMatchObject({ outcome: 'not-covered', ply: 1 })
    // No Black repertoire at all: grouped by the opponent's first move.
    expect(analyzeGame(game('black', 'd4 Nf6 c4'), reps)).toMatchObject({ outcome: 'not-covered', ply: 0 })
  })

  it('groups findings by position and counts moves and results', async () => {
    const { rep, reps } = await vienna()
    const analyses = [
      game('white', 'e4 e5 Nc3 Bc5 Nf3', { result: 'loss' }),
      game('white', 'e4 e5 Nc3 Bc5 Qg4', { result: 'win' }),
      game('white', 'e4 e5 Nc3 d6 f4', { result: 'draw' }),
      game('white', 'e4 e5 Nc3 Nf6 f4', { result: 'win' }),
    ].map((g) => analyzeGame(g, reps))
    const findings = collectFindings(analyses, reps)
    // One finding per unprepared reply, most frequent first.
    expect(findings.map((f) => [f.outcome, f.moves.map((m) => `${m.san}×${m.games.length}`).join(' ')])).toEqual([
      ['opp-left', 'Bc5×2'],
      ['opp-left', 'd6×1'],
    ])
    expect(findings[0].score).toBeCloseTo(0.5)
    expect(summarizeByRepertoire(analyses)).toEqual([{ repertoireId: rep.id, games: 4, avgOwnMoves: 0.25, forgot: 0, score: 0.625 }])
  })
})

describe('gradeForgottenMoves', () => {
  it('grades a forgotten move once, and only for games after the last review', async () => {
    const rep = await createRepertoire('Vienna', 'white', d, uci('e4 e5 Nc3'))
    await addLine(rep, uci('e4 e5 Nc3 Nf6 f4'), {}, d)
    const card = (await d.cards.toArray())[0]
    const reviewed = Date.UTC(2026, 7, 1)
    await d.cards.update(card.id, { fsrs: gradeCard(card.fsrs, true, new Date(reviewed)).card })

    const reps = await loadRepIndex(d)
    const before = analyzeGame(game('white', 'e4 e5 Nc3 Nf6 d4', { playedAt: reviewed - 1000 }), reps)
    const after = analyzeGame(game('white', 'e4 e5 Nc3 Nf6 d4', { playedAt: reviewed + 1000 }), reps)
    expect(await gradeForgottenMoves([before, after], d)).toBe(1)
    const graded = (await d.cards.get(card.id))!
    // Graded as of the game, not of the import.
    expect(new Date(graded.fsrs.last_review!).getTime()).toBe(after.game.playedAt)
    expect(await d.reviews.where({ cardId: card.id }).toArray()).toMatchObject([
      { mode: 'game', correct: false, gameId: after.game.id, playedUci: 'd2d4' },
    ])
    // Running again (e.g. on the next import) changes nothing.
    expect(await gradeForgottenMoves([before, after], d)).toBe(0)
  })

  it('ignores cards never learned', async () => {
    const rep = await createRepertoire('Vienna', 'white', d, uci('e4 e5 Nc3'))
    await addLine(rep, uci('e4 e5 Nc3 Nf6 f4'), {}, d)
    const a = analyzeGame(game('white', 'e4 e5 Nc3 Nf6 d4'), await loadRepIndex(d))
    expect(await gradeForgottenMoves([a], d)).toBe(0)
  })
})

describe('game tree', () => {
  it('merges transpositions and sorts moves by frequency', () => {
    const games = [
      game('white', 'e4 e5 Nf3 Nc6'),
      game('white', 'Nf3 Nc6 e4 e5', { result: 'loss' }),
      game('white', 'e4 e5 Nc3', { result: 'draw' }),
    ]
    const tree = buildGameTree(games)
    const [key] = pathKeys(uci('e4 e5 Nf3 Nc6')).slice(-1)
    expect(tree.get(key)?.games).toHaveLength(2)
    const after = tree.get(pathKeys(uci('e4 e5')).at(-1)!)!
    expect(after.moves.map((m) => [m.san, m.games.length])).toEqual([
      ['Nf3', 1],
      ['Nc3', 1],
    ])
    expect(tree.get(pathKeys([]).at(-1)!)?.moves.map((m) => m.san)).toEqual(['e4', 'Nf3'])
    expect(wdlOf(games)).toEqual({ win: 1, draw: 1, loss: 1 })
  })

  it('marks moves against the repertoire', async () => {
    const rep = await createRepertoire('Vienna', 'white', d, uci('e4 e5 Nc3'))
    await addLine(rep, uci('e4 e5 Nc3 Nf6 f4'), {}, d)
    const reps = await loadRepIndex(d)
    const at = (sans: string) => pathKeys(uci(sans)).at(-1)!
    expect(moveMark(at('e4 e5 Nc3 Nf6'), uci('e4 e5 Nc3 Nf6 f4')[4], 'white', reps)).toBe('rep')
    expect(moveMark(at('e4 e5 Nc3 Nf6'), uci('e4 e5 Nc3 Nf6 d4')[4], 'white', reps)).toBe('deviates')
    expect(moveMark(at('e4 e5 Nc3'), uci('e4 e5 Nc3 Nc6')[3], 'white', reps)).toBe('unanswered')
    // Before the start, after the line's end, or for the other colour: nothing to compare with.
    expect(moveMark(at('e4 e5'), uci('e4 e5 Nf3')[2], 'white', reps)).toBe('none')
    expect(moveMark(at('e4 e5 Nc3 Nf6 f4'), uci('e4 e5 Nc3 Nf6 f4 d5')[5], 'white', reps)).toBe('none')
    expect(moveMark(at('e4 e5 Nc3 Nf6'), uci('e4 e5 Nc3 Nf6 f4')[4], 'black', reps)).toBe('none')
  })

  it('groups games by opening family, variation and name', async () => {
    const rep = await createRepertoire('Vienna', 'white', d, uci('e4 e5 Nc3'))
    await addLine(rep, uci('e4 e5 Nc3 Nf6 f4'), {}, d)
    const reps = await loadRepIndex(d)
    const names = new Map<string, { eco: string; name: string }>([
      [pathKeys(uci('e4 e5 Nc3')).at(-1)!, { eco: 'C25', name: 'Vienna Game' }],
      [pathKeys(uci('e4 e5 Nc3 Nf6 f4')).at(-1)!, { eco: 'C29', name: 'Vienna Game: Vienna Gambit' }],
      [pathKeys(uci('e4 e5 Nc3 Nf6 f4 d5')).at(-1)!, { eco: 'C29', name: 'Vienna Game: Vienna Gambit, Main Line' }],
    ])
    const analyses = [
      game('white', 'e4 e5 Nc3 Nf6 f4 d5'),
      game('white', 'e4 e5 Nc3 Nf6 f4 exf4', { result: 'loss' }),
      game('white', 'e4 e5 Nc3 Nf6 d4', { result: 'draw' }),
      game('white', 'd4 d5'),
    ].map((g) => analyzeGame(g, reps))
    const groups = openingGroups(analyses, { opening: (k) => names.get(k) })
    expect(groups.map((g) => [g.label, g.analyses.length])).toEqual([
      ['Vienna Game', 3],
      ['1. d4 d5', 1],
    ])
    const [vienna] = groups
    expect(vienna.at).toEqual(uci('e4 e5 Nc3'))
    expect(vienna.stats).toMatchObject({ games: 3, score: 0.5, inRep: 1, playedRight: 2 / 3 })
    expect(vienna.children.map((g) => g.label)).toEqual(['Vienna Gambit'])
    const [gambit] = vienna.children
    expect(gambit.at).toEqual(uci('e4 e5 Nc3 Nf6 f4'))
    expect(gambit.children.map((g) => [g.label, g.at.length])).toEqual([['Main Line', 6]])
    expect(groups[1].stats).toMatchObject({ inRep: 0, playedRight: null })
  })

  it('finds where to prepare a line', async () => {
    const rep = await createRepertoire('Vienna', 'white', d, uci('e4 e5 Nc3'))
    await addLine(rep, uci('e4 e5 Nc3 Nf6 f4'), {}, d)
    const reps = await loadRepIndex(d)
    const target = (sans: string) => {
      const p = sansToUci(sans ? sans.split(' ') : [])
      return builderTarget(p.moves, p.sans, 'white', reps)
    }
    expect(target('e4 e5 Nc3 Nf6')).toMatchObject({ kind: 'builder', past: false, url: `/rep/${rep.id}/build?m=${uci('e4 e5 Nc3 Nf6').join(',')}` })
    // Past the end of a line, and reached by another move order: the repertoire's order, then the game's moves.
    expect(target('Nc3 Nf6 e4 e5 f4 d5')).toMatchObject({
      kind: 'builder',
      past: true,
      url: `/rep/${rep.id}/build?m=${uci('e4 e5 Nc3 Nf6 f4 d5').join(',')}`,
    })
    expect(target('e4')).toMatchObject({ kind: 'plan', url: `/plan/white?at=${uci('e4').join(',')}` })
    expect(target('e4 c5')).toMatchObject({ kind: 'new', url: `/?newColor=white&newStart=${encodeURIComponent('1. e4 c5')}` })
  })
})

describe('opening map', () => {
  it('keeps the branch points, collapses chains and drops rare branches', async () => {
    const rep = await createRepertoire('Vienna', 'white', d, uci('e4 e5 Nc3'))
    await addLine(rep, uci('e4 e5 Nc3 Nf6 f4'), {}, d)
    const reps = await loadRepIndex(d)
    const names = new Map<string, { eco: string; name: string }>([
      [pathKeys(uci('e4 e5 Nc3')).at(-1)!, { eco: 'C25', name: 'Vienna Game' }],
      [pathKeys(uci('e4 e5 Nc3 Nf6 f4')).at(-1)!, { eco: 'C29', name: 'Vienna Game: Vienna Gambit' }],
    ])
    const games = [
      game('white', 'e4 e5 Nc3 Nf6 f4 d5 fxe5'),
      game('white', 'e4 e5 Nc3 Nf6 f4 d5 fxe5', { result: 'loss' }),
      game('white', 'e4 e5 Nc3 Nf6 d4 exd4', { result: 'draw' }),
      game('white', 'e4 e5 Nc3 Nf6 d4 exd4'),
      game('white', 'e4 c5 Nf3 d6'),
      game('white', 'e4 c5 Nf3 Nc6'),
      game('white', 'd4 d5'),
    ]
    const root = buildOpeningMap(games, 'white', reps, { opening: (k) => names.get(k) }, 2)!
    const line = (n: { sans: string[] }) => n.sans.join(' ')
    expect(root.games).toHaveLength(7)
    // 1.d4 has a single game: left out.
    expect(root.rare).toBe(1)
    // 1.e4 is played in every shown game, so it's collapsed into the edge to the first split.
    const [e4] = root.children
    expect(line(e4)).toBe('e4')
    expect(e4.children.map(line)).toEqual(['e4 e5 Nc3 Nf6', 'e4 c5 Nf3'])
    const [vienna, sicilian] = e4.children
    expect(edgeMoves(vienna)).toBe('1... e5 2. Nc3 Nf6')
    expect(vienna.newName).toBe('Vienna Game')
    // Chains run on to where the games stop agreeing.
    expect(vienna.children.map(line)).toEqual(['e4 e5 Nc3 Nf6 f4 d5 fxe5', 'e4 e5 Nc3 Nf6 d4 exd4'])
    const [gambit, d4] = vienna.children
    expect(gambit).toMatchObject({ mark: 'right', newName: 'Vienna Gambit', score: 0.5 })
    expect(d4.mark).toBe('deviated')
    expect(d4.opening).toBe('Vienna Game')
    expect(d4.newName).toBeUndefined()
    // 2...Nc6 and 2...d6 have one game each: the Sicilian is a leaf.
    expect(sicilian).toMatchObject({ children: [], rare: 2, mark: 'none' })
    expect(mapNodes(root)).toHaveLength(6)

    const layout = layoutMap(root, () => 40)
    const at = (n: object) => layout.nodes.find((p) => p.node === n)!
    // The main line runs straight; sidelines drop below it, one row per leaf.
    expect(at(root).y).toBe(at(gambit).y)
    expect(at(d4).y).toBeGreaterThan(at(gambit).y)
    expect(at(sicilian).y).toBeGreaterThan(at(d4).y)
    expect(at(gambit).x).toBeGreaterThan(at(vienna).x)
    expect(layout.height).toBeGreaterThan(3 * 40)
    // Labels start clear of the node they leave, whether straight on or after a bend.
    expect(at(e4).labelX).toBeGreaterThan(at(root).x + at(root).r)
    expect(at(sicilian).labelX).toBeGreaterThan(at(e4).x)

    expect(defaultMinGames(games, 'white', reps, 2)).toBe(3)
  })
})

describe('import', () => {
  const lichessRow = (id: string, createdAt: number) =>
    JSON.stringify({
      id,
      variant: 'standard',
      speed: 'rapid',
      status: 'mate',
      createdAt,
      players: { white: { user: { name: 'Demyriad', id: 'demyriad' } }, black: { user: { name: 'B', id: 'b' } } },
      winner: 'white',
      moves: 'e4 e5',
    })

  it('streams Lichess games, skips duplicates and retries after a 429', async () => {
    const urls: string[] = []
    let calls = 0
    const fetchFn = (async (url: string) => {
      urls.push(url)
      if (calls++ === 0) return new Response('{"error":"busy"}', { status: 429 })
      return new Response(`${lichessRow('g1', 10)}\n${lichessRow('g2', 20)}\n`)
    }) as typeof fetch
    const waits: number[] = []
    const opts = { fetchFn, sleep: async (ms: number) => void waits.push(ms) }
    expect(await importLichess('Demyriad', 5, opts, d)).toBe(2)
    expect(waits).toEqual([60_000])
    expect(urls[1]).toContain('since=5')
    expect(urls[1]).toContain('perfType=bullet%2Cblitz%2Crapid%2Cclassical%2Ccorrespondence')
    expect(await importLichess('Demyriad', 5, opts, d)).toBe(0)
    expect(await d.games.count()).toBe(2)
  })

  it('resumes after the newest stored game and fetches only recent Chess.com months', async () => {
    const now = Date.UTC(2026, 8, 24)
    await setSetting('gamesImportVersion', IMPORT_VERSION, d)
    await d.games.add(game('white', 'e4 e5', { id: 'lichess:old', source: 'lichess', playedAt: Date.UTC(2026, 8, 20) }))
    const urls: string[] = []
    const fetchFn = (async (url: string) => {
      urls.push(url)
      if (url.startsWith('https://lichess.org')) return new Response('')
      if (url.endsWith('/archives'))
        return Response.json({
          archives: ['2025/08', '2025/09', '2025/10', '2026/09'].map((m) => `https://api.chess.com/pub/player/demyriad/games/${m}`),
        })
      return Response.json({ games: [] })
    }) as typeof fetch
    const res = await importGames({ lichessUser: 'Demyriad', chesscomUser: 'Demyriad', fetchFn, now }, d)
    expect(res.errors).toEqual([])
    expect(urls.find((u) => u.startsWith('https://lichess.org'))).toContain(`since=${Date.UTC(2026, 8, 20) + 1}`)
    // A year back from 24 Sep 2026 is 24 Sep 2025: August 2025 is skipped.
    expect(urls.filter((u) => /\d{4}\/\d{2}$/.test(u)).map((u) => u.slice(-7))).toEqual(['2025/09', '2025/10', '2026/09'])
  })

  it('re-imports the whole window once when stored games predate the current speeds', async () => {
    const now = Date.UTC(2026, 8, 24)
    await d.games.add(game('white', 'e4 e5', { id: 'lichess:old', source: 'lichess', playedAt: Date.UTC(2026, 8, 20) }))
    const urls: string[] = []
    const fetchFn = (async (url: string) => {
      urls.push(url)
      return new Response('')
    }) as typeof fetch
    await importGames({ lichessUser: 'Demyriad', fetchFn, now }, d)
    expect(urls[0]).toContain(`since=${now - IMPORT_WINDOW_MS}`)
    expect((await getSettings(d)).gamesImportVersion).toBe(IMPORT_VERSION)
    // The stored game is kept.
    expect(await d.games.count()).toBe(1)
  })

  it('reports an unknown Chess.com user', async () => {
    const fetchFn = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    await expect(importChesscom('nobody', 0, { fetchFn }, d)).rejects.toThrow('not found')
  })
})
