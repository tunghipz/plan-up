// Shared server helpers for the hosted share-link store. The `_` prefix keeps
// Vercel from turning this file into a route — it's imported by the real
// endpoints (share/index.ts, share/[id].ts). See design-docs/hosted-share-link.md.
//
// Talks to Upstash over its REST API with the built-in `fetch` (NO npm client) —
// so a function can never fail to load over a missing/incompatible dependency.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Vercel KV and a plain Upstash integration inject differently-named env vars;
// accept either so the store works regardless of how it was attached.
const URL_BASE = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(
  /\/+$/,
  ''
)
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''

export const kvReady = Boolean(URL_BASE && TOKEN)

/** Links live 90 days from the last write; each PUT resets the clock. */
export const TTL_SECONDS = 90 * 24 * 60 * 60
/** Reject an oversized blob before it ever reaches the store. */
export const MAX_BLOB_LEN = 512 * 1024

const KNOWN_KINDS = new Set(['sprint', 'collection'])

export interface ShareValue {
  v: number // 2 = sprint, 3 = collection (picks the viewer on read)
  blob: string // the lz-string snapshot — same wire format as the in-URL link
  kind: string
  wt: string // sha256(writeToken), hex — never store the raw token
  updatedAt: number
}

// ---- Upstash REST ----
// A command is a JSON array (["SET","k","v","EX","60"]) POSTed to the base URL;
// the response is `{ result: ... }`.
async function cmd(args: (string | number)[]): Promise<unknown> {
  const r = await fetch(URL_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!r.ok) throw new Error(`upstash ${r.status}: ${await r.text()}`)
  return (await r.json()).result
}

export const keyFor = (id: string): string => `share:${id}`

/** Read + JSON-parse a stored ShareValue, or null when absent. */
export async function kvGet(id: string): Promise<ShareValue | null> {
  const res = await cmd(['GET', keyFor(id)])
  return res == null ? null : (JSON.parse(String(res)) as ShareValue)
}
/** Write a ShareValue as JSON with a TTL (seconds). */
export async function kvSet(id: string, value: ShareValue, ttl: number): Promise<void> {
  await cmd(['SET', keyFor(id), JSON.stringify(value), 'EX', String(ttl)])
}
export async function kvDel(id: string): Promise<void> {
  await cmd(['DEL', keyFor(id)])
}
export async function kvExists(id: string): Promise<boolean> {
  return (await cmd(['EXISTS', keyFor(id)])) === 1
}

// ---- tokens / ids ----
export const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex')

/** Constant-time compare of a provided token against a stored hash. */
export function tokenOk(provided: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(provided))
  const b = Buffer.from(storedHash)
  return a.length === b.length && timingSafeEqual(a, b)
}

// No-ambiguous-character alphabet (drops i/l/o/0/1) for the human-facing suffix.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export function genSuffix(len = 6): string {
  const b = randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[b[i] % ALPHABET.length]
  return s
}
/** Opaque write-capability token (base64url, ~32 chars). */
export const genToken = (bytes = 24): string => randomBytes(bytes).toString('base64url')

export const validKind = (k: unknown): k is 'sprint' | 'collection' =>
  typeof k === 'string' && KNOWN_KINDS.has(k)

/** Permissive CORS so the packaged desktop app (origin `tauri://localhost`) can
 * reach the deployed API. Reads are public; writes are token-gated regardless. */
export function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-write-token')
}

/** Write a JSON response using ONLY the raw Node API — the `@vercel/node`
 * `.status()`/`.json()` helpers aren't reliably attached on ESM functions, and
 * calling a missing helper is what crashed every request (FUNCTION_INVOCATION_FAILED). */
export function send(res: ServerResponse, code: number, obj: unknown): void {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

/** Parse a JSON request body from the raw stream (don't rely on `req.body`, which
 * the helper layer may not populate on ESM). Caps at 1 MB; bad JSON → {}. */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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
