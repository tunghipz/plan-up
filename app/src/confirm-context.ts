import { createContext, useContext } from 'react'

// Context + hook live apart from ConfirmDialog.tsx so that file only exports
// components (Vite fast-refresh) — the provider imports ConfirmCtx from here.

export type ConfirmOpts = {
  title: string
  /** What the action hits, shown in ink under the title (e.g. `“build 3” and 2 more`). */
  subject?: string
  /** Secondary note, small and muted (consequence / "can't be undone"). */
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red action button + emphasis (delete/replace). Defaults to true. */
  destructive?: boolean
  /** Glyph above the title. Defaults to 'warning' when destructive, else 'none'. */
  icon?: 'trash' | 'warning' | 'none'
}

export const ConfirmCtx = createContext<(opts: ConfirmOpts) => Promise<boolean>>(
  async () => false
)

export const useConfirm = () => useContext(ConfirmCtx)
