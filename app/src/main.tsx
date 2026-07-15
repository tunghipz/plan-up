import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { SnapshotViewer } from './SnapshotViewer.tsx'
import { CollectionSnapshotViewer } from './CollectionSnapshotViewer.tsx'
import { parseShareHash, COLLECTION_SNAPSHOT_VERSION } from './share-snapshot.ts'

// A `#v=<n>&s=…` fragment means "open this shared read-only snapshot" — the app's
// only route fork (no router; the URL path is unchanged). Render the viewer
// instead of the full app; it never seeds/opens the recipient's own data unless
// they Import. `v=3` is a collection snapshot, everything else a sprint one.
// See design-docs/share-link-snapshot.md.
const share = parseShareHash(window.location.hash)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      {share ? (
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
