# Data model

**Status:** Implemented
**Last updated:** 2026-06-06
**Code:** `app/src/db.ts`

## Purpose
Define the four entities the whole app revolves around, and the migration
discipline that lets the schema evolve without losing local data.

## Entities

Four IndexedDB tables (Dexie database name **`plan-up`**):

### `Project` (`db.ts:19`)
`id` · `name` · `createdAt` (number) · `description?` (string) · `color?` (hex)
- `description` and `color` are **optional, non-indexed** fields edited from the settings
  page (see [project-member-settings.md](./project-member-settings.md)). Because they are
  not indexed, adding them needed **no Dexie version bump**; rows without them fall back to
  `colorForName(name)` and an empty description.

### `Member` (`db.ts:25`)
`id` · `projectId` · `name` · `color` (hex) · `daysOff: DayOff[]`
- A member is just a **label** — no auth, no login. The user creates them.
- `daysOff` are extra non-working days on top of weekends (see [scheduling.md](./scheduling.md)).

### `Sprint` (`db.ts:37`)
`id` · `projectId` · `name` · `startDate` · `endDate` (both `yyyy-mm-dd`) · `note?` (string)
- `name` is **automatic and locked** (`Sprint N`) — no rename UI; see [sprints.md](./sprints.md).
- `note?` is an **optional, non-indexed** sprint-goal string edited via the header goal
  banner. Like `Project.description` it needs **no Dexie version bump**; rows without it
  read as empty.

### `Task` (`db.ts:45`)
`id` · `projectId` · `sequence` (number, per-sprint) · `title` · `assigneeId` (`string|null`) ·
`sprintId` (`string | null`) · `status` · `priority` · `startDate` (`string|null`) · `dueDate` (`string|null`) ·
`estimate` (`number|null`, effort in days) · `createdAt` · `dependsOn: string[]` (task IDs) ·
`changeLog?: ChangeLogEntry[]` · `boardOrder?: number` · `listOrder?: number` ·
`collectionId?: string | null` · `sectionId?: string | null` · `collectionStatusId?: string | null`
- `changeLog` is an **optional, non-indexed** field holding the **5 most recent**
  user-initiated field changes (newest-first ring buffer). Like `description`/`color` it
  needs **no Dexie version bump**; rows without it read as `[]`. Written only through
  `updateTask()` / `logStatusChange()`, never by the scheduler. See
  [task-change-log.md](./task-change-log.md).
- `boardOrder` / `listOrder` are **optional, non-indexed** fractional ordering fields —
  manual drag position on the **Board** (per status column) and in the **List** (default
  order, within a member card) respectively. Both fall back to `sequence` when unset, are
  **never logged** (arrangement, not data), and need **no Dexie version bump**. `sequence`
  itself is immutable (task-number + prereq reference) and reordering never touches it.
  See [board-view.md](./board-view.md) and [list-view.md](./list-view.md).
- `sprintId` is now `string | null` — `null` when the task belongs to a collection.
- `collectionId?` (`string | null`) — **indexed**. The collection this task belongs to; `null` for sprint tasks. **Invariant: exactly one of `sprintId` / `collectionId` is non-null.**
- `sectionId?` (`string | null`) — non-indexed. The `Section.id` within the collection (arrangement only, never logged).
- `collectionStatusId?` (`string | null`) — non-indexed. Points to a `CollectionStatus.id` in the collection's `statuses` array (the user-defined status for this item).

### `Collection` (`db.ts:115`)
`id` · `projectId` · `name` · `order` (number, fractional sidebar position) ·
`sections: Section[]` · `statuses: CollectionStatus[]` · `createdAt` (number)
- `sections` and `statuses` are **embedded arrays** (not separate tables) — ordered, not indexed. A new collection is seeded with 1 section "All" and a default status set the user can edit.

### `Section` (embedded in Collection)
`id` · `name` · `color?` (optional hex from COLLECTION_PALETTE)
- Embedded in `Collection.sections`; no separate IndexedDB table or index.

### `CollectionStatus` (embedded in Collection)
`id` · `name` · `color` (hex from COLLECTION_PALETTE)
- User-defined status per collection (not shared across collections). Embedded in `Collection.statuses`.

### Value types
- `ChangeLogEntry`: `{ field: LoggableField; from: string|null; to: string|null;
  ts: number }` over 8 loggable fields (title, status, priority, assigneeId, startDate,
  dueDate, estimate, dependsOn). `from`/`to` store the **raw** value for stable fields
  (formatted at render); `assigneeId` freezes the resolved member **name** and `dependsOn`
  freezes a **sequence-range** label at write time (the former survives member deletion,
  the latter survives per-sprint sequence renumbering). `dependsOn` is logged by
  `setDependencies`; the other 7 by `updateTask`. See [task-change-log.md](./task-change-log.md).
- `DayOff` (`db.ts:14`): `{ date: string; half?: 'am' | 'pm' }`. No `half` → whole day off
  (0 working days); `half` → 0.5 day. AM vs PM is human-readable only; both contribute 0.5.
- `Status` (`db.ts:3`): `'todo' | 'in_progress' | 'done'`.
- `Priority` (`db.ts:4`): `'urgent' | 'high' | 'normal' | 'low' | 'none'`.

All dates are stored as `yyyy-mm-dd` strings.

## Schema versioning

Dexie `version().stores()` + an upgrade callback per bump. Current version: **9**.

| Ver | Change |
| --- | --- |
| 1 | Initial `members`, `sprints`, `tasks`. |
| 2 | Backfill `Task.startDate = null`. |
| 3 | Backfill `Task.dependsOn = []`. |
| 4 | Add `Task.sequence`, numbered by `createdAt`. |
| 5 | Add `Member.daysOff = []`. |
| 6 | `daysOff` shape `string[]` → `DayOff[]`. |
| 7 | Add `projects` table; backfill `projectId` on members/sprints/tasks (default "My Project"). |
| 8 | `sequence` becomes **per-sprint** (was per-project); each sprint renumbered 1..N by `createdAt`. |
| 9 | Add `collections` table; tasks gain `collectionId` index + `sectionId`/`collectionStatusId` (non-indexed); `sprintId` becomes nullable. Backfill `collectionId = null` on all existing tasks. |

Current indexes:
- `projects`: `id, name, createdAt`
- `members`: `id, name, projectId`
- `sprints`: `id, startDate, projectId`
- `tasks`: `id, sprintId, assigneeId, status, createdAt, projectId, collectionId`
- `collections`: `id, projectId, order`

## Rules & edge cases
- **Bump the version + add an upgrade callback whenever a field/index changes.** Never
  mutate an existing version block.
- `dependsOn` stores task **IDs** (stable), never sequence numbers — so renumbering a
  sprint's sequences never breaks dependency links.
