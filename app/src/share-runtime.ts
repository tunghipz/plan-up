import { IS_TAURI } from './backup'

/**
 * Runtime glue for share links (kept out of the pure, unit-tested share-snapshot
 * module). Two desktop-specific concerns:
 *
 * 1. Base URL — a packaged desktop build's own origin is `tauri://localhost`,
 *    which a recipient can't open. So a PROD desktop build points share links at
 *    the deployed web app. Web builds (and Tauri *dev*, where localhost works on
 *    the dev machine) use the current origin, so this returns `undefined` and
 *    `buildShareUrl` falls back to `location.origin`.
 * 2. Opening a link — `window.open` is a no-op inside the Tauri webview, so an
 *    external URL must go through the opener plugin to reach the system browser.
 */

const DEPLOYED_BASE = 'https://plan-up-eta.vercel.app/'

export function shareBaseUrl(): string | undefined {
  return IS_TAURI && import.meta.env.PROD ? DEPLOYED_BASE : undefined
}

/** Open a URL in the system browser (Tauri) or a new tab (web). */
export async function openExternal(url: string): Promise<void> {
  if (IS_TAURI) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      return
    } catch {
      /* fall through to window.open (also a no-op in Tauri, but harmless) */
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
