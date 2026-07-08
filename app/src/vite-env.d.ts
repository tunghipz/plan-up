/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/info" />

/** App release version, inlined from package.json via Vite `define` (vite.config.ts). */
declare const __APP_VERSION__: string

/** Vercel build environment ('production' | 'preview' | ...), '' outside Vercel.
 *  Inlined via Vite `define`; drives the preview-origin data warning. */
declare const __VERCEL_ENV__: string
