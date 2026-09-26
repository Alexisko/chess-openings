// Builds src/lib/openings/eco.json from the Lichess opening names
// (https://github.com/lichess-org/chess-openings, CC0): one entry per
// position, keyed like positionKey() in src/lib/chess/position.ts.
// Run with `node scripts/build-openings.mjs` to refresh the names.

import { writeFileSync } from 'node:fs'
import { Chess } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import { parsePgn, startingPosition } from 'chessops/pgn'
import { parseSan } from 'chessops/san'

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master'
const OUT = new URL('../src/lib/openings/eco.json', import.meta.url)

const keyOf = (pos) => makeFen(pos.toSetup()).split(' ').slice(0, 4).join(' ')

const entries = {}
for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const res = await fetch(`${BASE}/${file}.tsv`)
  if (!res.ok) throw new Error(`${file}.tsv: HTTP ${res.status}`)
  const [, ...rows] = (await res.text()).trim().split('\n')
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t')
    const game = parsePgn(pgn)[0]
    const pos = startingPosition(game.headers).unwrap()
    for (const node of game.moves.mainline()) {
      const move = parseSan(pos, node.san)
      if (!move) throw new Error(`${eco} ${name}: bad move ${node.san}`)
      pos.play(move)
    }
    if (!(pos instanceof Chess)) throw new Error(`${eco} ${name}: not standard chess`)
    // A few positions have two names (different move orders); keep the first.
    entries[keyOf(pos)] ??= [eco, name]
  }
}

writeFileSync(OUT, `${JSON.stringify(entries)}\n`)
console.log(`${Object.keys(entries).length} named positions → ${OUT.pathname}`)
