import { useEffect, useState } from 'react'
import { SnapshotViewer } from './SnapshotViewer'
import { CollectionSnapshotViewer } from './CollectionSnapshotViewer'
import { getShare, HostedError } from './share-hosted'
import { COLLECTION_SNAPSHOT_VERSION } from './share-snapshot'

/**
 * Recipient route for a hosted link (`/view/<slug>-<id>`). Fetches the snapshot
 * blob from the store by its id, then hands it to the SAME read-only viewers the
 * in-URL links use (they only need the decoded blob — they don't care where it
 * came from). Shows loading / not-found states; never crashes.
 * See design-docs/hosted-share-link.md.
 */
export function HostedViewer({ id }: { id: string }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'error'; gone: boolean }
    | { phase: 'ok'; v: number; blob: string }
  >({ phase: 'loading' })

  useEffect(() => {
    let alive = true
    getShare(id)
      .then((r) => {
        if (alive) setState({ phase: 'ok', v: r.v, blob: r.blob })
      })
      .catch((e) => {
        if (alive) setState({ phase: 'error', gone: e instanceof HostedError && e.status === 404 })
      })
    return () => {
      alive = false
    }
  }, [id])

  if (state.phase === 'ok') {
    return state.v === COLLECTION_SNAPSHOT_VERSION ? (
      <CollectionSnapshotViewer raw={state.blob} />
    ) : (
      <SnapshotViewer raw={state.blob} />
    )
  }

  return (
    <div className="min-h-screen grid place-items-center bg-canvas text-ink px-6">
      <div className="text-center max-w-sm">
        {state.phase === 'loading' ? (
          <>
            <div className="mx-auto mb-4 w-8 h-8 rounded-full border-2 border-border border-t-accent animate-spin" />
            <p className="text-[14px] text-ink-muted">Đang tải link chia sẻ…</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 w-12 h-12 rounded-full grid place-items-center bg-fill text-[22px]">🔗</div>
            <h1 className="text-[17px] font-bold mb-1.5">
              {state.gone ? 'Link đã hết hạn hoặc bị thu hồi' : 'Không mở được link'}
            </h1>
            <p className="text-[13.5px] text-ink-muted mb-5">
              {state.gone
                ? 'Người chia sẻ đã thu hồi, hoặc link đã quá hạn và bị dọn khỏi store.'
                : 'Không kết nối được store. Kiểm tra mạng rồi thử lại.'}
            </p>
            <a
              href="/"
              className="inline-flex items-center gap-2 rounded-[11px] px-4 py-2.5 text-[14px] font-semibold text-white brand-btn"
            >
              Mở plan-up
            </a>
          </>
        )}
      </div>
    </div>
  )
}
