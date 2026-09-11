# Task rich text (inline formatting in task titles)

**Status:** Implemented
**Last updated:** 2026-09-11 (v3 — bubble works in the editor too; v2 bubble; v1 spec)
**Code:** `app/src/rich-text.ts` (parser, `stripRich`, `toggleMark`, `sourceIndexFor`,
`caretOffsetFromPoint`, `rangeToSource`), `app/src/RichText.tsx` (the render component +
`FormatBubble` toolbar — kept separate so
`react-refresh/only-export-components` stays happy), `app/src/SprintView.tsx`
(`TitleTextarea`), `app/src/CollectionView.tsx` (`ItemTitle`),
`app/src/CollectionCalendar.tsx` (`TitleInput`, shortcuts only), read-only renderers in
`BoardView.tsx`, `GanttView.tsx`, `PngExportCard.tsx`, `CollectionPngCard.tsx`,
`SnapshotViewer.tsx`, `CollectionSnapshotViewer.tsx`, `App.tsx` (command palette),
plain-text sinks in `telegram-export.ts` and `ActivityLog.tsx`.
Tests: `app/src/rich-text.test.ts`

## Purpose

A task title is often the only place a user writes a sentence ("7 tháp: pháo, chòi
phép, súng cánh quạt, …"). Today it is a flat string: every word looks the same, so
there is no way to make the key word stand out. This feature lets the user select a
word inside the title and mark it **bold**, *italic*, ~~struck~~, or ==highlighted==,
the way they would in any note app — without turning the field into a full rich-text
editor (which would cost a schema change, HTML sanitisation on the share link, and a
~100 KB editor dependency, all against the "calm utility / speed > breadth" DNA in
`design-system.md`).

## Approach: markdown-lite inside the same string

The title stays `Task.title: string`. Formatting is stored as **inline markers in the
text itself** — the same convention users already know from chat apps:

| Mark | Syntax | Renders as |
| --- | --- | --- |
| Bold | `**text**` | `font-semibold` |
| Italic | `*text*` | `italic` |
| Strikethrough | `~~text~~` | `line-through` (ink at 70 %) |
| Highlight | `==text==` | marker-pen yellow background (see *Rules*) |

No inline code, no links, no block syntax (headings/lists) — a title is one line of
prose, not a document.

**Why markers and not HTML:** zero migration, zero Dexie bump, backup/export files stay
human-readable, the share link (which is just the task JSON) needs no sanitiser, and
every existing consumer keeps working with a one-line `stripRich()` call.

## User-facing behavior

### Editing (List view + Collection list)

- The title cell is read-only until clicked. **Click** → it becomes the same textarea
  as today, showing the **raw markers** (`**đậm**`) so what you edit is what is stored.
- **Select a word → ⌘B / ⌘I** (Ctrl on Windows/Linux) wraps the selection in the
  marker. Full set:
  - ⌘B → `**…**`
  - ⌘I → `*…*`
  - ⌘⇧X → `~~…~~`
  - ⌘⇧H → `==…==`
- Pressing the same shortcut again on an already-wrapped selection **removes** the
  markers (toggle, not stack).
- With **no selection**, the shortcut inserts the empty pair and puts the caret between
  the markers (`**|**`), so the user can type straight into the mark.
- After a toggle the selection is restored around the *inner text* (not the markers),
  so ⌘B then ⌘I nests correctly: `***text***`.
- Typing markers by hand works identically — nothing is auto-corrected.
- **Blur** (Enter / click away) → the cell renders formatted, markers hidden.

### The selection bubble (primary, mouse-first path)

Shortcuts are the fast path but they are invisible — nothing on screen says the field
can be formatted. So **selecting text in a title pops a small floating toolbar** above
the selection: **B** · *I* · ~~S~~ · ==H==. It works on **both surfaces**:

- the **resting, formatted** title (drag-select without opening the editor), and
- **inside the editor** — the common case: you clicked in to type, then select a word.
  Selecting there keeps the editor open and the caret alive; the bubble just appears.

- Drag-select any part of a title **without entering edit mode** (a plain click still
  opens the editor with the caret where you clicked — the bubble needs a real drag,
  i.e. a non-collapsed selection).
- Click a button → the mark is applied to the underlying **source** string and written
  straight to the DB. The surface you were on stays as it was (read stays read, the
  editor stays focused), and the selection stays put so a second button can stack a
  second mark (bold *then* highlight).
- A button shows **active** (filled) when the whole selection already carries that mark,
  and clicking it then removes the mark — same toggle semantics as the shortcut.
- The bubble closes on: a click elsewhere, Escape, scroll, or a selection that collapses.
- The shortcuts keep working inside the editor, and also work **while the bubble is
  open** — same `toggleMark`, one code path.

This also fixes v1's known gap: read mode used to swallow drag-selection entirely
(`onMouseDown` preventDefault), so a title could not be selected or copied at rest.

### Reading (everywhere else)

Board cards, Gantt bars/labels, PNG export, both snapshot viewers, the hosted viewer
and the home dashboard render the formatted text. Anywhere the title goes into a
**plain-text sink** it is stripped instead:

- `title=` tooltips (Gantt bars, Board pills) — attribute can't hold markup.
- Copy-to-Telegram export — plain text by design (`telegram-export.ts`).
- Sorting / searching (command palette, Board sort) — match against stripped text, so
  typing `đậm` finds `**đậm**`.
- Activity log / change-log diff lines — stripped.

## Data

No schema change. `Task.title` and collection `title` stay `string`; they may now
contain marker characters — see the `title` row in
[`data-model.md`](./data-model.md). **No Dexie version bump.**

## Implementation

New module `app/src/rich-text.ts` (logic) + `app/src/RichText.tsx` (render):

```ts
type Mark = 'bold' | 'italic' | 'strike' | 'mark'
interface RichSeg { text: string; marks: Mark[]; from: number }  // `from` = index in the SOURCE

parseRich(src): RichSeg[]                       // single left-to-right scan
stripRich(src): string                          // parseRich → join text
isBlankRich(src): boolean                       // nothing visible after stripping
sourceIndexFor(src, renderedIdx): number        // rendered offset → raw offset
caretOffsetFromPoint(x, y, root): number | null // click point → rendered offset
rangeToSource(src, root, range): [number, number] | null  // DOM selection → raw offsets
renderedIndexFor(src, srcIdx): number           // inverse of sourceIndexFor
selectSourceRange(root, src, from, to)          // put a source range back on screen
marksAt(src, start, end): Mark[]                // marks covering the WHOLE range
setMark(src, start, end, mark, on): { value, start, end }
toggleMark(value, start, end, mark): { value, start, end }
markForKey(e): Mark | null
<RichText text={s} />                           // <>…<span class=…>…</span>…</>
<FormatBubble … />                              // the floating B/I/S/H toolbar
```

**Parser** — one pass, no regex backtracking, no dependency:

1. Scan for a delimiter at position `i`, longest first: `***` (bold + italic), `**`,
   `~~`, `==`, then `*`.
2. Look ahead for the matching closer **on the same line**, at least 1 char away, and
   not itself escaped.
3. No closer → the delimiter is literal text (so `2 * 3 * 4` and `a**b` stay as typed).
4. Closer found → recurse on the inner slice and union the mark(s) into each child seg.
5. Escape: a marker preceded by `\` is literal and the backslash is dropped.
6. Each segment records `from`, its start index in the source — that is what makes the
   click-to-caret mapping exact.

**`toggleMark` → `setMark`** does not splice delimiters in place. It re-marks the parse
tree and **re-serialises the whole title canonically**:

1. `marksAt` decides the direction (already marked → remove, else add).
2. Every segment is split at the selection bounds and the middle part gets (or loses)
   the mark.
3. `serializeRich` writes the segments back with marks nested in a fixed order
   (`bold → italic → strike → mark`), so bold + highlight is always `**==x==**`.
4. If the result doesn't parse back to the same segments — a literal `*` in the text
   pairing up with a marker we just emitted — it is re-serialised with those characters
   backslash-escaped.

Splicing was tried first and cannot survive what the bubble produces daily: a selection
crossing a mark boundary, or a mark nested two deep (`**==x==**` un-bolded has to reach
*past* the `==`). Rebuilding from the parse tree makes stray markers structurally
impossible — **the visible text is invariant by construction**, which is also how the
selection is carried across the rewrite (mapped through rendered offsets, the one thing
the old and new strings agree on).

An **empty** selection is the one splice left: it inserts the bare pair and parks the
caret between the markers.

**`TitleTextarea`** (`app/src/SprintView.tsx`) keeps its existing draft/debounce/auto-size
machinery untouched; two additions:

- `onKeyDown`: intercept the four shortcuts before the existing Enter handler, call
  `toggleMark`, `setDraft`, restore the selection in a `useLayoutEffect` (assigning
  `value` otherwise parks the caret at the end), and schedule the same 350 ms debounced
  commit as a keystroke.
- Render: an `editing` state swaps a `<div role="textbox" tabIndex={0}>` carrying
  `<RichText>` for the textarea. Both share one class string (`boxCls`) so the
  `.editable` border/padding — which the height math depends on — is identical and the
  row doesn't jump on click. `onMouseDown` preventDefaults, maps the click through
  `caretOffsetFromPoint` → `sourceIndexFor`, then focuses the textarea at that offset
  (fallback: end of text). Tab lands on the div and `onFocus` flips it to editing.

The swap (rather than a transparent-text overlay) is chosen so the resting state shows
**no markers at all** — the overlay trick would force the raw `**` to stay visible to
keep character positions aligned.

**`FormatBubble`** (`RichText.tsx`) is a portal-rendered toolbar; `useFormatBubble.ts`
feeds it from whichever surface holds the selection.

*Read mode* is positioned from `range.getBoundingClientRect()`. Flow:

1. `onMouseUp` / `selectionchange` on the read-mode div: if the document selection is
   non-collapsed and lives inside this cell, `rangeToSource` walks the same text nodes
   `caretOffsetFromPoint` does, turning the range's start/end into **rendered** offsets
   and then into **source** offsets via `sourceIndexFor`.
2. The bubble renders above the rect (flipped below when it would clip the viewport top),
   `position: fixed`, in a portal so a row's `overflow` can't clip it.
3. `onMouseDown` on a button preventDefaults — otherwise the click collapses the
   selection before the handler runs.
4. A button calls `toggleMark(source, from, to, mark)` and writes the result; the parent
   re-renders formatted, and the bubble re-maps its range so the selection survives.
   `marksAt` decides whether a button reads as active (the whole range already marked).

Read mode therefore **no longer** preventDefaults `mousedown`; the editor opens on a
plain click (a collapsed selection at mouseup) instead, which leaves native
drag-selection — and normal copy — working at rest. A `pointerRef` guard keeps the
div's `onFocus` from swapping in the textarea **mid-drag** (that killed the selection
before it existed).

*Edit mode* is simpler in one way and harder in another: `selectionStart/End` already
**are** source offsets (no mapping), but a textarea exposes no range to measure. So
`textareaSelectionRect` mirrors the value into an off-screen div that copies every
layout-affecting metric (font, padding, border, width, wrapping), wraps the selected
slice in a span, and reads that span's rect — the standard trick, and the only way to
anchor the bubble to the words instead of to the whole field. React's `onSelect` drives
it, so drag-select, ⇧+arrows and caret moves all keep the bubble in sync (it hides the
moment the selection collapses). The textarea's `onBlur` ignores a focus loss to
`[data-format-bubble]` so clicking a button never closes the editor.

## Rules & edge cases

- **Done tasks** already render `line-through text-ink-faint` on the whole title; an
  inner `~~…~~` is then visually redundant but harmless — no special-casing.
- **Group/parent rows** render bold (`bold` prop). Inner `**…**` is a no-op there;
  italic/strike/highlight still apply.
- **Unmatched markers stay literal.** A title like `3*4*5` renders `3` *4* `5` (that is
  the documented cost of the syntax); `\*` escapes it.
- **PNG export** renders through the DOM (`PngExportCard` / `CollectionPngCard`), so
  formatted spans come out for free — the layout measures the rendered box, not the
  string, so markers cost nothing there.
- **Leftover markers are visible text.** `****` has no valid span, so it renders as
  literal stars; `isBlankRich` reports blank only when nothing is left after stripping.
- **Highlight token:** `--color-highlight` in `index.css` — Apple yellow at 45 % (light)
  / 30 % (dark). Deliberately not the accent blue or `--color-priority-high`, both of
  which already carry meaning in a row.
- **Toggling can rewrite markers elsewhere in the title** (canonical re-serialisation) —
  e.g. `*a*` becomes `*a*` but `***a***` normalises to a fixed order. Visible text and
  marks are preserved exactly; only the raw spelling is normalised.
- **A literal `*` may gain a backslash** (`3 \* 5`) when a toggle would otherwise make it
  pair with an emitted marker. Only visible in the editor, and only when needed.
- **Bubble needs a drag, not a click.** A collapsed selection (plain click) opens the
  editor; only a real range pops the toolbar. Clicking then dragging inside the editor
  keeps the shortcut path, no bubble (a textarea has no DOM range to anchor to).
- **A selection spanning several rows** (drag down the list) shows no bubble — the range
  has to sit inside one title cell.
- **The calendar popover's title field** (`CollectionCalendar.TitleInput`) is always in
  edit mode, so it shows raw markers permanently; only the shortcuts are wired there.
- **IME:** the shortcut handler ignores events while `isComposing` (same guard the Enter
  handler already uses for Vietnamese input).
- **No auto-formatting of pasted markdown** beyond what the parser already renders.

## Future / open questions

- Should the Board card's inline title editor get the same shortcuts? (Deferred — the
  Board title is edited in a popover today.)
- A floating toolbar on selection (instead of shortcut-only) was considered and
  rejected for v1: it fights the one-click/one-keystroke rule and adds a hover surface
  to every row.
