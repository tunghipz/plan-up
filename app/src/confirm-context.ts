import { createContext, useContext } from 'react'

// Context + hook live apart from ConfirmDialog.tsx so that file only exports
// components (Vite fast-refresh) — the provider imports ConfirmCtx from here.

export type ConfirmOpts = {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red action button + emphasis (delete/replace). Defaults to true. */
  destructive?: boolean
}

export const ConfirmCtx = createContext<(opts: ConfirmOpts) => Promise<boolean>>(
  async () => false
)

export const useConfirm = () => useContext(ConfirmCtx)
