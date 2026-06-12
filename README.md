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

- **Multi-project** — macOS-style icon rail (left), vibrancy sprint panel (middle, drag the edge to resize), task view (right). The panel's **Sprints** and **Collections** lists share one scroll area (no dead gap between them) and each section header **collapses** with a remembered state · only one container highlights at a time (a remembered sprint doesn't stay lit while you're in a collection)
- **Sprint folder** (biweekly) with start/end dates + per-sprint task sequence (resets to 1..N). The **name is automatic and locked** (`Sprint N`, never editable — keeps ordering boringly consistent); free-text context lives in an **optional goal note** shown in a thin banner under the header (click to edit; empty → a calm dashed `+ Add sprint note` slot). New sprints inherit `Sprint N+1` and the note is offered in the New Sprint sheet
- **Three views**:
  - **List** — grouped by assignee in inset-grouped cards · Reminders-style status circles · sortable column headers (the chosen sort is **remembered** — it survives switching view/sprint/project and a page reload) · titles **fill the Task column** and auto-wrap (width-aware) · **drag-to-reorder**: in the default `ID` order a hover-revealed grip lets you drag a task to a new spot (manual order persists in `listOrder`, never touching the immutable sequence; within a member card and same level only). Under any other sort the grip hides — sort by `ID` to reorder again. The List cards and the capacity bar **fill the full window width** (no fixed max-width) and reflow live on window / sidebar resize
  - **Capacity bar** (above every sprint view) — one slim stacked bar partitioning the sprint's leaf tasks into **done / in-progress / open** (sums to total) with an inline summary (`12 tasks · 33% done · 75% assigned`) and a legend; a `⚠ N not estimated` warning rides the legend when relevant. Glides when the task mix changes
  - **Board** — Cupertino kanban: three columns on the grey canvas, white soft-shadowed cards · click the status circle to cycle, or **drag a card** to reorder/move status (the card lifts onto the cursor as a tilted ghost, an insertion gap shows where it lands, edges auto-scroll, and the position persists; dragging is tuned for 60fps even across columns — cards don't re-render mid-move, hit-testing is rAF-coalesced, and columns are natural-height so a cross-column drop only relayouts the two columns involved). **Per-column sort** — each column header has a native picker to sort its cards by **Manual** (your dragged order, default) · **Name** · **Time** (the computed due date the chip shows) · **Member** (assignee), with a ▲/▼ direction toggle. Sort is a non-destructive overlay — picking Name/Time/Member never rewrites your manual order; switch back to Manual and it returns intact (and a drag into a column snaps it back to Manual at the drop spot). Each column's choice persists across reloads. **Add tasks inline** — a quiet `+ Add task` at the bottom of each column opens a composer that creates a task in that column's status (Enter adds & stays open for rapid entry; same creation path + smart defaults as the List). Cards show the live due **date + time**; **hover** reveals a quick-edit toolbar to **assign a member** and set **effort / start / end** (reusing the List's scheduler lock rules). **Task groups** appear as a card bucketed by their derived status with a progress bar + rolled-up date range; children carry a `↳ group` chip
  - **Timeline** — Apple-Calendar swimlanes (one lane per member, one soft-tinted event block per task, status-colored, half-day precision, lane-packed). **Fluid columns** stretch to fill the surface so a short sprint leaves no dead space (long sprints scroll). A **task group** renders as a slim Gantt **summary rail** spanning its children's roll-up, packed *above* them. Read-only projection of the auto-scheduler; off-window tasks split by direction and roll up as `↙ N earlier · ↗ M later · ○ K no dates` counts in the member label (the expand chips are status-tinted, so a Done task still reads green), **day-offs** show as faint diagonal-hatch bands and any task bar crossing one gets a same-status **hatch+dim "pause"** so the bar visibly pauses on the off-day, and **today** reads at a glance — its date sits in a filled accent **pill** in the header (Apple-Calendar style) with a soft accent **column wash** running down through the lanes. **Click a bar** → a Cupertino detail popover (title · status · computed dates) with **Open in List →**
- **Collections** (tasks outside a sprint) — a second kind of "List" in the sidebar (under **COLLECTIONS**), **freely named** (e.g. "Live-ops 2026", "Changelog", "Roadmap Q3") for events, changelogs, and ad-hoc items that don't fit the biweekly/scheduling/assignee mould. Each collection holds **multiple user-named tables** (sections) stacked as cards — the same card-per-group layout and tap-to-edit UX as the sprint List (flex columns **Name · Start · End · Status**, always-editable title, inline `+ Add item`, **click a header to collapse/expand**, drag the hover grip to move an item between tables). **Per-collection statuses** you define yourself (name + color from the Apple palette; add/rename/recolor/delete via **Statuses**) — not a shared fixed set. Two views — **List** (card-per-table) and **Calendar** — switched from the **single top context bar**, which adapts per container (sprints show List/Board/Timeline, collections show List/Calendar) and also carries the collection's name + summary + **Statuses**, so there's one context bar instead of a duplicate in-content toggle. Calendar is a Monday-first month grid with **seamless continuous multi-day bars** (greedy lane-packing, week-segment splitting, rounded only at the true start/end), multi-month `‹ ›` chevrons for events that span months, and soft status-tinted bars. Collections create via a Cupertino **"New Collection"** sheet (same style as New Sprint); tables via a matching **"New Table"** sheet. The top context bar carries a calm summary (item count + status-distribution dots, no decorative badge); empty tables show a quiet empty state; an unset status / date reads as a **dashed `＋` pill**. On the **Calendar**, items with no date surface in an **"Unscheduled" tray** (pick a date to drop them onto the grid) instead of silently vanishing, a **status legend** + **Today** button sit above the grid, and **clicking a bar** opens an inline editor (title · status · dates). Collection items live with `sprintId = null` so the sprint scheduler/capacity/rollover never touch them. Adding a new table here and adding a new member group in the sprint List share **one** affordance (`AddGroupButton`) — a dashed-slot button that's calm grey at rest and turns accent on hover (design-system §5.11). See [`design-docs/collections.md`](./design-docs/collections.md)
- **Task fields**: title, assignee, sprint, status, priority, start/end date, estimate, dependencies (prereq accepts lists **and ranges** like `2-5, 8`; rejected entries are explained inline instead of dropped silently — a cycle is drawn as its loop path, e.g. `7 → 8 → 6 → 7`, with the back-edge to cut named)
- **Member header at a glance** — each assignee group shows a progress ring (% done) around the avatar, done/total, an overdue alert (only when > 0), the next upcoming deadline (`due Jun 10`), and days off as effective days (`1.5d off`, half-days count 0.5) — all derived from tasks, no extra fields. **Days off are scoped to the sprint you're viewing** (the chip counts and the picker only allow dates inside the sprint's range); the settings page shows each member's full aggregate across all sprints. The control is always visible — a quiet dashed `Days off` pill when none are set yet
- **Project & member settings** — gear next to the project name slides in a right-side **inspector drawer** (over a dimmed backdrop, list/board stay visible behind) to edit the project (name, description, tile color), manage members (rename, **role title**, color, days off, add/remove — **duplicate names within a project are rejected** so the roster and assignee dropdowns stay unambiguous), and delete the project
- **Task groups & row actions** — hover a row → a checkbox appears; select tasks and a floating bar (English labels) offers **Group** (group several of one member under a new head — children nest, collapse + roll-up `done/total`), **Ungroup**, **Chain prereqs** (link the selection top-to-bottom — each depends on the one above, keeping existing prereqs, ≥2 required), **Clear prereqs** (wipe `dependsOn` on the selection), and **Delete** (delete the selection). The selection bar is the only delete affordance — there's no per-row kebab. Parents are containers, excluded from member counts
- **Schedule conflict warning** — when one member is double-booked (two sized tasks whose computed time ranges **overlap**, or that share a start time, end time, or a prerequisite) each row gets an amber ⚠ + the member header shows an `N trùng lịch` badge. Back-to-back tasks (touching endpoints) don't count
- **Status** — Reminders-style circle (todo / in-progress / done) + soft-tint pill
- **Task change log** — a faint 🕒 right after each task's title (List + Board) whose hover tooltip shows the **5 most recent** user edits, newest-first (`Status: To do → Done · 2h ago`). Records edits to title / status / priority / assignee / start / due / effort / **prereqs** (a prereq change logs `Prereqs: — → 1-2` **plus** the old→new dates it shifted on that task, e.g. `Start: May 4 → May 6`). Otherwise the scheduler's auto-recomputed dates aren't logged — the log captures *what you did*, and the one recomputed date it does record is the direct result of your own prereq edit. Title keystroke-bursts coalesce into one entry; assignee names are frozen so history survives a member being deleted. Stored on the task (non-indexed, no schema bump). See [`design-docs/task-change-log.md`](./design-docs/task-change-log.md)
- **Date picker** — a custom **Cupertino calendar** (replaces the native `<input type=date>` everywhere): Monday-first month grid, today ring, selected fill, weekends dimmed but still selectable, keyboard `← → ↑ ↓ / Enter / Esc`, Today / Clear, light+dark themed. **Planner-aware**: task date cells **highlight the sprint** (range shaded, opens on the sprint month — *shade only*, any date stays selectable since a task can run past its sprint), and the **assignee's in-sprint days-off** are marked with orange dots (half-day = half dot) and **listed with their time detail** below the grid (`Jun 6 · AM off · 08:00–12:00`, `Jun 10 · Off all day`). The member **days-off** picker hard-clamps entry to the sprint range. An empty date can render a discoverable **dashed `＋ Start / ＋ Due` pill** instead of a bare dash (always-on in Collections; hover-revealed on unlocked cells in the sprint List / Board, never on scheduler-locked dates).
- **Auto-scheduling** — set effort + prereqs, dates compute automatically (skips weekends + per-member off-days, supports half-day off)
- **Sprint rollover** — move unfinished tasks to the next sprint via a **preview popover** anchored to the Roll over button (not a center modal): it lists the exact tasks that will move (status · `#seq` · priority · title · assignee · due date, overdue in red) so you confirm by seeing, then **Move N**. Outside-click / Esc dismisses
- **Inline rename** — single-click a collection / table name (a hover ✎ hints it) to edit inline (sprint names are **locked** — not renamable; member rename/delete live in the settings page)
- **In-DNA confirms** — no native `window.confirm()`: destructive actions (delete project/member/tasks, delete collection, import-replace) use a Cupertino confirm **sheet**; in-card actions (delete a collection table/status) use an inline red Delete/Cancel strip
- **Cupertino UI** — Apple "design language": SF Pro + tabular figures · system blue `#0071E3` accent · grey canvas + white cards · large soft-rounded corners · vibrancy sidebars · depth over borders · **calm micro-motion ≤300ms** (status-complete pop + check-draw, capacity-bar glide, dialog scale-fade-in, a sliding segmented control) — all honour `prefers-reduced-motion` (design-system §6.5)
- **Keyboard-first**: `/` focus search · `n` new sprint · `⌘⇧D` toggle dark mode
- **Export / Import JSON** — local-first backup, no sync. Import **validates the file's shape before touching your data** — a truncated/foreign/hand-edited file (or one with duplicate ids) is rejected with a plain message and your existing data is left intact, never half-wiped
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

Five IndexedDB tables in `app/src/db.ts`:

| Table         | Fields                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| `projects`    | id, name, createdAt, description?, color?                                          |
| `members`     | id, projectId, name, color, daysOff (`{date, half?}[]`), title?                   |
| `sprints`     | id, projectId, name, startDate, endDate, note?                                    |
| `collections` | id, projectId, name, order, sections (`{id, name, color?}[]`), statuses (`{id, name, color}[]`), createdAt |
| `tasks`       | id, projectId, sequence, title, assigneeId, sprintId, status, priority, dependsOn, startDate, dueDate, estimate, parentId?, boardOrder?, listOrder?, changeLog?, collectionId?, sectionId?, collectionStatusId?, … |

A task lives in **exactly one** container — `sprintId` (sprint task) **xor** `collectionId` (collection item), the other `null`. Schema version bumps via Dexie's `version().stores()` + upgrade callback (currently v9 — adds the `collections` table + the `collectionId` index on tasks).

## Philosophy

- Single-user web app, no auth
- Speed > breadth (≤ 1 click or 1 keystroke per action)
- Local-first (export/import = backup, not sync)
- Calm utility (calm > cute)
