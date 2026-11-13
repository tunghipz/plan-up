import { useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Segmented control (macOS style): `List · Board · Timeline` on the top bar, and
 * the List's own `Group by  By member · All` row (design-docs/list-view.md
 * "Chỗ đặt toggle").
 */
export function ViewToggle<T extends string>({
  value,
  options,
  onChange,
  fill = false,
}: {
  value: T
  options: { value: T; label: string; Icon: LucideIcon; title?: string }[]
  onChange: (v: T) => void
  /** Stretch to the parent's width, equal segments, 36px tall (mobile row —
   * design-docs/mobile-layout.md). */
  fill?: boolean
}) {
  // Sliding white indicator (macOS segmented control): measure the active
  // segment after layout and glide the pill to it, instead of swapping a
  // per-button background. Re-measures on value/options change.
  const ref = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current?.querySelector<HTMLElement>(`[data-seg="${value}"]`)
      if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    // A filled toggle's segments change width with the viewport (rotation).
    if (!fill) return
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [value, options, fill])
  return (
    <div
      ref={ref}
      className={`relative items-center gap-0.5 p-0.5 rounded-[9px] bg-fill ${
        fill ? 'flex w-full' : 'inline-flex'
      }`}
    >
      {ind && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 rounded-[7px] bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)] transition-[left,width] duration-[280ms] ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none"
          style={{ left: ind.left, width: ind.width }}
        />
      )}
      {options.map(({ value: v, label, Icon, title }) => {
        const active = value === v
        return (
          <button
            key={v}
            data-seg={v}
            onClick={() => onChange(v)}
            className={`relative z-10 flex items-center gap-1.5 px-3 font-medium rounded-[7px] transition-colors ${
              fill ? 'flex-1 justify-center min-h-9 text-[13.5px]' : 'py-1 text-xs'
            } ${
              active ? 'text-ink' : 'text-ink-muted hover:text-ink'
            }`}
            title={title ?? `${label} view`}
            aria-pressed={active}
          >
            <Icon size={13} strokeWidth={active ? 2 : 1.75} />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
