import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmCtx, type ConfirmOpts } from './confirm-context'

/**
 * In-DNA replacement for window.confirm() (design-system §6.4 / §8 — no grey OS
 * dialog). A provider wraps <App>; `useConfirm()` (see confirm-context.ts)
 * returns an async function that resolves true/false, so call sites read
 * almost identically to the old `confirm()`:
 * `if (!(await confirm({ title, message }))) return`.
 */

type Pending = { opts: ConfirmOpts; resolve: (ok: boolean) => void }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => setPending({ opts, resolve })),
    []
  )

  // Resolve + close in one shot (functional update reads the live pending).
  const close = useCallback((ok: boolean) => {
    setPending((p) => {
      p?.resolve(ok)
      return null
    })
  }, [])

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmSheet
          opts={pending.opts}
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
        />
      )}
    </ConfirmCtx.Provider>
  )
}

function ConfirmSheet({
  opts,
  onCancel,
  onConfirm,
}: {
  opts: ConfirmOpts
  onCancel: () => void
  onConfirm: () => void
}) {
  const {
    title,
    message,
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel',
    destructive = true,
  } = opts

  const sheetRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Topmost layer (z-60) owns Escape — don't let a drawer/modal/App
        // handler underneath also close on the same keypress.
        e.stopImmediatePropagation()
        e.stopPropagation()
        onCancel()
        return
      }
      if (e.key === 'Enter') {
        // If focus sits on one of the dialog's buttons (autoFocus'd Confirm, or
        // Cancel after a Tab), let the button's own native Enter-activation
        // fire — a focused Cancel must cancel, never confirm. Only when focus
        // is elsewhere does a bare Enter mean "confirm".
        const active = document.activeElement
        if (
          active instanceof HTMLButtonElement &&
          sheetRef.current?.contains(active)
        )
          return
        e.preventDefault()
        onConfirm()
        return
      }
      // Focus trap: keep Tab within the sheet so an aria-modal dialog can't move
      // focus to background controls.
      if (e.key === 'Tab' && sheetRef.current) {
        const f = sheetRef.current.querySelectorAll<HTMLElement>('button')
        if (f.length === 0) return
        const first = f[0]
        const last = f[f.length - 1]
        const active = document.activeElement
        if (!sheetRef.current.contains(active)) {
          e.preventDefault()
          first.focus()
        } else if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])

  return (
    <div
      className="dlg-scrim fixed inset-0 bg-black/25 backdrop-blur-md flex items-center justify-center p-4 z-[60]"
      onClick={onCancel}
    >
      <div
        ref={sheetRef}
        className="dlg-sheet glass-modal text-ink rounded-[16px] w-full max-w-md p-6 space-y-3"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <h2 className="text-[19px] font-bold tracking-[-0.014em]">{title}</h2>
        {message && (
          <p className="text-[13.5px] text-ink-muted leading-relaxed">{message}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            // Destructive alerts focus the SAFE action (Apple idiom) so a
            // reflexive Enter/Space can never delete.
            autoFocus={destructive}
            onClick={onCancel}
            className="px-3.5 py-1.5 text-sm font-medium text-ink-muted hover:bg-surface-hover rounded-[8px] transition"
          >
            {cancelLabel}
          </button>
          <button
            autoFocus={!destructive}
            onClick={onConfirm}
            className={`px-4 py-1.5 text-sm font-medium text-white rounded-[8px] transition ${
              destructive
                ? 'bg-overdue hover:bg-overdue/90'
                : 'brand-btn'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
