# Opening Trainer

Build a chess opening repertoire from scratch and learn it with spaced repetition. See how well prepared you
are against the moves real opponents play.

- **Builder:** play moves on the board next to the Lichess opening explorer (filtered by time control,
  rating or the masters database) and Stockfish.
  - The engine warns when a repertoire move is clearly worse than its best move.
  - Transpositions are detected and cut.
  - Every position can have notes on its ideas and plans.
- **Training (FSRS):**
  - *Learn* plays a new line with hints, then asks you to replay it from memory.
  - *Review* replays lines from the start and covers every due card with as few lines as possible.
  - *Drill* starts two moves before your weakest positions.
  - Any move other than your repertoire move counts as wrong.
- **Preparedness @ move N:** the chance of reaching your N-th move while still in preparation you
  remember, when opponents choose moves at the explorer's frequencies. The gap list ranks the biggest
  leaks: replies you haven't prepared, lines that end too early, and moves you haven't learned or recall
  poorly.

## Stack

Vite + React + TypeScript, Tailwind, `@lichess-org/chessground` + `chessops`, Stockfish 19 lite (WASM, single
thread), Dexie (IndexedDB), `ts-fsrs`. It is a PWA with no backend: all data stays in the browser.
Use **Settings → Backup** to move it between devices.

Pushing to `main` deploys the static files to GitHub Pages (`.github/workflows/deploy.yml`). On a phone,
open the Pages URL and use "Add to Home Screen" to install it.

The Lichess opening explorer requires authentication. The app uses "Log in with Lichess" (OAuth PKCE with no
scopes), or you can paste a personal token with no scopes.

## Develop

```sh
npm install        # also copies the Stockfish engine into public/stockfish
npm run dev
npm test
npm run build
```

## Layout

```
src/db/          Dexie schema, repertoire operations, reviews, settings, backup
src/lib/chess/   position keys, repertoire graph (lines, transpositions), PGN
src/lib/explorer Lichess explorer client (cache + throttled queue)
src/lib/engine/  Stockfish worker, cloud eval, UCI parsing
src/lib/srs/     FSRS scheduling, session planning, line runs
src/lib/prep/    preparedness score and gap finder
src/features/    pages: dashboard, builder, train, settings
```

GPL-3.0 dependencies (chessground, chessops, Stockfish) mean that a distributed version of the app must
also be GPL-compatible.
