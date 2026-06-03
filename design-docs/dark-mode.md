# Dark mode

**Status:** Implemented
**Last updated:** 2026-06-03
**Code:** `app/src/lib.ts` (`useDarkMode`), `app/src/App.tsx` (toggle button),
`app/src/index.css` (`.dark` token block)

## Purpose
A first-class Apple-style dark theme, toggleable and remembered.

## User-facing behavior
- Toggle via the Moon/Sun button at the bottom of the icon rail, or `⌘/Ctrl + Shift + D`.
- Defaults to the OS preference on first run, then remembers the explicit choice.

## Implementation
- `useDarkMode()` (`lib.ts:46`) — reads `localStorage['plan-tmp:dark']` (`'1'`/`'0'`);
  falls back to `matchMedia('(prefers-color-scheme: dark)')`. Toggles the `dark` class on
  `<html>`.
- All theming is **token-driven**: `index.css` `@theme` defines light values; the `.dark`
  block overrides the same `--color-*` names, so every `bg-surface`/`text-ink`/etc. flips
  automatically. `color-scheme` is set so native widgets (date picker, scrollbars) match.

## Rules & edge cases
- New UI must use semantic tokens (`--color-*`), never hard-coded hex, or it won't adapt.
  Soft-tints use `color-mix(... var(--color-…) …)` so they stay legible on dark surfaces.
- Dark palette: canvas `#1C1C1E`, surface `#2C2C2E`, accent `#0A84FF` (see
  `../design-system.md`).
