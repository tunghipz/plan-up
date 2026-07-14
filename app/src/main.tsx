import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { SnapshotViewer } from './SnapshotViewer.tsx'
import { parseShareHash } from './share-snapshot.ts'

// A `#v=1&s=…` fragment means "open this shared read-only snapshot" — the app's
// only route fork (no router; the URL path is unchanged). Render the viewer
// instead of the full app; it never seeds/opens the recipient's own data unless
// they Import. See design-docs/share-link-snapshot.md.
const shareBlob = parseShareHash(window.location.hash)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      {shareBlob ? <SnapshotViewer raw={shareBlob} /> : <App />}
    </ConfirmProvider>
  </StrictMode>,
)
