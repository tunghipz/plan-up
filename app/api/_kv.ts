// Shared server helpers for the hosted share-link store. The `_` prefix keeps
// Vercel from turning this file into a route — it's imported by the real
// endpoints (share/index.ts, share/[id].ts). See design-docs/hosted-share-link.md.
import { Redis } from '@upstash/redis'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Vercel KV and a plain Upstash integration inject differently-named env vars;
// accept either so the store works regardless of how it was attached.
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

export const kvReady = Boolean(url && token)

// Construct lazily (and once) so a bad/missing config surfaces as a caught error
// inside the request handler — not an uncatchable module-load crash.
let _redis: Redis | null = null
export function getRedis(): Redis {
  if (!kvReady) throw new Error('KV env missing')
  if (!_redis) _redis = new Redis({ url: url!, token: token! })
  return _redis
}

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

export const keyFor = (id: string): string => `share:${id}`

export const hashToken = (t: string): string =>
  createHash('sha256').update(t).digest('hex')

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
export function cors(res: {
  setHeader: (k: string, v: string) => void
}): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-write-token')
}
