# List view

**Status:** Implemented
**Last updated:** 2026-06-05
**Code:** `app/src/SprintView.tsx` (`MemberCard`, `UnassignedCard`, `GroupHeader`,
`TaskColumnHeader`, `SortHeader`, `COL`, `TaskRows` drag state, `TaskRow` grip),
`app/src/db.ts` (`orderBetween`, `setListOrder`)

## Purpose
The primary editing surface: every task in the sprint, grouped by assignee in
inset-grouped cards, fully editable inline.

## User-facing behavior
- One **card per member** (plus an **Unassigned** card, and a collapsed "members with no
  tasks" section). Each card = a `GroupHeader` + its own labelled column header + task rows
  + an "Add task" row.
- **Collapse** a member card by clicking its header (persisted per sprint).
- **Sort** by any column via its header (`ID, Task, Effort, Start, End, Status, Prereq`);
  click toggles asc/desc, active column shows an arrow. Sort is **shared across all
  member cards** (one preference, not per-member) and **persisted** so it survives
  switching view/sprint/project and a page reload (defaults to `seq asc` first run).
- Member cards omit the **Assignee** column (everyone in the group is the same person);
  the Unassigned card keeps it.

## Drag-to-reorder
A hover-revealed **grip** (`GripVertical`, leftmost gutter, `cursor-grab`) lets you drag a
task to a new position — like ClickUp. Manual order is stored in `Task.listOrder` (fractional;
falls back to `sequence` when unset) and is **never logged** (arrangement, not data). `sequence`
is never touched, so task-numbers and prereq references stay stable.

- **Only enabled in the default order** (`sort.field === 'seq'`). Under any other sort
  (name/date/…) the grip is hidden and rows aren't draggable — that arrangement is read-only.
  The default view sorts by `listOrder ?? sequence` (tiebreak `sequence`), so it's monotonic
  and a drop just writes a fractional value **between the two displayed neighbours** (e.g.
  between 2 and 3 → 2.5); no global reindex needed.
- **Within a member card only.** Dropping onto a different card is a no-op (snap back) —
  reassigning still goes through the assignee picker, not drag.
- **Same level only.** A top-level task reorders among top-level tasks; a child reorders among
  its **siblings under the same parent**; dragging a **group head** moves the whole group (its
  children travel with it). Dragging across levels / into or out of a group is a no-op — use
  Group / Ungroup (selection bar) to reparent. (See [task-groups.md](./task-groups.md).)
- **Mechanics:** native HTML5 DnD (same as the Board). Drag is armed only from the grip
  (`onPointerDown` flips the row `draggable`, reset on `dragend`), so the whole row is the drag
  image but plain clicks elsewhere never start a drag. A 2px accent **insertion line** marks the
  drop slot, computed once per frame from the pointer vs each row's mid-height (mirrors the
  Board's `over` slot). `orderBetween(prev, next)` (db.ts) returns the fractional value;
  `setListOrder(id, order)` persists it raw.

## Column widths (`COL`)
Fixed widths sized to measured content + a small buffer; **Task** is `flex-1` and absorbs
slack:
`dot 16 · ID 32 · Task flex(min 150) · Assignee 64 · Effort 80 · Start 112 · End 112 ·
Status 112 · Prereq 56 · actions 16`. Header & rows share the same `COL` constants so
they stay aligned.

## Horizontal scroll
Each group wraps its header + rows in `overflow-x-auto` with a `min-w` floor (**member
820px**, **unassigned 896px**) ≥ true content width. On narrow screens the table scrolls
instead of crushing the Task column, and the grey column-header background still spans the
full content width (no fall-short on scroll).

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
