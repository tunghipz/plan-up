# plan-up

ClickUp without the seat tax — a single-user, local-first task & sprint planner. Multi-project, no auth, no backend, no team plan. Members are just labels you create. Data lives in your browser (IndexedDB); export/import JSON for backup.

## Stack

React 19 · TypeScript · Vite · Tailwind v4 · Dexie (IndexedDB) · SF Pro (system) · lucide-react

## Run

```bash
cd app
npm install
npm run dev    # http://localhost:5173
```

Other scripts:

```bash
npm run build      # tsc -b && vite build
npm run test       # vitest run
npm run lint       # eslint .
```

## What's inside

- **Multi-project** — macOS-style icon rail (left), vibrancy sprint panel (middle, drag the edge to resize), task view (right)
- **Sprint folder** (biweekly) with start/end dates + per-sprint task sequence (resets to 1..N)
- **Three views**:
  - **List** — grouped by assignee in inset-grouped cards · Reminders-style status circles · sortable column headers (the chosen sort is **remembered** — it survives switching view/sprint/project and a page reload) · width-aware auto-wrap titles
  - **Board** — Cupertino kanban: three columns on the grey canvas, white soft-shadowed cards · click the status circle to cycle, or **drag a card** to reorder/move status (the card lifts onto the cursor as a tilted ghost, an insertion gap shows where it lands, edges auto-scroll, and the position persists; dragging is tuned for 60fps even across columns — cards don't re-render mid-move, hit-testing is rAF-coalesced, and columns are natural-height so a cross-column drop only relayouts the two columns involved). **Per-column sort** — each column header has a native picker to sort its cards by **Manual** (your dragged order, default) · **Name** · **Time** (the computed due date the chip shows) · **Member** (assignee), with a ▲/▼ direction toggle. Sort is a non-destructive overlay — picking Name/Time/Member never rewrites your manual order; switch back to Manual and it returns intact (and a drag into a column snaps it back to Manual at the drop spot). Each column's choice persists across reloads. **Add tasks inline** — a quiet `+ Add task` at the bottom of each column opens a composer that creates a task in that column's status (Enter adds & stays open for rapid entry; same creation path + smart defaults as the List). Cards show the live due **date + time**; **hover** reveals a quick-edit toolbar to **assign a member** and set **effort / start / end** (reusing the List's scheduler lock rules). **Task groups** appear as a card bucketed by their derived status with a progress bar + rolled-up date range; children carry a `↳ group` chip
  - **Timeline** — Apple-Calendar swimlanes (one lane per member, one soft-tinted event block per task, status-colored, half-day precision, lane-packed). **Fluid columns** stretch to fill the surface so a short sprint leaves no dead space (long sprints scroll). A **task group** renders as a slim Gantt **summary rail** spanning its children's roll-up, packed *above* them. Read-only projection of the auto-scheduler; off-window tasks split by direction and roll up as `↙ N earlier · ↗ M later · ○ K no dates` counts in the member label (the expand chips are status-tinted, so a Done task still reads green), **day-offs** show as faint diagonal-hatch bands and any task bar crossing one gets a same-status **hatch+dim "pause"** so the bar visibly pauses on the off-day, today is a thin accent line
- **Task fields**: title, assignee, sprint, status, priority, start/end date, estimate, dependencies (prereq accepts lists **and ranges** like `2-5, 8`; rejected entries are explained inline instead of dropped silently — a cycle is drawn as its loop path, e.g. `7 → 8 → 6 → 7`, with the back-edge to cut named)
- **Member header at a glance** — each assignee group shows a progress ring (% done) around the avatar, done/total, an overdue alert (only when > 0), the next upcoming deadline (`due Jun 10`), and days off as effective days (`1.5d off`, half-days count 0.5) — all derived from tasks, no extra fields. **Days off are scoped to the sprint you're viewing** (the chip counts and the picker only allow dates inside the sprint's range); the settings page shows each member's full aggregate across all sprints. The control is always visible — a quiet dashed `Days off` pill when none are set yet
- **Project & member settings** — gear next to the project name slides in a right-side **inspector drawer** (over a dimmed backdrop, list/board stay visible behind) to edit the project (name, description, tile color), manage members (rename, **role title**, color, days off, add/remove), and delete the project
- **Task groups & row actions** — hover a row → a checkbox appears; select tasks and a floating bar offers **Gom nhóm** (group several of one member under a new head — children nest, collapse + roll-up `done/total`), **Bỏ nhóm** (ungroup), and **Xoá** (delete the selection). The selection bar is the only delete affordance — there's no per-row kebab. Parents are containers, excluded from member counts
- **Schedule conflict warning** — when one member is double-booked (two sized tasks whose computed time ranges **overlap**, or that share a start time, end time, or a prerequisite) each row gets an amber ⚠ + the member header shows an `N trùng lịch` badge. Back-to-back tasks (touching endpoints) don't count
- **Status** — Reminders-style circle (todo / in-progress / done) + soft-tint pill
- **Task change log** — a faint 🕒 right after each task's title (List + Board) whose hover tooltip shows the **5 most recent** user edits, newest-first (`Trạng thái: To do → Done · 2h trước`). Records edits to title / status / priority / assignee / start / due / effort / **prereqs** (a prereq change logs `Phụ thuộc: — → 1-2` **plus** the old→new dates it shifted on that task, e.g. `Bắt đầu: May 4 → May 6`). Otherwise the scheduler's auto-recomputed dates aren't logged — the log captures *what you did*, and the one recomputed date it does record is the direct result of your own prereq edit. Title keystroke-bursts coalesce into one entry; assignee names are frozen so history survives a member being deleted. Stored on the task (non-indexed, no schema bump). See [`design-docs/task-change-log.md`](./design-docs/task-change-log.md)
- **Date picker** — a custom **Cupertino calendar** (replaces the native `<input type=date>` everywhere): Monday-first month grid, today ring, selected fill, weekends dimmed but still selectable, keyboard `← → ↑ ↓ / Enter / Esc`, Today / Clear, light+dark themed. **Planner-aware**: task date cells **highlight the sprint** (range shaded, opens on the sprint month — *shade only*, any date stays selectable since a task can run past its sprint), and the **assignee's in-sprint days-off** are marked with orange dots (half-day = half dot) and **listed with their time detail** below the grid (`Jun 6 · AM off · 08:00–12:00`, `Jun 10 · Off all day`). The member **days-off** picker hard-clamps entry to the sprint range.
- **Auto-scheduling** — set effort + prereqs, dates compute automatically (skips weekends + per-member off-days, supports half-day off)
- **Sprint rollover** — move unfinished tasks to next sprint in one click
- **Inline rename** — double-click a sprint name to edit (member rename/delete live in the settings page)
- **Cupertino UI** — Apple "design language": SF Pro + tabular figures · system blue `#0071E3` accent · grey canvas + white cards · large soft-rounded corners · vibrancy sidebars · depth over borders
- **Keyboard-first**: `/` focus search · `n` new sprint · `⌘⇧D` toggle dark mode
- **Export / Import JSON** — local-first backup, no sync
- **Dark mode** — Apple dark (canvas `#1C1C1E`, accent `#0A84FF`)
- **Brand mark** — a progress-ring-on-squircle favicon in System Blue, dark-aware (swaps to `#0A84FF` via `prefers-color-scheme`) — the same ring as the member progress indicator

## Layout

```
/                  → docs only (design.md, design-system.md, CLAUDE.md)
/app               → everything code (src/, vite.config.ts, package.json, …)
```

## Design docs

- [`design.md`](./design.md) — product spec: premises, scope, success criteria
- [`design-system.md`](./design-system.md) — UI/UX constitution: brand, typography, layout, component rules, anti-patterns
- [`design-docs/`](./design-docs/) — one spec per feature (data model, scheduling, list/board, settings, favicon, …). **Doc-first: any feature change updates its doc before code.**

Read `design-system.md` **before** building any new component.

## Data model

Four IndexedDB tables in `app/src/db.ts`:

| Table      | Fields                                                                            |
| ---------- | --------------------------------------------------------------------------------- |
| `projects` | id, name, createdAt, description?, color?                                          |
| `members`  | id, projectId, name, color, daysOff (`{date, half?}[]`), title?                   |
| `sprints`  | id, projectId, name, startDate, endDate                                           |
| `tasks`    | id, projectId, sequence, title, assigneeId, sprintId, status, priority, dependsOn, startDate, dueDate, estimate, parentId?, boardOrder?, changeLog?, … |

Schema version bumps via Dexie's `version().stores()` + upgrade callback (currently v8).

## Philosophy

- Single-user web app, no auth
- Speed > breadth (≤ 1 click or 1 keystroke per action)
- Local-first (export/import = backup, not sync)
- Calm utility (calm > cute)
