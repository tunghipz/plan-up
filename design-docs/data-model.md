# Data model

**Status:** Implemented
**Last updated:** 2026-06-03
**Code:** `app/src/db.ts`

## Purpose
Define the four entities the whole app revolves around, and the migration
discipline that lets the schema evolve without losing local data.

## Entities

Four IndexedDB tables (Dexie database name **`plan-tmp`**):

### `Project` (`db.ts:19`)
`id` · `name` · `createdAt` (number)

### `Member` (`db.ts:25`)
`id` · `projectId` · `name` · `color` (hex) · `daysOff: DayOff[]`
- A member is just a **label** — no auth, no login. The user creates them.
- `daysOff` are extra non-working days on top of weekends (see [scheduling.md](./scheduling.md)).

### `Sprint` (`db.ts:37`)
`id` · `projectId` · `name` · `startDate` · `endDate` (both `yyyy-mm-dd`)

### `Task` (`db.ts:45`)
`id` · `projectId` · `sequence` (number, per-sprint) · `title` · `assigneeId` (`string|null`) ·
`sprintId` · `status` · `priority` · `startDate` (`string|null`) · `dueDate` (`string|null`) ·
`estimate` (`number|null`, effort in days) · `createdAt` · `dependsOn: string[]` (task IDs)

### Value types
- `DayOff` (`db.ts:14`): `{ date: string; half?: 'am' | 'pm' }`. No `half` → whole day off
  (0 working days); `half` → 0.5 day. AM vs PM is human-readable only; both contribute 0.5.
- `Status` (`db.ts:3`): `'todo' | 'in_progress' | 'done'`.
- `Priority` (`db.ts:4`): `'urgent' | 'high' | 'normal' | 'low' | 'none'`.

All dates are stored as `yyyy-mm-dd` strings.

## Schema versioning

Dexie `version().stores()` + an upgrade callback per bump. Current version: **8**.

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

Current indexes:
- `projects`: `id, name, createdAt`
- `members`: `id, name, projectId`
- `sprints`: `id, startDate, projectId`
- `tasks`: `id, sprintId, assigneeId, status, createdAt, projectId`

## Rules & edge cases
- **Bump the version + add an upgrade callback whenever a field/index changes.** Never
  mutate an existing version block.
- `dependsOn` stores task **IDs** (stable), never sequence numbers — so renumbering a
  sprint's sequences never breaks dependency links.
