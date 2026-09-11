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
