import { useRef, useState } from 'react'
import { Check, Copy, Download, Loader2 } from 'lucide-react'
import { ModalSheet } from './ModalSheet'
import { PngExportCard } from './PngExportCard'
import type { MemberGroup } from './png-export'
import {
  canCopyImage,
  copyPngToClipboard,
  downloadPng,
  pngFilename,
  renderNodeToPng,
} from './png-export'

/**
 * Preview + Copy/Download for the shareable task image (design-docs/export-png.md).
 * Renders the card TWICE: a scaled-down preview (via `zoom`) and a full-size
 * off-screen node that `modern-screenshot` captures. The off-screen node stays
 * laid out (not `display:none`) so the screenshot has real geometry.
 */
export function ExportImageModal({
  projectName,
  viewName,
  groups,
  today,
  onClose,
}: {
  projectName: string
  viewName: string
  groups: MemberGroup[]
  today: string
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<'copy' | 'download' | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copyAvailable = canCopyImage()

  const filename = pngFilename(viewName, today)

  async function handleCopy() {
    if (!cardRef.current || busy) return
    setBusy('copy')
    setError(null)
    const ok = await copyPngToClipboard(cardRef.current)
    setBusy(null)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      setError('Trình duyệt không cho copy ảnh — dùng Download.')
    }
  }

  async function handleDownload() {
    if (!cardRef.current || busy) return
    setBusy('download')
    setError(null)
    try {
      const dataUrl = await renderNodeToPng(cardRef.current)
      downloadPng(dataUrl, filename)
    } catch {
      setError('Không tạo được ảnh. Thử lại nhé.')
    } finally {
      setBusy(null)
    }
  }

  const card = (ref?: React.Ref<HTMLDivElement>) => (
    <PngExportCard
      ref={ref}
      projectName={projectName}
      viewName={viewName}
      groups={groups}
      today={today}
    />
  )

  return (
    <ModalSheet title="Export as image" onClose={onClose}>
      <p className="text-[13px] text-ink-muted -mt-1">
        Ảnh tổng hợp task theo từng người — copy dán thẳng vào chat, hoặc tải về.
      </p>

      {/* Scaled preview (zoom reflows the box so the modal doesn't overflow). */}
      <div className="rounded-[12px] border border-border-hair bg-canvas overflow-auto max-h-[52vh]">
        <div style={{ zoom: 0.56 }}>{card()}</div>
      </div>

      {error && <p className="text-[12.5px] text-overdue">{error}</p>}

      <div className="flex items-center gap-2 justify-end pt-1">
        {copyAvailable && (
          <button
            onClick={handleCopy}
            disabled={busy !== null}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[9px] text-[13px] font-medium text-ink bg-surface-hover hover:bg-border-hair transition disabled:opacity-50"
          >
            {busy === 'copy' ? (
              <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
            ) : copied ? (
              <Check size={14} className="text-status-done" />
            ) : (
              <Copy size={14} />
            )}
            {copied ? 'Copied' : 'Copy image'}
          </button>
        )}
        <button
          onClick={handleDownload}
          disabled={busy !== null}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-[9px] text-[13px] font-semibold text-white bg-accent hover:bg-accent-hover transition disabled:opacity-50"
        >
          {busy === 'download' ? (
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Download size={14} />
          )}
          Download PNG
        </button>
      </div>

      {/* Full-size capture node — off-screen but laid out. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: -99999,
          top: 0,
          pointerEvents: 'none',
        }}
      >
        {card(cardRef)}
      </div>
    </ModalSheet>
  )
}
