# App icon, favicon & link preview

**Status:** Implemented
**Last updated:** 2026-06-04
**Code:** `app/public/favicon.svg`, `app/public/og-image.png`, meta in `app/index.html`

## Purpose
The browser-tab favicon (and any future app-icon export) is the smallest piece of
brand. The previous `favicon.svg` was a stock purple→blue gradient zigzag — which
directly violates the design-system constitution (§8.1 "không gradient purple/blue",
"một accent duy nhất"). It carried zero plan-up identity. This replaces it with a
mark grown from the app's own visual language.

## The mark
An Apple-style **squircle** (superellipse, n≈5) filled System Blue, with a white
**progress ring** ~75% complete — the same Reminders-style `StatusCircle` /
member progress ring that is the app's signature control (see
[member-header-summary.md](./member-header-summary.md),
[status-and-priority.md](./status-and-priority.md)). It reads as "a sprint, nearly
done": calm, Cupertino-native, unmistakably *this* app.

Treatment is **white glyph on a blue tile** (not tinted-on-white) because it is the
only treatment that stays legible at 16px in a browser tab and on a dock — a
white tile dissolves on light backgrounds.

## Behavior
- Single SVG, no raster fallback (modern browsers render SVG favicons; the app is a
  local-first tool, not SEO/legacy-targeted).
- **Dark-aware:** an inline `<style>` swaps the tile fill via
  `@media (prefers-color-scheme: dark)` — `#0071E3` (light) → `#0A84FF` (dark),
  matching the accent tokens in [dark-mode.md](./dark-mode.md). The white ring is
  unchanged across themes.

## Implementation
- `app/public/favicon.svg` — `viewBox="0 0 100 100"`, ~1.7KB.
  - squircle `<path>` (class `.tile`, fill swapped by the media query),
  - faint white track ring (`stroke-opacity .28`, width 11),
  - white progress arc: `r=27`, `stroke-dasharray="127.2 42.5"` (≈75% of the
    169.6 circumference), `stroke-linecap=round`, `rotate(-90 50 50)` so the gap
    sits top-right.
- Linked in `app/index.html`: `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`.
- Colors are the literal accent hexes (a static asset can't read CSS `@theme`
  tokens); they mirror `--color-accent` / its dark value in `src/index.css`.

## Rules & edge cases
- **Source of the squircle path:** sampled from the superellipse formula
  (96 segments). Demo + regeneration recipe live in `demo/app-icon-A-refined.html`
  and `demo/app-icon-favicon-variations.html` (gitignored).
- If the accent ever changes (design-system §2.1), update the two hexes here too.
- Fill amount (75%) is decorative, not data-bound — the favicon does not reflect
  real sprint progress.

## Link preview (og:image)
The card shown when the plan-up link is shared (Telegram / Slack / X).

- **Asset:** `app/public/og-image.png`, **1200×630 PNG** — must be raster, not SVG
  (Telegram and most scrapers don't render SVG og:images).
- **Design (direction D · "ring motif"):** brand-blue `#0071E3` field, white wordmark
  `plan-up` + eyebrow "LOCAL-FIRST PLANNER" + tagline, and the 75% progress ring blown
  up and bled off the right edge — the same ring as the favicon, used as a graphic
  device. Blue treatment chosen over the white/Cupertino-canvas alt because a shared
  link competes in a busy chat feed; the blue card has the highest contrast and reads
  as a product in both light and dark chats.
- **Source/regeneration:** `demo/og-D-render.html` (board at exact 1200×630, `?blue`
  toggles treatment) → Playwright `screenshot --viewport-size=1200,630`. Telegram
  context proof: `demo/og-D-telegram.html`. (Both gitignored under `demo/`.)
- **Meta tags** in `index.html`: `og:title` / `og:description` / `og:image`
  (+`:width`/`:height`/`:type`) / `og:type` / `og:site_name`, plus `twitter:card =
  summary_large_image` and `twitter:*` mirrors, and a plain `<meta name="description">`.
- ⚠️ **Absolute URL caveat:** `og:image` is currently the relative `/og-image.png`.
  Some scrapers (Telegram especially) need an **absolute** `https://<domain>/og-image.png`
  — switch it once the app has a real domain.

## Future / open questions
- No `apple-touch-icon` / maskable PNGs shipped (SVG favicon only). Add them if the
  app is ever installed as a PWA.
