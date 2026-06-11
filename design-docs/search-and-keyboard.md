# Search & keyboard

**Status:** Implemented
**Last updated:** 2026-06-11
**Code:** `app/src/App.tsx` (`SearchPalette`, key handler, scroll-to-task), `SprintView.tsx`
(`data-task-id`, flash highlight)

## Purpose
Fast, keyboard-first navigation — speed > breadth (≤ 1 keystroke per action).

## Search — command palette (Spotlight style)
The toolbar no longer holds a 208px search input (it crowded the bar once Roll over +
3-way segmented were added). Search is now a **centered command palette**, macOS-Spotlight
idiom, matching the Cupertino DNA (calm chrome, depth).

- **Trigger:** a magnifier **icon button** in the toolbar, or `/`, or `⌘K`/`Ctrl+K`.
  The icon shows only when a **sprint** is selected (search was always sprint-only — see Rules).
- **Scope:** the **current sprint's tasks**, matched by **title** (case-insensitive substring).
  Not global (no cross-sprint / collection / action search — kept deliberately small; can grow later).
- **Behavior — jump-to, not filter-in-place** *(changed 2026-06-11)*: the list is no longer
  filtered while you type. The palette lists matches (status · `#seq` · assignee); picking one
  (`Enter` / click) **closes the palette, switches to List view if you were on Board/Timeline,
  scrolls the list to that task, and flashes a brief highlight ring** on its row.
- Palette uses the shared `dlg-scrim` / `dlg-sheet` motion (§6.5). Keyboard inside: `↑`/`↓`
  move selection, `Enter` jump, `Esc` close.

## Keyboard shortcuts (`App.tsx` global handler)
| Key | Action |
| --- | --- |
| `/` | Open search palette |
| `⌘K` / `Ctrl+K` | Open search palette |
| `n` | New sprint dialog |
| `Escape` | Close palette (else close settings) |
| `⌘/Ctrl + Shift + D` | Toggle dark mode |

Single-key shortcuts (`/`, `n`) are ignored while typing in an `input`/`textarea`/contentEditable;
`⌘K` works anywhere.

### While the settings page is open
See [project-member-settings.md](./project-member-settings.md):
- `Escape` closes the settings page (if no palette is open).
- `n` and `/` are **disabled** (no palette/dialog over settings).

## Rules & edge cases
- Palette is per-current-sprint (its candidate list is the already-scoped sprint tasks), not global.
- Collections never used search → no palette in collection context (the icon is hidden there).
- Scroll-to-task uses container `scrollTo` (never `scrollIntoView` — it breaks our scroll
  container, design-system §technical-red-lines). The flash sets a `data-flash` attribute the
  CSS animates, then clears it on a timer.
