import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  cors,
  keyFor,
  kvReady,
  MAX_BLOB_LEN,
  redis,
  tokenOk,
  TTL_SECONDS,
  type ShareValue,
} from '../_kv'

/**
 * /api/share/:id
 * - GET    — public read (no token): returns `{ v, blob, kind, updatedAt }`.
 * - PUT    — overwrite the blob (requires `x-write-token`); resets the TTL.
 * - DELETE — revoke (requires `x-write-token`).
 * See design-docs/hosted-share-link.md.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!kvReady || !redis) return res.status(503).json({ error: 'store unavailable' })

  const raw = req.query.id
  const id = String(Array.isArray(raw) ? raw[0] : raw ?? '')
  if (!/^[a-z0-9]{1,16}$/.test(id)) return res.status(400).json({ error: 'bad id' })
  const key = keyFor(id)

  if (req.method === 'GET') {
    const value = await redis.get<ShareValue>(key)
    if (!value) return res.status(404).json({ error: 'not found' })
    return res
      .status(200)
      .json({ v: value.v, blob: value.blob, kind: value.kind, updatedAt: value.updatedAt })
  }

  if (req.method === 'PUT' || req.method === 'DELETE') {
    const value = await redis.get<ShareValue>(key)
    if (!value) return res.status(404).json({ error: 'not found' })
    const hdr = req.headers['x-write-token']
    const provided = Array.isArray(hdr) ? hdr[0] : hdr
    if (!provided || !tokenOk(String(provided), value.wt))
      return res.status(403).json({ error: 'forbidden' })

    if (req.method === 'DELETE') {
      await redis.del(key)
      return res.status(200).json({ ok: true })
    }
    // PUT
    const body = (req.body ?? {}) as { blob?: unknown }
    if (typeof body.blob !== 'string' || !body.blob || body.blob.length > MAX_BLOB_LEN)
      return res.status(400).json({ error: 'bad blob' })
    const next: ShareValue = { ...value, blob: body.blob, updatedAt: Date.now() }
    await redis.set(key, next, { ex: TTL_SECONDS })
    return res.status(200).json({ ok: true, updatedAt: next.updatedAt })
  }

  return res.status(405).json({ error: 'method' })
}
