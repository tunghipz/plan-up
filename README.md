# plan-tmp

ClickUp without the seat tax — a single-user, local-first task & sprint planner. Multi-project, no auth, no backend, no team plan. Members are just labels you create. Data lives in your browser (IndexedDB); export/import JSON for backup.

## Stack

React 19 · TypeScript · Vite · Tailwind v4 · Dexie (IndexedDB) · Geist + Geist Mono · lucide-react

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

- **Multi-project** — Slack/Discord-style icon rail (left), sprint panel (middle), task view (right)
- **Sprint folder** (biweekly) with start/end dates + per-sprint task sequence (resets to 1..N)
- **Two views**:
  - **List** — grouped by assignee · sortable column headers · column dividers · zebra striping · auto-wrap titles
  - **Board** — Kanban 3 columns (Todo / In Progress / Done), each column tinted by its status color, click status icon to cycle
- **Task fields**: title, assignee, sprint, status, priority, start/end date, estimate, dependencies
- **Status lozenges** (Jira-style) — solid pills for In Progress / Done, outline for To Do
- **Auto-scheduling** — set effort + prereqs, dates compute automatically (skips weekends + per-member off-days, supports half-day off)
- **Sprint rollover** — move unfinished tasks to next sprint in one click
- **Inline rename** — double-click sprint name or member name to edit
- **Jira-blue UI** — `#1868DB` accent · cool-paper chrome (no solid black) · hairline borders · Geist + Geist Mono typography
- **Keyboard-first**: `/` focus search · `n` new sprint · `⌘⇧D` toggle dark mode
- **Export / Import JSON** — local-first backup, no sync
- **Dark mode** — Atlassian-style dark canvas `#1D2125`

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
