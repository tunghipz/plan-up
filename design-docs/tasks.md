# Tasks

**Status:** Implemented
**Last updated:** 2026-09-11 (bulk **Assign** — move the selection to another member)
**Code:** `app/src/SprintView.tsx` (`TaskRow`, `AddTaskRow`, `TitleTextarea`,
`EffortCell`, `DatePickCell`, `PrereqInput`, `SelectionBar`, `AssignPopover`),
`app/src/db.ts` (`reassignTasks`)

## Purpose
The task is the unit of work. Everything else (sprints, members, scheduling) exists to
organize and plan tasks.

## Fields
`title` · `assigneeId` · `sprintId` · `status` · `priority` · `startDate` · `dueDate` ·
`estimate` (effort, days) · `dependsOn` · `sequence` (per-sprint ID) · `createdAt`.
See [data-model.md](./data-model.md).

## User-facing behavior
- **Add:** the "Add task" row at the bottom of a group — type a title, then **Enter** or
  **blur** (click away / Tab) to commit, so a typed-but-unsubmitted title is never lost.
  Empty input commits nothing; the synchronous clear means Enter-then-blur can't double-add.
  New task: `status='todo'`, `priority='normal'`, `startDate = sprint start`,
  `sequence = nextSequence`.
- **Edit inline** (all in-row): title, effort, start/end date, status, prereqs, assignee.
- **Delete:** select the task (hover → checkbox) and use **Xoá** on the floating
  `SelectionBar` (confirm). Works on a multi-select too. There is **no per-row kebab** —
  the bar is the only delete affordance. Cascade-strips the task from other tasks'
  `dependsOn`; deleting a group head ungroups its children (does not cascade). See
  [task-groups.md](./task-groups.md).

## Bulk assign — move the selection to another member

The floating `SelectionBar` carries an **Assign** button (between the count and the prereq
actions). It moves every selected task into another member's lane in one go — the bulk
counterpart of the per-row `AssigneePicker`.

Interaction (direction B of `demo/assign-member/`, chosen 2026-09-11):
- Click **Assign**, or press **`a`** while a selection is live, to open a popover **above**
  the bar. The search field takes focus on open, so the whole flow is keyboard-only.
- **Type** to filter by name or role title · **↑ / ↓** to move · **Enter** to assign ·
  **Esc** to close. The rows are also plain click targets.
- The list shows every project member plus **Unassigned**. A **✓** marks the lane the
  selection currently sits in (nothing is marked when the selection spans lanes).
- Assigning closes the popover and clears the selection — the rows have left the lane you
  were looking at, so keeping them selected would point at nothing.

Why a popover and not avatars inline on the bar: members are virtual and the roster grows
freely, so the picker has to stay usable at 30 members. The demo's inline-avatar and
bar-morph variants both stop working past ~6.

### What moving does to the rest of the row
- **Dates recompute** for every moved task (`recomputeDates`) — the target member's days off
  are different, so the plan has to re-derive. See [scheduling.md](./scheduling.md).
- **A group child is ungrouped** on the way out: groups never span members
  ([task-groups.md](./task-groups.md)), so moving a child out of its lane clears `parentId`.
- **A group head takes its children with it** — the whole group lands in the target lane,
  intact, because moving the head alone would split the group across two members. The List
  gives a head no select checkbox today, so this path is a guarantee at the data layer
  (`reassignTasks`) rather than something the UI can currently reach.
- **The task lands at the bottom** of the target lane (`listOrder` = the lane's max + 1),
  the same place a newly added task appears. Carrying the old `listOrder` across would drop
  the row in an arbitrary spot in a lane it has never been in.
- Each move is one logged edit (`assigneeId` is a `LoggableField`), so the sprint activity
  log shows `Assignee A→B` per task.

## Inline editing affordance
All click-to-edit text fields share the `.editable` class (`index.css`):
invisible at rest → soft fill on hover → white surface + accent border on focus. Used by
the **task title**, **add-task**, **effort**, **prereq** inputs, and member/sprint rename.
(Boxed dialog/search inputs and date pickers are intentionally a different pattern.)

- **Title** (`TitleTextarea`) auto-grows; a `ResizeObserver` re-fits height when the column
  width changes (window/sidebar/column resize), so it never keeps a stale 2-line height.
- **Effort** (`EffortCell`) accepts a number (days); empty = unset.
- **Start/End** (`DatePickCell`) open the native date picker; locked (read-only) when the
  date is computed (has prereqs, or effort drives the end) — see [scheduling.md](./scheduling.md).
- **Prereq** (`PrereqInput`) accepts comma-separated sequence numbers — see
  [dependencies.md](./dependencies.md).

## Rules & edge cases
- Editing effort or start, or assignment changes (per-row **or** bulk), trigger `recomputeDates()`.
- The displayed Start/End are the **computed** plan, not raw stored dates, so they always
  agree with the scheduler.
