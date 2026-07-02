# Sprint activity log

**Status:** Implemented
**Last updated:** 2026-07-02 (`sprint_started` now logged inside `createSprint()` — sprint
row + event in one transaction; earlier: per-sprint retention cap — newest 500 events kept,
older pruned on write; motion pass — segmented control slides a measured pill like the
main `ViewToggle` (§6.5 #4), rows do a one-shot entrance stagger when the drawer opens —
see [Motion](#motion))
**Code:** `app/src/db.ts` (`ActivityEvent`, `events` table v10, `logEvent`,
`MAX_EVENTS_PER_SPRINT`, `pruneSprintEvents`,
`sprintEvents`, `logTaskEdits` + wiring in `createSprint`/`addSprintTask`/`updateTask`/
`logStatusChange`/`setDependencies`/`moveUnfinishedToNextSprint`),
`app/src/ActivityLog.tsx` (drawer body), `app/src/App.tsx` (🕒 toolbar button +
`showActivity` **right-side drawer**)
**Tests:** `app/src/activity-log.test.ts` (11 cases)
**Demo:** `demo/sprint-activity-log.html` (Cupertino, light/dark, Timeline + By-member);
`demo/activity-log-popup-options.html` (3 popup directions explored — drawer chosen)

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

### Sole history surface (was: per-task change log)

This **replaced** the per-task change log (`task-change-log.md`, **removed 2026-06-16**) as
the app's only edit-history surface. That feature was a cap-5 "memory jog" 🕒 tooltip per
task row; the two overlapped, so the per-task one was retired and this took over fully:

- **Sprint-wide, not per-task-5.** Shows the whole sprint's recent history, not the last 5
  per task — but **capped at the newest 500 events per sprint** (older rows pruned on write;
  `MAX_EVENTS_PER_SPRINT` in `db.ts`) so the store can't grow unbounded. See
  [Rules & edge cases](#rules--edge-cases).
- **More event types.** Beyond field-edits, it records **lifecycle events** (created, rolled
  over, sprint started) — see [Data](#data).
- **Inherited grammar.** Field-edit events reuse the `ChangeLogEntry` edit-entry shape
  (old → new, semantic color on the new value, `+ …` for added prereqs/assignee). That shape
  — built by `updateTask`/`logStatusChange`/`setDependencies` and mirrored via `logTaskEdits`
  — is now this feature's internal vocabulary, not shared with any other surface.

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

### The surface — right-side drawer

A **right-side drawer** (440px, `max-w-[90vw]`) slides in over a dimmed + blurred
backdrop, **mirroring the project-settings drawer idiom** (same width, slide easing
`cubic-bezier(.32,.72,0,1)`, `inert` when closed, Esc / backdrop-click / 🕒-toggle to
dismiss). The sprint stays visible behind it — activity log is *reference* content you
read **against** the board, not a place you navigate to.

> **Why a drawer (2026-06-16 redesign).** The original was a full main-column page that
> *replaced* the List/Board. Three directions were prototyped in
> `demo/activity-log-popup-options.html` — (A) centered modal, (B) right drawer,
> (C) anchored popover. The drawer won: activity is reference/inspect content (keep the
> sprint in view), and it reuses the settings-drawer mechanics verbatim (slide, `inert`,
> backdrop) so it costs almost nothing to ship and stays visually consistent.

- **Header** (54px, matches the settings drawer) — title "Activity log", inline sub
  `{range} · {N} events` (SF tabular-nums), and a close **✕** at the right (Esc also closes).
- **Body** — scrollable, inset-grouped cards on canvas. A segmented control at the top:
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

### Motion

Two calm touches (design-system §6.5 — ≤300ms, shared easings, reduced-motion safe):

1. **Segmented control = sliding pill.** The Timeline / By-member toggle slides a single
   white pill to the active segment (measured via `useLayoutEffect`, `transition-[left,width]`
   on the **move** easing `cubic-bezier(.32,.72,0,1)`) instead of swapping a per-button
   background. This is **not new motion** — it makes the drawer's segmented control conform to
   the §6.5 #4 standard the main-column `ViewToggle` already follows, so the two read as the
   same control. The pill **jumps without animating on first paint** (no entrance slide), then
   glides on every switch.
2. **One-shot entrance stagger.** When the drawer **opens** (`open` flips false→true — the
   drawer stays mounted and slides in, so this keys off the prop, not mount), the event rows
   fade + rise 6px in a short cascade (`act-row-in`, 0.34s move easing, ~44ms per row, capped).
   It is a **one-shot** keyed to the open transition via a transient `act-enter` class that
   clears after ~650ms — deliberately **not** a per-insert animation (§6.5 bans animating list
   insert/remove). Switching tabs after the entrance window does **not** re-animate. Honours
   `prefers-reduced-motion` (rows appear instantly). Marked *optional polish* in the motion
   study (`demo/sidebar-activitylog-motion.html`) — it brushes the "don't animate rows" line
   but is defensible as an entrance, not an insert.

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

Status/priority semantic colors and the `+`/strikethrough treatment use the shared
status/priority tokens — the same grammar the removed per-task `ChangeLogTooltip` once used,
now rendered by `ActivityLog.tsx`.

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
  events newest-first (`ts` desc). `logTaskEdits(task, entries)` records the diffed edit
  entries (`ChangeLogEntry[]`, now an internal shape — see
  [task-change-log.md](./task-change-log.md)) as `'edit'` events (sprint tasks only; **title
  coalesces within `TITLE_COALESCE_MS`** so a keystroke burst is one event). Wired at:
  `addSprintTask` (`created`), `updateTask` (`edit` — its txn scope includes `db.events`),
  `logStatusChange` (board status — safe to widen its txn because all Board callers invoke it
  OUTSIDE any open transaction), `setDependencies` (prereq + caused date shifts),
  `moveUnfinishedToNextSprint` (`rolled_over` on the target sprint). Scheduler recomputes
  (`recomputeDates`/`recomputeAllDates`, raw `db.tasks.update`) stay **unlogged**.
- **`ActivityLog.tsx`** — the drawer body. `useLiveQuery(sprintEvents)`. Formats values
  against `lib.ts` label maps + `formatShortDate`/`formatRelativeTime`/`formatTimestamp`. Two
  render paths: `TimelineView` (day-grouped) and `MemberGroupView` (groups by the task's
  **current** assignee via the live `tasks` prop; sprint-level events excluded; deleted-task →
  "Unassigned").
- **`App.tsx`** — a 🕒 `History` toolbar button (sprint-only, calm grey at rest, accent
  while open) toggles `showActivity`, a transient **right-side drawer** (NOT a persisted
  view mode; reset on sprint/collection switch via `selectSprint`/`selectCollection`). The
  drawer + its dimmed backdrop stay mounted while a sprint is selected so the slide
  animates; `inert={!showActivity}` keeps focus/keyboard out when closed. Dismissed by
  re-clicking the 🕒 button, clicking the backdrop, the header ✕, **or `Escape`** (the
  global key handler closes the drawer right after the palette and before settings — see
  [search-and-keyboard.md](./search-and-keyboard.md)). `sprint_started` is logged inside
  the data layer's canonical **`createSprint()`** (`db.ts`) — the sprint row and its event
  commit in **one transaction**, so a crash between them can't leave a sprint with no birth
  entry (the New-Sprint dialog's `submit` just calls it; seeding logs no event by design).
  UI strings are English (matches the rest of the app; the
  Vietnamese demo was flavor only).
- **`ActivityLog.tsx`** renders the **drawer body** (not a positioned page): a 54px header
  (title + range·count + ✕ `onClose`) over a `flex-1 overflow-auto bg-canvas` scroll area
  holding the segmented control + Timeline/By-member content. App.tsx owns the positioned
  drawer shell + backdrop (mirroring `ProjectSettingsView` inside the settings drawer).

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
- **Per-sprint cap (500)** — the store keeps only the newest `MAX_EVENTS_PER_SPRINT` (= 500)
  events per sprint. Every write site (`logEvent`, `logTaskEdits`) calls `pruneSprintEvents`
  after appending, which deletes the oldest rows past the cap **for that sprint only** (other
  sprints are untouched). Pruning is by `ts` (newest-first); destructive — pruned history is
  gone, not just hidden. An over-cap sprint self-heals on its next logged write.
- **Empty state** — "No activity yet in this sprint."

## Future / open questions

- **Storage model** — settled: **A** (dedicated `events` table, Dexie v10, export v4). Done.
- **Retention** — settled: **capped at the newest 500 events per sprint**, pruned on write
  (`MAX_EVENTS_PER_SPRINT`). See [Rules & edge cases](#rules--edge-cases).
- **Keyboard shortcut** to open the log (none assigned yet — must avoid OS/`/`/`n`/`⌘K`
  conflicts per §6.1).
- **Filters** — prototyped (by category) then **cut** for calm; revisit if the stream gets
  noisy on long sprints.
- **Global / cross-sprint activity** — out of scope; this is per-sprint by request.
