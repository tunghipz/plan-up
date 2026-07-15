import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  cors,
  genSuffix,
  genToken,
  getRedis,
  hashToken,
  keyFor,
  kvReady,
  MAX_BLOB_LEN,
  validKind,
  TTL_SECONDS,
  type ShareValue,
} from '../_kv'

/**
 * POST /api/share — create a hosted share. Body `{ blob, kind }`. Generates a
 * unique short suffix + a write-capability token, stores the snapshot with a TTL,
 * and returns `{ id, writeToken }`. The client composes the `/view/<slug>-<id>`
 * URL and keeps the token locally. See design-docs/hosted-share-link.md.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
  if (!kvReady) return res.status(503).json({ error: 'store unavailable' })

  try {
    const redis = getRedis()
    const body = (req.body ?? {}) as { blob?: unknown; kind?: unknown }
    const { blob, kind } = body
    if (typeof blob !== 'string' || !blob || blob.length > MAX_BLOB_LEN)
      return res.status(400).json({ error: 'bad blob' })
    if (!validKind(kind)) return res.status(400).json({ error: 'bad kind' })

    const v = kind === 'collection' ? 3 : 2

    // Retry until a free suffix is found (collisions are astronomically rare).
    let id = ''
    for (let i = 0; i < 6; i++) {
      const candidate = genSuffix(6)
      if (!(await redis.exists(keyFor(candidate)))) {
        id = candidate
        break
      }
    }
    if (!id) return res.status(500).json({ error: 'id generation failed' })

    const writeToken = genToken()
    const value: ShareValue = {
      v,
      blob,
      kind,
      wt: hashToken(writeToken),
      updatedAt: Date.now(),
    }
    await redis.set(keyFor(id), value, { ex: TTL_SECONDS })
    return res.status(200).json({ id, writeToken })
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String((e as Error)?.message ?? e) })
  }
}
