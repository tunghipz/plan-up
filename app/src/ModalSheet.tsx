/**
 * Center-modal shell — the ONE dlg-scrim/dlg-sheet idiom (design-system §6.5
 * scale-fade motion, §6.4 in-DNA dialogs): dimmed blurred scrim (click
 * closes), white sheet (clicks stop), 19px bold title, `space-y-4` body.
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
  return (
    <div
      className="dlg-scrim fixed inset-0 bg-black/25 backdrop-blur-md flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="dlg-sheet bg-surface text-ink rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.28)] w-full max-w-md p-6 space-y-4 border border-border-hair"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[19px] font-bold tracking-[-0.014em]">{title}</h2>
        {children}
      </div>
    </div>
  )
}
