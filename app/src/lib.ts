import { useEffect, useState } from 'react'

const MS = 86400_000

function dayDiff(dateStr: string): number {
  const a = new Date()
  a.setHours(0, 0, 0, 0)
  const b = new Date(dateStr)
  b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / MS)
}

// (dd/mm/yy padding helper removed in v2 — dates now render as `MMM d`.)
const MON = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Format as `MMM d` (Cupertino DNA) — e.g. "May 19". Locale-independent
 * (fixed English month abbreviations) so it reads the same on every machine. */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${MON[d.getMonth()]} ${d.getDate()}`
}

export function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return ''
  return formatShortDate(dateStr)
}

export function isOverdue(dateStr: string | null, isDone: boolean): boolean {
  if (!dateStr || isDone) return false
  return dayDiff(dateStr) < 0
}

/** `MMM d – d` when same month, else `MMM d – MMM d`. */
export function formatSprintRange(start: string, end: string): string {
  const a = new Date(start)
  const b = new Date(end)
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${MON[a.getMonth()]} ${a.getDate()} – ${b.getDate()}`
  }
  return `${formatShortDate(start)} – ${formatShortDate(end)}`
}

export function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem('plan-tmp:dark')
    if (stored !== null) return stored === '1'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('plan-tmp:dark', dark ? '1' : '0')
  }, [dark])

  return [dark, setDark] as const
}
