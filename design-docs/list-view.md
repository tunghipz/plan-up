# List view

**Status:** Implemented
**Last updated:** 2026-07-06 (calm refinements: time-on-hover dates, quiet empty cells, sticky-light group headers, compact rows, `#`-prefixed prereq)
**Code:** `app/src/SprintView.tsx` (`MemberCard`, `UnassignedCard`, `GroupHeader`,
`TaskColumnHeader`, `SortHeader`, `COL`, `TaskRows` drag state, `TaskRow` grip),
`app/src/DatePicker.tsx` (`DatePickCell` time-on-hover), `app/src/db.ts` (`orderBetween`, `setListOrder`)

> **v4 · calm refinements (2026-07-06)** — a signal-to-noise pass on the row grid
> (demo `demo/list-view-refinements.html`, options approved by user):
> 1. **Date time-of-day shows on row hover only.** The working-hours suffix (`, 08:00` /
>    `, 17:00`) was repeating on every row for near-zero info. The date shows at rest; the
>    `, HH:mm` tail fades in on `group-hover/row`. `DatePickCell` gained a `timeOnHover` prop
>    (List passes it; Collections/other callers keep time inline).
> 2. **Quiet empty cells.** A resting empty Effort / Prereq / date renders its `—` at ~25%
>    opacity (was full `ink-faint`); editable-empty cells reveal their `＋` add-affordance on
>    row hover. The grid of dashes no longer competes with real data.
> 3. **One sticky column header** for the whole list (was: a repeated header inside every
>    group card). It's rendered once at the top of `space-y-4` and **pins to the top of the
>    scroll area** as you scroll — it sticks because nothing between it and the scroll
>    container (`scrollRef` in App) is an overflow box, unlike the old per-card headers which
>    were trapped inside each card's `overflow-x-auto`. It uses the **member column layout**
>    (no Assignee column) and mirrors the member cards' `overflow-x-auto` / `min-w-[820px]` so
>    columns line up. The header itself is also lightened (no grey fill; sits on the canvas).
>    **Exception:** the **Unassigned** card keeps its *own* inline header, because it adds an
>    Assignee column the member layout doesn't have — one header can't align with both column
>    sets. The global header only renders when there's ≥1 member group (`groups.length > 0`).
>    *Caveat:* on a viewport narrow enough to trigger each card's horizontal scroll (<~820px
>    of column width, rare on this desktop-first tool) the pinned header won't track a card's
>    independent horizontal scroll.
> 4. **Compact rows** (~40px, was ~48px) — more tasks per screen (speed DNA).
> 5. **Prereq shows `#7`** (was bare `7`) — matches the `#N` language used in the cycle/notice
>    popovers and disambiguates an ID reference from a count. Prefix is display-only (the input
>    edits raw numbers).
> 6. The **sprint-note** empty state is a slim left-aligned ghost (see
>    [app-shell-and-navigation.md] / `SprintNoteBanner`), not a full-width dashed bar.

## Purpose
The primary editing surface: every task in the sprint, grouped by assignee in
inset-grouped cards, fully editable inline.

## User-facing behavior
- One **card per member** (plus an **Unassigned** card, and a collapsed "members with no
  tasks" section). Each card = a `GroupHeader` + task rows + an "Add task" row. The
  **column header is a single sticky bar** at the top of the list (not repeated per card) —
  see v4 note above. (The Unassigned card is the one exception that keeps an inline header,
  since it carries an extra Assignee column.)
- **Collapse** a member card by clicking its header (persisted per sprint).
- **Sort** by any column via its header (`ID, Task, Effort, Start, End, Status, Prereq`);
  clicking a column **cycles three states: asc → desc → off**. "Off" is a NEUTRAL state
  (`sort.field === null`) where **no column shows an arrow** and rows fall back to the manual
  order (`listOrder ?? sequence`), which also re-enables drag-to-reorder. The active column
  shows an arrow (▲/▼); cleared/neutral columns show none. Every column — including `ID`/`seq`
  — can reach neutral, so its arrow can always be turned off. (Neutral and an explicit `seq asc`
  render the same row order — `seq` IS the manual order — the only difference is whether the
  ID header shows an arrow.) Sort is **shared across all member cards** (one preference, not
  per-member) and **persisted** so it survives switching view/sprint/project and a page reload
  (defaults to neutral first run).
- Sorting by **Start** / **End** uses the *displayed* date, not the raw stored field.
  Leaf rows show the **scheduled** plan date (`computeWorkingPlan`) and a group-head row shows
  a **rollup** (earliest child start … latest child end); its own stored `dueDate` never tracks
  that rollup. `compareTasks` therefore sorts these two columns by a per-lane `dateKeys` map of
  the same composite `date+time` keys the cells render, so a parent lands where its End cell says
  it should. (Before this, a parent sorted by its often-empty raw `dueDate` → jumped to the bottom
  even when its rolled-up End was early.) Empty dates sort last ascending.
- Member cards omit the **Assignee** column (everyone in the group is the same person);
  the Unassigned card keeps it.
- A task with **Effort = 0** renders as a **milestone**: a `◆ Milestone` pill after the
  title and a single collapsed milestone date (instead of a `Start → End` span). This is
  distinct from Effort `—` (*not estimated*, ⚠). See [milestones.md](./milestones.md).

## Drag-to-reorder
A hover-revealed **grip** (`GripVertical`, leftmost gutter, `cursor-grab`) lets you drag a
task to a new position — like ClickUp. Manual order is stored in `Task.listOrder` (fractional;
falls back to `sequence` when unset) and is **never logged** (arrangement, not data). `sequence`
is never touched, so task-numbers and prereq references stay stable.

- **Only enabled in the manual ascending order** — neutral (`sort.field === null`) or an
  explicit `seq asc`. Under any other sort — name/date/… **or even `seq DESC`** — the grip is
  hidden and rows aren't draggable. (Descending matters: the drop math writes a fractional
  `listOrder` *between the two displayed neighbours*, which only resolves correctly when the
  display is ascending; in a descending view `before > after`, so the value can't separate and
  the drag would silently scramble/no-op. So drag is gated to the ascending manual order only.)
  That order sorts by `listOrder ?? sequence` (tiebreak `sequence`), so it's monotonic
  and a drop just writes a fractional value **between the two displayed neighbours** (e.g.
  between 2 and 3 → 2.5); no global reindex needed.
- **Within a member card only.** Dropping onto a different card is a no-op (snap back) —
  reassigning still goes through the assignee picker, not drag.
- **Only a genuine drop repositions.** Releasing the grip **without moving** (or dropping
  back onto the dragged row / into its own gap — same neighbours before and after) is a
  **no-op**: nothing is written, so grabbing a grip and letting go never perturbs
  `listOrder`.
- **Same level only.** A top-level task reorders among top-level tasks; a child reorders among
  its **siblings under the same parent**; dragging a **group head** moves the whole group (its
  children travel with it). Dragging across levels / into or out of a group is a no-op — use
  Group / Ungroup (selection bar) to reparent. (See [task-groups.md](./task-groups.md).)
- **Mechanics:** **Pointer Events** (not native HTML5 DnD). The grip's `onPointerDown`
  captures the pointer (`setPointerCapture`), so every move/up routes to the grip wherever
  the cursor goes; the owner resolves the row under the cursor via
  `document.elementFromPoint(...).closest('[data-task-id]')` (lanes use `[data-lane-id]`).
  *Replaced native HTML5 drag (2026-06-30): the old approach toggled the row `draggable`
  imperatively and relied on `dragover`→`preventDefault` timing, which silently failed in
  some browsers (the row showed the "dragging" fade but never dropped). Pointer events are
  consistent cross-browser and don't touch `draggable`, so row text stays selectable.* A 2px
  accent **insertion line** marks the drop slot, computed from the pointer vs each row's
  mid-height. `orderBetween(prev, next)` (db.ts) returns the fractional value;
  `setListOrder(id, order)` persists it raw.
- **The insertion line only shows where a drop would actually move the row.** The hover
  handler runs the *same* `computeDropSlot` the drop does and suppresses the line for a
  `null`/`ownGap` slot — so the ~2-row band around the dragged row's current slot (its own
  gap: bottom-half of the row above + top-half of the row below) shows **no line**, matching
  the no-op. Fix (2026-07-06): previously the line appeared for any hovered neighbour
  regardless of `ownGap`, so dragging a row a half-step onto an adjacent neighbour lit the
  line but releasing did nothing — the row looked stuck. To move a row down one slot, drag
  past the next row's mid-height (its bottom half). Same gating in the member-lane and
  Collections drags (all share `reorder.ts`).

## Column widths (`COL`)
Fixed widths sized to measured content + a small buffer; **Task** is `flex-1` and absorbs
slack:
`dot 16 · ID 32 · Task flex(min 150) · Assignee 64 · Effort 80 · Start 112 · End 112 ·
Status 112 · Prereq 56 · actions 16`. Header & rows share the same `COL` constants so
they stay aligned.

## Horizontal scroll
Each group wraps its rows in `overflow-x-auto` with a `min-w` floor (**member 820px**,
**unassigned 896px**) ≥ true content width; the **single sticky header** mirrors the member
`overflow-x-auto` / `min-w-[820px]` so it aligns. On narrow screens the table scrolls instead
of crushing the Task column. *(Caveat: the pinned header doesn't track a card's independent
horizontal scroll on very narrow viewports — see v4 note.)*

## Rules & edge cases
- Changing a `COL` width means re-checking the `min-w` floors (must stay ≥ summed content).
- Collapse state key: `localStorage['plan-up:collapsed:<sprintId>']`.
- Sort state key: `localStorage['plan-up:sort']` — a single global `{field, dir}` (not
  per-sprint, since the sort is one shared preference). Seeded into state on mount and
  re-written on every change; a missing/corrupt value falls back to `seq asc`.
- Group header right side surfaces the member summary — see
  [member-header-summary.md](./member-header-summary.md).
- Drag-reorder writes `listOrder` raw (no change-log entry) and never recomputes dates or
  touches `sequence`; it's pure arrangement. Falls back to `sequence` for any task never dragged.
