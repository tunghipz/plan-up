import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  cors,
  genSuffix,
  genToken,
  hashToken,
  kvExists,
  kvReady,
  kvSet,
  MAX_BLOB_LEN,
  readJsonBody,
  send,
  validKind,
  TTL_SECONDS,
  type ShareValue,
} from '../_kv'

/**
 * POST /api/share — create a hosted share. Body `{ blob, kind }`. Generates a
 * unique short suffix + a write-capability token, stores the snapshot with a TTL,
 * and returns `{ id, writeToken }`. Uses the raw Node req/res API (no `.status()`
 * helper). See design-docs/hosted-share-link.md.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method' })
  if (!kvReady) return send(res, 503, { error: 'store unavailable' })

  try {
    const body = await readJsonBody(req)
    const { blob, kind } = body
    if (typeof blob !== 'string' || !blob || blob.length > MAX_BLOB_LEN)
      return send(res, 400, { error: 'bad blob' })
    if (!validKind(kind)) return send(res, 400, { error: 'bad kind' })

    const v = kind === 'collection' ? 3 : 2

    // Retry until a free suffix is found (collisions are astronomically rare).
    let id = ''
    for (let i = 0; i < 6; i++) {
      const candidate = genSuffix(6)
      if (!(await kvExists(candidate))) {
        id = candidate
        break
      }
    }
    if (!id) return send(res, 500, { error: 'id generation failed' })

    const writeToken = genToken()
    const value: ShareValue = { v, blob, kind, wt: hashToken(writeToken), updatedAt: Date.now() }
    await kvSet(id, value, TTL_SECONDS)
    return send(res, 200, { id, writeToken })
  } catch (e) {
    return send(res, 500, { error: 'server', detail: String((e as Error)?.message ?? e) })
  }
}
