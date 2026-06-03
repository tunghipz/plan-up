# plan-tmp

ClickUp without the seat tax — a single-user, local-first task & sprint planner. No auth, no backend, no team plan. Members are just labels you create. Data lives in your browser (IndexedDB); export/import JSON for backup.

## Stack

React 19 · TypeScript · Vite · Tailwind v4 · Dexie (IndexedDB) · TanStack Table · lucide-react

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

- **Sprint folder** (biweekly) with start/end dates
- **Group-by-Assignee** view — each member is a card with their tasks
- **Task fields**: title, assignee, sprint, status, priority, start date, due date
- **Keyboard-first**: `/` focus search · `n` new sprint · `⌘⇧D` toggle dark mode
- **Export / Import JSON** — local-first backup
- **Auto seed + dedupe** on first load
- **Dark mode** with rust `#C04A1A` accent

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

Three IndexedDB tables in `app/src/db.ts`:

| Table     | Fields                                                                  |
| --------- | ----------------------------------------------------------------------- |
| `members` | id, name, color                                                         |
| `sprints` | id, name, startDate, endDate                                            |
| `tasks`   | id, title, assigneeId, sprintId, status, priority, startDate, dueDate, … |

Schema version bumps via Dexie's `version().stores()` + upgrade callback.

## Philosophy

- Single-user web app, no auth
- Speed > breadth (≤ 1 click or 1 keystroke per action)
- Local-first (export/import = backup, not sync)
- Calm utility (calm > cute)
