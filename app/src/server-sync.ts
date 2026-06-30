import type { ExportPayload } from './db'

type SnapshotResponse =
  | { hasSnapshot: false }
  | { hasSnapshot: true; snapshot: ExportPayload }

export function isServerSyncEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.protocol === 'http:' || window.location.protocol === 'https:'
}

export async function loadServerSnapshot(): Promise<ExportPayload | null> {
  if (!isServerSyncEnabled()) return null
  const response = await fetch('/api/db/snapshot', {
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!response.ok) return null
  const data = (await response.json()) as SnapshotResponse
  if (!data.hasSnapshot) return null
  return data.snapshot
}

export async function saveServerSnapshot(snapshot: ExportPayload): Promise<void> {
  if (!isServerSyncEnabled()) return
  const response = await fetch('/api/db/snapshot', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ snapshot }),
  })
  if (!response.ok) {
    let detail = ''
    try {
      const data = (await response.json()) as { error?: string }
      detail = data.error ? ` ${data.error}` : ''
    } catch {
      // Non-JSON errors are still useful through the status code.
    }
    throw new Error(`Server snapshot sync failed (${response.status}).${detail}`)
  }
}
