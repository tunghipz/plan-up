import { useMemo, useState } from 'react'
import { Send, Check } from 'lucide-react'
import { ModalSheet } from './ModalSheet'

/**
 * Copy a sprint OR collection as plain "Tree" text for pasting into Telegram.
 * Presentational + generic: the caller supplies the subtitle, the scope options
 * (first is the "all" scope), and a `build(scopeId)` that returns the text for a
 * scope (sprint → formatSprintTree, collection → formatCollectionTree). This owns
 * scope/preview/clipboard only. See design-docs/copy-to-telegram.md.
 */

const TG_MAX = 4096

// Telegram chat palette — not app tokens (the preview mimics Telegram, not us).
const TG = {
  light: { bg: '#cfe0ee', bubble: '#effdde', ink: '#0f0f0f', meta: '#6a9c53' },
  dark: { bg: '#0e1621', bubble: '#2b5278', ink: '#ffffff', meta: '#6ab0e8' },
}

export interface CopyScope {
  id: string
  label: string
}

export function CopyTelegramModal({
  subtitle,
  scopes,
  build,
  onClose,
}: {
  subtitle: string
  /** Scope options; the first should be the "all" scope (id used by `build`). */
  scopes: CopyScope[]
  /** Builds the copy text for a given scope id. */
  build: (scopeId: string) => string
  onClose: () => void
}) {
  const [scope, setScope] = useState<string>(scopes[0]?.id ?? 'all')
  const [copied, setCopied] = useState(false)
  // Preview follows the app theme (html.dark, set by useDarkMode). Read once —
  // the theme toggle lives in the sidebar footer, not reachable while this modal
  // is open, so it can't change under us.
  const [dark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  // A scoped option could vanish between opens — fall back to the first scope.
  const activeScope = scopes.some((s) => s.id === scope) ? scope : (scopes[0]?.id ?? 'all')
  const text = useMemo(() => build(activeScope), [build, activeScope])

  const count = [...text].length
  const over = count > TG_MAX
  const theme = dark ? TG.dark : TG.light

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for insecure contexts / older webviews.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* give up silently — the preview is still selectable */
      }
      ta.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const chip = (active: boolean) =>
    `px-3 py-1 rounded-[7px] text-[12.5px] transition ${
      active
        ? 'bg-surface text-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
        : 'text-ink-muted hover:text-ink'
    }`

  return (
    <ModalSheet title="Copy cho Telegram" onClose={onClose}>
      <div className="-mt-1 flex items-center gap-2 text-[13px] text-ink-muted">
        <Send size={14} strokeWidth={1.9} className="text-accent" aria-hidden />
        {subtitle}
      </div>

      {/* Scope: whole sprint/collection or one lane/section. */}
      {scopes.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="text-[12px] text-ink-faint">Phạm vi</span>
          <div className="flex flex-wrap gap-1 bg-[var(--color-canvas-sunk)] rounded-[9px] p-1">
            {scopes.map((s) => (
              <button key={s.id} className={chip(activeScope === s.id)} onClick={() => setScope(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Telegram preview — proportional font, exactly how it pastes. Follows
          the app theme (light/dark). */}
      <div>
        <div className="mb-1.5 text-[12px] text-ink-faint">Xem trước</div>
        <div
          className="rounded-[12px] p-3 max-h-[240px] overflow-auto"
          style={{
            background: theme.bg,
            backgroundImage: `radial-gradient(${dark ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.35)'} 1px, transparent 0)`,
            backgroundSize: '20px 20px',
          }}
        >
          <div
            className="ml-auto max-w-full rounded-[12px] rounded-br-[4px] px-2.5 py-2 shadow-[0_1px_1px_rgba(0,0,0,0.14)]"
            style={{ background: theme.bubble, color: theme.ink }}
          >
            <pre
              className="m-0 whitespace-pre-wrap break-words text-[13px] leading-[1.42]"
              style={{ fontFamily: '-apple-system, "Segoe UI", system-ui, sans-serif' }}
            >
              {text}
            </pre>
            <div className="text-right text-[10px] mt-0.5" style={{ color: theme.meta }}>
              14:32 ✓✓
            </div>
          </div>
        </div>
      </div>

      {/* Footer: Copy + char count. */}
      <div className="flex items-center gap-3">
        <button
          onClick={doCopy}
          className={`flex-1 inline-flex items-center justify-center gap-2 rounded-[11px] px-4 py-2.5 text-[14px] font-semibold text-white transition active:scale-[0.98] ${
            copied ? 'bg-status-done' : 'bg-accent hover:bg-accent-hover'
          }`}
        >
          {copied ? <Check size={16} strokeWidth={2.4} /> : <Send size={15} strokeWidth={2} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <span className={`text-[11.5px] tab-data ${over ? 'text-[#ff3b30] font-semibold' : 'text-ink-faint'}`}>
          {count} / {TG_MAX}
        </span>
      </div>
    </ModalSheet>
  )
}
