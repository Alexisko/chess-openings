// Copies the Stockfish WASM engine into public/ so it can be loaded as a Web Worker.
import { copyFileSync, mkdirSync } from 'node:fs'

const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']
mkdirSync('public/stockfish', { recursive: true })
for (const f of files) copyFileSync(`node_modules/stockfish/bin/${f}`, `public/stockfish/${f}`)
