import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { SnapshotViewer } from './SnapshotViewer.tsx'
import { CollectionSnapshotViewer } from './CollectionSnapshotViewer.tsx'
import { HostedViewer } from './HostedViewer.tsx'
import { parseShareHash, COLLECTION_SNAPSHOT_VERSION } from './share-snapshot.ts'
import { suffixFromPath } from './share-hosted.ts'

// Two read-only route forks (no router — the app is single-page):
//  1. A `/view/<slug>-<id>` PATH → fetch the snapshot from the store and render
//     it (the short, updatable hosted link). See design-docs/hosted-share-link.md.
//  2. A `#v=<n>&s=…` HASH → the data is in the URL fragment itself (the offline
//     in-URL link). `v=3` = collection, else sprint. See share-link-snapshot.md.
// Neither ever seeds/opens the recipient's own data.
const hostedId = suffixFromPath(window.location.pathname)
const share = hostedId ? null : parseShareHash(window.location.hash)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      {hostedId ? (
        <HostedViewer id={hostedId} />
      ) : share ? (
        share.version === COLLECTION_SNAPSHOT_VERSION ? (
          <CollectionSnapshotViewer raw={share.blob} />
        ) : (
          <SnapshotViewer raw={share.blob} />
        )
      ) : (
        <App />
      )}
    </ConfirmProvider>
  </StrictMode>,
)
