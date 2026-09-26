import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { pct, scoreColor } from '../../components/format'
import { ArrowLeft, BookIcon, TargetIcon, TrainIcon } from '../../components/icons'
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
import { useRepertoire, type RepertoireData } from '../../db/useRepertoire'
import { pathTo } from '../../lib/chess/graph'
import { graphToPgn, pgnToLines } from '../../lib/chess/pgn'
import { formatMoves } from '../../lib/chess/position'
import { repStart } from '../../lib/chess/start'
import { AuthRequiredError } from '../../lib/explorer'
import type { Gap } from '../../lib/prep/preparedness'
import { usePreparedness } from '../../lib/prep/usePreparedness'
import { builderUrl, planUrl } from '../../lib/routes'
import { confirmDialog, promptDialog } from '../../lib/dialog'
import { isDue, isNew } from '../../lib/srs/scheduler'

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
  const now = new Date()
  const due = data.cards.filter((c) => isDue(c.fsrs, now)).length
  const fresh = data.cards.filter((c) => isNew(c.fsrs)).length

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
            onClick={async () => {
              const name = await promptDialog({ title: 'Rename repertoire', defaultValue: rep.name, confirmLabel: 'Rename' })
              if (name?.trim()) await renameRepertoire(rep.id, name.trim())
            }}
          >
            {rep.name}
          </h1>
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
            <Link className="btn-ghost" to={`/train?mode=drill&rep=${rep.id}`}>
              <TargetIcon size={15} /> Drill
            </Link>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Toggle label="Include in daily training" checked={!rep.paused} onChange={(on) => setRepertoirePaused(rep.id, !on)} />
          {rep.paused && (
            <span className="text-xs text-faint">
              Paused: left out of Review, Learn and Drill on Home. The buttons above still train it.
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2 md:items-start">
        <Section title={`Preparedness, ${settings.prepDepth} moves deep`}>
          {!prep ? (
            <p className="text-sm text-muted">Calculating…</p>
          ) : (
            <>
              <div className="flex items-center gap-5">
                <ScoreRing value={prep.result.score} size={96} stroke={7} />
                <div className="flex flex-col gap-3">
                  <p className="text-xs leading-relaxed text-muted">
                    Chance to play {settings.prepDepth} moves from the start without leaving the prep you remember.
                  </p>
                  <div>
                    <span className="font-display text-2xl font-medium tabular-nums">{prep.result.expectedDepth.toFixed(1)}</span>{' '}
                    <span className="text-xs text-muted">of your moves in prep, on average</span>
                  </div>
                </div>
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
                      <th className="text-right font-normal">Prepared</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prep.branches.map((b) => (
                      <tr key={b.uci} className="border-t border-line/70">
                        <td className="py-1.5 font-semibold">{b.san}</td>
                        <td className="text-right text-muted">{b.share === null ? '–' : pct(b.share)}</td>
                        <td className={`text-right font-medium ${scoreColor(b.score)}`}>{pct(b.score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-3 text-xs text-faint">
                Raise the target depth in Settings as your score improves.
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
            navigate('/')
          }}
        >
          Delete repertoire
        </button>
      </div>
    </div>
  )
}

function GapList({ data, gaps }: { data: RepertoireData; gaps: Gap[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {gaps.map((g, i) => {
        const start = repStart(data.rep)
        const path = pathTo(data.graph, g.key)
        const uci = [...start.moves, ...path.map((m) => m.uci)]
        const sans = [...start.sans, ...path.map((m) => m.san)]
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
              </div>
            </div>
            <Link
              className={`${train ? 'btn-ghost' : 'btn-primary'} shrink-0 px-2.5 py-1 text-xs`}
              to={train ? `/train?mode=${g.kind === 'weak' ? 'drill' : 'learn'}&rep=${data.rep.id}` : builderUrl(data.rep.id, uci)}
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
