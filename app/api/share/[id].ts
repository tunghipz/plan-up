import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  cors,
  kvDel,
  kvGet,
  kvReady,
  kvSet,
  MAX_BLOB_LEN,
  readJsonBody,
  send,
  tokenOk,
  TTL_SECONDS,
  type ShareValue,
} from '../_kv'

/** The id is the last path segment (`/api/share/<id>`); parsed from the raw URL
 * so we don't depend on the `req.query` helper. */
function idFromUrl(rawUrl: string | undefined): string {
  const path = new URL(rawUrl || '', 'http://x').pathname
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

/**
 * /api/share/:id
 * - GET    — public read (no token): returns `{ v, blob, kind, updatedAt }`.
 * - PUT    — overwrite the blob (requires `x-write-token`); resets the TTL.
 * - DELETE — revoke (requires `x-write-token`).
 * Raw Node req/res API. See design-docs/hosted-share-link.md.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (!kvReady) return send(res, 503, { error: 'store unavailable' })

  const id = idFromUrl(req.url)
  if (!/^[a-z0-9]{1,16}$/.test(id)) return send(res, 400, { error: 'bad id' })

  try {
    if (req.method === 'GET') {
      const value = await kvGet(id)
      if (!value) return send(res, 404, { error: 'not found' })
      return send(res, 200, { v: value.v, blob: value.blob, kind: value.kind, updatedAt: value.updatedAt })
    }

    if (req.method === 'PUT' || req.method === 'DELETE') {
      const value = await kvGet(id)
      if (!value) return send(res, 404, { error: 'not found' })
      const hdr = req.headers['x-write-token']
      const provided = Array.isArray(hdr) ? hdr[0] : hdr
      if (!provided || !tokenOk(String(provided), value.wt)) return send(res, 403, { error: 'forbidden' })

      if (req.method === 'DELETE') {
        await kvDel(id)
        return send(res, 200, { ok: true })
      }
      // PUT
      const body = await readJsonBody(req)
      if (typeof body.blob !== 'string' || !body.blob || body.blob.length > MAX_BLOB_LEN)
        return send(res, 400, { error: 'bad blob' })
      const next: ShareValue = { ...value, blob: body.blob, updatedAt: Date.now() }
      await kvSet(id, next, TTL_SECONDS)
      return send(res, 200, { ok: true, updatedAt: next.updatedAt })
    }

    return send(res, 405, { error: 'method' })
  } catch (e) {
    return send(res, 500, { error: 'server', detail: String((e as Error)?.message ?? e) })
  }
}
