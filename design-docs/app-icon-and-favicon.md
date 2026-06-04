# App icon & favicon

**Status:** Implemented
**Last updated:** 2026-06-04
**Code:** `app/public/favicon.svg`, linked from `app/index.html`

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

## Future / open questions
- No PNG/ICO export shipped (SVG-only). Add `apple-touch-icon` / maskable PNGs only
  if the app is ever installed as a PWA.
