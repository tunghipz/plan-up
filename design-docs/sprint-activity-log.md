# Sprint activity log

**Status:** Implemented
**Last updated:** 2026-06-16
**Code:** `app/src/db.ts` (`ActivityEvent`, `events` table v10, `logEvent`,
`sprintEvents`, `logTaskEdits` + wiring in `addSprintTask`/`updateTask`/
`logStatusChange`/`setDependencies`/`moveUnfinishedToNextSprint`),
`app/src/ActivityLog.tsx` (page), `app/src/App.tsx` (🕒 toolbar button +
`showActivity` overlay + `sprint_started` log on sprint create)
**Tests:** `app/src/activity-log.test.ts` (11 cases)
**Demo:** `demo/sprint-activity-log.html` (Cupertino, light/dark, Timeline + By-member)

> **Storage decision: A (dedicated `events` table) — chosen & implemented.**
> See [Data](#data). Option B (extend `Task.changeLog`) was rejected: it loses
> events on task deletion and bloats task rows.

## Purpose

The per-task change log ([task-change-log.md](./task-change-log.md)) answers *"how did
**this** task get here?"* — but it's deliberately a **memory jog**: capped at 5 entries
per task, surfaced only as a hover 🕒 tooltip, and scoped to one task at a time. There is
no way to ask the sprint-wide question: *"what happened in this sprint — what got done,
who picked up what, which dates slipped, what rolled in from last sprint?"*

This feature adds a **Sprint activity log**: a single chronological page that aggregates
**all** recorded activity across **every task in one sprint** into one timeline. It turns
the scattered per-task history into a readable sprint narrative for stand-ups, end-of-sprint
review, and "where did the week go" self-audit.

### Relationship to the per-task change log (important)

This is a **deliberate scope shift** from `task-change-log.md`, which states it is "a memory
jog, not an audit trail — the cap at 5 is the whole point." The activity log moves toward
an **audit-trail** posture:

- **No cap.** The page shows the full sprint history, not the last 5 per task.
- **More event types.** Beyond the 8 field-edits the change log records today, the activity
  log adds **lifecycle events** (created, completed, rolled over, assigned, sprint started)
  — see [Data](#data). These are **not logged anywhere today** and require new write-path
  logging.
- **Same vocabulary.** Field-edit events reuse the exact `ChangeLogEntry` rendering grammar
  (old → new, semantic color on the new value, `+ 3–4` for added prereqs/assignee) so the
  two surfaces stay visually consistent.

The two surfaces coexist: the 🕒 tooltip stays the fast per-row glance; the activity log is
the sprint-wide read. Decision (2026-06-12): the change-log's cap-5 ring buffer is **not**
enough to back this page faithfully — a full event store is needed (see
[Open questions](#future--open-questions)).

### DNA fit (design-system §9 checklist)

1. **Wedge** — supports *calm utility* (daily read) + *speed* (1 click from sprint). ✓
2. **No "who".** Single-user / no-auth → the log records **what & when**, never an actor.
   "By member" groups by the task's **assignee** (a label), not by who clicked.
3. **Keyboard path** — opens via toolbar; a shortcut is a future add (no conflict budget
   spent yet).
4. **Empty state** — a sprint with no recorded activity shows a calm "No activity yet".
5. **Dark mode** — all colors are tokens.
6. **Cupertino** — SF tabular-nums, inset-grouped cards on canvas, depth not lines, accent
   as signal.

## User-facing behavior

### Entry point

A **🕒 (History) icon button** in the sprint **main-column header toolbar**, next to the
search magnifier (design-system §5.10 — toolbar action). Chosen over adding a label or a
segmented tab because the toolbar is already dense (Roll over + List/Board + Export/Import);
an icon-only button is the smallest footprint.

- **Calm at rest** — grey idle icon (`--color-ink-muted`), like the search icon. **Not**
  accent-tinted (accent is a signal, not chrome — §2.1). *(The demo tints it + adds a "Mới"
  badge only to spotlight it; ship calm.)*
- Click → navigates to the activity page for the **current sprint**.
- Per-sprint only (matches the request "log của sprint đó"); there is no global/all-sprint
  view in this iteration.

### The page

A full main-column page (replaces the List/Board area; the sprint panel + icon rail stay):

- **Header** — back affordance `‹ Sprint N`, title "Activity log", sub `{range} · {N}
  hoạt động` (SF tabular-nums).
- **Segmented control** — two organizations:
  1. **Timeline** (default) — one vertical stream, grouped by **day** (Hôm nay / Hôm qua /
     weekday + date), newest-first. Each event is one row: `[event icon] · #seq task title
     · {field} {old → new} · {time}`. Day headers are sticky (vibrancy).
  2. **By member** — one inset card per **assignee**; inside, that member's events (each
     still showing the task ref). Carries a one-line caveat that "member" = assignee label,
     not an actor.

  *(By-task grouping was prototyped and cut on request — the 🕒 per-task tooltip already
  serves the single-task view.)*

- Each event's time shows **relative** in Timeline (`14:32` within a day group) with the
  absolute timestamp as the `title` attr; By-member shows `{date} {time}` since rows cross
  days.

### Event rendering (reuses change-log grammar)

| Event | Icon | Text |
| --- | --- | --- |
| created | file-plus | "Tạo task" |
| completed (→ done) | check-circle (green) | `In Progress → Done` (new = green) |
| status (other) | circle | `To Do → In Progress` (new tinted accent) |
| assignee | user (member color) | `An → Bình`; first assign = `+ Bình` (green) |
| priority | flag | `High → Urgent` (new tinted red/orange) |
| start / due date | calendar | `Jun 13 → Jun 12`; prereq-caused shift annotated `↳` |
| estimate | clock | `2d → 3d` |
| prereq (`dependsOn`) | link | `+ 3–4` (add, green) / struck on removal |
| rolled over | rotate | "Chuyển sang từ Sprint N-1" |
| sprint started | rocket | "Sprint N bắt đầu" (sprint-level, no task ref) |

Status/priority semantic colors and the `+`/strikethrough treatment match
`ChangeLogTooltip.tsx` exactly.

## Data

See [data-model.md](./data-model.md). This feature needs an **activity event store** that
the current `Task.changeLog` (cap-5 ring buffer) cannot provide.

**Existing** (`ChangeLogEntry`, [task-change-log.md](./task-change-log.md)): `{ field,
from, to, ts }`, 8 loggable fields, ≤5 per task, written by `updateTask` /
`logStatusChange` / `setDependencies`.

**New events to capture** (currently logged **nowhere**):

| Event | Trigger / write site (today) | Logging to add |
| --- | --- | --- |
| `created` | task create | log on insert |
| `completed` | status → `done` | derivable from a status event; may flag for emphasis |
| `rolled_over` | sprint rollover (`sprint-rollover.md`) — "system mutation", **explicitly not logged today** | log the move (from-sprint) |
| `assigned` | first non-null `assigneeId` | already a `changeLog` assignee entry; promote |
| `sprint_started` | sprint create (`sprints.md`) | sprint-level event |

**Implemented as model A** — a dedicated append-only `events` table (Dexie **v10**),
indexed `id, sprintId, ts, projectId`. Row shape (`ActivityEvent`):

```ts
type ActivityKind = 'created' | 'edit' | 'rolled_over' | 'sprint_started'
interface ActivityEvent {
  id: string
  projectId: string
  sprintId: string          // collection tasks (no sprint) are never logged
  taskId: string | null     // null for sprint-level events (sprint_started)
  taskSeq: number | null    // frozen at write time (survives renumber/deletion)
  taskTitle: string | null  // frozen at write time
  kind: ActivityKind
  field?: LoggableField     // present iff kind === 'edit'
  from: string | null
  to: string | null
  ts: number
}
```

- `kind: 'edit'` reuses the changeLog `field`/`from`/`to` grammar (assignee freezes the
  member NAME; `dependsOn` freezes a seq-range label) — so events and the per-task 🕒
  tooltip render identically.
- **No separate `completed` kind**: a completion is an `edit` of `status` with `to: 'done'`
  (the UI tints it green). Keeps the event set minimal.
- Migration v10 adds the table only — **no backfill** (history starts at v10; tasks created
  before it have no recorded events).
- **Export/import:** `ExportPayload` bumped to **version 4** with an optional `events[]`;
  `exportAll` includes them, `importAll` clears + bulk-adds them (shape-guarded). Older
  payloads (v1–v3) import with an empty log.

## Implementation

- **`db.ts`** — `logEvent(e)` appends a row; `sprintEvents(sprintId)` reads a sprint's
  events newest-first (`ts` desc). `logTaskEdits(task, entries)` mirrors the changeLog
  entries just built into events (sprint tasks only; **title coalesces within
  `TITLE_COALESCE_MS`** so a keystroke burst is one event). Wired at: `addSprintTask`
  (`created`), `updateTask` (`edit`, in the same txn as the changeLog write — scope gains
  `db.events`), `logStatusChange` (board status — safe to widen its txn because all Board
  callers invoke it OUTSIDE any open transaction), `setDependencies` (prereq + caused date
  shifts), `moveUnfinishedToNextSprint` (`rolled_over` on the target sprint). Scheduler
  recomputes (`recomputeDates`/`recomputeAllDates`, raw `db.tasks.update`) stay **unlogged**.
- **`ActivityLog.tsx`** — the page. `useLiveQuery(sprintEvents)`. Reimplements the
  changeLog value formatters against `lib.ts` label maps + `formatShortDate`/
  `formatRelativeTime`/`formatTimestamp` (the `ChangeLogTooltip` helpers aren't exported)
  so text matches the tooltip. Two render paths: `TimelineView` (day-grouped) and
  `MemberGroupView` (groups by the task's **current** assignee via the live `tasks` prop;
  sprint-level events excluded; deleted-task → "Unassigned").
- **`App.tsx`** — a 🕒 `History` toolbar button (sprint-only, calm grey at rest, accent
  while open) toggles `showActivity`, a transient full-page overlay of the main column
  (NOT a persisted view mode; reset on sprint/collection switch). Closed by re-clicking the
  🕒 button **or `Escape`** (the global key handler closes the overlay right after the
  palette and before settings — see [search-and-keyboard.md](./search-and-keyboard.md)).
  `sprint_started` is
  logged in the New-Sprint dialog's `submit`. UI strings are English (matches the rest of
  the app; the Vietnamese demo was flavor only).

## Rules & edge cases

- **No "who"** — never render an actor; "By member" = assignee grouping only.
- **Sprint-level events** (`sprint_started`) have no task ref and are excluded from the
  By-member grouping (no assignee).
- **Member deletion** — assignee events freeze the **name** at write time (same as the
  change log), so history survives deletion.
- **Rolled-over tasks** — the `rolled_over` event is logged on the **destination** sprint;
  the task's pre-rollover history (from the previous sprint) is out of scope for this page
  (it shows *this* sprint's activity).
- **Scheduler recomputes are not logged** (premise carried from the change log); only the
  user action that caused a shift is, with the prereq-caused date shift annotated `↳`.
- **Empty state** — "No activity yet in this sprint."

## Future / open questions

- **Storage model** — settled: **A** (dedicated `events` table, Dexie v10, export v4). Done.
- **Retention** — append-only store grows unbounded; do we cap per sprint, or rely on
  sprints being short-lived? (Lean: uncapped per sprint, revisit if export size hurts.)
- **Keyboard shortcut** to open the log (none assigned yet — must avoid OS/`/`/`n`/`⌘K`
  conflicts per §6.1).
- **Filters** — prototyped (by category) then **cut** for calm; revisit if the stream gets
  noisy on long sprints.
- **Global / cross-sprint activity** — out of scope; this is per-sprint by request.
