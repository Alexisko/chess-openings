import { pct } from '../../components/format'
import { WdlBar } from '../../components/ui'
import { startLogin } from '../../lib/auth/lichess'
import { formatScore, type Evaluation } from '../../lib/engine/uci'
import { AuthRequiredError, totalGames, type ExplorerState } from '../../lib/explorer'

interface Props {
  state: ExplorerState
  /** UCI moves already in the repertoire from this position. */
  repMoves: Set<string>
  myTurn: boolean
  evaluation?: Evaluation | null
  onPick: (uci: string) => void
}

/** Opening explorer table: what players at the chosen level play here. */
export function ExplorerPanel({ state, repMoves, myTurn, evaluation, onPick }: Props) {
  const { data, error, loading } = state
  if (error instanceof AuthRequiredError)
    return (
      <div className="text-sm">
        <p className="mb-2 text-muted">Log in with Lichess to see opponent statistics.</p>
        <button className="btn-primary" onClick={() => startLogin()}>
          Log in with Lichess
        </button>
      </div>
    )
  if (error) return <p className="text-sm text-bad">{error.message}</p>
  if (!data) return <p className="text-sm text-muted">{loading ? 'Loading…' : ''}</p>

  const total = totalGames(data)
  if (!total) return <p className="text-sm text-muted">No games in the database from this position — you're out of book.</p>

  const evalByMove = new Map((evaluation?.lines ?? []).map((l) => [l.pv[0], l]))
  const preparedShare = data.moves.filter((m) => repMoves.has(m.uci)).reduce((s, m) => s + totalGames(m), 0) / total

  return (
    <div className={loading ? 'opacity-60' : ''}>
      {data.opening && (
        <div className="mb-2 text-xs text-muted">
          <span className="font-mono">{data.opening.eco}</span> {data.opening.name}
        </div>
      )}
      {!myTurn && (
        <div className="mb-2 text-xs">
          Replies prepared: <span className="font-semibold">{pct(preparedShare)}</span> of games
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="w-16 font-normal">Move</th>
            <th className="w-12 text-right font-normal">%</th>
            <th className="w-16 pr-2 text-right font-normal">Games</th>
            {evaluation && <th className="w-12 pr-2 text-right font-normal">Eval</th>}
            <th className="font-normal">Result</th>
          </tr>
        </thead>
        <tbody>
          {data.moves.map((m) => {
            const n = totalGames(m)
            const inRep = repMoves.has(m.uci)
            const ev = evalByMove.get(m.uci)
            return (
              <tr
                key={m.uci}
                onClick={() => onPick(m.uci)}
                className={`cursor-pointer border-t border-line hover:bg-surface-2 ${inRep ? 'text-accent' : ''}`}
              >
                <td className="py-1 font-medium">
                  {m.san}
                  {inRep && <span title="In your repertoire"> {myTurn ? '★' : '✓'}</span>}
                </td>
                <td className="text-right">{pct(n / total)}</td>
                <td className="pr-2 text-right text-muted">{n.toLocaleString()}</td>
                {evaluation && <td className="pr-2 text-right font-mono text-xs">{ev ? formatScore(ev) : ''}</td>}
                <td>
                  <WdlBar white={m.white} draws={m.draws} black={m.black} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
