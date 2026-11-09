import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { parseShareHash, COLLECTION_SNAPSHOT_VERSION } from './share-snapshot.ts'
import { suffixFromPath } from './share-hosted.ts'

// Two read-only route forks (no router — the app is single-page):
//  1. A `/view/<slug>-<id>` PATH → fetch the snapshot from the store and render
//     it (the short, updatable hosted link). See design-docs/hosted-share-link.md.
//  2. A `#v=<n>&s=…` HASH → the data is in the URL fragment itself (the offline
//     in-URL link). `v=3` = collection, else sprint. See share-link-snapshot.md.
// Neither ever seeds/opens the recipient's own data.
//
// Each branch is a dynamic import, resolved BEFORE the first render, so the
// bundler splits them into their own chunks: a link recipient never downloads
// the whole App (~480 kB), and the App never ships the viewers. One awaited
// import, then a single render — no Suspense fallback flash.
const hostedId = suffixFromPath(window.location.pathname)
const share = hostedId ? null : parseShareHash(window.location.hash)

async function loadRoot(): Promise<ReactNode> {
  if (hostedId) {
    const { HostedViewer } = await import('./HostedViewer.tsx')
    return <HostedViewer id={hostedId} />
  }
  if (share) {
    if (share.version === COLLECTION_SNAPSHOT_VERSION) {
      const { CollectionSnapshotViewer } = await import('./CollectionSnapshotViewer.tsx')
      return <CollectionSnapshotViewer raw={share.blob} />
    }
    const { SnapshotViewer } = await import('./SnapshotViewer.tsx')
    return <SnapshotViewer raw={share.blob} />
  }
  const { default: App } = await import('./App.tsx')
  return <App />
}

void loadRoot().then((root) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ConfirmProvider>{root}</ConfirmProvider>
    </StrictMode>,
  )
})
