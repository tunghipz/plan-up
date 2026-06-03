# plan-tmp

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
- **Two views**:
  - **List** — grouped by assignee in inset-grouped cards · Reminders-style status circles · sortable column headers · width-aware auto-wrap titles
  - **Board** — Cupertino kanban: three columns on the grey canvas, white soft-shadowed cards · click the status circle to cycle
- **Task fields**: title, assignee, sprint, status, priority, start/end date, estimate, dependencies
- **Member header at a glance** — each assignee group shows a progress ring (% done) around the avatar, done/total, an overdue alert (only when > 0), remaining workload (`Nd left`), and days off as effective days (`1.5d off`, half-days count 0.5) — all derived from tasks, no extra fields
- **Status** — Reminders-style circle (todo / in-progress / done) + soft-tint pill
- **Auto-scheduling** — set effort + prereqs, dates compute automatically (skips weekends + per-member off-days, supports half-day off)
- **Sprint rollover** — move unfinished tasks to next sprint in one click
- **Inline rename** — double-click sprint name or member name to edit
- **Cupertino UI** — Apple "design language": SF Pro + tabular figures · system blue `#0071E3` accent · grey canvas + white cards · large soft-rounded corners · vibrancy sidebars · depth over borders
- **Keyboard-first**: `/` focus search · `n` new sprint · `⌘⇧D` toggle dark mode
- **Export / Import JSON** — local-first backup, no sync
- **Dark mode** — Apple dark (canvas `#1C1C1E`, accent `#0A84FF`)

## Layout

```
/                  → docs only (design.md, design-system.md, CLAUDE.md)
/app               → everything code (src/, vite.config.ts, package.json, …)
```

## Design docs

- [`design.md`](./design.md) — product spec: premises, scope, success criteria
- [`design-system.md`](./design-system.md) — UI/UX constitution: brand, typography, layout, component rules, anti-patterns

Read `design-system.md` **before** building any new component.

## Data model

Four IndexedDB tables in `app/src/db.ts`:

| Table      | Fields                                                                            |
| ---------- | --------------------------------------------------------------------------------- |
| `projects` | id, name, createdAt                                                               |
| `members`  | id, projectId, name, color, daysOff (`{date, half?}[]`)                           |
| `sprints`  | id, projectId, name, startDate, endDate                                           |
| `tasks`    | id, projectId, sequence, title, assigneeId, sprintId, status, priority, dependsOn, startDate, dueDate, estimate, … |

Schema version bumps via Dexie's `version().stores()` + upgrade callback (currently v8).

## Philosophy

- Single-user web app, no auth
- Speed > breadth (≤ 1 click or 1 keystroke per action)
- Local-first (export/import = backup, not sync)
- Calm utility (calm > cute)
