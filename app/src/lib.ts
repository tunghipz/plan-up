import { useEffect, useState } from 'react'

const MS = 86400_000

function dayDiff(dateStr: string): number {
  const a = new Date()
  a.setHours(0, 0, 0, 0)
  const b = new Date(dateStr)
  b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / MS)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Format as dd/mm/yy — unambiguous, locale-independent. */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${pad2(
    d.getFullYear() % 100
  )}`
}

export function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return ''
  return formatShortDate(dateStr)
}

export function isOverdue(dateStr: string | null, isDone: boolean): boolean {
  if (!dateStr || isDone) return false
  return dayDiff(dateStr) < 0
}

export function formatSprintRange(start: string, end: string): string {
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
