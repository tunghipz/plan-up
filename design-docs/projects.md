# Projects (multi-project)

**Status:** Implemented
**Last updated:** 2026-07-02 (delete now also wipes the project's collections + activity events)
**Code:** `app/src/App.tsx` (icon rail, `NewProjectDialog`), `app/src/db.ts`
(`createProject`, `deleteProject`, `colorForName`)

## Purpose
Keep unrelated bodies of work in separate buckets ("ClickUp without the seat tax"),
each with its own members, sprints, and tasks.

## User-facing behavior
- **Switch:** click a tile in the icon rail. The whole app (sprints, tasks, capacity)
  refetches for that project; the choice persists.
- **Create:** `+` at the top of the rail → `NewProjectDialog` (name, placeholder
  "My Side Project") → the new (empty) project becomes current.
- **Delete:** the settings page's **Delete project** button (see
  [project-member-settings.md](./project-member-settings.md)) calls `deleteProject()`,
  which cascades over everything the project owns.

## Data
`Project { id, name, createdAt }`. Members/sprints/tasks each carry `projectId`.

## Implementation
- `createProject(name)` (`db.ts:217`) — trims (`"Untitled Project"` fallback), adds row.
- `deleteProject(projectId)` (`db.ts`) — transactional cascade over **all** project-owned
  rows: deletes the project's tasks, sprints, members, **collections and activity events**
  (the last two were previously orphaned), and strips this project's task IDs from any
  *other* project's `dependsOn` (cross-project links).
- Tile color: `colorForName()` (`db.ts:199`) hashes the name → one of an 8-color palette
  (deterministic, so a name always maps to the same color).
- Current project persisted at `localStorage['plan-up:currentProjectId']`; defaults to
  the first project by `createdAt`.

## Rules & edge cases
- Sprint sequence numbers are per-sprint (not per-project) since schema v8.
- Deleting a project is destructive (settings "Danger zone" + the import-toast Undo both
  route through the same cascade).
