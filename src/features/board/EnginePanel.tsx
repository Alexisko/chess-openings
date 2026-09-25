import { EvalBar } from '../../components/ui'
import { replay } from '../../lib/chess/position'
import { formatScore, type Evaluation } from '../../lib/engine/uci'

/** Evaluation bar plus the engine's best lines in SAN. */
export function EnginePanel({ evaluation, onPick }: { evaluation: Evaluation | null; onPick: (uci: string) => void }) {
  if (!evaluation) return <p className="animate-pulse text-sm text-muted">Analysing…</p>
  return (
    <div className="flex flex-col gap-2">
      <EvalBar line={evaluation.lines[0]} />
      <ul className="flex flex-col gap-1 text-sm">
        {evaluation.lines.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-12 shrink-0 rounded bg-surface-3 px-1 text-center text-xs leading-5 font-semibold tabular-nums">
              {formatScore(l)}
            </span>
            <button className="truncate text-left text-muted transition-colors hover:text-ink" onClick={() => onPick(l.pv[0])}>
              {pvToSan(evaluation.fen, l.pv)}
            </button>
          </li>
        ))}
      </ul>
      <div className="text-[10px] text-faint">
        {evaluation.source === 'cloud' ? 'Lichess cloud' : 'Stockfish 19'} · depth {evaluation.depth}
      </div>
    </div>
  )
}

function pvToSan(fen: string, pv: string[]): string {
  const out: string[] = []
  let cur = fen
  const moveNo = Number(fen.split(' ')[5] ?? 1)
  let white = fen.split(' ')[1] === 'w'
  let n = moveNo
  try {
    for (const [i, u] of pv.slice(0, 8).entries()) {
      const [m] = replay([u], cur)
      if (white) out.push(`${n}. ${m.san}`)
      else out.push(i === 0 ? `${n}... ${m.san}` : m.san)
      if (!white) n++
      white = !white
      cur = m.fen
    }
  } catch {
    // Stop at the first move we can't replay.
  }
  return out.join(' ')
}
