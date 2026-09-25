import { parseMoves, startOf } from '../chess/start'
import { turnOf } from '../chess/position'

/**
 * A curated guide to building a repertoire: at the main decision points of
 * each colour, the openings worth considering, with a short description.
 * The repertoire plan (lib/plan) walks the positions and offers these options
 * wherever you haven't chosen a move yet.
 */

export type Style = 'solid' | 'active' | 'sharp' | 'gambit'
export type Theory = 'light' | 'medium' | 'heavy'

export interface CatalogOption {
  name: string
  /** Characteristic main line, in SAN, continuing from the slot. */
  line: string
  /**
   * 'branch' only records your move and keeps guiding you (e.g. 1.e4, then an
   * answer to each reply). 'repertoire' creates a repertoire.
   */
  kind: 'branch' | 'repertoire'
  /**
   * For repertoires: how many plies of `line` come before the repertoire
   * starts (default 1, i.e. right after your move). The Italian starts after
   * 3.Bc4 so that 2...Nf6 (Petrov) and 2...d6 (Philidor) get their own slots.
   */
  startPlies?: number
  style: Style
  theory: Theory
  about: string
}

interface SlotDef {
  /** SAN moves leading to the decision (your turn). */
  at: string
  title: string
  options: CatalogOption[]
}

const b = (name: string, line: string, style: Style, theory: Theory, about: string): CatalogOption => ({
  name,
  line,
  kind: 'branch',
  style,
  theory,
  about,
})
const r = (
  name: string,
  line: string,
  style: Style,
  theory: Theory,
  about: string,
  startPlies?: number,
): CatalogOption => ({ name, line, kind: 'repertoire', style, theory, about, startPlies })

const SLOTS: SlotDef[] = [
  // ─── White ───────────────────────────────────────────────────────────────
  {
    at: '',
    title: 'Your first move as White',
    options: [
      b('1.e4', '1.e4', 'active', 'heavy', 'Open, tactical games where development and king safety matter most. The most common first move at club level.'),
      b('1.d4', '1.d4', 'solid', 'medium', 'Closed, strategic games built on central control; opponents have fewer sharp tries against it.'),
      b('English Opening', '1.c4', 'solid', 'medium', 'A flank opening that controls d5 and often turns into a reversed Sicilian. Fewer forcing lines.'),
      b('Réti Opening', '1.Nf3', 'solid', 'light', 'Flexible: keeps options open and can transpose to 1.d4 or 1.c4 systems.'),
    ],
  },
  {
    at: '1.e4 e5',
    title: 'Against 1...e5',
    options: [
      r('Italian Game', '2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d3', 'active', 'medium', 'Quick development aiming at f7; the slow 4.c3/5.d3 setup gives rich middlegames without much forced theory.', 3),
      r('Ruy Lopez', '2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O', 'solid', 'heavy', 'Long-term pressure on e5 and the c6 knight. The classical main road, deep in theory.', 3),
      r('Scotch Game', '2.Nf3 Nc6 3.d4 exd4 4.Nxd4', 'active', 'medium', 'Opens the centre at once and gives clear, active piece play.', 3),
      r('Vienna Game', '2.Nc3 Nf6 3.f4', 'active', 'light', 'Keeps f2–f4 in reserve for a kingside attack; avoids the Petrov and the Berlin.'),
      r("King's Gambit", '2.f4 exf4 3.Nf3', 'gambit', 'medium', 'Gives a pawn for the centre and open lines. Romantic and sharp; opponents are often unprepared.'),
      r("Bishop's Opening", '2.Bc4 Nf6 3.d3', 'solid', 'light', 'Aims at f7 while keeping options open; avoids the Petrov.'),
    ],
  },
  {
    at: '1.e4 e5 2.Nf3 Nf6',
    title: 'Against the Petrov',
    options: [
      r('Main line 3.Nxe5', '3.Nxe5 d6 4.Nf3 Nxe4 5.d4', 'solid', 'medium', 'Take the pawn and keep a small, lasting edge in a symmetrical position.'),
      r('3.d4', '3.d4 Nxe4 4.Bd3 d5 5.Nxe5', 'active', 'medium', 'Opens the centre for quicker development; less symmetrical than the main line.'),
      r('Four Knights (3.Nc3)', '3.Nc3 Nc6', 'solid', 'light', 'Simple development that often transposes into a Four Knights Game.'),
    ],
  },
  {
    at: '1.e4 e5 2.Nf3 d6',
    title: 'Against the Philidor',
    options: [
      r('3.d4', '3.d4 exd4 4.Nxd4 Nf6 5.Nc3', 'active', 'light', 'Take space and develop freely; Black ends up passive.'),
      r('3.Bc4', '3.Bc4 Be7 4.c3', 'solid', 'light', 'Aims at f7 and prepares d4 with c3.'),
    ],
  },
  {
    at: '1.e4 c5',
    title: 'Against the Sicilian',
    options: [
      r('Open Sicilian', '2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3', 'sharp', 'heavy', 'The critical test: open lines and a lead in development, but every Black system has its own theory.'),
      r('Rossolimo & Moscow', '2.Nf3 Nc6 3.Bb5', 'solid', 'medium', 'After 2.Nf3, 3.Bb5 (or 3.Bb5+ against 2...d6) avoids the main Open Sicilians.'),
      r('Alapin (2.c3)', '2.c3 Nf6 3.e5 Nd5 4.d4', 'solid', 'medium', 'Prepares d4 to build a classical centre; positional and low on theory.'),
      r('Closed / Grand Prix (2.Nc3)', '2.Nc3 Nc6 3.f4', 'active', 'light', 'Slow build-up with f4 and a kingside attack; easy plans.'),
      r('Smith-Morra Gambit', '2.d4 cxd4 3.c3 dxc3 4.Nxc3', 'gambit', 'medium', 'A pawn for fast development and open files. Dangerous at club level.'),
    ],
  },
  {
    at: '1.e4 e6',
    title: 'Against the French',
    options: [
      r('Advance Variation', '2.d4 d5 3.e5 c5 4.c3', 'active', 'medium', 'Gain space with e5 and cramp Black; the fight is about the d4 pawn.'),
      r('Exchange Variation', '2.d4 d5 3.exd5 exd5', 'solid', 'light', 'Symmetrical structure, simple development; aim for small edges.'),
      r('Tarrasch (3.Nd2)', '2.d4 d5 3.Nd2', 'solid', 'medium', 'Avoids the Winawer pin; solid positional play.'),
      r('Main line (3.Nc3)', '2.d4 d5 3.Nc3', 'sharp', 'heavy', 'Meets the Winawer and Classical head-on. Very rich and very theoretical.'),
      r("King's Indian Attack", '2.d3 d5 3.Nd2 Nf6 4.Ngf3', 'solid', 'light', 'A setup rather than theory: g3, Bg2, O-O and a kingside attack.'),
    ],
  },
  {
    at: '1.e4 c6',
    title: 'Against the Caro-Kann',
    options: [
      r('Advance Variation', '2.d4 d5 3.e5 Bf5 4.Nf3', 'active', 'medium', 'Space with e5 and play against the bishop on f5.'),
      r('Exchange Variation', '2.d4 d5 3.exd5 cxd5 4.Bd3', 'solid', 'light', 'Carlsbad-like structure with easy piece play for White.'),
      r('Classical (3.Nc3)', '2.d4 d5 3.Nc3 dxe4 4.Nxe4', 'solid', 'heavy', 'The main line: a small space edge and many deep variations.'),
      r('Two Knights', '2.Nc3 d5 3.Nf3', 'active', 'light', 'Quick development that sidesteps most Caro-Kann theory.'),
    ],
  },
  {
    at: '1.e4 d5',
    title: 'Against the Scandinavian',
    options: [r('Main line 2.exd5', '2.exd5 Qxd5 3.Nc3 Qa5 4.d4', 'solid', 'medium', 'Take on d5 and gain time on the queen.')],
  },
  {
    at: '1.e4 Nf6',
    title: 'Against the Alekhine',
    options: [
      r('Modern Variation', '2.e5 Nd5 3.d4 d6 4.Nf3', 'solid', 'medium', 'Keep a space advantage without overextending.'),
      r('2.Nc3', '2.Nc3 d5 3.e5', 'solid', 'light', 'Sidesteps the knight chase entirely.'),
    ],
  },
  {
    at: '1.e4 d6',
    title: 'Against the Pirc',
    options: [
      r('Austrian Attack', '2.d4 Nf6 3.Nc3 g6 4.f4', 'sharp', 'medium', 'A big pawn centre and attacking chances.'),
      r('150 Attack', '2.d4 Nf6 3.Nc3 g6 4.Be3 Bg7 5.Qd2', 'active', 'light', 'Be3, Qd2, Bh6 and a kingside attack. Easy plans.'),
      r('Classical', '2.d4 Nf6 3.Nc3 g6 4.Nf3 Bg7 5.Be2', 'solid', 'light', 'Simple development and a space advantage.'),
    ],
  },
  {
    at: '1.e4 g6',
    title: 'Against the Modern',
    options: [
      r('150 Attack setup', '2.d4 Bg7 3.Nc3 d6 4.Be3', 'active', 'light', 'Be3, Qd2 and an attack; the same plan as against the Pirc.'),
      r('Classical setup', '2.d4 Bg7 3.Nc3 d6 4.Nf3', 'solid', 'light', 'Calm development with a space advantage.'),
    ],
  },
  {
    at: '1.d4 d5',
    title: 'Against 1...d5',
    options: [
      b("Queen's Gambit (2.c4)", '2.c4', 'solid', 'medium', 'The classical main road: pressure on d5. Next you choose a line against each defence.'),
      r('London System', '2.Bf4 Nf6 3.e3 e6 4.Nf3', 'solid', 'light', 'The same setup against almost everything. Very little theory.'),
    ],
  },
  {
    at: '1.d4 d5 2.c4 e6',
    title: "Against the Queen's Gambit Declined",
    options: [
      r('Classical (3.Nc3)', '3.Nc3 Nf6 4.Bg5 Be7 5.e3', 'solid', 'medium', 'Standard development with pressure on d5; exchange plans are possible later.'),
      r('Catalan', '3.Nf3 Nf6 4.g3', 'solid', 'heavy', 'The g2 bishop aims at the queenside; long-term positional pressure.'),
    ],
  },
  {
    at: '1.d4 d5 2.c4 c6',
    title: 'Against the Slav',
    options: [
      r('Main line (3.Nf3)', '3.Nf3 Nf6 4.Nc3', 'solid', 'heavy', 'The critical main line; the Semi-Slav is part of it.'),
      r('Exchange Slav', '3.cxd5 cxd5', 'solid', 'light', 'Symmetrical structure, easy to play, small edges.'),
    ],
  },
  {
    at: '1.d4 d5 2.c4 dxc4',
    title: "Against the Queen's Gambit Accepted",
    options: [
      r('3.e4', '3.e4 e5 4.Nf3', 'active', 'medium', 'Take the whole centre at once.'),
      r('3.Nf3', '3.Nf3 Nf6 4.e3', 'solid', 'medium', 'Calm development; win back c4 with Bxc4.'),
    ],
  },
  {
    at: '1.d4 Nf6',
    title: 'Against 1...Nf6',
    options: [
      b('2.c4', '2.c4', 'solid', 'heavy', 'The main road against the Indian defences. Next you choose a line against each of them.'),
      r('London System', '2.Bf4 e6 3.e3 c5 4.c3', 'solid', 'light', 'The same setup as against 1...d5. Very little theory.'),
      r('Trompowsky', '2.Bg5 Ne4 3.Bf4', 'active', 'light', 'Takes Black out of the books at move 2.'),
    ],
  },
  {
    at: '1.d4 Nf6 2.c4 g6',
    title: "Against the King's Indian and Grünfeld",
    options: [
      r('Main line (3.Nc3)', '3.Nc3 Bg7 4.e4 d6 5.Nf3', 'sharp', 'heavy', 'Big centre; fight the King’s Indian head-on and meet the Grünfeld with the main lines.'),
      r('Fianchetto (3.g3)', '3.g3 Bg7 4.Bg2 O-O 5.Nf3', 'solid', 'medium', 'Solid and positional; takes much of the sting out of both defences.'),
    ],
  },
  {
    at: '1.d4 Nf6 2.c4 e6',
    title: "Against the Nimzo-Indian and Queen's Indian",
    options: [
      r('3.Nc3 (allow the Nimzo)', '3.Nc3 Bb4 4.e3', 'solid', 'heavy', 'Face the Nimzo-Indian; rich strategic play.'),
      r('3.Nf3', '3.Nf3 b6 4.g3', 'solid', 'medium', "Avoids the Nimzo; meet the Queen's Indian with a fianchetto."),
      r('Catalan (3.g3)', '3.g3 d5 4.Bg2', 'solid', 'medium', 'Long-diagonal pressure; avoids the Nimzo.'),
    ],
  },
  {
    at: '1.d4 Nf6 2.c4 c5',
    title: 'Against the Benoni',
    options: [r('Main line 3.d5', '3.d5 e6 4.Nc3 exd5 5.cxd5 d6 6.e4', 'sharp', 'medium', 'Take space and push for e5.')],
  },
  {
    at: '1.d4 f5',
    title: 'Against the Dutch',
    options: [
      r('Fianchetto (2.g3)', '2.g3 Nf6 3.Bg2', 'solid', 'medium', 'The main line: the g2 bishop blunts Black’s kingside plans.'),
      r('Staunton Gambit', '2.e4 fxe4 3.Nc3', 'gambit', 'light', 'A pawn for rapid development against a weakened king.'),
    ],
  },
  {
    at: '1.c4 e5',
    title: 'Against 1...e5 (reversed Sicilian)',
    options: [r('2.Nc3 and g3', '2.Nc3 Nf6 3.g3', 'solid', 'medium', 'Fianchetto and play on the light squares.')],
  },
  {
    at: '1.c4 c5',
    title: 'Against the Symmetrical English',
    options: [r('2.Nc3 and g3', '2.Nc3 Nc6 3.g3 g6 4.Bg2 Bg7', 'solid', 'medium', 'Symmetrical fianchetto setups; manoeuvring play.')],
  },
  {
    at: '1.c4 Nf6',
    title: 'Against 1...Nf6',
    options: [
      r('2.Nc3', '2.Nc3 e5 3.g3', 'solid', 'medium', 'Classical English development.'),
      r('2.g3', '2.g3 e6 3.Bg2', 'solid', 'light', 'Fianchetto first, keep options open.'),
    ],
  },
  {
    at: '1.Nf3 d5',
    title: 'Against 1...d5',
    options: [
      r('Réti (2.c4)', '2.c4 e6 3.g3', 'solid', 'medium', 'Hit d5 from the side and fianchetto.'),
      r("King's Indian Attack", '2.g3 Nf6 3.Bg2', 'solid', 'light', 'A system: g3, Bg2, O-O, d3 and e4.'),
    ],
  },
  {
    at: '1.Nf3 Nf6',
    title: 'Against 1...Nf6',
    options: [
      r('2.c4', '2.c4 g6 3.Nc3', 'solid', 'medium', 'English-style play.'),
      r('2.g3', '2.g3 g6 3.Bg2', 'solid', 'light', 'Fianchetto and a flexible setup.'),
    ],
  },

  // ─── Black ───────────────────────────────────────────────────────────────
  {
    at: '1.e4',
    title: 'Your defence to 1.e4',
    options: [
      b('1...e5', '1...e5', 'active', 'heavy', 'Classical and principled. White has many second moves, and you choose an answer to each.'),
      b('Sicilian Defence', '1...c5', 'sharp', 'heavy', 'Unbalanced fights with winning chances for Black. You pick a system against 2.Nf3 and an answer to each anti-Sicilian.'),
      r('French Defence', '1...e6 2.d4 d5', 'solid', 'medium', 'Solid pawn chain and counterattack with ...c5 and ...f6. Clear plans.'),
      r('Caro-Kann Defence', '1...c6 2.d4 d5', 'solid', 'medium', 'Very solid, with a good light-squared bishop. Endgames tend to favour Black.'),
      r('Scandinavian Defence', '1...d5 2.exd5 Qxd5', 'active', 'light', 'Forces the play from move one; one structure to learn.'),
      r('Pirc Defence', '1...d6 2.d4 Nf6 3.Nc3 g6', 'active', 'medium', 'Let White build a centre, then strike at it. Flexible and fighting.'),
      r('Alekhine Defence', '1...Nf6 2.e5 Nd5', 'active', 'medium', 'Provokes White’s pawns forward to attack them later.'),
      r('Modern Defence', '1...g6 2.d4 Bg7', 'active', 'light', 'A flexible setup rather than theory.'),
    ],
  },
  {
    at: '1.e4 e5 2.Nf3',
    title: 'Against 2.Nf3',
    options: [
      b('2...Nc6', '2...Nc6', 'active', 'heavy', 'The classical reply. Next you choose answers to the Ruy Lopez, Italian, Scotch and others.'),
      r('Petrov Defence', '2...Nf6 3.Nxe5 d6 4.Nf3 Nxe4', 'solid', 'medium', 'Counterattack e4 at once; very solid and avoids the Ruy Lopez and Italian.'),
    ],
  },
  {
    at: '1.e4 e5 2.Nf3 Nc6 3.Bb5',
    title: 'Against the Ruy Lopez',
    options: [
      r('Morphy Defence (3...a6)', '3...a6 4.Ba4 Nf6 5.O-O Be7', 'active', 'heavy', 'The main line: a long strategic battle.'),
      r('Berlin Defence', '3...Nf6 4.O-O Nxe4 5.d4', 'solid', 'medium', 'Rock solid; often leads to the famous Berlin endgame.'),
    ],
  },
  {
    at: '1.e4 e5 2.Nf3 Nc6 3.Bc4',
    title: 'Against the Italian',
    options: [
      r('Two Knights (3...Nf6)', '3...Nf6 4.d3 Bc5', 'active', 'medium', 'Active and counterattacking; be ready for 4.Ng5.'),
      r('Giuoco Piano (3...Bc5)', '3...Bc5 4.c3 Nf6 5.d3', 'solid', 'medium', 'Mirror development and a slow manoeuvring game.'),
    ],
  },
  {
    at: '1.e4 e5 2.Nf3 Nc6 3.d4',
    title: 'Against the Scotch',
    options: [
      r('3...exd4 4.Nxd4 Nf6', '3...exd4 4.Nxd4 Nf6 5.Nxc6 bxc6', 'active', 'medium', 'Quick counterplay against e4.'),
      r('3...exd4 4.Nxd4 Bc5', '3...exd4 4.Nxd4 Bc5 5.Be3 Qf6', 'active', 'medium', 'Pressure on the d4 knight.'),
    ],
  },
  {
    at: '1.e4 e5 2.Nf3 Nc6 3.Nc3',
    title: 'Against the Three / Four Knights',
    options: [r('3...Nf6', '3...Nf6 4.Bb5 Bb4', 'solid', 'light', 'Mirror development; solid and simple.')],
  },
  {
    at: '1.e4 e5 2.Nc3',
    title: 'Against the Vienna',
    options: [
      r('2...Nf6', '2...Nf6 3.f4 d5', 'active', 'medium', 'Strike back in the centre with ...d5.'),
      r('2...Nc6', '2...Nc6 3.Bc4 Nf6', 'solid', 'light', 'Simple development.'),
    ],
  },
  {
    at: '1.e4 e5 2.f4',
    title: "Against the King's Gambit",
    options: [
      r('Accept (2...exf4)', '2...exf4 3.Nf3 d5 4.exd5 Nf6', 'sharp', 'medium', 'Take the pawn and return it at the right moment.'),
      r('Decline (2...Bc5)', '2...Bc5 3.Nf3 d6', 'solid', 'light', 'Stops White castling and keeps things calm.'),
      r('Falkbeer (2...d5)', '2...d5 3.exd5 exf4', 'active', 'light', 'An immediate central counter.'),
    ],
  },
  {
    at: '1.e4 e5 2.Bc4',
    title: "Against the Bishop's Opening",
    options: [r('2...Nf6', '2...Nf6 3.d3 Bc5', 'solid', 'light', 'Develop and hit e4.')],
  },
  {
    at: '1.e4 e5 2.d4',
    title: 'Against the Centre Game',
    options: [r('2...exd4', '2...exd4 3.Qxd4 Nc6 4.Qe3 Nf6', 'active', 'light', 'Gain time on the white queen.')],
  },
  {
    at: '1.e4 c5 2.Nf3',
    title: 'Your Open Sicilian system',
    options: [
      r('Najdorf', '2...d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6', 'sharp', 'heavy', 'The most famous Sicilian: flexible and full of fighting chances.'),
      r('Dragon', '2...d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 g6', 'sharp', 'heavy', 'Fianchetto and race on opposite wings.'),
      r('Sveshnikov', '2...Nc6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 e5', 'sharp', 'heavy', 'Dynamic play at the price of a hole on d5.'),
      r('Accelerated Dragon', '2...Nc6 3.d4 cxd4 4.Nxd4 g6', 'active', 'medium', 'A Dragon without the sharpest attacking lines.'),
      r('Taimanov / Kan', '2...e6 3.d4 cxd4 4.Nxd4 Nc6', 'active', 'medium', 'Flexible Scheveningen-type structures with fewer forcing lines.'),
    ],
  },
  {
    at: '1.e4 c5 2.c3',
    title: 'Against the Alapin',
    options: [
      r('2...d5', '2...d5 3.exd5 Qxd5 4.d4 Nf6', 'active', 'medium', 'Active piece play from the start.'),
      r('2...Nf6', '2...Nf6 3.e5 Nd5 4.d4 cxd4', 'active', 'medium', 'Attack e4 and blockade on d5.'),
    ],
  },
  {
    at: '1.e4 c5 2.Nc3',
    title: 'Against the Closed Sicilian',
    options: [r('2...Nc6', '2...Nc6 3.g3 g6 4.Bg2 Bg7', 'solid', 'light', 'Mirror the fianchetto and play on the queenside.')],
  },
  {
    at: '1.e4 c5 2.d4',
    title: 'Against the Smith-Morra',
    options: [
      r('Accept', '2...cxd4 3.c3 dxc3 4.Nxc3 Nc6', 'sharp', 'medium', 'Take the pawn and defend carefully.'),
      r('Decline (3...Nf6)', '2...cxd4 3.c3 Nf6 4.e5 Nd5', 'solid', 'light', 'Transposes to an Alapin and avoids the gambit play.'),
    ],
  },
  {
    at: '1.e4 c5 2.f4',
    title: 'Against the Grand Prix',
    options: [
      r('2...d5', '2...d5 3.exd5 Nf6', 'active', 'light', 'Hit the centre at once.'),
      r('2...Nc6', '2...Nc6 3.Nf3 g6', 'solid', 'light', 'Fianchetto and solid development.'),
    ],
  },
  {
    at: '1.d4',
    title: 'Your defence to 1.d4',
    options: [
      b('1...d5', '1...d5', 'solid', 'medium', 'Classical: stake a claim in the centre. Next you choose an answer to 2.c4, the London and others.'),
      b('1...Nf6', '1...Nf6', 'active', 'heavy', 'Flexible: leads to the Indian defences. Next you choose a system against 2.c4 and others.'),
      r('Dutch Defence', '1...f5 2.g3 Nf6 3.Bg2 g6', 'sharp', 'medium', 'Unbalanced from move one; kingside play.'),
    ],
  },
  {
    at: '1.d4 d5 2.c4',
    title: "Against the Queen's Gambit",
    options: [
      r("Queen's Gambit Declined", '2...e6 3.Nc3 Nf6 4.Bg5 Be7', 'solid', 'medium', 'Solid and classical; very hard to break down.'),
      r('Slav Defence', '2...c6 3.Nf3 Nf6 4.Nc3 dxc4', 'solid', 'medium', 'Keeps the light-squared bishop free; solid.'),
      r("Queen's Gambit Accepted", '2...dxc4 3.Nf3 Nf6 4.e3 e6', 'active', 'medium', 'Take the pawn, give it back, and get free development.'),
    ],
  },
  {
    at: '1.d4 d5 2.Nf3',
    title: 'Against 2.Nf3',
    options: [r('2...Nf6', '2...Nf6 3.c4 e6', 'solid', 'light', 'Flexible; often transposes to the Queen’s Gambit.')],
  },
  {
    at: '1.d4 d5 2.Bf4',
    title: 'Against the London',
    options: [
      r('2...Nf6 and ...c5', '2...Nf6 3.e3 c5 4.c3 Nc6', 'active', 'light', 'Pressure on d4 and b2.'),
      r('2...c5', '2...c5 3.e3 Nc6 4.c3 Qb6', 'active', 'light', 'Hit d4 and b2 at once.'),
    ],
  },
  {
    at: '1.d4 Nf6 2.c4',
    title: 'Your system against 2.c4',
    options: [
      r("King's Indian Defence", '2...g6 3.Nc3 Bg7 4.e4 d6 5.Nf3 O-O', 'sharp', 'heavy', 'Let White take the centre, then attack on the kingside.'),
      r('Grünfeld Defence', '2...g6 3.Nc3 d5 4.cxd5 Nxd5', 'sharp', 'heavy', 'Attack White’s centre with pieces. Very theoretical.'),
      r("Nimzo / Queen's Indian", '2...e6 3.Nc3 Bb4', 'solid', 'heavy', 'Pieces control the centre; the Nimzo-Indian is one of the most respected defences.'),
      r('Benoni', '2...c5 3.d5 e6 4.Nc3 exd5 5.cxd5 d6', 'sharp', 'medium', 'Queenside majority and active pieces in an unbalanced structure.'),
    ],
  },
  {
    at: '1.d4 Nf6 2.Nf3',
    title: 'Against 2.Nf3',
    options: [
      r("King's Indian setup", '2...g6 3.g3 Bg7', 'active', 'light', 'Same setup as against 2.c4.'),
      r('2...e6', '2...e6 3.c4 b6', 'solid', 'light', "Heads for a Queen's Indian."),
    ],
  },
  {
    at: '1.d4 Nf6 2.Bf4',
    title: 'Against the London',
    options: [
      r('2...g6', '2...g6 3.e3 Bg7', 'solid', 'light', 'Fianchetto and play ...d6 and ...e5.'),
      r('2...c5', '2...c5 3.e3 Qb6', 'active', 'light', 'Hit d4 and b2.'),
    ],
  },
  {
    at: '1.d4 Nf6 2.Bg5',
    title: 'Against the Trompowsky',
    options: [
      r('2...Ne4', '2...Ne4 3.Bf4 d5', 'active', 'light', 'Chase the bishop and take the centre.'),
      r('2...e6', '2...e6 3.e4 h6', 'solid', 'light', 'Solid; ask the bishop at once.'),
    ],
  },
  {
    at: '1.c4',
    title: 'Your answer to the English',
    options: [
      r('1...e5 (reversed Sicilian)', '1...e5 2.Nc3 Nf6', 'active', 'medium', 'Take the centre directly.'),
      r('Symmetrical (1...c5)', '1...c5 2.Nc3 Nc6', 'solid', 'medium', 'Mirror White and play in the same structures.'),
      r('1...Nf6', '1...Nf6 2.Nc3 e6', 'solid', 'light', 'Flexible; can transpose to your 1.d4 defences.'),
    ],
  },
  {
    at: '1.Nf3',
    title: 'Your answer to 1.Nf3',
    options: [
      r('1...d5', '1...d5 2.g3 Nf6', 'solid', 'light', 'Classical centre.'),
      r('1...Nf6', '1...Nf6 2.c4 g6', 'solid', 'light', 'Flexible; can transpose to your 1.d4 defences.'),
    ],
  },
]

/** Named opponent moves at positions where the opponent is to move (shown without explorer data too). */
const REPLIES: Record<string, [san: string, name: string][]> = {
  '': [
    ['e4', "King's Pawn"],
    ['d4', "Queen's Pawn"],
    ['c4', 'English Opening'],
    ['Nf3', 'Réti Opening'],
  ],
  '1.e4': [
    ['e5', 'Open Game'],
    ['c5', 'Sicilian Defence'],
    ['e6', 'French Defence'],
    ['c6', 'Caro-Kann Defence'],
    ['d5', 'Scandinavian Defence'],
    ['Nf6', 'Alekhine Defence'],
    ['d6', 'Pirc Defence'],
    ['g6', 'Modern Defence'],
  ],
  '1.e4 e5': [
    ['Nf3', "King's Knight"],
    ['Nc3', 'Vienna Game'],
    ['Bc4', "Bishop's Opening"],
    ['f4', "King's Gambit"],
    ['d4', 'Centre Game'],
  ],
  '1.e4 e5 2.Nf3': [
    ['Nc6', 'Main line'],
    ['Nf6', 'Petrov Defence'],
    ['d6', 'Philidor Defence'],
    ['f5', 'Latvian Gambit'],
  ],
  '1.e4 e5 2.Nf3 Nc6': [
    ['Bb5', 'Ruy Lopez'],
    ['Bc4', 'Italian Game'],
    ['d4', 'Scotch Game'],
    ['Nc3', 'Three Knights'],
    ['c3', 'Ponziani'],
  ],
  '1.e4 c5': [
    ['Nf3', 'Open Sicilian'],
    ['Nc3', 'Closed Sicilian'],
    ['c3', 'Alapin'],
    ['d4', 'Smith-Morra Gambit'],
    ['f4', 'Grand Prix Attack'],
  ],
  '1.e4 c5 2.Nf3': [
    ['d6', 'Najdorf / Dragon / Classical'],
    ['Nc6', 'Sveshnikov / Accelerated Dragon'],
    ['e6', 'Taimanov / Kan'],
  ],
  '1.d4': [
    ['d5', 'Closed Game'],
    ['Nf6', 'Indian Defence'],
    ['e6', 'Horwitz Defence'],
    ['f5', 'Dutch Defence'],
    ['d6', 'Old Indian'],
    ['g6', 'Modern Defence'],
  ],
  '1.d4 d5': [
    ['c4', "Queen's Gambit"],
    ['Nf3', 'Zukertort'],
    ['Bf4', 'London System'],
    ['e3', 'Colle System'],
    ['Bg5', 'Levitsky Attack'],
  ],
  '1.d4 d5 2.c4': [
    ['e6', "Queen's Gambit Declined"],
    ['c6', 'Slav Defence'],
    ['dxc4', "Queen's Gambit Accepted"],
    ['Nc6', 'Chigorin Defence'],
    ['e5', 'Albin Countergambit'],
  ],
  '1.d4 Nf6': [
    ['c4', 'Indian Game'],
    ['Nf3', 'Indian Game'],
    ['Bf4', 'London System'],
    ['Bg5', 'Trompowsky'],
    ['Nc3', 'Veresov'],
  ],
  '1.d4 Nf6 2.c4': [
    ['e6', "Nimzo / Queen's Indian"],
    ['g6', "King's Indian / Grünfeld"],
    ['c5', 'Benoni'],
    ['e5', 'Budapest Gambit'],
    ['d6', 'Old Indian'],
  ],
  '1.c4': [
    ['e5', 'Reversed Sicilian'],
    ['Nf6', 'Anglo-Indian'],
    ['c5', 'Symmetrical English'],
    ['e6', 'Agincourt Defence'],
    ['c6', 'Caro-Kann setup'],
    ['g6', 'Great Snake'],
  ],
  '1.Nf3': [
    ['d5', 'Réti Opening'],
    ['Nf6', 'Indian setup'],
    ['c5', 'Sicilian Invitation'],
    ['g6', "King's Indian setup"],
  ],
}

export interface ResolvedOption extends CatalogOption {
  /** Full UCI line from the initial position. */
  lineUci: string[]
  /** Where a repertoire for this option starts (UCI from the initial position). */
  startUci: string[]
  /** Your move at the slot. */
  uci: string
  san: string
}

export interface ResolvedSlot {
  key: string
  path: string[]
  title: string
  options: ResolvedOption[]
}

export interface NamedMove {
  uci: string
  san: string
  name: string
}

interface Resolved {
  slots: Map<string, ResolvedSlot>
  replies: Map<string, NamedMove[]>
}

let resolved: Resolved | undefined

/** SAN text of the slot followed by the option's moves, parsed from the initial position. */
function parseAfter(at: string, line: string): string[] {
  // The slot is parsed alone first: "1.e4" + "1...e5" must not repeat a move number mid-line.
  const base = parseMoves(at)
  const rest = line.replace(/\d+\.(\.\.)?\s*/g, '').trim()
  const sans = rest ? rest.split(/\s+/) : []
  // Re-attach proper move numbers so the PGN parser reads it as one line.
  const plies = [...startOf(base).sans, ...sans]
  const text = plies.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s)).join(' ')
  return parseMoves(text)
}

function resolve(): Resolved {
  if (resolved) return resolved
  const slots = new Map<string, ResolvedSlot>()
  for (const s of SLOTS) {
    const path = parseMoves(s.at)
    const start = startOf(path)
    const options = s.options.map((o): ResolvedOption => {
      const lineUci = parseAfter(s.at, o.line)
      const own = startOf(lineUci)
      const startUci = lineUci.slice(0, path.length + (o.kind === 'branch' ? 1 : (o.startPlies ?? 1)))
      return { ...o, lineUci, startUci, uci: lineUci[path.length], san: own.sans[path.length] }
    })
    slots.set(start.key, { key: start.key, path, title: s.title, options })
  }
  const replies = new Map<string, NamedMove[]>()
  for (const [at, list] of Object.entries(REPLIES)) {
    const path = parseMoves(at)
    const start = startOf(path)
    replies.set(
      start.key,
      list.map(([san, name]) => {
        const uci = parseAfter(at, san).at(-1)!
        return { uci, san: startOf([...path, uci]).sans.at(-1)!, name }
      }),
    )
  }
  resolved = { slots, replies }
  return resolved
}

/** The catalogue's decision at a position (your turn), if any. */
export const catalogSlot = (key: string): ResolvedSlot | undefined => resolve().slots.get(key)

/** Named opponent moves at a position. */
export const catalogReplies = (key: string): NamedMove[] => resolve().replies.get(key) ?? []

/** Every slot, for tests and the colour of each decision. */
export const allSlots = (): ResolvedSlot[] => [...resolve().slots.values()]

/** The side choosing at a slot. */
export const slotColor = (slot: ResolvedSlot) => turnOf(slot.key)
