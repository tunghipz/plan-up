import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * POST /api/share — create a hosted share. Body `{ blob, kind }` → `{ id, writeToken }`.
 * Self-contained on purpose: Vercel's ESM function runtime couldn't resolve a
 * relative `../_kv` import (missing `.js` → FUNCTION_INVOCATION_FAILED at load),
 * so each function inlines its helpers and imports only Node builtins.
 * See design-docs/hosted-share-link.md.
 */

const URL_BASE = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '')
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''
const kvReady = Boolean(URL_BASE && TOKEN)
const TTL_SECONDS = 90 * 24 * 60 * 60
// Same cap the viewer decodes (share-snapshot.ts MAX_BLOB_LEN): storing more
// than any client can open only gives abuse room.
const MAX_BLOB_LEN = 200_000
// 10 chars of a 31-letter alphabet ≈ 49.5 bits. The link is the only secret a
// read needs, so the id must not be guessable by scanning (6 chars was ~30 bits).
const ID_LEN = 10
/** Creates per IP per hour — far above a person sharing plans, far below a flood. */
const POST_LIMIT = 30
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

interface ShareValue {
  v: number
  blob: string
  kind: string
  wt: string
  updatedAt: number
}

async function cmd(args: (string | number)[]): Promise<unknown> {
  const r = await fetch(URL_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000), // don't hang the function on a stuck store
  })
  if (!r.ok) throw new Error(`upstash ${r.status}: ${await r.text()}`)
  return (await r.json()).result
}

function send(res: ServerResponse, code: number, obj: unknown): void {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  // A snapshot is somebody's plan: never let a shared/intermediate cache keep it.
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(obj))
}

/**
 * Fixed-window rate limit per client IP, in the same store. The key carries the
 * window index, so a key whose EXPIRE never landed (function killed between the
 * two calls) belongs to a past window and can't lock anyone out. The IP is
 * hashed (no raw addresses in the store). Vercel's edge sets x-forwarded-for /
 * x-real-ip itself, so a client can't pick its own bucket.
 */
function clientKey(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for']
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim()
  const real = req.headers['x-real-ip']
  const ip = first || (Array.isArray(real) ? real[0] : real) || req.socket?.remoteAddress || 'unknown'
  return createHash('sha256').update(ip).digest('hex').slice(0, 16)
}
async function allow(req: IncomingMessage, bucket: string, limit: number, windowSec: number): Promise<boolean> {
  const slot = Math.floor(Date.now() / 1000 / windowSec)
  const key = `rl:${bucket}:${clientKey(req)}:${slot}`
  const n = Number(await cmd(['INCR', key]))
  if (n === 1) await cmd(['EXPIRE', key, String(windowSec * 2)])
  return n <= limit
}


async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const existing = (req as unknown as { body?: unknown }).body
  if (existing && typeof existing === 'object') return existing as Record<string, unknown>
  let data = ''
  try {
    for await (const chunk of req) {
      data += chunk
      if (data.length > 1_048_576) return {}
    }
  } catch {
    return {}
  }
  if (!data) return {}
  try {
    return JSON.parse(data) as Record<string, unknown>
  } catch {
    return {}
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-write-token')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method' })
  if (!kvReady) return send(res, 503, { error: 'store unavailable' })

  try {
    if (!(await allow(req, 'post', POST_LIMIT, 3600))) return send(res, 429, { error: 'rate limited' })
    const body = await readJsonBody(req)
    const { blob, kind } = body
    if (typeof blob !== 'string' || !blob || blob.length > MAX_BLOB_LEN)
      return send(res, 400, { error: 'bad blob' })
    if (kind !== 'sprint' && kind !== 'collection') return send(res, 400, { error: 'bad kind' })

    const v = kind === 'collection' ? 3 : 2

    // Unique short suffix (retry on the astronomically rare collision).
    let id = ''
    for (let i = 0; i < 6; i++) {
      const b = randomBytes(ID_LEN)
      let s = ''
      for (let k = 0; k < ID_LEN; k++) s += ALPHABET[b[k] % ALPHABET.length]
      if ((await cmd(['EXISTS', `share:${s}`])) !== 1) {
        id = s
        break
      }
    }
    if (!id) return send(res, 500, { error: 'id generation failed' })

    const writeToken = randomBytes(24).toString('base64url')
    const value: ShareValue = {
      v,
      blob,
      kind,
      wt: createHash('sha256').update(writeToken).digest('hex'),
      updatedAt: Date.now(),
    }
    await cmd(['SET', `share:${id}`, JSON.stringify(value), 'EX', String(TTL_SECONDS)])
    return send(res, 200, { id, writeToken })
  } catch (e) {
    console.error('POST /api/share failed:', e) // log detail server-side, not to the client
    return send(res, 500, { error: 'server' })
  }
}
