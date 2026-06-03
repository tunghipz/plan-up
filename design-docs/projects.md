# Projects (multi-project)

**Status:** Implemented
**Last updated:** 2026-06-03
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
- **Delete:** `deleteProject()` exists and cascades, but is **not wired to any UI button
  yet** — noted as a known gap.

## Data
`Project { id, name, createdAt }`. Members/sprints/tasks each carry `projectId`.

## Implementation
- `createProject(name)` (`db.ts:217`) — trims (`"Untitled Project"` fallback), adds row.
- `deleteProject(projectId)` (`db.ts:229`) — transactional cascade: deletes the project's
  tasks, sprints, members, and strips this project's task IDs from any *other* project's
  `dependsOn` (cross-project links).
- Tile color: `colorForName()` (`db.ts:199`) hashes the name → one of an 8-color palette
  (deterministic, so a name always maps to the same color).
- Current project persisted at `localStorage['plan-tmp:currentProjectId']`; defaults to
  the first project by `createdAt`.

## Rules & edge cases
- Sprint sequence numbers are per-sprint (not per-project) since schema v8.
- Deleting a project is destructive and currently only reachable via code/tests.
