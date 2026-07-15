import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * /api/share/:id — GET (public read) / PUT / DELETE (both need `x-write-token`).
 * Self-contained (no relative import) — see api/share/index.ts for why.
 * See design-docs/hosted-share-link.md.
 */

const URL_BASE = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '')
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''
const kvReady = Boolean(URL_BASE && TOKEN)
const TTL_SECONDS = 90 * 24 * 60 * 60
const MAX_BLOB_LEN = 512 * 1024

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
async function kvGet(id: string): Promise<ShareValue | null> {
  const res = await cmd(['GET', `share:${id}`])
  return res == null ? null : (JSON.parse(String(res)) as ShareValue)
}

function tokenOk(provided: string, storedHash: string): boolean {
  const a = Buffer.from(createHash('sha256').update(provided).digest('hex'))
  const b = Buffer.from(storedHash)
  return a.length === b.length && timingSafeEqual(a, b)
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

/** id = last path segment of `/api/share/<id>` (from the raw URL). */
function idFromUrl(rawUrl: string | undefined): string {
  const path = new URL(rawUrl || '', 'http://x').pathname
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
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
        await cmd(['DEL', `share:${id}`])
        return send(res, 200, { ok: true })
      }
      // PUT
      const body = await readJsonBody(req)
      if (typeof body.blob !== 'string' || !body.blob || body.blob.length > MAX_BLOB_LEN)
        return send(res, 400, { error: 'bad blob' })
      const next: ShareValue = { ...value, blob: body.blob, updatedAt: Date.now() }
      await cmd(['SET', `share:${id}`, JSON.stringify(next), 'EX', String(TTL_SECONDS)])
      return send(res, 200, { ok: true, updatedAt: next.updatedAt })
    }

    return send(res, 405, { error: 'method' })
  } catch (e) {
    console.error(`${req.method} /api/share/${id} failed:`, e) // server-side only
    return send(res, 500, { error: 'server' })
  }
}
