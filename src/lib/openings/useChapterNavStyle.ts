import { useState } from 'react'

/** How chapters are browsed: an outline panel, or a menu in the lines header (both offered while trying them out). */
export type ChapterNavStyle = 'list' | 'menu'

export function useChapterNavStyle(): [ChapterNavStyle, (s: ChapterNavStyle) => void] {
  const [style, setStyle] = useState<ChapterNavStyle>(() => {
    try {
      return localStorage.getItem('chapterNav') === 'menu' ? 'menu' : 'list'
    } catch {
      return 'list'
    }
  })
  const set = (s: ChapterNavStyle) => {
    setStyle(s)
    try {
      localStorage.setItem('chapterNav', s)
    } catch {
      // Preference is optional.
    }
  }
  return [style, set]
}
