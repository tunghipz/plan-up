import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'

export interface SheetAction {
  label: string
  Icon: LucideIcon
  onSelect: () => void
  /** Small grey second line (e.g. the project name for "Export this project"). */
  detail?: string
  disabled?: boolean
}

/**
 * iOS-style action sheet for phone width — the toolbar's `⋯` menu holds the
 * actions that don't fit the capsule (design-docs/mobile-layout.md "Shell").
 * Two stacked groups pinned to the bottom edge: the actions, then a separate
 * Cancel. Scrim click / Escape / Cancel close it; picking an action closes it
 * BEFORE running the action so a dialog the action opens isn't stacked under
 * the sheet.
 */
export function MobileActionSheet({
  title,
  actions,
  onClose,
}: {
  title?: string
  actions: SheetAction[]
  onClose: () => void
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  // Latest onClose without re-running the effect: callers pass an inline arrow,
  // and re-focusing the sheet on every parent render would be wrong.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    sheetRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return createPortal(
    <div className="dlg-scrim fixed inset-0 z-50 bg-black/30" onClick={onClose}>
      <div
        ref={sheetRef}
        role="menu"
        aria-label={title ?? 'Actions'}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="action-sheet absolute inset-x-2 bottom-2 outline-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="rounded-[14px] bg-surface overflow-hidden">
          {title && (
            <div className="px-4 py-3 text-center text-[12.5px] text-ink-muted border-b border-border-hair">
              {title}
            </div>
          )}
          {actions.map(({ label, Icon, onSelect, detail, disabled }, i) => (
            <button
              key={label}
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                onClose()
                onSelect()
              }}
              className={`w-full flex items-center gap-3.5 min-h-[54px] px-4 text-left text-accent active:bg-surface-hover disabled:opacity-40 ${
                i ? 'border-t border-border-hair' : ''
              }`}
            >
              <Icon size={20} strokeWidth={1.9} className="shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[16.5px]">{label}</span>
                {detail && (
                  <span className="block text-[12.5px] text-ink-muted truncate">{detail}</span>
                )}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-2 w-full min-h-[54px] rounded-[14px] bg-surface text-[16.5px] font-semibold text-accent active:bg-surface-hover"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  )
}
