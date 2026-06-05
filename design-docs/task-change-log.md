# Task change log

**Status:** Implemented
**Last updated:** 2026-06-05
**Code:** `app/src/db.ts` (`updateTask`, `appendChangeLog`, `logStatusChange`,
`LOGGABLE_FIELDS`, import clamp), `app/src/lib.ts` (`formatRelativeTime`, `formatTimestamp`,
`STATUS_LABEL`/`PRIORITY_LABEL`/`FIELD_LABEL`), `app/src/ChangeLogTooltip.tsx` (shared
tooltip), `app/src/SprintView.tsx` (`TaskRow` edit funnel + 🕒), `app/src/BoardView.tsx`
(`handleDrop` + `onCycleStatusId` status logging + 🕒)

> **Eng-reviewed 2026-06-05** (`/plan-eng-review`). The review caught a runtime crash and
> three wrong assumptions in the first cut. Net changes from the office-hours design:
> board status logs **inline** (not via `updateTask` — that nested a wider Dexie
> transaction scope inside a narrower one and would throw); coalesce is **title-only**
> (coalescing status/priority destroyed real transitions); label maps live in **`lib.ts`**
> (not moved out of `SprintView` — `STATUS_META` is used in 3 modules); **`dependsOn`
> deferred** (it flows through `setDependencies`, not `updateTask`). See "Eng review
> decisions" below.

## Purpose
Once you edit a task you lose all memory of how it got to its current state — "khi nào
nó nhảy sang in_progress? khi nào tao dời hạn? đã đổi người làm chưa?". This adds a
lightweight per-task **change log that keeps the 5 most recent changes**, so you can
self-audit a task's recent history at a glance. It's a **memory jog, not an audit
trail** — the cap at 5 is the whole point. Single-user app → no "who", only "what & when".

## User-facing behavior
- A small **🕒 history icon** at the end of a task row, revealed on **row hover** (same
  affordance as the select checkbox). Shown in both **List** (`SprintView`) and **Board**
  (`BoardView`).
- **Hover/focus** → tooltip listing up to 5 entries, **newest first**, one line each:
  *field · old → new · giờ tương đối*, e.g. `Người làm: An → Bình · 2h trước`.
- Each line's `title` attr = absolute timestamp (`05/06 23:14`). Relative time is computed
  when the tooltip renders; it does not live-tick while open.
- **Empty state:** log empty → the icon is **hidden** (no empty tooltip).
- **No tap handler** — touch deferred (desktop-first).

## What is logged
Every **user-initiated** change to one of these **7** main fields, in a single
`LOGGABLE_FIELDS` set:

`title` · `status` · `priority` · `assigneeId` · `startDate` · `dueDate` · `estimate`

`dependsOn` is **deferred** (see Eng review decisions). Status changes are logged from
**both** views: List status-dot cycle, Board click-to-cycle (`onCycleStatusId`,
`BoardView.tsx:268`), and Board cross-column drag.

### What is NOT logged
- **Scheduler recomputations** (`recomputeDates`/`recomputeAllDates` rewriting dates).
- **System mutations:** sprint rollover, parent/group ops, dependency edits
  (`setDependencies`), board reorder (`boardOrder`), sequence renumbering.
- **Task creation** — the log starts empty.

> Dates & effort log the **action, not the resulting state**: editing `estimate` (or a
> manual `startDate`) logs that edit; the start/due dates the scheduler then shifts via
> `recomputeDates` are **not** logged. So the log records "bạn đặt Bắt đầu = Jun 10", the
> value you picked — never the post-recompute value. Intended.

## Data
New **non-indexed, optional** field on `Task` (no Dexie version bump — same pattern as
`parentId`/`boardOrder`/`color`; old rows read as `[]`). See [data-model.md](./data-model.md).

```ts
type LoggableField =
  | 'title' | 'status' | 'priority' | 'assigneeId'
  | 'startDate' | 'dueDate' | 'estimate'

type ChangeLogEntry = {
  field: LoggableField
  from: string | null   // RAW value for stable fields; resolved name for assigneeId
  to:   string | null
  ts:   number          // epoch ms
}
// Task gains:  changeLog?: ChangeLogEntry[]   // newest-first, length ≤ 5
```

### Labels — render-time, except assignee (Decision 1A, revised)
Only **`assigneeId`** is delete-vulnerable, so its **resolved member name** is frozen into
`from`/`to` at write time (survives the member being deleted). Every other field stores its
**raw** value and is formatted by the tooltip at render:
- **status / priority** → `STATUS_LABEL` / `PRIORITY_LABEL` (new label-only maps in
  `lib.ts` — `STATUS_META` stays in `SprintView`, untouched).
- **startDate / dueDate** → `formatShortDate` ("Jun 10", month-first); `—` for null.
- **estimate** → number; `—` for null.
- **title** → as-is.
- field label itself → `FIELD_LABEL` map in `lib.ts`.

"Stable" here means *self-describing to render* (a `'todo'` or `'2026-06-10'` formats the
same regardless of when), **not** "never recomputed" — dates can be recomputed later, but
the log holds the value the user picked at that moment (action-semantics).

## Implementation

### Shared core — `appendChangeLog(task, newEntries) → ChangeLogEntry[]`
Pure-ish helper (no DB): given the existing `task.changeLog` and freshly-diffed entries,
applies **title-only coalesce**, then caps to 5 newest-first. Used by both write paths
so diff/coalesce/cap logic lives in exactly one place (DRY).

**Coalesce (title only):** if a new `title` entry's predecessor at the log head is also
`title` **and within a 2-minute window** (window slides on each keystroke), update that
entry's `to` + `ts` (keep its original `from`); if the result has `from === to` (typed
back to the original), drop the entry. All other fields never coalesce — each edit is its
own entry, preserving e.g. todo→in_progress→done as two distinct transitions.

### `updateTask(id, patch)` — canonical USER-edit path
Runs read→diff→write in a `db.transaction('rw', db.tasks, db.members, …)` (mirrors
`recomputeDates`):
1. Read the task. **Only** `await db.members.toArray()` when `'assigneeId' in patch`
   (Decision 5A — title/status/date/effort/priority skip it; matters because title fires
   per keystroke).
2. For each key in `patch ∩ LOGGABLE_FIELDS` whose value **actually changed** (value-based
   equality; dates/estimate/assignee are scalars, simple `!==`), build an entry. For
   `assigneeId`, resolve member name for `from`/`to`.
3. `changeLog = appendChangeLog(task, entries)`; write `{ ...patch, changeLog }` in the txn.

`updateTask` does **not** call `recomputeDates` — callers keep their explicit
`recomputeDates(id)` after the edit (uses raw `db.tasks.update`, logs nothing).

### `logStatusChange(id, from, to)` — Board status path (Decision 2A, revised)
Board status changes do **not** go through `updateTask` (its `db.members` scope nested
inside the sorted-column reindex transaction `db.transaction('rw', db.tasks, …)` at
`BoardView.tsx:329` would throw — Dexie sub-transactions must be a subset of the parent
scope). Instead a small `logStatusChange` opens a `db.tasks`-only transaction, builds the
single status entry via `appendChangeLog`, and writes `changeLog`. Called from:
- `handleDrop` (both manual `:315` and sorted `:329` paths) when `t.status !== status`,
- `onCycleStatusId` (`:268`).
`boardOrder` reindex writes stay raw and unlogged.

### Call sites — List (`SprintView.tsx`)
Swap the `TaskRow` `update` helper (`:1417`) to `updateTask`, covering title/status/
assignee/effort/dates in one change. The `GroupHeaderRow` parent-title write (~`:1239`)
also routes through `updateTask`.

### Display — `ChangeLogTooltip.tsx` (Decision 4A, revised)
One shared component `<ChangeLogTooltip entries={...} />` + the value formatters, imported
by both views. It imports the label maps from `lib.ts` (never from `SprintView`). The 🕒
trigger reuses the existing hover-reveal pattern; colors via design tokens.

### Import safety (Decision: build now)
`importAll` clamps untrusted input: `changeLog = Array.isArray(t.changeLog) ?
t.changeLog.slice(0, 5) : []` so a hand-edited export can't smuggle an unbounded array
past the write-path cap.

## Rules & edge cases
- Cap = ring buffer; 6th distinct change drops the oldest; length ≤ 5.
- No-op write (same value) → no entry.
- Title coalesce window slides; a slow typist (>2 min between keystrokes) produces
  separate entries — acceptable, cap-5 bounds it.
- assignee label frozen at write time; member deletion later doesn't break history.
- `undefined` changeLog (pre-feature rows) treated as `[]`.
- `>7d` entry: relative time flips to an absolute date (same as the `title` attr — mildly
  redundant, accepted).

## Eng review decisions (2026-06-05)
- **2A→inline:** board status via `logStatusChange`, not `updateTask` (nested-transaction
  crash). Also covers the previously-missed `onCycleStatusId` path.
- **3A→title-only coalesce:** coalescing status/priority would erase real transitions.
- **4A→`lib.ts` label maps:** `STATUS_META` is used in SprintView+BoardView+GanttView and
  carries theme fields; moving it was wrong. Tiny label-only maps go in `lib.ts`.
- **`dependsOn` deferred:** it flows through `setDependencies` (`db.ts:920`), not
  `updateTask`. Logging it cleanly is a follow-up (and ties into a possible
  "explain why the date moved" recompute-provenance feature).
- **5A:** conditional `db.members` load (only when `assigneeId` in patch).
- **Import clamp:** built this PR.

## Future / open questions
- **`dependsOn` logging** — deferred; needs `setDependencies` to share `appendChangeLog`.
- **Recompute provenance** ("why did this date move?") — the causal effort/prereq → date
  chain is intentionally not logged here; a separate provenance feature could log scheduler
  writes *with their cause*. Out of scope.
- **Touch / mobile** — tap-to-toggle popover deferred (desktop-first).
