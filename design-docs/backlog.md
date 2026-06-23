# Backlog

**Status:** Removed as a system feature
**Last updated:** 2026-06-23
**Code:** Legacy data can still exist in `app/src/db.ts`, but active UI/AI behavior treats Backlog
as a normal collection.

## Purpose

Backlog used to be the default holding area for project tasks that are not
scheduled into a sprint yet. The product now uses **Collections** for that
purpose instead. A user can still create a collection named `Backlog`, but it is
not auto-created, protected, or handled by a dedicated AI action.

## User-facing behavior

- No automatic Backlog row is shown in the sidebar.
- No Backlog collection is auto-created when a project loads.
- A collection named `Backlog` appears under **Collections** like any other
  collection and can be renamed or deleted.
- Tasks inside that collection use normal collection behavior: assign member,
  edit planned start/end, change collection status, add to sprint, or delete.
- AI Chat should use `move_task_to_collection` with `collectionName: "Backlog"`
  only when such a normal collection exists. It should not emit a dedicated
  `move_task_to_backlog` action.

## Data

Legacy Backlog data uses the existing `Collection` + `Task` model:

- Older local databases may still have `Collection.kind = 'backlog'`. The active
  app ignores that marker and renders the record as a normal collection.
- Backlog-named tasks remain collection items: `sprintId = null`, `collectionId`
  points to the collection, and `sectionId` points to one of its sections.
- Moving any task into a collection uses the normal collection move path:
  preserve planning fields (`assigneeId`, `startDate`, `dueDate`, `estimate`),
  clear sprint-only relationship/ordering fields (`dependsOn`, `parentId`,
  `listOrder`, `boardOrder`), and remove that task from other tasks'
  dependencies.

## Implementation

- `ensureProjectBacklog(projectId)` and `moveTaskToBacklog(taskId)` are removed
  from active UI/AI flows.
- `moveTaskToCollection(taskId, collectionId)` is the supported path for moving
  work into any collection, including a user-created collection named Backlog.
- `moveTaskToSprint(taskId, sprintId)` moves one collection task into a
  specific active sprint, clears collection fields, appends a sprint sequence,
  and preserves owner/estimate/date metadata.
- `moveTaskToNextSprint(taskId, sourceSprintId?)` moves one task to the next
  non-archived sprint after its source sprint and appends a fresh sequence in the
  target sprint.
- `App.tsx` lists all collections together in the Collections section.
- AI Chat exposes typed movement actions `move_task_to_next_sprint`,
  `move_task_to_collection`, and `move_task_to_sprint`.

## Rules & edge cases

- Existing legacy Backlog collections are not migrated or deleted automatically;
  they simply behave as regular collections.
- Moving a task to the next sprint requires a source sprint and a later active
  sprint. Archived sprints are skipped.
- Moving a collection task to “next sprint” uses the selected sprint as the
  source reference when the task itself has no `sprintId`.
- Moving a collection task to a named sprint requires the sprint to belong to the
  same project and not be archived.
- Applying AI actions still requires the normal user confirmation in the chat
  drawer.
