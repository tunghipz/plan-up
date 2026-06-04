# Search & keyboard

**Status:** Implemented
**Last updated:** 2026-06-03
**Code:** `app/src/App.tsx` (search input, key handler), `SprintView.tsx`/`BoardView.tsx`
(filtering)

## Purpose
Fast, keyboard-first navigation — speed > breadth (≤ 1 keystroke per action).

## Search
- Header search box filters the current sprint's tasks by **title** (case-insensitive
  substring). Filtering lives in the views, not the shell.
- `/` focuses it; `Escape` clears + blurs it (when it has text).

## Keyboard shortcuts (`App.tsx` global handler)
| Key | Action |
| --- | --- |
| `/` | Focus search |
| `n` | New sprint dialog |
| `Escape` | Clear & blur search |
| `⌘/Ctrl + Shift + D` | Toggle dark mode |

Shortcuts are ignored while typing in an `input`/`textarea`/contentEditable.

### While the settings page is open
See [project-member-settings.md](./project-member-settings.md):
- `Escape` closes the settings page **first** (priority over clearing search).
- `n` and `/` are **disabled** (the search box is hidden; no sprint dialog over settings).

## Rules & edge cases
- Search is per-current-sprint (it filters the already-scoped task list), not global.
- Board search and list search use the same title-substring rule.
