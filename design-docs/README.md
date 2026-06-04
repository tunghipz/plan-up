# Design docs — plan-tmp

Per-feature design specs for the app. **One file per feature.** This folder is the
source of truth for *what each feature does and why*; the code is the source of
truth for *how*.

## ✋ Process: doc-first

> **Any feature change must update (or add) its design doc here BEFORE implementing.**

1. Write/update the relevant `design-docs/<feature>.md` (use the template below).
2. Get it reviewed/agreed.
3. Then implement, and keep the doc in sync if reality diverges.

New feature → new file here. Touching an existing feature → edit its file and bump
*Last updated*.

## Doc template

```md
# <Feature>

**Status:** Implemented | Planned
**Last updated:** YYYY-MM-DD
**Code:** `app/src/<files>`

## Purpose
Why it exists / what user problem it solves.

## User-facing behavior
What the user sees and does.

## Data
Tables / fields touched (link to data-model.md).

## Implementation
Key components / functions (with file:line), algorithm notes.

## Rules & edge cases
Non-obvious behaviors, defaults, persistence keys.

## Future / open questions
(optional)
```

## Index

| Doc | Feature |
| --- | --- |
| [data-model.md](./data-model.md) | IndexedDB tables, fields, Dexie schema versioning |
| [persistence-and-backup.md](./persistence-and-backup.md) | Local-first storage, export/import JSON, seeding |
| [app-shell-and-navigation.md](./app-shell-and-navigation.md) | Layout, icon rail, resizable sprint panel, capacity stats |
| [projects.md](./projects.md) | Multi-project create/switch/delete |
| [project-member-settings.md](./project-member-settings.md) | Gear → settings page: edit project info (name/description/color) + members + delete |
| [sprints.md](./sprints.md) | Sprint CRUD, biweekly defaults, per-sprint sequence |
| [sprint-rollover.md](./sprint-rollover.md) | Move unfinished tasks to next sprint |
| [members-and-days-off.md](./members-and-days-off.md) | Member labels, colors, off-days |
| [tasks.md](./tasks.md) | Task CRUD, fields, inline editing |
| [scheduling.md](./scheduling.md) | Auto-scheduling engine (effort, prereqs, workdays) |
| [dependencies.md](./dependencies.md) | Prerequisites, cycle prevention, blocked state |
| [status-and-priority.md](./status-and-priority.md) | Status circle/pill, priority chip |
| [list-view.md](./list-view.md) | Grouped cards, sortable columns, column widths |
| [member-header-summary.md](./member-header-summary.md) | Progress ring, overdue, next deadline, days off |
| [board-view.md](./board-view.md) | Cupertino kanban |
| [search-and-keyboard.md](./search-and-keyboard.md) | Search filter, keyboard shortcuts |
| [dark-mode.md](./dark-mode.md) | Theme toggle |

## Cross-cutting docs (kept in repo root)

- [`../design.md`](../design.md) — product spec: premises, scope, success criteria.
- [`../design-system.md`](../design-system.md) — UI/UX constitution: brand, typography,
  layout, component rules, anti-patterns. **Read before building any new component.**
