# Member avatars

**Status:** Implemented
**Last updated:** 2026-06-19
**Code:** `app/src/members.tsx` (`Avatar`, `AvatarPicker`), `app/src/db.ts`
(`setMemberAvatar`, `resizeImageToDataURL`, `Member.avatarImage`/`avatarEmoji`),
`app/src/lib.ts` (`firstGrapheme`), `app/src/ProjectSettingsView.tsx` (`MemberRow`)

## Purpose
Give each member a recognizable face instead of just a colored initial. A member
can have a **custom photo** or an **emoji**; with neither set it falls back to the
existing colored-initial avatar. Local-first — the image lives in IndexedDB and
travels inside the per-project export. No backend, no auth.

## Data model
Two **optional, non-indexed** fields on `Member` (no Dexie version bump — same
pattern as `title?`; see [data-model.md](./data-model.md)):
- `avatarImage?: string` — a resized image data-URL (≤128px square, webp or jpeg).
- `avatarEmoji?: string` — a single emoji grapheme.

They are **mutually exclusive**: `setMemberAvatar` clears the other whenever one is
set. Old rows / old exports simply lack both fields and read as the colored initial.

## Render — `Avatar` (3-tier fallback)
The single `Avatar` component (used by SprintView, BoardView, GanttView, settings)
resolves in order:
1. `avatarImage` → `<img>` filling the circle (`object-cover`).
2. else `avatarEmoji` → emoji centered on `member.color` background.
3. else → first initial on `member.color` background (unchanged from before).

Because there is one render point, every surface updates for free.

## Editing — `AvatarPicker` (Project Settings only)
Avatars are edited **only** in the Project Settings member row (gear → settings),
matching where rename/title/color/days-off live — one place, no drifting
affordances. The member's `Avatar` is rendered as a button; clicking opens a small
**absolute popover** (no portal — the Members card has no overflow clip).

Layout = **Segmented** (chosen from a 3-way prototype, see *History*):
- Preview row (live 44px avatar + name/title).
- Apple **segmented control `Photo | Emoji`** (track `bg-fill rounded-[9px]`,
  selected segment = white floating pill). Active tab defaults to the member's
  current state (image set → Photo, else Emoji).
- One swapping **panel**:
  - **Emoji**: grid of suggested emoji + a text input. Commit takes the first
    grapheme via `firstGrapheme` (`Intl.Segmenter`) — handles ZWJ sequences
    (👨‍👩‍👧), flags, skin-tone modifiers without truncating.
  - **Photo**: "Upload" button → hidden `<input type="file"
    accept="image/png,image/jpeg,image/webp,image/gif">` → `resizeImageToDataURL`
    → `setMemberAvatar`. Disabled + spinner while resizing; shows the size saved.
- **Remove** (only when image or emoji is set) → clears both, back to initial.

## Image handling — `resizeImageToDataURL(file, size=128)`
Client-side, so the DB and the shareable export file stay small (a multi-MB photo
→ a few KB):
- Center-crops to a square and draws onto a `size×size` canvas.
- Exports `toDataURL('image/webp', 0.85)`. webp encoding **silently returns a PNG**
  on unsupported browsers (it does not throw), so it checks the
  `data:image/webp` prefix and re-encodes to JPEG if absent.
- Rejects non-raster MIME (SVG excluded), files > 10MB, and undecodable images,
  each with a friendly message the picker surfaces. GIF flattens to its first frame.

## Export / import
Members are serialized whole (`project-io.ts` spreads each member object), so the
new fields ride along with **no code change and no `ProjectBundle` version bump** —
old exports just lack them.

## Tests
- `db.test.ts` — `setMemberAvatar` mutual exclusion + null-clears + persists.
- `lib.test.ts` — `firstGrapheme` (ASCII, ZWJ family, flag, empty).
- `resizeImageToDataURL` is canvas/`Image`-based → not runnable under the node test
  env; verified in-browser. (Visual prototypes: `demo/member-avatars.html`,
  `demo/avatar-picker-variations.html`.)

## History
- 2026-06-19: feature added. Picker layout chosen as **Segmented** over "Stacked"
  and "Action tiles" via a side-by-side demo (compact height + canonical Cupertino
  segmented control; tradeoff: one extra click to switch photo↔emoji).
