import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { pct, scoreColor } from '../../components/format'
import { ChapterTraining } from '../../components/ChapterTraining'
import { ArrowLeft, BookIcon, PencilIcon, TargetIcon, TrainIcon } from '../../components/icons'
import { ColorDot, Notice, ScoreRing, Section, Toggle } from '../../components/ui'
import {
  addLine,
  deleteRepertoire,
  MoveConflictError,
  OutsideRepertoireError,
  renameRepertoire,
  setRepertoirePaused,
} from '../../db/repertoire'
import { useSettings } from '../../db/settings'
import { useMoveRecords, useRepertoire, type RepertoireData } from '../../db/useRepertoire'
import { graphToPgn, pgnToLines } from '../../lib/chess/pgn'
import { formatMoves, replay } from '../../lib/chess/position'
import { repStart } from '../../lib/chess/start'
import { AuthRequiredError } from '../../lib/explorer'
import type { Gap, PrepResult } from '../../lib/prep/preparedness'
import { usePreparedness, type PrepGap, type PrepState } from '../../lib/prep/usePreparedness'
import { ownMovesIn, preparednessFrom } from '../../lib/prep/preparedness'
import { chapterShare, firstMove, type Chapter } from '../../lib/openings/chapters'
import { renameChapter } from '../../lib/openings/renameChapter'
import { useRepertoireChapters } from '../../lib/openings/useRepertoireChapters'
import { builderUrl, planUrl, repertoireUrl, trainUrl } from '../../lib/routes'
import { confirmDialog, promptDialog } from '../../lib/dialog'
import { isDue, isNew } from '../../lib/srs/scheduler'
import { describeRecord, emptyCounts, knowledgeOf, weakness } from '../../lib/srs/knowledge'
import { myMove, pathTo } from '../../lib/chess/graph'
import { KnowledgeBar, KnowledgeChip } from '../../components/Knowledge'

const GAP_LABEL: Record<Gap['kind'], string> = {
  'unprepared-reply': 'No answer prepared',
  'line-ends': 'Line ends too early',
  'not-learned': 'Not learned yet',
  weak: 'Weak recall',
}
const GAP_TONE: Record<Gap['kind'], string> = {
  'unprepared-reply': 'bg-bad',
  'line-ends': 'bg-warn',
  'not-learned': 'bg-info',
  weak: 'bg-warn',
}

function Count({ n }: { n: number }) {
  return <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-semibold tabular-nums text-muted">{n}</span>
}

export function RepertoirePage() {
  const { id } = useParams()
  const data = useRepertoire(id)
  const settings = useSettings()
  const prep = usePreparedness(data, settings?.explorerFilter, settings?.prepDepth ?? 6)
  const navigate = useNavigate()

  if (data === undefined || !settings) return null
  if (data === null) return <p className="text-muted">Repertoire not found.</p>
  const { rep } = data
  const startSans = repStart(rep).sans
  const now = new Date()
  const due = data.cards.filter((c) => isDue(c.fsrs, now)).length
  const fresh = data.cards.filter((c) => isNew(c.fsrs)).length
  const rename = async () => {
    const name = await promptDialog({ title: 'Rename repertoire', defaultValue: rep.name, confirmLabel: 'Rename' })
    if (name?.trim()) await renameRepertoire(rep.id, name.trim())
  }

  return (
    <div className="stagger flex flex-col gap-5">
      <div>
        <Link to={planUrl(rep.color)} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-brass">
          <ArrowLeft size={13} /> {rep.color === 'white' ? 'White' : 'Black'} repertoire plan
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-3">
          <ColorDot color={rep.color} size={16} />
          <h1
            className="page-title cursor-text decoration-line-strong decoration-dashed underline-offset-4 hover:underline"
            title="Click to rename"
            onClick={rename}
          >
            {rep.name}
          </h1>
          <button className="-ml-1.5 rounded-md p-1.5 text-faint hover:bg-surface-3 hover:text-ink" onClick={rename} aria-label="Rename repertoire" title="Rename repertoire">
            <PencilIcon size={16} />
          </button>
          {repStart(rep).moves.length > 0 && (
            <span className="rounded-md bg-surface-2 px-2 py-0.5 font-display text-sm text-muted">
              {formatMoves(repStart(rep).sans)}
            </span>
          )}
          <div className="flex w-full flex-wrap gap-2 md:ml-auto md:w-auto">
            <Link className="btn-primary" to={builderUrl(rep.id, [])}>
              Open builder
            </Link>
            <Link className="btn-ghost" to={`/rep/${rep.id}/tree`}>
              Overview
            </Link>
            <Link className={`btn-ghost ${due ? '' : 'pointer-events-none opacity-40'}`} to={`/train?mode=review&rep=${rep.id}`}>
              <TrainIcon size={15} /> Review <Count n={due} />
            </Link>
            <Link className={`btn-ghost ${fresh ? '' : 'pointer-events-none opacity-40'}`} to={`/train?mode=learn&rep=${rep.id}`}>
              <BookIcon size={15} /> Learn <Count n={fresh} />
            </Link>
            <Link className="btn-ghost" to={trainUrl('train', { repId: rep.id })} title="Test any move you have learned, weak ones more often">
              <TargetIcon size={15} /> Train
            </Link>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Toggle label="Include in daily training" checked={!rep.paused} onChange={(on) => setRepertoirePaused(rep.id, !on)} />
          {rep.paused && (
            <span className="text-xs text-faint">
              Paused: left out of Review, Learn and Train on Home. The buttons above still train it.
            </span>
          )}
        </div>
      </div>

      <ChapterSection data={data} prep={prep} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2 md:items-start">
        <Section title={`Preparedness to move ${settings.prepDepth}`}>
          {!prep ? (
            <p className="text-sm text-muted">Calculating…</p>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-muted">
                Chance to reach your move {settings.prepDepth} of the game without leaving your preparation, when opponents
                play at the explorer's frequencies.
                {startSans.length > 0 && <> The set-up moves {formatMoves(startSans)} count as known.</>}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <PrepScore
                  value={prep.built}
                  label="Built"
                  help="Every move you prepared counts as known: only the opponent's replies can take you out."
                />
                <PrepScore
                  value={prep.result}
                  label="Remembered"
                  help="Each of your moves counts at the chance you recall it today. Moves not learned yet count as 0."
                />
              </div>
              {prep.pending > 0 && (
                <div className="mt-3">
                  <Notice>
                    {prep.fetchError instanceof AuthRequiredError
                      ? 'Log in with Lichess (Settings) to download opponent statistics.'
                      : `Downloading opponent statistics… ${prep.pending} positions left.`}
                  </Notice>
                </div>
              )}
              {prep.branches.length > 0 && (
                <table className="mt-4 w-full text-sm">
                  <thead className="text-left text-[11px] tracking-wide text-faint uppercase">
                    <tr>
                      <th className="font-normal">Opponent plays</th>
                      <th className="text-right font-normal">Games</th>
                      <th className="text-right font-normal">Built</th>
                      <th className="text-right font-normal">Remembered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prep.branches.map((b) => (
                      <tr key={b.uci} className="border-t border-line/70">
                        <td className="py-1.5 font-semibold">{b.san}</td>
                        <td className="text-right text-muted">{b.share === null ? '–' : pct(b.share)}</td>
                        <td className={`text-right font-medium ${scoreColor(b.built)}`}>{pct(b.built)}</td>
                        <td className={`text-right font-medium ${scoreColor(b.score)}`}>{pct(b.score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-3 text-xs text-faint">
                {prep.built.score - prep.result.score >= 0.15
                  ? 'Remembered is well behind built: train to close the gap.'
                  : prep.built.score < 0.8
                    ? 'To raise built, answer the frequent replies and extend the short lines (see the gaps).'
                    : 'Raise the target depth in Settings as your score improves.'}
              </p>
            </>
          )}
        </Section>

        <Section title="Biggest gaps">
          {!prep ? null : prep.gaps.length === 0 ? (
            <p className="text-sm text-muted">No gaps up to move {settings.prepDepth}. Time to go deeper!</p>
          ) : (
            <GapList data={data} gaps={prep.gaps.slice(0, 12)} />
          )}
        </Section>
      </div>

      <MoveKnowledge data={data} />

      <PgnTools data={data} />

      <div>
        <button
          className="btn-danger text-xs"
          onClick={async () => {
            const ok = await confirmDialog({
              title: `Delete “${rep.name}”?`,
              message: 'All its moves, notes on its moves and review history are deleted. This cannot be undone.',
              confirmLabel: 'Delete repertoire',
              danger: true,
            })
            if (!ok) return
            await deleteRepertoire(rep.id)
            navigate(repertoireUrl(rep.color))
          }}
        >
          Delete repertoire
        </button>
      </div>
    </div>
  )
}

/** A preparedness score with its ring and the average number of your moves played in prep. */
function PrepScore({ value, label, help }: { value: PrepResult; label: string; help: string }) {
  return (
    <div className="flex items-center gap-3" title={help}>
      <ScoreRing value={value.score} size={72} stroke={6} />
      <div>
        <div className="text-[11px] tracking-wide text-faint uppercase">{label}</div>
        <div>
          <span className="font-display text-xl font-medium tabular-nums">{value.expectedDepth.toFixed(1)}</span>{' '}
          <span className="text-xs text-muted">of your moves in prep, on average</span>
        </div>
      </div>
    </div>
  )
}

/** The repertoire's chapters, each with its preparedness and its own training. */
function ChapterSection({ data, prep }: { data: RepertoireData; prep: PrepState | undefined }) {
  const settings = useSettings()
  const { tree, chapters, shareOf, naming } = useRepertoireChapters(data, settings?.explorerFilter)
  if (!tree || !chapters || !tree.children.length) return null
  const { rep } = data
  const startLen = repStart(rep).moves.length
  const own = (ch: Chapter) => ownMovesIn(ch.node.path, startLen, rep.color)
  const score = (ch: Chapter) => prep && preparednessFrom(prep.inputs, ch.node.key, own(ch)).score
  const built = (ch: Chapter) => prep && preparednessFrom(prep.builtInputs, ch.node.key, own(ch)).score
  const depth = (ch: Chapter) => {
    let d = 0
    for (let p = ch.parent; p; p = p.parent) d++
    return d
  }
  return (
    <Section title={`Chapters · ${chapters.list.length}`}>
      <ol className="-my-1 flex flex-col">
        {chapters.list.map((ch, i) => {
          const s = chapterShare(tree, ch, shareOf)
          return (
            <li
              key={ch.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line/60 py-2 last:border-b-0"
              style={{ paddingLeft: `${depth(ch) * 1.25}rem` }}
            >
              <div className="flex min-w-0 flex-1 basis-56 items-baseline gap-2">
                <span className="w-5 shrink-0 text-right text-[11px] text-faint tabular-nums">{i + 1}</span>
                <Link to={builderUrl(rep.id, ch.node.path)} className="min-w-0 truncate font-display text-[15px] hover:text-maple" title={ch.name}>
                  {ch.title}
                </Link>
                <span className="shrink-0 text-xs text-faint">{firstMove(ch)}</span>
                {s !== undefined && (
                  <span className="shrink-0 text-[11px] text-faint tabular-nums" title="Share of games with this reply">
                    {pct(s)}
                  </span>
                )}
                <button
                  className="shrink-0 rounded p-0.5 text-faint hover:bg-surface-3 hover:text-ink"
                  onClick={() => renameChapter(ch, naming)}
                  aria-label={`Rename ${ch.title}`}
                  title="Rename chapter"
                >
                  <PencilIcon size={13} />
                </button>
              </div>
              <ChapterTraining rep={rep} chapter={ch} cards={data.cardMap} score={score(ch)} built={built(ch)} compact />
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

/** How well you know each of your moves, and the ones that need work most. */
function MoveKnowledge({ data }: { data: RepertoireData }) {
  const records = useMoveRecords(data.rep.id)
  const [all, setAll] = useState(false)
  if (!records || !data.cards.length) return null
  const now = new Date()
  const start = repStart(data.rep)
  const counts = emptyCounts()
  const rows = data.cards.map((c) => {
    const rec = records.get(c.positionKey)
    const level = knowledgeOf(c.fsrs, rec, now)
    counts[level]++
    return { key: c.positionKey, level, rec, w: weakness(c.fsrs, rec, now) }
  })
  const weak = rows.filter((r) => r.level === 'shaky' || r.level === 'learning').sort((a, b) => b.w - a.w)
  const shown = all ? weak : weak.slice(0, 6)
  return (
    <Section
      title="Move knowledge"
      right={
        <Link className="btn-ghost px-2.5 py-1 text-xs" to={trainUrl('train', { repId: data.rep.id })}>
          <TargetIcon size={14} /> Train
        </Link>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-muted">
        From your answers in Review, Learn and Train and your imported games: how many times in a row you played each move
        right, and whether you missed it recently. A mistake stops counting once you have played the move right a few times
        since.
      </p>
      <KnowledgeBar counts={counts} />
      {weak.length > 0 && (
        <>
          <div className="eyebrow mt-5 mb-2">Needs work</div>
          <ul className="grid gap-2 md:grid-cols-2">
            {shown.map((r) => {
              const path = pathTo(data.graph, r.key)
              const own = myMove(data.graph, r.key)
              const moves = [...path, ...(own ? [own] : [])]
              const sans = [...start.sans, ...moves.map((m) => m.san)]
              return (
                <li key={r.key}>
                  <Link
                    to={builderUrl(data.rep.id, [...start.moves, ...path.map((m) => m.uci)])}
                    className="flex items-center gap-3 rounded-lg border border-line/60 bg-surface-2/60 px-3 py-2 transition hover:border-line-strong"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-[15px]" title={formatMoves(sans)}>
                        {formatMoves(sans)}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <KnowledgeChip level={r.level} />
                        <span className="tabular-nums">{describeRecord(r.rec)}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
          {weak.length > shown.length && (
            <button className="mt-2 text-xs text-brass underline-offset-2 hover:underline" onClick={() => setAll(true)}>
              Show all {weak.length}
            </button>
          )}
        </>
      )}
    </Section>
  )
}

function GapList({ data, gaps }: { data: RepertoireData; gaps: PrepGap[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {gaps.map((g, i) => {
        const uci = [...g.path]
        const sans = replay(g.path).map((p) => p.san)
        const elsewhere = g.rep.id !== data.rep.id
        if (g.uci && g.san) {
          uci.push(g.uci)
          sans.push(g.san)
        }
        const train = g.kind === 'not-learned' || g.kind === 'weak'
        return (
          <li key={i} className="flex items-center gap-3 rounded-lg border border-line/60 bg-surface-2/60 px-3 py-2">
            <span className={`h-8 w-1 shrink-0 rounded-full ${GAP_TONE[g.kind]}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-display">{formatMoves(sans) || 'Starting position'}</div>
              <div className="text-xs text-muted">
                {GAP_LABEL[g.kind]} · <span className="tabular-nums">{pct(g.reach, 1)}</span> of games
                {elsewhere && <span className="text-info"> · in {g.rep.name}</span>}
              </div>
            </div>
            <Link
              className={`${train ? 'btn-ghost' : 'btn-primary'} shrink-0 px-2.5 py-1 text-xs`}
              to={train ? trainUrl(g.kind === 'weak' ? 'train' : 'learn', { repId: g.rep.id }) : builderUrl(g.rep.id, uci)}
            >
              {train ? 'Train' : 'Prepare'}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function PgnTools({ data }: { data: RepertoireData }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string>()

  const exportPgn = () => {
    const pgn = graphToPgn(data.graph, data.rep.name, repStart(data.rep).sans)
    const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.rep.name.replace(/[^\w-]+/g, '_')}.pgn`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importPgn = async (file: File) => {
    const { lines, errors } = pgnToLines(await file.text())
    let added = 0
    let outside = 0
    const conflicts: string[] = []
    for (const l of lines) {
      try {
        added += (await addLine(data.rep, l)).added.length
      } catch (e) {
        if (e instanceof MoveConflictError) conflicts.push(e.message)
        else if (e instanceof OutsideRepertoireError) outside++
        else errors.push((e as Error).message)
      }
    }
    setMsg(
      [
        `Added ${added} moves from ${lines.length} lines.`,
        conflicts.length ? `${conflicts.length} lines skipped because they contradict your moves.` : '',
        outside ? `${outside} lines skipped because they don't start with this repertoire's starting moves.` : '',
        errors.length ? `${errors.length} problems: ${errors.slice(0, 3).join('; ')}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  return (
    <Section title="PGN">
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
          Import PGN
        </button>
        <button className="btn-ghost" onClick={exportPgn} disabled={!data.moves.length}>
          Export PGN
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pgn,text/plain"
          hidden
          onChange={(e) => e.target.files?.[0] && importPgn(e.target.files[0])}
        />
      </div>
      {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}
    </Section>
  )
}
