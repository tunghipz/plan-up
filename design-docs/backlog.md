# Backlog

**Status:** Implemented
**Last updated:** 2026-06-23
**Code:** `app/src/db.ts`, `app/src/App.tsx`, `app/src/ai/*`,
`app/public/skills/project-management/SKILL.md`

## Purpose

Backlog is the default holding area for project tasks that are not scheduled into
a sprint yet. It lets the user capture or triage work without forcing it into
the current sprint plan.

## User-facing behavior

- Each project has one **Backlog** entry in the sidebar.
- Backlog opens with the existing Collection List/Calendar surface, because
  backlog tasks are outside sprint scheduling.
- Backlog is a system collection: the normal collection delete affordance is not
  shown for it.
- Backlog uses the same collection planning columns as other collections:
  assigned member, planned start date, planned end date, collection status, and
  an **Add to sprint** action.
- Add-to-sprint is a shared collection affordance. The menu is searchable and
  suggests the current sprint plus the next one or two active sprints when those
  sprints exist; the full active sprint list remains searchable.
- AI Chat can propose:
  - moving a visible sprint task to the next non-archived sprint
  - moving a visible task to Backlog
  - moving a visible collection/Backlog task to a specific sprint by sprint name
    or ID

## Data

Backlog uses the existing `Collection` + `Task` model:

- `Collection.kind?: 'backlog'` marks the project backlog. It is optional and
  non-indexed, so no Dexie version bump is required.
- Backlog tasks are collection items: `sprintId = null`, `collectionId =
  backlog.id`, and `sectionId` points to the backlog collection's first section.
- Backlog is a system-collection exception: it may preserve task planning fields
  (`assigneeId`, `startDate`, `dueDate`, `estimate`) so the user can keep owner
  and expected date information while deciding which sprint should receive the
  work.
- Moving a task into Backlog clears sprint-only relationship/ordering fields
  (`dependsOn`, `parentId`, `listOrder`, `boardOrder`) and removes that task
  from other tasks' dependencies.

## Implementation

- `ensureProjectBacklog(projectId)` creates or returns the project backlog.
- `moveTaskToBacklog(taskId)` moves one task into that backlog.
- `moveTaskToSprint(taskId, sprintId)` moves one Backlog/collection task into a
  specific active sprint, clears collection fields, appends a sprint sequence,
  and preserves owner/estimate/date metadata.
- `moveTaskToNextSprint(taskId, sourceSprintId?)` moves one task to the next
  non-archived sprint after its source sprint and appends a fresh sequence in the
  target sprint.
- `App.tsx` ensures a backlog exists whenever a project is loaded and renders it
  as a first-class sidebar row before user-created collections.
- AI Chat exposes typed actions `move_task_to_next_sprint`,
  `move_task_to_backlog`, and `move_task_to_sprint`.

## Rules & edge cases

- Backlog creation is idempotent. If an older/manual collection named `Backlog`
  exists in the project, the app marks it as the backlog instead of creating a
  duplicate.
- Moving a task to the next sprint requires a source sprint and a later active
  sprint. Archived sprints are skipped.
- Moving a task from Backlog to “next sprint” uses the selected sprint as the
  source reference when the task itself has no `sprintId`.
- Moving a task from Backlog to a named sprint requires the sprint to belong to
  the same project and not be archived.
- Applying AI actions still requires the normal user confirmation in the chat
  drawer.
