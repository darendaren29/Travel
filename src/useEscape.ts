import { useEffect } from 'react'

/** Call `onEscape` when Esc is pressed anywhere (dialogs, the editor panel); `enabled` false ignores it. */
export function useEscape(onEscape: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // Let an open <select> / datalist close itself first.
      const el = document.activeElement as HTMLElement | null
      if (el?.tagName === 'SELECT') return
      e.preventDefault()
      onEscape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape, enabled])
}
