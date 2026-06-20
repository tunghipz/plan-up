# Project icon (emoji override)

**Status:** Implemented
**Last updated:** 2026-06-20
**Code:** `app/src/db.ts` (`Project.icon`, `updateProject` Pick), `app/src/App.tsx`
(icon-rail tile render), `app/src/members.tsx` (`PROJECT_ICON_EMOJIS`, `EmojiPickerRow`),
`app/src/ProjectSettingsView.tsx` (the "Icon" row). Tested in
`app/src/project-io-db.test.ts` (emoji survives export → import).

## Purpose
Each project shows up in the left **icon rail** as a colored squircle with the
project name's **first letter** (`App.tsx:814` — `name.trim().charAt(0).toUpperCase()`).
Letters collide fast: in the screenshot two "P" projects are indistinguishable except
by tile color. Let the user **override the letter with an emoji** so projects are
recognizable at a glance. Optional, opt-in, never required — the letter stays the
default.

This is the **in-app project avatar**, not the browser favicon / PWA app icon (that's
[app-icon-and-favicon.md](./app-icon-and-favicon.md)) — out of scope here.

## User-facing behavior
- **Icon rail tile:** if the project has an emoji, the tile shows the emoji centered on
  its color tile; otherwise the first-letter fallback (unchanged). Tile color, size
  (36px), active ring, and hover are all unchanged.
- **Edit:** in **Project settings → Project card**, a new **"Icon"** row (sits right
  after Description, above Color), mirroring the existing Color row:
  - A **search box** on top. Empty → a **curated grid of two rows** (15 common planner
    emoji + a leading **"Aa"** chip), so the most likely pick is ≤1 click. Type a word
    (`rocket`, `chart`, `fire`…) → the grid swaps to keyword matches from the shared
    `EMOJI` set (also used by member avatars). Pasting an emoji surfaces it as the first
    result, so the full emoji set is reachable with **no dependency** (replaces the old
    side text-input + macOS-picker hint).
  - The **"Aa"** chip (curated view only) clears the emoji → tile reverts to the
    first-letter fallback.
- Change is **live** (no Save button) — same `updateProject` on pick as Color.

## Data
Add one **optional, non-indexed** field to `Project` (`db.ts:104`), exactly like the
existing `color?`:
```ts
export interface Project {
  // …
  color?: string
  /** Optional emoji shown on the icon-rail tile instead of the name's first letter.
   *  When unset, the UI falls back to the first letter. Non-indexed → no version bump. */
  icon?: string
}
```
- **No Dexie schema bump / no upgrade callback** — adding a non-indexed optional field
  needs neither (same precedent as `color?`, see [data-model.md](./data-model.md)).
- Old projects (no `icon`) render the letter — backward compatible by construction.
- Export/import: `icon` rides along inside the `project` object for free in both the
  full backup (`ExportPayload`) and the per-project bundle (`ProjectBundle`); no remap
  needed (it's not an id). See [persistence-and-backup.md](./persistence-and-backup.md),
  [project-export-import.md](./project-export-import.md).

## Implementation
### Render (`App.tsx`, icon rail)
- `const label = p.icon || p.name.trim().charAt(0).toUpperCase() || '·'` — `||` (not
  `??`) so a stored empty string also falls back to the letter.
- Render `{label}`. When `p.icon` is set, bump font-size to `text-[19px]` and set
  `letterSpacing: 0` (vs `text-[15px]` / `-0.01em` for the letter) so the glyph fills the
  36px tile. Tile `background` stays `p.color ?? colorForName(p.name)`.
- `title`/`aria-label` stay the project **name** (an emoji is not an accessible label).

### Edit UI (`members.tsx` → `ProjectSettingsView.tsx`)
- `EmojiPickerRow` lives in `members.tsx` next to `ColorSwatchRow`, mirroring its
  `{ value, onPick }` shape (`onPick: (icon: string | undefined) => void`):
  - `PROJECT_ICON_EMOJIS` — **15** curated emoji (🚀 🎯 ✅ 📌 📋 💡 🔥 ⭐ 📈 🐛 🔧 🎨 🧩 📦 🗂️),
    laid out `grid-cols-8` so they fill **exactly two rows** alongside the "Aa" chip.
  - A `query` state drives the view: empty → curated grid; non-empty →
    `emojiResultsFor(query)` over the shared `EMOJI` keyword set (capped at 24, English
    keywords). The project-planning glyphs dropped from the curated grid were added to
    that set so they stay searchable; a pasted/typed emoji is surfaced first via
    `firstGrapheme` (handles ZWJ sequences like 👨‍💻). No empty-state grid → a short
    "No emoji found" line instead.
  - Each glyph is a clickable chip; the selected one gets `ring-2 ring-accent`. The
    leading **"Aa"** chip (curated view only) clears the emoji (→ first-letter fallback).
  - `onPick(emoji | undefined)` → `updateProject(project.id, { icon })`. Clearing passes
    `icon: undefined`; the render `||` fallback makes the result correct whether Dexie
    deletes the key or stores `undefined`.
- `ProjectSettingsView.tsx`: an **"Icon"** field sits between Description and Color in the
  Project card, wired straight to `updateProject`.

## Rules & edge cases
- **Store at most one emoji.** The input caps length; multi-codepoint emoji (ZWJ
  sequences like 👨‍💻, flags) are fine as a single grapheme — don't split them. The cap
  only stops someone pasting a paragraph.
- **Empty / whitespace → unset** (falls back to the letter).
- **Letter fallback unchanged** — projects without an emoji look exactly as today.
- **Color still applies** behind the emoji; the two settings are independent.
- Emoji rendering is OS-native (Apple emoji on macOS) — acceptable since this is an
  in-app tile, not a shared asset that must be cross-platform identical.

## Future / open questions
- Show the emoji **before the project name** in the header / switcher rows too (v1 =
  rail tile only).
- Auto-suggest an emoji from the project name on create (deferred — keep create fast).
- Tune the 15-emoji curated set / search keywords if usage shows gaps.
