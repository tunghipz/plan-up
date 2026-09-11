import { createPortal } from 'react-dom'
import type { Mark } from './rich-text'
import { parseRich } from './rich-text'

const CLASS: Record<Mark, string> = {
  bold: 'font-semibold',
  italic: 'italic',
  strike: 'line-through decoration-[1.5px]',
  mark: 'rounded-[3px] px-[3px] py-[1px] mx-[-1px]',
}

/**
 * Render a title with its inline formatting. Pure spans — no dangerouslySetInnerHTML,
 * so a shared snapshot can never smuggle markup in through a title.
 */
export function RichText({ text }: { text: string }) {
  const segs = parseRich(text ?? '')
  if (segs.length === 1 && segs[0].marks.length === 0) return <>{segs[0].text}</>
  return (
    <>
      {segs.map((s, i) =>
        s.marks.length === 0 ? (
          <span key={i}>{s.text}</span>
        ) : (
          <span
            key={i}
            className={s.marks.map((m) => CLASS[m]).join(' ')}
            // Token defined per theme in index.css — a literal colour here would
            // glare on the dark canvas.
            style={s.marks.includes('mark') ? { background: 'var(--color-highlight)' } : undefined}
          >
            {s.text}
          </span>
        )
      )}
    </>
  )
}

/** Buttons, in the order they appear in the bubble. */
const BUBBLE: { mark: Mark; label: string; cls: string; title: string }[] = [
  { mark: 'bold', label: 'B', cls: 'font-bold', title: 'Bold  ⌘B' },
  { mark: 'italic', label: 'I', cls: 'italic font-serif', title: 'Italic  ⌘I' },
  { mark: 'strike', label: 'S', cls: 'line-through', title: 'Strikethrough  ⌘⇧X' },
  { mark: 'mark', label: 'H', cls: '', title: 'Highlight  ⌘⇧H' },
]

/**
 * Floating B / I / S / H toolbar shown above a selection made on a resting
 * (formatted) title. The mouse-first counterpart to the keyboard shortcuts —
 * without it nothing on screen says a title can be formatted at all.
 * See design-docs/task-rich-text.md.
 */
export function FormatBubble({
  rect,
  active,
  onToggle,
}: {
  /** Viewport rect of the current selection. */
  rect: DOMRect
  /** Marks that cover the whole selection — those buttons read as pressed. */
  active: Mark[]
  onToggle: (mark: Mark) => void
}) {
  const W = 4 * 30 + 8
  const top = rect.top - 40
  return createPortal(
    <div
      data-format-bubble
      role="toolbar"
      aria-label="Format selection"
      className="fixed z-[70] flex items-center gap-0.5 p-1 rounded-[10px] glass-popover"
      style={{
        // Flip below the selection when the bubble would clip the viewport top.
        top: top < 8 ? rect.bottom + 8 : top,
        left: Math.max(8, Math.min(window.innerWidth - W - 8, rect.left + rect.width / 2 - W / 2)),
        width: W,
      }}
      // Keep the selection alive: a plain mousedown here would collapse it
      // before the click handler ever runs.
      onMouseDown={(e) => e.preventDefault()}
    >
      {BUBBLE.map((b) => {
        const on = active.includes(b.mark)
        return (
          <button
            key={b.mark}
            type="button"
            title={b.title}
            aria-pressed={on}
            onClick={() => onToggle(b.mark)}
            className={`w-[30px] h-[26px] rounded-[7px] text-[13px] leading-none transition ${b.cls} ${
              on ? 'bg-accent text-white' : 'text-ink hover:bg-fill'
            }`}
            style={
              b.mark === 'mark' && !on ? { background: 'var(--color-highlight)' } : undefined
            }
          >
            {b.label}
          </button>
        )
      })}
    </div>,
    document.body
  )
}
