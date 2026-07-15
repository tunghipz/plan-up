# Data model

**Status:** Implemented
**Last updated:** 2026-07-02
**Code:** `app/src/types.ts` (entity types) + `app/src/schema.ts` (Dexie schema & migrations); `app/src/db.ts` is the facade re-exporting both

## Purpose
Define the four entities the whole app revolves around, and the migration
discipline that lets the schema evolve without losing local data.

## Entities

Seven IndexedDB tables (Dexie database name **`plan-up`**): `projects`, `members`,
`sprints`, `tasks`, `collections`, `events`, `people`.

### `Project` (`types.ts`)
`id` · `name` · `createdAt` (number) · `description?` (string) · `color?` (hex) · `icon?` (emoji)
- `description`, `color`, and `icon` are **optional, non-indexed** fields edited from the
  settings page (see [project-member-settings.md](./project-member-settings.md),
  [project-icon-emoji.md](./project-icon-emoji.md)). Because they are
  not indexed, adding them needed **no Dexie version bump**; rows without them fall back to
  `colorForName(name)`, an empty description, and the name's first letter respectively.

### `Member` (`types.ts`)
`id` · `projectId` · `name` · `color` (hex) · `daysOff: DayOff[]` · `title?` (string)
· `avatarImage?` (string) · `avatarEmoji?` (string) · `order` (number) · `personId?` (string)
- A member is just a **label** — no auth, no login. The user creates them.
- `personId?` links this membership to a global [`Person`](#person-dbts) — one human across
  projects. **Indexed** (added in **v13**, backfilled by grouping members by normalized name).
  Every new member gets one via `addMember` / import. See [home-dashboard.md](./home-dashboard.md).
- `order` is the **manual lane order** (per project) used to sort member cards in the
  List view (drag-to-reorder) and the Board view's `member` sort. Non-indexed; backfilled
  in **v12** to `0..N-1` per project. See [member-lane-order.md](./member-lane-order.md).
- `daysOff` are extra non-working days on top of weekends (see [scheduling.md](./scheduling.md)).
- `title?` is an **optional, non-indexed** free-text role label (see [member-title.md](./member-title.md)).
- `avatarImage?` / `avatarEmoji?` are **optional, non-indexed** avatar fields — like
  `title?` they need **no Dexie version bump**. `avatarImage` is a resized (≤128px square)
  image data-URL; `avatarEmoji` is a single emoji grapheme. They are **mutually exclusive**
  (setting one clears the other). Render falls back image → emoji → colored initial. See
  [member-avatars.md](./member-avatars.md).

### `Sprint` (`types.ts`)
`id` · `projectId` · `name` · `startDate` · `endDate` (both `yyyy-mm-dd`) · `note?` (string)
· `archivedAt?` (number)
- `name` is **automatic and locked** (`Sprint N`) — no rename UI; see [sprints.md](./sprints.md).
- `note?` is an **optional, non-indexed** sprint-goal string edited via the header goal
  banner. Like `Project.description` it needs **no Dexie version bump**; rows without it
  read as empty.
- `archivedAt?` is an **optional, non-indexed** epoch-ms timestamp (absent = active) —
  again **no Dexie version bump**. Set/cleared via `setSprintArchived`; archived sprints
  leave the active flow. See [sprint-archive.md](./sprint-archive.md).

### `Task` (`types.ts`)
`id` · `projectId` · `sequence` (number, per-sprint) · `title` · `assigneeId` (`string|null`) ·
`sprintId` (`string | null`) · `status` · `priority` · `startDate` (`string|null`) · `dueDate` (`string|null`) ·
`estimate` (`number|null`, effort in days) · `createdAt` · `dependsOn: string[]` (task IDs) ·
`boardOrder?: number` · `listOrder?: number` ·
`collectionId?: string | null` · `sectionId?: string | null` · `collectionStatusId?: string | null`
- The per-task `changeLog?: ChangeLogEntry[]` field was **removed in v11** (the per-task
  change log feature is gone — see [task-change-log.md](./task-change-log.md)). Edit history
  now lives sprint-wide in the `events` table (`ActivityEvent`, below).
- `boardOrder` / `listOrder` are **optional, non-indexed** fractional ordering fields —
  manual drag position on the **Board** (per status column) and in the **List** (default
  order, within a member card). `listOrder` is **also** the manual order for **collection
  items within a section** (the pointer-drag reorder in [collections.md](./collections.md);
  moving an item across tables writes `sectionId` + `listOrder` together). Both fall back to
  `sequence` when unset, are **never logged** (arrangement, not data), and need **no Dexie
  version bump**. `sequence` itself is immutable (task-number + prereq reference) and
  reordering never touches it. See [board-view.md](./board-view.md) and
  [list-view.md](./list-view.md).
- `sprintId` is now `string | null` — `null` when the task belongs to a collection.
- `collectionId?` (`string | null`) — **indexed**. The collection this task belongs to; `null` for sprint tasks. **Invariant: exactly one of `sprintId` / `collectionId` is non-null.**
- `sectionId?` (`string | null`) — non-indexed. The `Section.id` within the collection (arrangement only, never logged).
- `collectionStatusId?` (`string | null`) — non-indexed. Points to a `CollectionStatus.id` in the collection's `statuses` array (the user-defined status for this item).

### `Collection` (`types.ts`)
`id` · `projectId` · `name` · `order` (number, fractional sidebar position) ·
`sections: Section[]` · `statuses: CollectionStatus[]` · `createdAt` (number)
- `sections` and `statuses` are **embedded arrays** (not separate tables) — ordered, not indexed. A new collection is seeded with 1 section "All" and a default status set the user can edit.

### `Section` (embedded in Collection)
`id` · `name` · `color?` (optional hex from COLLECTION_PALETTE)
- Embedded in `Collection.sections`; no separate IndexedDB table or index.

### `CollectionStatus` (embedded in Collection)
`id` · `name` · `color` (hex from COLLECTION_PALETTE)
- User-defined status per collection (not shared across collections). Embedded in `Collection.statuses`.

### `ActivityEvent` (`types.ts`, table `events`)
`id` · `projectId` · `sprintId` · `taskId` (`string|null`) · `taskSeq` (`number|null`) ·
`taskTitle` (`string|null`) · `kind` · `field?` (`LoggableField`) · `from` (`string|null`) ·
`to` (`string|null`) · `ts` (number)
- **Append-only, uncapped** sprint activity log (see
  [sprint-activity-log.md](./sprint-activity-log.md)) — the **sole** edit-history surface
  (the per-task `Task.changeLog` it once complemented was removed in v11). Lives in its
  **own table**, so events survive task deletion and aggregate sprint-wide. Collection tasks
  (no sprint) are never logged.
- `kind`: `'created' | 'edit' | 'rolled_over' | 'sprint_started'`. `field`/`from`/`to` are
  only meaningful for `'edit'` and reuse the `ChangeLogEntry` grammar (assignee freezes the
  member NAME; `dependsOn` freezes a seq-range label). `taskSeq`/`taskTitle` are **frozen at
  write time** so the log stays readable after renumbering or deletion.
- Indexes: `id, sprintId, ts, projectId`.

### `Person` (`types.ts`, table `people`)
`id` · `name` · `color` (hex) · `createdAt` (number)
- A **real human shared across projects**. A `Member` is one project's membership for a
  person (`Member.personId` → `Person.id`); the same human in N projects is N members but
  ONE person. Added in **v13**.
- **Identity only** — days-off and assignment stay on `Member`, so the scheduler is
  untouched. The Home roster aggregates a person's load/days-off across their members.
- Created/linked by normalized name (`addMember`, import, the v13 backfill). A person with
  zero remaining members is kept (hidden from the roster), not deleted. Rename/recolor/merge
  via the People roster. See [home-dashboard.md](./home-dashboard.md).

### `ShareRecord` (`types.ts`, table `shares`)
`id` (= the `/view` URL suffix — the store key) · `refId` (per-ref link: the shared
`sprintId` or `collectionId`; **project-scope sprint link** [`scope: 'project'`]: the
`projectId` — record isn't bound to one sprint; **indexed**) · `kind`
(`'sprint' | 'collection'`) · `scope?` (`'ref'` [absent = default: collections + legacy
sprint links] or `'project'` [one sprint link shared across the whole project, points at
the last-pushed sprint — Hướng A]) · `currentRefId?` (project-scope: the sprintId whose
snapshot is currently live) · `currentLabel?` (project-scope: display name of the live
sprint, shown in the modal) · `slug` (cosmetic URL prefix) · `writeToken` (**secret**,
local only — authorizes PUT/DELETE on the store) · `url` (full shareable link) · `lastSig`
(content signature of the snapshot last pushed — the bundle JSON minus the volatile
`exportedAt`; compared to the current board to know if the link is stale, driving the
**Update** button) · `createdAt` · `updatedAt` · `projectId`.
Table added in **v14**. `scope`/`currentRefId`/`currentLabel` are non-indexed optional
fields (no store-shape change), but **v15** runs a data migration adopting legacy per-ref
sprint rows into project-scope (see the version table below). Project-scope lookup:
`getProjectShare(projectId, kind)`. See [hosted-share-link.md](./hosted-share-link.md).
- Local map of a plan → its **hosted share link** (short, updatable `/view/<slug>-<id>`,
  data on a Vercel KV / Upstash store). Lets the Share button know a plan is already shared
  and drives Update/Revoke. Travels in the full backup (v6) so a restore keeps the token.
- **Not cascade-deleted** on project/plan delete — the store entry's TTL (90 days) cleans it
  up. See [hosted-share-link.md](./hosted-share-link.md).

### Value types
- `ChangeLogEntry`: `{ field: LoggableField; from: string|null; to: string|null;
  ts: number }` over 8 loggable fields (title, status, priority, assigneeId, startDate,
  dueDate, estimate, dependsOn). Now the **activity log's internal edit-entry shape** (the
  per-task change log that originally named it was removed in v11): each entry is built by
  `updateTask` / `logStatusChange` (the 7 patch fields) or `setDependencies` (`dependsOn`),
  then mirrored into an `ActivityEvent` of `kind: 'edit'` via `logTaskEdits`. `from`/`to`
  store the **raw** value for stable fields (formatted at render); `assigneeId` freezes the
  resolved member **name** and `dependsOn` freezes a **sequence-range** label at write time
  (the former survives member deletion, the latter survives sequence renumbering).
- `DayOff` (`types.ts`): `{ date: string; half?: 'am' | 'pm' }`. No `half` → whole day off
  (0 working days); `half` → 0.5 day. AM vs PM is human-readable only; both contribute 0.5.
- `Status` (`types.ts`): `'todo' | 'in_progress' | 'done'`.
- `Priority` (`types.ts`): `'urgent' | 'high' | 'normal' | 'low' | 'none'`.

All dates are stored as `yyyy-mm-dd` strings.

## Schema versioning

Dexie `version().stores()` + an upgrade callback per bump. Current version: **14**.

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
| 10 | Add `events` table (sprint activity log). No data backfill — history starts at v10. |
| 11 | Remove the per-task `Task.changeLog` field (per-task change log removed). Upgrade strips the dead property from existing task rows; no index change. |
| 12 | Add `Member.order` (non-indexed manual lane order); backfill per project to `0..N-1` in current `toArray()` order. See [member-lane-order.md](./member-lane-order.md). |
| 13 | Add `people` table + indexed `Member.personId` (re-declare full `members` store). Backfill groups existing members by normalized name across all projects → one person each, linked. Scheduler untouched. See [home-dashboard.md](./home-dashboard.md). |
| 14 | Add `shares` table (hosted share links). No backfill — nobody has a share yet. See [hosted-share-link.md](./hosted-share-link.md). |
| 15 | Adopt legacy per-ref **sprint** shares into the project-scope model (Hướng A): each `shares` row with `kind='sprint'` and no `scope` is rewritten `scope='project'`, `currentRefId=<old sprintId>`, `refId=projectId`. Collections untouched. No index change. See [hosted-share-link.md](./hosted-share-link.md). |

Current indexes:
- `projects`: `id, name, createdAt`
- `members`: `id, name, projectId, personId`
- `people`: `id, name`
- `sprints`: `id, startDate, projectId`
- `tasks`: `id, sprintId, assigneeId, status, createdAt, projectId, collectionId`
- `collections`: `id, projectId, order`
- `events`: `id, sprintId, ts, projectId`
- `shares`: `id, refId, projectId`

## Rules & edge cases
- **Bump the version + add an upgrade callback whenever a field/index changes.** Never
  mutate an existing version block.
- `dependsOn` stores task **IDs** (stable), never sequence numbers — so renumbering a
  sprint's sequences never breaks dependency links.
- `deleteProject` wipes **every project-owned row** in one transaction: the project's
  `tasks`, `sprints`, `members`, `collections` **and** `events` (the `projectId` index on
  events exists for exactly this wipe) — nothing is left orphaned.
