# Tasks

**Status:** Implemented
**Last updated:** 2026-06-04
**Code:** `app/src/SprintView.tsx` (`TaskRow`, `AddTaskRow`, `TitleTextarea`,
`EffortCell`, `DatePickCell`, `PrereqInput`, `SelectionBar`)

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
- Editing effort or start, or assignment changes, trigger `recomputeDates()`.
- The displayed Start/End are the **computed** plan, not raw stored dates, so they always
  agree with the scheduler.
