# Task change log — REMOVED

**Status:** Removed (2026-06-16)
**Superseded by:** [sprint-activity-log.md](./sprint-activity-log.md)

> The per-task change log — a faint **🕒** after each task title (List + Board) whose hover
> tooltip showed that task's **5 most recent** user edits — was removed on 2026-06-16. The
> **sprint activity log** (a right-side drawer, see its doc) now covers history sprint-wide:
> it is uncapped, lives in its own append-only `events` table that survives task deletion,
> and groups by day or by member. Two overlapping history surfaces was redundant; the
> per-task cap-5 jog earned its keep only before the sprint log existed.

## What was removed

- **UI:** `app/src/ChangeLogTooltip.tsx` (deleted) + its 🕒 render sites in
  `SprintView.tsx` (`TaskRow` `trailing`) and `BoardView.tsx` (after the title).
- **Data:** the `Task.changeLog?: ChangeLogEntry[]` field (cap-5 ring buffer) and the
  `appendChangeLog()` helper + `CHANGELOG_CAP`. Dexie **v11** strips the dead field from
  existing task rows. The untrusted-import clamp (`changeLog.slice(0, 5)`) is gone with it.

## What was kept

The **edit-tracking pipeline is intact** — it still feeds the sprint activity log:
- `updateTask` / `logStatusChange` / `setDependencies` still diff edits and build
  `ChangeLogEntry[]`, then call `logTaskEdits()` to mirror them into the `events` store.
- `ChangeLogEntry` (the `{field, from, to, ts}` shape), `LoggableField`, `LOGGABLE_FIELDS`,
  `changeLogValue` (assignee-name freezing) and `TITLE_COALESCE_MS` (title-burst coalescing)
  all survive — they are now purely the activity log's internal edit-entry grammar.
- The scheduler-isolation premise (recomputes are **never** logged) is unchanged and guarded
  by `app/src/activity-log.test.ts` (`does NOT log scheduler recomputes`).

Coverage for the removed code (the `appendChangeLog` purity tests, the per-task
`task.changeLog` assertions, the import-clamp test) was deleted from `db.test.ts`; the
equivalent write-site behavior is fully covered against the `events` store in
`activity-log.test.ts`.
