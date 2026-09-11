# Task rich text (inline formatting in task titles)

**Status:** Implemented
**Last updated:** 2026-09-11 (initial spec + implementation)
**Code:** `app/src/rich-text.ts` (parser, `stripRich`, `toggleMark`, `sourceIndexFor`,
`caretOffsetFromPoint`), `app/src/RichText.tsx` (the render component — kept separate so
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
toggleMark(value, start, end, mark): { value, start, end }
markForKey(e): Mark | null
<RichText text={s} />                           // <>…<span class=…>…</span>…</>
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

**`toggleMark`** takes the value + `selectionStart/End`, decides whether the selection
is already wrapped (markers inside the selection, or immediately outside it), then
splices in or out and returns the new string plus the selection to restore. For the two
star marks the *run* of `*` on each side is measured rather than a prefix match — `*`
and `**` share a prefix, so a naive test would shave one star off a bold pair and leave
`*text*` behind. Run of 1 = italic, 2 = bold, 3+ = both; a toggle removes only the mark
asked for.

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
- **Read mode swallows text selection.** `onMouseDown` preventDefaults to place the
  caret, so a title can't be drag-selected at rest — select it inside the editor instead.
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
