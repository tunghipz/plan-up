import { IS_TAURI } from './backup'

/**
 * Runtime client for the hosted share store (`/api/share/*`). The pure snapshot
 * grammar stays in share-snapshot.ts; this module only moves a blob to/from the
 * server and turns a suffix into a short `/view/<slug>-<id>` URL.
 *
 * The `slug` is cosmetic — only the `<id>` suffix is the store key — so renaming
 * a plan never breaks a link. See design-docs/hosted-share-link.md.
 */

const DEPLOYED_ORIGIN = 'https://plan-up-eta.vercel.app'

/** Where the API lives. Web + Tauri *dev* = same origin (relative ''); a packaged
 * desktop build's origin is `tauri://localhost`, so it must hit the deployed API. */
function apiBase(): string {
  return IS_TAURI && import.meta.env.PROD ? DEPLOYED_ORIGIN : ''
}
/** Origin used to compose the shareable `/view` URL shown to the sender. */
function viewOrigin(): string {
  if (IS_TAURI && import.meta.env.PROD) return DEPLOYED_ORIGIN
  return typeof location !== 'undefined' ? location.origin : ''
}

export type ShareKind = 'sprint' | 'collection'

/** Slugify a plan name for the cosmetic URL prefix: strip diacritics (đ→d), lower,
 * collapse to `[a-z0-9-]`, trim dashes, cap length. Empty → 'plan'. */
export function slugify(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return s || 'plan'
}

/** Compose the display URL from a slug + suffix id. */
export function viewUrl(slug: string, id: string): string {
  return `${viewOrigin()}/view/${slug}-${id}`
}

/**
 * Extract the store key (suffix) from a `/view/<slug>-<id>` pathname. The suffix
 * is the segment after the LAST dash (the slug may itself contain dashes). Returns
 * null when the path isn't a `/view/` link or the id is malformed.
 */
export function suffixFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/view\/(.+)$/)
  if (!m) return null
  const seg = m[1].replace(/\/+$/, '')
  const dash = seg.lastIndexOf('-')
  const id = dash >= 0 ? seg.slice(dash + 1) : seg
  return /^[a-z0-9]{1,16}$/.test(id) ? id : null
}

/** Non-2xx responses become a typed error so callers can branch on 403/404. */
export class HostedError extends Error {
  status: number
  constructor(status: number) {
    super(`hosted share request failed (${status})`)
    this.status = status
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new HostedError(res.status)
  return (await res.json()) as T
}

/** Create a hosted share; returns the store id + the local-only write token. */
export function createShare(
  blob: string,
  kind: ShareKind
): Promise<{ id: string; writeToken: string }> {
  return jsonFetch(`${apiBase()}/api/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob, kind }),
  })
}

/** Overwrite an existing share's blob in place (link stays the same). */
export async function updateShare(
  id: string,
  writeToken: string,
  blob: string
): Promise<void> {
  await jsonFetch(`${apiBase()}/api/share/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-write-token': writeToken },
    body: JSON.stringify({ blob }),
  })
}

/** Revoke (delete) a share. */
export async function revokeShare(id: string, writeToken: string): Promise<void> {
  await jsonFetch(`${apiBase()}/api/share/${id}`, {
    method: 'DELETE',
    headers: { 'x-write-token': writeToken },
  })
}

/** Public read used by the viewer. Throws HostedError(404) when revoked/expired. */
export function getShare(
  id: string
): Promise<{ v: number; blob: string; kind: ShareKind; updatedAt: number }> {
  return jsonFetch(`${apiBase()}/api/share/${id}`)
}
