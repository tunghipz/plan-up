import { useEffect, useRef } from 'react'

/**
 * Center-modal shell — the ONE dlg-scrim/dlg-sheet idiom (design-system §6.5
 * scale-fade motion, §6.4 in-DNA dialogs): dimmed blurred scrim (click
 * closes), white sheet (clicks stop), 19px bold title, `space-y-4` body.
 * Owns the overlay keyboard contract (§6.5 amendment 2026-07-07): Escape
 * closes (top layer only — yields to a stacked ConfirmDialog), the sheet is a
 * `role="dialog"` and takes initial focus so Esc works immediately.
 * Used by every "New …" sheet and the collections NameModal. Deliberately NOT
 * used by: SearchPalette (top-aligned, wider, zero-padding shell) and
 * ConfirmDialog (alertdialog role + focus trap + z-[60] stacking) — different
 * contracts, same motion classes.
 */
export function ModalSheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Focus the sheet so Esc works without a click and SR context is the dialog.
    // Skip if the body already focused something (e.g. an autoFocus input).
    if (!sheetRef.current?.contains(document.activeElement)) {
      sheetRef.current?.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A ConfirmDialog stacked above (z-60) owns Escape — don't double-close.
      if (document.querySelector('[role="alertdialog"]')) return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="dlg-scrim fixed inset-0 bg-black/25 backdrop-blur-md flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="dlg-sheet bg-surface text-ink rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.28)] w-full max-w-md p-6 space-y-4 border border-border-hair outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[19px] font-bold tracking-[-0.014em]">{title}</h2>
        {children}
      </div>
    </div>
  )
}
