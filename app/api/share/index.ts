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
const MAX_BLOB_LEN = 512 * 1024
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
  res.end(JSON.stringify(obj))
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
    const body = await readJsonBody(req)
    const { blob, kind } = body
    if (typeof blob !== 'string' || !blob || blob.length > MAX_BLOB_LEN)
      return send(res, 400, { error: 'bad blob' })
    if (kind !== 'sprint' && kind !== 'collection') return send(res, 400, { error: 'bad kind' })

    const v = kind === 'collection' ? 3 : 2

    // Unique short suffix (retry on the astronomically rare collision).
    let id = ''
    for (let i = 0; i < 6; i++) {
      const b = randomBytes(6)
      let s = ''
      for (let k = 0; k < 6; k++) s += ALPHABET[b[k] % ALPHABET.length]
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
