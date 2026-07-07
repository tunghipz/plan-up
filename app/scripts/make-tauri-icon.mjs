// Renders the desktop app icon source (src-tauri/icon-source.png, 1024×1024):
// the favicon's squircle + progress ring, on the brand rust #C04A1A, floated on
// a transparent margin the way macOS icons expect. Regenerate the full icon set
// afterwards with: npx tauri icon src-tauri/icon-source.png
// (design-docs/desktop-app-tauri.md)
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const favicon = await readFile(path.join(appDir, 'public/favicon.svg'), 'utf8')

// Reuse the favicon art but force the rust tile (the web favicon is System
// Blue; the desktop brand mark is rust — design-system brand spec).
const svg = favicon
  .replace(/\.tile \{ fill:#0071E3; \}/, '.tile { fill:#C04A1A; }')
  .replace(/@media \(prefers-color-scheme: dark\) \{ \.tile \{ fill:#0A84FF; \} \}/, '')

// macOS icon convention: artwork ~80% of the canvas, transparent margin around.
const html = `<!doctype html><body style="margin:0;width:1024px;height:1024px;
display:grid;place-items:center;background:transparent">
<div style="width:824px;height:824px">${svg.replace('width="100" height="100"', 'width="824" height="824"')}</div>
</body>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
await page.setContent(html)
const out = path.join(appDir, 'src-tauri/icon-source.png')
await page.screenshot({ path: out, omitBackground: true })
await browser.close()
console.log('wrote', out)
