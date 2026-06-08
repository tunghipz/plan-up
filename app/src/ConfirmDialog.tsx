import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/**
 * In-DNA replacement for window.confirm() (design-system §6.4 / §8 — no grey OS
 * dialog). A provider wraps <App>; `useConfirm()` returns an async function that
 * resolves true/false, so call sites read almost identically to the old
 * `confirm()`:  `if (!(await confirm({ title, message }))) return`.
 */

export type ConfirmOpts = {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red action button + emphasis (delete/replace). Defaults to true. */
  destructive?: boolean
}

type Pending = { opts: ConfirmOpts; resolve: (ok: boolean) => void }

const ConfirmCtx = createContext<(opts: ConfirmOpts) => Promise<boolean>>(
  async () => false
)

export const useConfirm = () => useContext(ConfirmCtx)

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
        onCancel()
        return
      }
      if (e.key === 'Enter') {
        // preventDefault stops the autoFocus'd confirm button's own native
        // Enter-activation from ALSO firing — without it onConfirm runs twice
        // (idempotent today, but a latent footgun).
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
        className="dlg-sheet bg-surface text-ink rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.28)] w-full max-w-md p-6 space-y-3 border border-border-hair"
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
            onClick={onCancel}
            className="px-3.5 py-1.5 text-sm font-medium text-ink-muted hover:bg-surface-hover rounded-[8px] transition"
          >
            {cancelLabel}
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            className={`px-4 py-1.5 text-sm font-medium text-white rounded-[8px] transition ${
              destructive
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
