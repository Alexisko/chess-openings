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
  - Home shows each colour's preparedness (built and remembered) and next choice to make.
- **Builder:** play moves on the board next to the Lichess opening explorer (filtered by time control,
  rating or the masters database) and Stockfish.
  - A Lichess / Masters switch on the explorer panel shows the other database for a quick look. It only changes
    the panel: scores and the move tree keep the filter from Settings, whose ratings and speeds stay as they are.
  - The engine warns when a repertoire move is clearly worse than its best move.
  - Transpositions are detected and cut.
  - Every position can have notes on its ideas and plans.
  - **Chapters**, like a Lichess study: where the opponent's reply leads to another variation ("Vienna Game →
    Vienna Gambit"), a new chapter starts. Replies within the variation stay in the chapter as side lines,
    named by their sub-variation. The lines panel shows one chapter as a Lichess-style move list (main line in
    two columns, side lines on their own rows, deeper branches in parentheses, comments inline). Browse
    chapters from the outline above it (or step through them with ‹ ›), rename them, or force / prevent a
    chapter start on an opponent move. The Overview and the repertoire page are organised by chapter too.
  - Moves take symbols (!! ! !? ?! ? ??): click the current move in the lines again to pick one. The engine marks the
    opponent's inaccuracies, mistakes and blunders itself (drop in winning chances, Lichess thresholds, from Lichess
    cloud evaluations); your own symbol wins. The last move's symbol shows on its square, as in a Lichess study.
  - The opening's name follows you along the line ("Vienna Game → Vienna Gambit"), here, in training and on
    the overview. Names are the Lichess opening names, bundled in the app, or the names you give lines; a
    position without its own name keeps the one before it. Training only names positions already on the
    board.
  - "What 3.f4 does" explains the last move. Stockfish plays a free extra move for the side that just moved
    (the side to move flipped, skipped after a check): if that gains more than a spare tempo, the move
    threatens it ("Threatens fxe5 +4.4"); otherwise it's shown as the next idea. Hover the move to see it
    on the board. Facts from the board sit underneath: pieces newly attacked (discovered attacks too), new
    pins, development, castling and lines opened.
- **Training (FSRS):**
  - *Learn* plays a new line with hints, then asks you to replay it from memory.
  - *Review* replays lines from the start and covers every due card with as few lines as possible. A missed
    move comes back a few lines later, ungraded.
  - *Train* (replaces the old weak-spot drill) tests any learned move, due or not, for everything, one colour,
    a repertoire or a chapter. Choose *Moves* (single positions after a two-move lead-in) or *Lines* (whole
    lines, a shared start asked once). Moves you missed recently or haven't been asked for a while come up
    more often; a missed move comes back a few questions later, ungraded.
  - Every answer shows how well you know the move (*Shaky / Learning / Solid / Mastered*, with your streak and
    hit rate), and the repertoire page lists the moves that need work. Old mistakes stop counting once
    you've played the move right a few times since.
  - Any move other than your repertoire move counts as wrong.
  - A chapter can be trained on its own (Review / Learn / Train from the builder or the repertoire page).
  - After an opponent move marked ? or ??, training asks you to find the move that punishes it.
  - *Explain moves* (a switch next to the score, remembered per device) pauses after each correct move to show
    what it threatens and does, until you continue. It's never shown once you're answering again, where it
    could give the next move away.
- **Streaks and reminders:**
  - A day counts towards your streak once you've answered the daily goal's number of moves in training
    (Settings → Training, 10 by default; moves from imported games don't count). The Train tab shows the streak,
    today's progress and the last seven days; the end of a session says what's left. Days are local days, and
    the streak follows you across devices through the synced review history.
  - *Daily reminder* (Settings → App): a notification at the time you choose, only on days you haven't met the
    goal yet, with the moves due ("Keep your 6-day streak · 14 moves to review"). Tapping it opens the review.
    It is set per device and needs a Lichess login. On iPhone and iPad it only works in the installed app
    (iOS 16.4+).
  - Installed, the app icon shows the number of moves due as a badge, and a long press on it offers Review and
    Learn new moves.
- **Preparedness @ move N:** the chance of reaching your N-th move while still in your preparation, when
  opponents choose moves at the explorer's frequencies. It comes in two versions:
  - *Built:* every move you prepared counts as known, so only the opponent's replies can take you out. It
    measures how complete the repertoire is.
  - *Remembered:* each of your moves counts at the chance you recall it today (FSRS), and moves not learned
    yet count as 0.
  - N is your N-th move of the game everywhere. Your moves before a repertoire's starting position are set
    up, not drilled, and count as known.
  - The gap list ranks the biggest leaks: replies you haven't prepared, lines that end too early, and moves
    you haven't learned or recall poorly.
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

Pushing to `main` deploys the static files to GitHub Pages (`.github/workflows/deploy.yml`).

To install it on a phone, open the Pages URL: Chrome on Android offers an Install button (on Home and in
Settings → App); in Safari on iPhone use Share → Add to Home Screen. The installed app opens full screen
(`display: standalone`, without the browser's bars) and works offline.

Sounds (`public/sound/`) come from [Lichess](https://github.com/lichess-org/lila/tree/master/public/sound):
`move`, `capture` and `wrong` are its standard `Move`, `Capture` and `OutOfBound`; `line-complete` and
`session-complete` are `PuzzleStormGood` and `PracticeComplete` from the lisp set by EdinburghCollective
([CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)).

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

It runs on the Workers free plan.

Daily reminders are Web Push messages sent by the same Worker: each user's Durable Object keeps the devices'
push subscriptions with their reminder time and time zone, plus a small summary of the training that the app
reports after each sync (goal, moves answered over the last days, the streak, when cards come due). Its alarm
fires at the next reminder and skips users who met today's goal. Encryption (RFC 8291) and VAPID (RFC 8292) use
WebCrypto, with no dependencies (`worker/src/webpush.ts`). They need a VAPID key pair, generated once:

```sh
cd worker && node scripts/vapid-keys.mjs   # prints the keys and the `wrangler secret put` commands
```

Store `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` contact) as secrets, then
deploy. Without them the app says reminders aren't set up. Changing the keys later turns reminders off on
every device until they're switched on again. For a local Worker, put the same three values in
`worker/.dev.vars`.

To develop against a local Worker, run `npm run dev` in `worker/` and start
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
src/lib/pwa/     installing the app, daily reminders (push subscription, training status), app badge
src/features/    pages: dashboard, plan, builder, train, games, settings
worker/          Cloudflare Worker storing each user's synced copy
```

GPL-3.0 dependencies (chessground, chessops, Stockfish) mean that a distributed version of the app must
also be GPL-compatible.
