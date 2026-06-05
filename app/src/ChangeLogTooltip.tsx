import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { History } from 'lucide-react'
import type { ChangeLogEntry, LoggableField } from './db'
import {
  STATUS_LABEL,
  PRIORITY_LABEL,
  FIELD_LABEL,
  formatShortDate,
  formatRelativeTime,
  formatTimestamp,
} from './lib'

/**
 * Per-task change log surface (design-docs/task-change-log.md): a hover-revealed
 * 🕒 icon whose tooltip lists the 5 most recent edits, newest-first. Renders
 * nothing when the log is empty (no empty tooltip).
 *
 * The tooltip is portalled to <body> with position:fixed so it escapes the
 * card/column `overflow` clipping that would otherwise cut it off; it flips
 * above the icon when there isn't room below. Stable fields are formatted here
 * at render; only assigneeId arrives pre-resolved to a member name.
 */

/** Format a raw entry value for display. `assigneeId` is already a name. */
function formatValue(field: LoggableField, v: string | null): string {
  if (v === null) return '—'
  switch (field) {
    case 'status':
      return STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? v
    case 'priority':
      return PRIORITY_LABEL[v as keyof typeof PRIORITY_LABEL] ?? v
    case 'startDate':
    case 'dueDate':
      return formatShortDate(v)
    default:
      return v // title, estimate (stringified number), assigneeId (name)
  }
}

export function ChangeLogTooltip({ entries }: { entries?: ChangeLogEntry[] }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  // Measure after the popover mounts (hidden), then place it: below the icon by
  // default, flipped above if it would overflow the viewport bottom; right edge
  // aligned to the icon, clamped to the viewport.
  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    const a = anchorRef.current?.getBoundingClientRect()
    const p = popRef.current?.getBoundingClientRect()
    if (!a || !p) return
    const m = 6
    let top = a.bottom + 4
    if (top + p.height + m > window.innerHeight) {
      top = Math.max(m, a.top - p.height - 4)
    }
    const left = Math.max(m, Math.min(a.right - p.width, window.innerWidth - p.width - m))
    setCoords({ top, left })
  }, [open])

  if (!entries || entries.length === 0) return null

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Lịch sử thay đổi"
        className="grid place-items-center text-ink-faint hover:text-ink-muted transition-colors focus:outline-none"
      >
        <History size={13} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="tooltip"
            style={{
              position: 'fixed',
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              visibility: coords ? 'visible' : 'hidden',
            }}
            className="z-[100] w-max max-w-[300px] rounded-lg border border-border-hair bg-surface px-2.5 py-2 text-left shadow-[0_4px_14px_rgba(0,0,0,0.16)]"
          >
            {entries.map((e, i) => (
              <span
                key={i}
                title={formatTimestamp(e.ts)}
                className="flex items-baseline gap-1.5 whitespace-nowrap py-0.5 text-[11.5px] leading-snug"
              >
                <span className="text-ink-muted">{FIELD_LABEL[e.field]}:</span>
                <span className="text-ink">
                  {formatValue(e.field, e.from)} → {formatValue(e.field, e.to)}
                </span>
                <span className="text-ink-faint">· {formatRelativeTime(e.ts)}</span>
              </span>
            ))}
          </div>,
          document.body
        )}
    </span>
  )
}
