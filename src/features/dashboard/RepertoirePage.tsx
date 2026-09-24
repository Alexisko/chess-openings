import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { pct, scoreColor } from '../../components/format'
import { ColorDot, Section } from '../../components/ui'
import { addLine, deleteRepertoire, MoveConflictError, OutsideRepertoireError, renameRepertoire } from '../../db/repertoire'
import { useSettings } from '../../db/settings'
import { useRepertoire, type RepertoireData } from '../../db/useRepertoire'
import { pathTo } from '../../lib/chess/graph'
import { graphToPgn, pgnToLines } from '../../lib/chess/pgn'
import { formatMoves } from '../../lib/chess/position'
import { repStart } from '../../lib/chess/start'
import { AuthRequiredError } from '../../lib/explorer'
import type { Gap } from '../../lib/prep/preparedness'
import { usePreparedness } from '../../lib/prep/usePreparedness'
import { builderUrl } from '../../lib/routes'
import { isDue, isNew } from '../../lib/srs/scheduler'

const GAP_LABEL: Record<Gap['kind'], string> = {
  'unprepared-reply': 'No answer prepared',
  'line-ends': 'Line ends too early',
  'not-learned': 'Not learned yet',
  weak: 'Weak recall',
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ColorDot color={rep.color} />
        <h1
          className="text-xl font-semibold"
          title="Click to rename"
          onClick={async () => {
            const name = prompt('Rename repertoire', rep.name)
            if (name?.trim()) await renameRepertoire(rep.id, name.trim())
          }}
        >
          {rep.name}
        </h1>
        {repStart(rep).moves.length > 0 && (
          <span className="text-sm text-muted">from {formatMoves(repStart(rep).sans)}</span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Link className="btn-primary" to={builderUrl(rep.id, [])}>
            Open builder
          </Link>
          <Link className="btn-ghost" to={`/rep/${rep.id}/tree`}>
            Overview
          </Link>
          <Link className={`btn-ghost ${due ? '' : 'pointer-events-none opacity-40'}`} to={`/train?mode=review&rep=${rep.id}`}>
            Review ({due})
          </Link>
          <Link className={`btn-ghost ${fresh ? '' : 'pointer-events-none opacity-40'}`} to={`/train?mode=learn&rep=${rep.id}`}>
            Learn ({fresh})
          </Link>
          <Link className="btn-ghost" to={`/train?mode=drill&rep=${rep.id}`}>
            Drill
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <Section title={`Preparedness, ${settings.prepDepth} moves deep`}>
          {!prep ? (
            <p className="text-sm text-muted">Calculating…</p>
          ) : (
            <>
              <div className="flex items-end gap-6">
                <div>
                  <div className={`text-4xl font-semibold ${scoreColor(prep.result.score)}`}>{pct(prep.result.score)}</div>
                  <div className="text-xs text-muted">
                    chance to play {settings.prepDepth} moves from the start without leaving remembered prep
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-semibold">{prep.result.expectedDepth.toFixed(1)}</div>
                  <div className="text-xs text-muted">avg. own moves in prep</div>
                </div>
              </div>
              {prep.pending > 0 && (
                <p className="mt-2 text-xs text-warn">
                  {prep.fetchError instanceof AuthRequiredError
                    ? 'Log in with Lichess (Settings) to download opponent statistics.'
                    : `Downloading opponent statistics… ${prep.pending} positions left.`}
                </p>
              )}
              {prep.branches.length > 0 && (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="font-normal">Opponent plays</th>
                      <th className="text-right font-normal">Games</th>
                      <th className="text-right font-normal">Prepared</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prep.branches.map((b) => (
                      <tr key={b.uci} className="border-t border-line">
                        <td className="py-1">{b.san}</td>
                        <td className="text-right text-muted">{b.share === null ? '–' : pct(b.share)}</td>
                        <td className={`text-right font-medium ${scoreColor(b.score)}`}>{pct(b.score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-3 text-xs text-muted">
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
          className="btn-danger"
          onClick={async () => {
            if (!confirm(`Delete "${rep.name}" and all its review history?`)) return
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
    <ul className="flex flex-col gap-1.5 text-sm">
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
          <li key={i} className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate">{formatMoves(sans) || 'Starting position'}</div>
              <div className="text-xs text-muted">
                {GAP_LABEL[g.kind]} · {pct(g.reach, 1)} of games
              </div>
            </div>
            <Link
              className="btn-ghost shrink-0 px-2 py-1 text-xs"
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
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </Section>
  )
}
