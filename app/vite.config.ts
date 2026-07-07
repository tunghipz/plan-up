import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json'

// Ship a version manifest next to the build so the update pill can show WHICH
// version is available. Kept out of the SW precache (workbox globIgnores) so the
// `no-store` fetch always hits the network. See design-docs/version-and-updates.md.
function emitVersionManifest(version: string): Plugin {
  return {
    name: 'emit-version-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version }),
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    emitVersionManifest(pkg.version),
    // Service worker: precache the build for offline + instant update swap.
    // `prompt` mode = the new SW WAITS; we surface the update pill and only
    // skipWaiting + reload when the user clicks it (see VersionFooter.tsx).
    VitePWA({
      // Service workers can't run under Tauri's protocol — ship the desktop
      // build without SW/manifest entirely (desktop-app-tauri.md). Tauri sets
      // TAURI_ENV_PLATFORM for both `tauri dev` and `tauri build`.
      disable: !!process.env.TAURI_ENV_PLATFORM,
      registerType: 'prompt',
      injectRegister: null, // registration is driven by useRegisterSW in React
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        globIgnores: ['**/version.json'], // keep network-fresh for the version check
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'plan-up',
        short_name: 'plan-up',
        description: 'Local-first sprint & task planner — no backend, data stays in your browser.',
        theme_color: '#0071e3',
        background_color: '#f5f5f7',
        display: 'standalone',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  // Single source of truth for the app version: package.json, inlined at build
  // time and surfaced in the sidebar footer (app-shell-and-navigation.md).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Tauri: keep its CLI output visible and expose TAURI_ENV_* to the client.
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
})
