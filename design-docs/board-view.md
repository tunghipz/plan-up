# Board view

**Status:** Implemented
**Last updated:** 2026-06-04
**Code:** `app/src/BoardView.tsx`

## Purpose
A calm, glanceable kanban for the sprint — "where is everything" at a status level.
Read-mostly; deep editing stays in the list view.

## User-facing behavior
- Three columns on the grey canvas: **To do · In progress · Done** (the `STATUS_ORDER`),
  each with the status icon, label, and a count.
- **Cards** (white, large-radius, soft shadow) show: status circle (click to cycle status),
  title, `#sequence`, priority tag (urgent/high only), a due chip, and the assignee avatar.
- **Task groups (parents)** are bucketed and shown by their **derived status** (rolled up
  from children via `derivedGroupStatus`), so a group reads consistently with List/Timeline
  (never stuck in *To do* just because the container's own status was never changed). A group
  card shows: a bold title + a *layers* glyph, a thin **progress bar** + `done/total` badge,
  and a **date-range chip** (`MMM d – MMM d`) rolled up from its children (earliest start …
  latest end — parents have no own dates). Its status circle is **not clickable** (status is
  derived). Children still appear as their own cards in their own status columns, each tagged
  with a faint **`↳ <parent title>`** chip so its group membership is visible across columns.
- **Due chip** shows the **live computed** due date **+ time** (e.g. `Jun 11, 17:00`, from
  `computeWorkingPlan` — same source as List/Timeline, never a stale stored date), color-coded
  by urgency: done → green; overdue → red; within 3 days → orange; else faint. Soft-tinted via
  tokens (dark-safe).
- **Quick-edit (hover toolbar)** — hovering a leaf card reveals a small top-right toolbar
  with two actions, keeping the card clean otherwise:
  - **Assign** (person icon) — opens the member dropdown (reuses the List `assigneeId`
    flow: `update` + `recomputeDates`, since a reassign changes which member's days-off
    apply).
  - **Schedule** (calendar icon) — opens a small popover with **Effort** (`EffortCell`) +
    **Start** + **End** (`DatePickCell` ×2), mirroring the app's "set effort → dates compute"
    flow. Reuses the List's **lock rules**: Start is locked when the task has prerequisites;
    End is locked when it has prerequisites *or* effort > 0 (those are scheduler-derived, so
    setting Effort auto-fills End). Effort and Start changes call `recomputeDates`; all write
    through the same inputs the List edits, so the Board never overrides auto-scheduling.
    Group cards get no toolbar (their dates are derived, they're containers).
- **Drag to reorder / change status** — drag a leaf card to a position in any column.
  ClickUp-style feedback: the card is **lifted out** of its slot and **rides the cursor as a
  tilted, shadowed ghost** (the browser's default drag image is suppressed); an **empty gap**
  opens at the cursor's insertion point in the target column (which tints) to show where it
  will land. So you see *what* is moving (the floating card) and *where* (the gap).
  On drop the card takes that column's status **and** a manual order so it **stays exactly
  where it was dropped** (within-column reorder works too). Dragging near the top/bottom edge
  **auto-scrolls** the board. Dragging never starts from an interactive control (status
  circle / toolbar / date popover), so quick-edit keeps working. **Group (parent) cards
  aren't draggable** (status derived); the status circle's click-to-cycle is the
  pointer/keyboard alternative.
- **Limitation:** native HTML5 DnD is pointer-only — **touch screens can't drag** (use the
  status circle to cycle). A Pointer-Events touch path is a possible later addition.
- Search filters cards by title (see [search-and-keyboard.md](./search-and-keyboard.md)).

## Data
Reads the current sprint's `tasks` (passed in) + the project's `members` (for avatars and
the assign menu). Mutations: status (cycle), `assigneeId` (quick-edit, + `recomputeDates`),
and `estimate` / `startDate` / `dueDate` (quick-edit, respecting the same lock rules and
recompute as the List).

## Implementation
- `byStatus` buckets filtered tasks by their **effective status** — `derivedGroupStatus`
  for a parent (a task that heads a group), raw `task.status` otherwise. Within a column,
  tasks sort by `orderOf = boardOrder ?? sequence`, **ascending for all columns** (top =
  first — predictable for drag; replaced the old Done-desc).
- `cycleStatus` advances `todo → in_progress → done → todo`; it's a no-op for parents
  (their status is derived).
- **Drag-and-drop** uses the native HTML5 DnD API (no library):
  - `dragId` (hidden source) + `over = {status, index}` drive the empty `<DropSlot>` gap.
    `onDragStart` suppresses the native drag image (`setDragImage(BLANK_DRAG_IMG)`); a
    `<DragGhost>` (the dragged task, `rotate-3deg`, shadow, `pointer-events-none`) is rendered
    fixed and **positioned imperatively** via `ghostRef.style.transform` in the dragover
    listener (no re-render per move) so it tracks the cursor smoothly.
    `onDragStart` seeds `over` at the card's own slot (instant 1:1 swap) and **cancels** the
    drag if it began on a control (`closest('button, select, input, a, label')`), so the
    status circle / toolbar / popover keep working.
  - Each card's `onDragOver` computes the index from the cursor's vertical half and
    `stopPropagation`s; the column handler only **seeds** the index (to end) on column-*enter*
    and never re-sets it (re-setting on every dragover bounced the slot → flicker). There's no
    `onDragLeave` clear, so the slot doesn't flash crossing the gutter. `<DropSlot>` is
    `pointer-events-none` so it never intercepts hit-testing.
  - `onDrop` computes a fractional `boardOrder` between the slot's display neighbours
    (`orderForDrop`, skipping the dragged card) and writes `{status?, boardOrder?}` so the
    card persists at the dropped position. Parents set `draggable=false`; dropping a parent
    id is ignored.
  - `scrollableAncestor(gridRef)` finds the board's scroll container; a rAF loop edge-scrolls
    it while dragging. A document `dragend` listener is a backstop that always clears
    `dragId` (so a hidden source can never get stuck).
  - **Perf:** each task's `computeWorkingPlan` is precomputed once into `planById` (useMemo
    keyed on tasks), so the per-index-change re-renders during a drag don't re-run the
    scheduler for every card's due chip — that recompute was the drag-jank source.
- Reuses `STATUS_META` / `STATUS_ORDER` / `StatusIcon` / `derivedGroupStatus` / `DatePickCell`
  / `EffortCell` from `SprintView.tsx`, and `recomputeDates` / `computeWorkingPlan` from
  `db.ts` — so the quick-edit lock rules and recompute behavior stay identical to the List,
  single-sourced.

## Rules & edge cases
- Board is intentionally minimal — no inline date/effort/prereq editing (that's the list).
- Active view persisted at `localStorage['plan-up:view']`.
