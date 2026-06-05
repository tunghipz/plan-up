# Board view

**Status:** Implemented
**Last updated:** 2026-06-05
**Code:** `app/src/BoardView.tsx`

## Purpose
A calm, glanceable kanban for the sprint — "where is everything" at a status level.
Read-mostly; deep editing stays in the list view.

## User-facing behavior
- Three columns on the grey canvas: **To do · In progress · Done** (the `STATUS_ORDER`),
  each with the status icon, label, and a count. Columns are **natural-height** (each grows
  with its own cards, kanban-style — not force-stretched to equal height), so dragging a card
  between columns only relayouts the columns involved, not the whole board.
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
  - **Perf — cross-column drag stays at 60fps (layout/paint, not React).** With cards already
    memo-stable, the residual jank when crossing columns was pure layout/paint cost. Three fixes:
    - **Natural-height columns** (`items-start` on the grid + `[contain:layout]` on each
      `<section>`): the grid no longer force-stretches all columns to the tallest, so when the
      `<DropSlot>` (58px) leaves the source column and enters the target, only those two columns
      relayout — the reflow no longer cascades to the whole grid. `contain: layout` scopes each
      column's internal reflow to itself (no clip, so card shadows still bleed past the edge).
    - **rAF-coalesced hit-testing:** native `dragover` fires faster than the frame rate. The
      handler keeps `preventDefault`/`dropEffect` synchronous (HTML5 DnD needs them) but defers
      the `getBoundingClientRect()` + `setOver` into a single `requestAnimationFrame`, coalescing
      a burst of events into **one** read+update per frame *after* layout has settled — killing
      the per-event forced reflow (layout thrash). `clearDrag` cancels any pending frame. The
      drop lands on the last *committed* `over`, so the card lands exactly where the visible slot
      is (a stale pending frame can't desync slot vs. landing).
    - **Instant column tint** (dropped `transition-colors`): the `isOver` background tint now
      flips instantly instead of animating, so crossing no longer repaints both columns' full
      card stacks every frame for the transition's duration. `<DragGhost>` is also `memo`-wrapped
      so it doesn't re-render on each `over` change.
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

## Per-column sort
*Designed via /office-hours 2026-06-05 (builder mode); implemented same day.*

**What & why.** Each column gets its own sort so you can ask "what's next" per status
without disturbing the others — e.g. sort *In progress* by due date while *To do* stays
in your hand-dragged priority order. The board's identity is drag-to-reorder, so sort is
**additive**, never a replacement.

**Model.** Per-column state `{ mode, dir }`, `mode ∈ {manual, name, time, member}`, default `manual`:
- **manual** — today's behavior: `orderOf = boardOrder ?? sequence`, ascending (drag order).
- **name** — `title` A→Z, case-insensitive (reuse the List's `compareTasks` title branch).
- **time** — the **computed** date the card's Due chip shows (`planById.get(t.id).dueDate`
  + `endTime`), so chip and order always agree. Tiebreak: computed start, then `sequence`.
  Tasks with no due sink to the bottom regardless of `dir`.
- **member** — the assignee's `Member.name`, case-insensitive (the avatar the card shows),
  grouping a column by who owns each card. Tiebreak `sequence`. **Unassigned** cards (and
  group/parent cards with no own assignee) sink to the bottom regardless of `dir`.
- For **group (parent) cards**: name = parent title; time = the group's rolled-up **latest**
  child due (the end of the date-range chip), via the existing `groupRange`/`metaById` roll-up,
  so a group sorts by the same date it displays.

**Non-destructive overlay.** Picking name/time is view-only — it **never writes `boardOrder`**.
Switching a column back to **Manual** restores the hand-dragged order intact (the `boardOrder`
values were never touched).

**Drag stays first-class.** A drop is manual intent, so **dropping a card into a column
auto-switches that column's `mode` to `manual`** (`dropTo` sets `boardOrder` between the slot's
neighbours as today, then flips that column to manual so the drop position is honored and
becomes the new manual order). The source column keeps its own sort. This is the only state
change a drag causes. (Within a sorted column, the `<DropSlot>` still tracks the cursor; on
drop the column reverts to manual and the card lands at the slot.)

**Persistence.** `localStorage['plan-up:board-sort']` — a per-status map
`{ todo, in_progress, done } → { mode, dir }`, loaded on mount, saved on change. Survives
view/sprint/project switch and reload, mirroring the List's `plan-up:sort`. Validated on load
(unknown mode/dir → default), like `loadSort`. Kept **separate** from `plan-up:sort` because
this is per-column and carries the extra `manual` mode the List doesn't have.

**UI — native picker (design-system §5.5).** In each column `<header>`, right of the count, a
calm pill with a **hidden `<select>` overlay** for the mode (Manual · Name · Time · Member) —
the same native-picker pattern as the List's assignee/priority selects, not a bespoke popover.
Idle (manual) the pill shows just a faint `ArrowUpDown` glyph so the header stays quiet; when a
column is sorted the pill turns `accent` and shows the mode label (e.g. **Name**), with a small
**▲/▼ ghost button** beside it to flip direction. The control is `data-no-drag` so it never
starts a card drag. Chosen over a custom popover (via /huashu-design DNA review): the OS owns the
dropdown → free keyboard nav, dark-safe through tokens, zero custom outside-click chrome,
consistent with the rest of the app's pickers.

**Implementation notes (as built).**
- `byStatus` picks the comparator per column from `boardSort[status]`: `manual` = `orderOf`
  (`boardOrder ?? sequence`); `name` = case-insensitive title; `time` = `timeKeyById` (a memo
  that maps each task → its computed due key `YYYY-MM-DDThh:mm`, rolling a parent up to its
  latest child due); `member` = `membersById.get(t.assigneeId)?.name` lower-cased. No-due (time)
  and unassigned (member) tasks sink last regardless of `dir`. Reuses the precomputed `planById`
  (no extra scheduler runs — see the drag-perf note above).
- **Drop into a *sorted* column reindexes, doesn't fractional-insert.** Under a name/time
  sort the visible neighbours' `boardOrder` isn't monotonic, so a fractional insert would land
  wrong. `handleDrop` instead rewrites the whole column's `boardOrder` to `0,1,2,…` matching the
  displayed order with the card spliced in at the slot (one `db.transaction`), then flips the
  column to `manual` **after the write commits** (so it doesn't briefly re-sort stale values).
  A drop into a column already in `manual` keeps the old lightweight single fractional write.
- `SortMenu` (per column) is `memo`'d with stable props (`sort` ref stable unless that column
  changed; `onChange = setColSort` is a `useCallback`), so the frequent re-renders during a card
  drag skip it — preserving the drag-perf work. The icon button carries `data-no-drag`.

## Rules & edge cases
- Board is intentionally minimal — no inline date/effort/prereq editing (that's the list).
- Active view persisted at `localStorage['plan-up:view']`.
- Per-column sort persists at `localStorage['plan-up:board-sort']`; a drag into a column resets
  that column to manual sort.
