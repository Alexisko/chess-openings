# Opening Trainer

Build a chess opening repertoire from scratch and learn it with spaced repetition. See how well prepared you
are against the moves real opponents play.

- **Repertoire plan (White / Black):** guides you to a complete repertoire for each colour. Choose your first
  move as White (e.g. 1.e4), then an answer to each of Black's main replies (Italian, Ruy Lopez, Vienna… against
  1...e5, a line against the Sicilian, the French…). As Black, choose a defence to 1.e4, 1.d4, 1.c4 and 1.Nf3,
  then an answer to White's main tries. Each answer becomes a repertoire, opened in the builder with its main
  line ready to save.
  - Options come from a curated catalogue with a short description, style and amount of theory, how often the
    move is played and how it scores, and how often you played it in your own games.
  - Replies and their frequencies come from the explorer. Starting a repertoire deeper (the Italian starts
    after 3.Bc4) brings up the replies it doesn't cover (2...Nf6 Petrov, 2...d6 Philidor).
  - Home shows each colour's coverage, overall preparedness and next choice to make.
- **Builder:** play moves on the board next to the Lichess opening explorer (filtered by time control,
  rating or the masters database) and Stockfish.
  - A Lichess / Masters switch on the explorer panel shows the other database for a quick look. It only changes
    the panel: scores and the move tree keep the filter from Settings, whose ratings and speeds stay as they are.
  - The engine warns when a repertoire move is clearly worse than its best move.
  - Transpositions are detected and cut.
  - Every position can have notes on its ideas and plans.
  - The opening's name follows you along the line ("Vienna Game → Vienna Gambit"), here, in training and on
    the overview. Names come from explorer data already cached; a position without its own name keeps the one
    before it. Training only names positions already on the board.
- **Training (FSRS):**
  - *Learn* plays a new line with hints, then asks you to replay it from memory.
  - *Review* replays lines from the start and covers every due card with as few lines as possible.
  - *Drill* starts two moves before your weakest positions.
  - Any move other than your repertoire move counts as wrong.
- **Preparedness @ move N:** the chance of reaching your N-th move while still in preparation you
  remember, when opponents choose moves at the explorer's frequencies. The gap list ranks the biggest
  leaks: replies you haven't prepared, lines that end too early, and moves you haven't learned or recall
  poorly.
- **Your games:** imports your Lichess and Chess.com games at every speed from bullet to daily (the last 12
  months at first, then only new ones) and finds where each game left your preparation. Bullet counts
  here, though not in the explorer statistics: you should know your moves at any speed.
  - Moves you forgot are listed, and one played after the card's last review sends the card back to review.
  - Replies you have no answer to, and lines that ended mid-game, link to the builder.
  - Openings no repertoire covers can start a new repertoire.
  - The engine checks the most frequent deviations for opponent mistakes to punish and your own
    mistakes right after your preparation.

## Stack

Vite + React + TypeScript, Tailwind, `@lichess-org/chessground` + `chessops`, Stockfish 19 lite (WASM, single
thread), Dexie (IndexedDB), `ts-fsrs`. It is a PWA: data lives in the browser (IndexedDB) and is synced
between devices by a small Cloudflare Worker (see [Sync](#sync)). **Settings → Backup** exports or restores a
snapshot file.

Pushing to `main` deploys the static files to GitHub Pages (`.github/workflows/deploy.yml`). On a phone,
open the Pages URL and use "Add to Home Screen" to install it.

The Lichess opening explorer requires authentication. The app uses "Log in with Lichess" (OAuth PKCE with no
scopes), or you can paste a personal token with no scopes.

## Sync

Each user's data is kept under their Lichess username, which the app takes from the Lichess login and doesn't
verify: this is meant for a handful of friends, and anyone who knows a username can read or overwrite its data.
Games aren't synced; each device imports them again.

- `worker/` is the server: one Durable Object per user holding one gzipped JSON document (the backup format)
  and a version number. An upload only succeeds if it was based on the current version.
- `src/lib/sync/` merges on the device: a three-way merge against the copy both sides last agreed on
  (remembered as one fingerprint per record), so a record added on one side is told apart from one deleted on
  the other. When both sides changed a record, the most recent edit wins. `repairAfterMerge` then removes
  duplicates and conflicting moves that edits on two devices can create.
- It syncs when the app opens or comes back to the foreground, every 5 minutes while open, and 5 seconds
  after a change.

Deploy the Worker (after `npx wrangler login` once):

```sh
cd worker && npm install && npx wrangler deploy
```

It runs on the Workers free plan. To develop against a local Worker, run `npm run dev` in `worker/` and start
the app with `VITE_SYNC_URL=http://localhost:8787`.

## Develop

```sh
npm install        # also copies the Stockfish engine into public/stockfish
npm run dev
npm test
npm run build
```

## Layout

```
src/db/          Dexie schema, repertoire operations, reviews, settings, backup, sync bookkeeping
src/lib/chess/   position keys, repertoire graph (lines, transpositions), PGN
src/lib/explorer Lichess explorer client (cache + throttled queue)
src/lib/engine/  Stockfish worker, cloud eval, UCI parsing
src/lib/srs/     FSRS scheduling, session planning, line runs
src/lib/prep/    preparedness score and gap finder
src/lib/openings curated catalogue of openings for the repertoire plan
src/lib/plan/    repertoire plan per colour (which repertoire answers each reply, what is left to choose)
src/lib/games/   game import (Lichess, Chess.com), comparison with the repertoire, engine checks
src/lib/sync/    sync with the server: three-way merge, background scheduling
src/features/    pages: dashboard, plan, builder, train, games, settings
worker/          Cloudflare Worker storing each user's synced copy
```

GPL-3.0 dependencies (chessground, chessops, Stockfish) mean that a distributed version of the app must
also be GPL-compatible.
