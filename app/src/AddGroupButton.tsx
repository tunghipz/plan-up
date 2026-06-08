import type { LucideIcon } from 'lucide-react'

/**
 * Shared "add a new group" affordance (design-system §5.11). Appends a new
 * group-card to a card-per-group list — Collection "Add table", Sprint "Add member".
 *
 * A full-width dashed slot (reads as "a card will appear here") that stays calm and
 * gray at rest and turns accent only on hover — accent is a signal of intent, not
 * chrome (§2.1). Radius matches the group card (14px), not a toolbar button, because
 * it is a placeholder for the card it creates. One source of truth so the two call
 * sites can never drift apart again.
 */
export function AddGroupButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-center gap-1.5 py-2.5 text-[13px] font-semibold text-ink-muted border border-dashed border-border rounded-[14px] transition hover:text-accent hover:border-accent/40 hover:bg-accent-soft"
    >
      <Icon size={14} strokeWidth={2} />
      {label}
    </button>
  )
}
