/**
 * Which shell the page runs in. No imports, so any module (lib.ts included) can
 * read it without a cycle. See design-docs/ios-app.md.
 */

/** Any Tauri shell — macOS app or the iOS app. The page's origin is then
 * `tauri://localhost`, which nobody else can open (share links, hosted API). */
export const IS_NATIVE_SHELL =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function looksMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac; touch points give it away.
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** Tauri on a phone / tablet: runs as the web build would, but a browser-style
 * download does nothing, so exports go through the native `save_export`. */
export const IS_NATIVE_MOBILE = IS_NATIVE_SHELL && looksMobile()

/** The Tauri DESKTOP shell — menu bar, updater, folder backup, Claude panel,
 * window chrome. Every desktop-only feature gates on this. */
export const IS_TAURI = IS_NATIVE_SHELL && !IS_NATIVE_MOBILE
