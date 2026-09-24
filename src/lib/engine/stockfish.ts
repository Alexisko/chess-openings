import { parseInfo, toPvLine, type Evaluation, type PvLine } from './uci'

const ENGINE_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`

type Listener = (e: Evaluation) => void

/**
 * Thin wrapper around the Stockfish WASM worker. One analysis runs at a time;
 * starting a new one stops the previous search.
 */
export class Stockfish {
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private generation = 0
  private idle: Promise<void> = Promise.resolve()

  private boot(): Promise<void> {
    if (this.ready) return this.ready
    this.worker = new Worker(ENGINE_URL)
    this.ready = new Promise((resolve) => {
      const onMsg = (e: MessageEvent) => {
        if (String(e.data) === 'readyok') {
          this.worker!.removeEventListener('message', onMsg)
          resolve()
        }
      }
      this.worker!.addEventListener('message', onMsg)
      this.worker!.postMessage('uci')
      this.worker!.postMessage('setoption name Hash value 32')
      this.worker!.postMessage('isready')
    })
    return this.ready
  }

  /** Analyses a position, streaming results. Resolves with the final evaluation. */
  async analyse(fen: string, opts: { depth: number; multiPv: number }, onUpdate?: Listener): Promise<Evaluation | null> {
    const gen = ++this.generation
    this.stopSearch()
    await this.idle
    await this.boot()
    if (gen !== this.generation) return null
    const worker = this.worker!

    let finish!: () => void
    this.idle = new Promise((r) => (finish = r))
    const lines = new Map<number, PvLine>()
    let depth = 0

    return new Promise((resolve) => {
      const onMsg = (e: MessageEvent) => {
        const text = String(e.data)
        const info = parseInfo(text)
        if (info) {
          if (info.multipv === 1 && info.depth > depth) {
            depth = info.depth
            for (const k of [...lines.keys()]) if (k > 1) lines.delete(k)
          }
          lines.set(info.multipv, toPvLine(fen, info))
          if (gen === this.generation && info.multipv === lines.size && onUpdate) onUpdate(this.snapshot(fen, depth, lines))
        } else if (text.startsWith('bestmove')) {
          worker.removeEventListener('message', onMsg)
          finish()
          resolve(gen === this.generation ? this.snapshot(fen, depth, lines) : null)
        }
      }
      worker.addEventListener('message', onMsg)
      worker.postMessage(`setoption name MultiPV value ${opts.multiPv}`)
      worker.postMessage(`position fen ${fen}`)
      worker.postMessage(`go depth ${opts.depth}`)
    })
  }

  private snapshot(fen: string, depth: number, lines: Map<number, PvLine>): Evaluation {
    const sorted = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l)
    return { fen, depth, lines: sorted, source: 'local' }
  }

  stopSearch() {
    this.worker?.postMessage('stop')
  }

  stop() {
    this.generation++
    this.stopSearch()
  }
}

export const stockfish = new Stockfish()
