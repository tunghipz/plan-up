import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Preview box for the export modals: scales a fixed-width card (down or up)
 * so it exactly fits the available width, instead of a hard-coded zoom that
 * drifts whenever card/modal widths change (design-docs/export-png.md).
 * Upscaling is fine — `zoom` re-rasterizes the DOM, no blur.
 * `zoom` (not transform) so the scaled box reflows and the modal sizes to it;
 * height still caps at 52vh with scroll for long exports.
 */
export function ScaledPreview({
  cardWidth,
  children,
}: {
  cardWidth: number
  children: React.ReactNode
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setScale(el.clientWidth / cardWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cardWidth])

  return (
    <div
      ref={boxRef}
      className="rounded-[12px] border border-border-hair bg-canvas overflow-auto max-h-[52vh]"
    >
      {scale > 0 && <div style={{ zoom: scale }}>{children}</div>}
    </div>
  )
}
