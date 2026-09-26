/**
 * Sound effects, from Lichess (see the README for credits). Played through Web
 * Audio, which starts without the delay <audio> has on phones. Whether sound is
 * on and how loud are kept per device.
 */

export type SoundName = 'move' | 'capture' | 'wrong' | 'line-complete' | 'session-complete'

const NAMES: SoundName[] = ['move', 'capture', 'wrong', 'line-complete', 'session-complete']

export interface SoundPrefs {
  enabled: boolean
  /** 0 to 1. */
  volume: number
}

let prefs = readPrefs()
let ctx: AudioContext | undefined
const buffers = new Map<SoundName, AudioBuffer>()

function readPrefs(): SoundPrefs {
  try {
    const volume = Number(localStorage.getItem('soundVolume') ?? 0.7)
    return { enabled: localStorage.getItem('sound') !== 'off', volume: volume >= 0 && volume <= 1 ? volume : 0.7 }
  } catch {
    return { enabled: true, volume: 0.7 }
  }
}

export function soundPrefs(): SoundPrefs {
  return prefs
}

export function setSoundPrefs(next: Partial<SoundPrefs>) {
  prefs = { ...prefs, ...next }
  try {
    localStorage.setItem('sound', prefs.enabled ? 'on' : 'off')
    localStorage.setItem('soundVolume', String(prefs.volume))
  } catch {
    // Preference is optional.
  }
}

/** Browsers only let audio start after a user gesture: unlock it on the first one. */
export function initSound() {
  const unlock = () => {
    if (!ctx) {
      ctx = new AudioContext()
      void load(ctx)
    }
    // Also after the page was in the background, which can suspend it again.
    if (ctx.state !== 'running') void ctx.resume()
  }
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
    window.addEventListener(type, unlock, { capture: true, passive: true })
  }
}

async function load(ac: AudioContext) {
  await Promise.all(
    NAMES.map(async (name) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}sound/${name}.mp3`)
        buffers.set(name, await ac.decodeAudioData(await res.arrayBuffer()))
      } catch {
        // Without the file, that sound stays silent.
      }
    }),
  )
}

export function playSound(name: SoundName) {
  const buffer = buffers.get(name)
  if (!prefs.enabled || !ctx || ctx.state !== 'running' || !buffer) return
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const gain = ctx.createGain()
  gain.gain.value = prefs.volume
  source.connect(gain).connect(ctx.destination)
  source.start()
}
