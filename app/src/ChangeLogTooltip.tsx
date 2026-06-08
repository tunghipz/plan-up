import { Fragment, useLayoutEffect, useRef, useState } from 'react'
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
 * nothing when the log is empty.
 *
 * Layout = "aligned ledger + semantic cues" (chosen 2026-06-05 over plain lines):
 * a 3-column grid [right-aligned field label · old→new change · faint time] so
 * values line up and old (faint) vs new (strong) reads at a glance. Two semantic
 * cues carry extra meaning without extra chrome:
 *   - status/priority: the NEW value is tinted its Reminders/priority color
 *   - dependsOn: empty→set is "+ 7" (add), set→empty is a struck removal;
 *     a set→set change stays a normal old→new.
 *
 * Portalled to <body> (position:fixed) so it escapes card/column overflow
 * clipping; flips above the icon when near the viewport bottom.
 */

/** Display text for a raw entry value. `assigneeId` is already a member name. */
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
      return v // title, estimate (stringified), dependsOn (seq label), assignee (name)
  }
}

/** CSS color for the NEW value, when the field carries a semantic color. */
function newValueColor(field: LoggableField, to: string): string | undefined {
  if (field === 'status')
    return `var(--color-status-${to === 'in_progress' ? 'progress' : to})`
  if (field === 'priority')
    return to === 'urgent' || to === 'high'
      ? `var(--color-priority-${to})`
      : undefined
  return undefined
}

function ChangeText({ e }: { e: ChangeLogEntry }) {
  // dependsOn: lean on add/remove when one side is the empty set.
  if (e.field === 'dependsOn') {
    if (e.from === null && e.to !== null)
      return (
        <span style={{ color: 'var(--color-status-done)' }} className="font-medium">
          + {e.to}
        </span>
      )
    if (e.to === null && e.from !== null)
      return <span className="text-ink-faint line-through">{e.from}</span>
  }
  const oldText = formatValue(e.field, e.from)
  const newColor = e.to !== null ? newValueColor(e.field, e.to) : undefined
  return (
    <>
      <span className="text-ink-faint">{oldText}</span>
      <span className="text-ink-faint mx-1">→</span>
      <span className="font-medium text-ink" style={newColor ? { color: newColor } : undefined}>
        {formatValue(e.field, e.to)}
      </span>
    </>
  )
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
        aria-label="Change history"
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
            className="z-[100] w-max max-w-[320px] rounded-xl border border-border-hair bg-surface px-3 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]"
          >
            <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-2.5 gap-y-0.5">
              {entries.map((e) => (
                // Stable key: at most one entry per field per write (same ts),
                // so ts+field is unique — beats index keys when the log updates
                // live while the tooltip is open.
                <Fragment key={`${e.ts}-${e.field}`}>
                  <span className="text-right text-[11px] text-ink-muted whitespace-nowrap">
                    {FIELD_LABEL[e.field]}
                  </span>
                  <span className="text-[12px] whitespace-nowrap">
                    <ChangeText e={e} />
                  </span>
                  <span
                    title={formatTimestamp(e.ts)}
                    className="text-right text-[10.5px] text-ink-faint whitespace-nowrap pl-1.5"
                  >
                    {formatRelativeTime(e.ts)}
                  </span>
                </Fragment>
              ))}
            </div>
          </div>,
          document.body
        )}
    </span>
  )
}
