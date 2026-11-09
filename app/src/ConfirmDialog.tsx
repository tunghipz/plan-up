import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { ConfirmCtx, type ConfirmOpts } from './confirm-context'

/**
 * In-DNA replacement for window.confirm() (design-system §6.4 / §8 — no grey OS
 * dialog). A compact macOS-style alert: 284px, solid surface, centred text,
 * two equal buttons, a light scrim with no blur (direction A of
 * demo/confirm-dialog.html). A provider wraps <App>; `useConfirm()` (see confirm-context.ts)
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
    subject,
    message,
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel',
    destructive = true,
    icon = destructive ? 'warning' : 'none',
  } = opts
  const Glyph = icon === 'trash' ? Trash2 : icon === 'warning' ? AlertTriangle : null

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
      className="dlg-scrim fixed inset-0 bg-black/20 dark:bg-black/40 flex items-center justify-center p-4 z-[60]"
      onClick={onCancel}
    >
      <div
        ref={sheetRef}
        className="dlg-sheet w-[284px] max-w-full rounded-[14px] bg-surface text-ink text-center px-4 pt-5 pb-4 shadow-[0_24px_60px_rgba(0,0,0,0.22),0_0_0_0.5px_rgba(0,0,0,0.08)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.55),0_0_0_0.5px_rgba(255,255,255,0.1)]"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={subject || message ? 'confirm-desc' : undefined}
      >
        {Glyph && (
          <div
            aria-hidden
            className="mx-auto mb-2.5 flex h-10 w-10 items-center justify-center rounded-full text-overdue"
            style={{ background: 'color-mix(in srgb, var(--color-overdue) 12%, transparent)' }}
          >
            <Glyph size={18} strokeWidth={2} />
          </div>
        )}
        <h2 id="confirm-title" className="text-[15px] font-semibold tracking-[-0.01em] text-balance">
          {title}
        </h2>
        {(subject || message) && (
          <div id="confirm-desc">
            {subject && (
              <p className="mt-1.5 text-[13px] text-ink break-words text-pretty">{subject}</p>
            )}
            {message && (
              <p className="mt-1.5 text-[12.5px] leading-snug text-ink-muted text-pretty">{message}</p>
            )}
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            // Destructive alerts focus the SAFE action (Apple idiom) so a
            // reflexive Enter/Space can never delete.
            autoFocus={destructive}
            onClick={onCancel}
            className="h-8 rounded-[9px] bg-fill text-[13.5px] font-medium text-ink transition hover:bg-surface-hover outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {cancelLabel}
          </button>
          <button
            autoFocus={!destructive}
            onClick={onConfirm}
            className={`h-8 rounded-[9px] text-[13.5px] font-medium text-white transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
              destructive ? 'bg-overdue hover:bg-overdue/90' : 'brand-btn'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
