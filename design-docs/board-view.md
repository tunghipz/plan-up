# Board view

**Status:** Implemented
**Last updated:** 2026-06-05
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
- **Add task — bottom ghost composer (per column)** — every column carries a quiet blue
  **`+ Add task`** affordance at its **bottom** (Apple toolbar ghost, §5.10 of the design
  system). Click → it becomes a card-shaped inline composer in place (autofocused textarea):
  - **Enter** creates the task and **keeps the composer open** (cleared + refocused) for rapid
    multi-entry — adding three tasks is three titles + three Enters, no re-click.
  - **Esc**, or **blur while empty**, closes it (Shift+Enter inserts a newline rather than
    submitting). Blur with text pending does *not* close (mirrors the List's "click-outside
    doesn't cancel" rule, §6.3) — only the Cancel button / Esc / empty-blur close.
  - The new task inherits that **column's status** (add under *In progress* → starts
    in_progress), and the List's create defaults (§5.3.1): `sprintId` = current sprint,
    `startDate` = sprint start, **unassigned**, priority `normal`, no due/effort, `dependsOn []`.
    `sequence` comes from `nextSequence(sprintId)` — the **same creation path as the List**, so
    Board-created tasks are indistinguishable from List-created ones.
  - It appends to the column bottom; manual `boardOrder` is left unset (sorts after existing
    cards by sequence), so a freshly added card sits at the end until dragged.
  - **Groups can't be created from the Board** (grouping stays a List action); the composer
    only makes leaf tasks.
- **Limitation:** native HTML5 DnD is pointer-only — **touch screens can't drag** (use the
  status circle to cycle). A Pointer-Events touch path is a possible later addition.
- Search filters cards by title (see [search-and-keyboard.md](./search-and-keyboard.md)).

## Data
Reads the current sprint's `tasks` (passed in) + the project's `members` (for avatars and
the assign menu). Takes `sprintId` + `sprintStartDate` props (for the add-task defaults).
Mutations: status (cycle), `assigneeId` (quick-edit, + `recomputeDates`), `estimate` /
`startDate` / `dueDate` (quick-edit, respecting the same lock rules and recompute as the
List), and **task creation** via `db.tasks.add` + `nextSequence` (bottom composer).

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
  - **Perf — cards don't re-render while dragging.** A drag fires `onDragOver` constantly,
    each call bumping the `over` placeholder index → BoardView re-renders. To keep that from
    re-rendering every card on every move:
    - `BoardCard` is wrapped in **`React.memo`**, and every prop is passed with a **stable
      identity**: the drag handlers are `useCallback`s that read the card's id/status/index
      from `data-*` attributes on the DOM node (not closures over the rendered index), and the
      `group` roll-up / `displayStatus` / `parentTitle` come from a memoized **`metaById`** map
      (a fresh inline `{done,total,range}` object each render would otherwise bust memo).
    - Result: a dragover only re-renders the lightweight `<DropSlot>` placeholder; the dragged
      card re-renders once (its `dragging` flag flips it to `hidden`); **all other cards skip
      rendering entirely**. Measured: 0 card renders across 60 dragovers on a 17-card column.
    - Each task's `computeWorkingPlan` is still precomputed once into `planById` (useMemo keyed
      on tasks), so even when a card *does* render its due chip never re-runs the scheduler.
    - The board is written to the DB **only on drop** (`dropTo`), never mid-move.
- Reuses `STATUS_META` / `STATUS_ORDER` / `StatusIcon` / `derivedGroupStatus` / `DatePickCell`
  / `EffortCell` from `SprintView.tsx`, and `recomputeDates` / `computeWorkingPlan` from
  `db.ts` — so the quick-edit lock rules and recompute behavior stay identical to the List,
  single-sourced.
- **`AddTaskComposer`** (one per column) toggles between the ghost `+ Add task` button and an
  inline textarea. It builds the task exactly like the List's `AddTaskRow` (`uid()` +
  `nextSequence(sprintId)` + the §5.3.1 defaults) but with `status` set to the **column's**
  status instead of always `todo`. On submit it stays open and refocuses; Esc / empty-blur
  closes. Dragging is suppressed inside it (the article isn't draggable; the composer isn't a
  card).

## Rules & edge cases
- Board is intentionally minimal — no inline date/effort/prereq editing (that's the list).
- Active view persisted at `localStorage['plan-up:view']`.
