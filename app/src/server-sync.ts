import type { ExportPayload } from './db'

type SnapshotResponse =
  | { hasSnapshot: false }
  | { hasSnapshot: true; snapshot: ExportPayload }

export type ServerSnapshotAction = 'import-server' | 'keep-local' | 'same'

export function snapshotSignature(snapshot: ExportPayload): string {
  const { exportedAt: _exportedAt, ...stable } = snapshot
  return JSON.stringify(stable)
}

export function snapshotHasUserData(snapshot: ExportPayload): boolean {
  return (
    (snapshot.projects?.length ?? 0) > 0 ||
    snapshot.members.length > 0 ||
    snapshot.sprints.length > 0 ||
    (snapshot.collections?.length ?? 0) > 0 ||
    snapshot.tasks.length > 0 ||
    (snapshot.people?.length ?? 0) > 0 ||
    (snapshot.aiThreads?.length ?? 0) > 0 ||
    (snapshot.aiMessages?.length ?? 0) > 0
  )
}

export function chooseServerSnapshotAction({
  local,
  server,
  lastAcceptedSignature,
}: {
  local: ExportPayload
  server: ExportPayload
  lastAcceptedSignature: string | null
}): ServerSnapshotAction {
  const localSignature = snapshotSignature(local)
  const serverSignature = snapshotSignature(server)
  if (localSignature === serverSignature) return 'same'
  if (!snapshotHasUserData(local)) return 'import-server'

  // Local still equals the last server snapshot we accepted/uploaded, so a
  // different server snapshot is an external update and can safely replace it.
  if (lastAcceptedSignature && localSignature === lastAcceptedSignature) {
    return 'import-server'
  }

  // Local has data that the server has not acknowledged yet. Preserve it and
  // let the debounce upload path make the server catch up.
  return 'keep-local'
}

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

export async function saveServerSnapshot(
  snapshot: ExportPayload
): Promise<{ exportedAt: string; projectCount: number }> {
  if (!isServerSyncEnabled()) {
    return {
      exportedAt: snapshot.exportedAt,
      projectCount: snapshot.projects?.length ?? 0,
    }
  }
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
  return (await response.json()) as { exportedAt: string; projectCount: number }
}
