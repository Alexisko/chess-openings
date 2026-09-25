# Roadmap

## Understanding positions

Goal: explain the ideas behind a position, not only the moves. Insight is shown in the builder, after you've
played your move in training, and at the end of a line. It is never shown before you've answered.

Listed in the suggested build order.

1. **Opening names along the line.** The explorer already returns an opening name for each position. Show
   the name as you step through a line ("Vienna Game → Vienna Gambit") in the builder, training and the
   overview.

2. **Masters database in one click.** Add a Lichess players / Masters toggle on the explorer panel itself.
   Today it's only in Settings. The toggle keeps the current rating and speed filter for when you switch back.

3. **"What does this move threaten?"** After a move, flip the side to move in the FEN (skipped when in check)
   and ask Stockfish for the best move. That move is the threat ("3.f4 threatens fxe5"), with its eval gain
   to tell a real threat from nothing. Add simple facts from chessops: the piece developed, pieces newly
   attacked, pins, lines opened.

4. **Wikibooks Chess Opening Theory.** Show the prose for the position from the Chess Opening Theory wikibook,
   the same text the Lichess explorer shows. Pages follow move order, e.g.
   `Chess_Opening_Theory/1._e4/1...e5/2._Nc3/2...Nf6/3._f4/3...d5`. They can be fetched from the MediaWiki API
   with `origin=*` (browser requests allowed; coverage checked down to the Vienna Gambit after 4...Nxe4 and the
   Najdorf English Attack). Cache per path. For transpositions, fall back to the repertoire's own path to the
   position. CC BY-SA: credit Wikibooks and link the page.

5. **Your own results.** From imported games: how often you've reached this position and how you scored from
   it. Point out lines where your recall is good but your results are poor: you know the moves but not the
   plans.

6. **Traps.** Opponent replies that are frequent at your rating but lose to a strong answer: high explorer
   frequency combined with a large eval drop (cloud eval, then local Stockfish), plus moves amateurs play much
   more often than masters. Each becomes "they often play X; punish it with Y", listed per repertoire and
   later usable as a drill.

7. **Master games.** Ask the masters explorer for its top games (`topGames`, currently 0) and list 3–5 at
   the end of each line, with players, year and result. Open one on the board from that position; its PGN
   comes from `explorer.lichess.org/masters/pgn/{id}` (no login needed).

8. **Importing annotations.** Import a Lichess study or any PGN with comments. Its comments become position
   notes and move comments, matched by position key so transpositions still work. Show what an import adds or
   changes before saving, and never overwrite your own notes silently.

9. **Hand-picked video moments (Gemini).** For a few videos you choose per line, the Gemini API (which accepts a
   public YouTube URL) extracts which positions are discussed and what's said about each. The result is
   "video moments": a timestamped link ("▶ 4:32") and a one-line summary you can adopt into your notes.
   - Check that every move sequence it returns is legal. Flag claims the engine disagrees with
     ("wins a piece").
   - The API key stays in the Worker as a secret. Results are stored per position and synced, so friends
     can see them too.
   - The YouTube-URL feature is in preview at the time of writing (September 2026), so pricing and limits may
     change.
   - First check whether chessvision.ai's video search can be linked to a position. It already indexes 30k+
     chess videos by position.
