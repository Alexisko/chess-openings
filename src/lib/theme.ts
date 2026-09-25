import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const THEME_COLOR: Record<Theme, string> = { dark: '#140f0a', light: '#f4ebdb' }
const systemTheme = (): Theme => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')

function savedTheme(): Theme | null {
  try {
    const t = localStorage.getItem('theme')
    return t === 'light' || t === 'dark' ? t : null
  } catch {
    return null
  }
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector<HTMLMetaElement>('meta[name=theme-color]')?.setAttribute('content', THEME_COLOR[theme])
}

/** The current theme and a toggle. Follows the system until the user picks one (index.html applies it on load). */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => savedTheme() ?? systemTheme())

  useEffect(() => apply(theme), [theme])

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: light)')
    const onChange = () => savedTheme() === null && setTheme(systemTheme())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggle = () =>
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem('theme', next)
      } catch {
        // The choice then only lasts for this visit.
      }
      return next
    })
  return [theme, toggle]
}
