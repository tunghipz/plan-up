# Design docs — plan-up

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
| [project-export-import.md](./project-export-import.md) | Per-project export to a portable file + non-destructive "add as new project" import (auto-detected alongside full backup) |
| [app-shell-and-navigation.md](./app-shell-and-navigation.md) | Layout, icon rail, resizable sprint panel, capacity stats |
| [home-dashboard.md](./home-dashboard.md) | Read-first Home screen: all-projects grid (active-sprint progress/overdue) + cross-project People roster (Dexie v13 `people` table) |
| [projects.md](./projects.md) | Multi-project create/switch/delete |
| [project-member-settings.md](./project-member-settings.md) | Gear → settings page: edit project info (name/description/color) + members + delete |
| [project-icon-emoji.md](./project-icon-emoji.md) | Optional emoji override for a project's icon-rail tile (curated grid + native picker; falls back to first letter) |
| [sprints.md](./sprints.md) | Sprint CRUD, biweekly defaults, per-sprint sequence, locked `Sprint N` name + optional goal note |
| [sprint-cadence.md](./sprint-cadence.md) | Sprint start locked to Monday + fixed 2-week duration (Monday-strip picker, derived read-only end) |
| [sprint-archive.md](./sprint-archive.md) | Reversible archive to declutter the sprint list (collapsible `Archived (N)` section, hover action, out of active flow) |
| [collections.md](./collections.md) | Task ngoài sprint — collection tự đặt tên, nhiều bảng (sections), view List (giống sprint, tap-to-edit) + Calendar liền mạch, status do user tự tạo per-collection |
| [sprint-rollover.md](./sprint-rollover.md) | Move unfinished tasks to next sprint — preview popover |
| [members-and-days-off.md](./members-and-days-off.md) | Member labels, colors, off-days |
| [member-title.md](./member-title.md) | Optional per-member role label (free-text), shown in settings + sprint header |
| [member-avatars.md](./member-avatars.md) | Custom member avatar — upload photo (resized) or pick emoji; edited in Project Settings; falls back to colored initial |
| [member-lane-order.md](./member-lane-order.md) | Drag-to-reorder member lanes (per project); drives List card order + Board `member` sort |
| [tasks.md](./tasks.md) | Task CRUD, fields, inline editing |
| [task-change-log.md](./task-change-log.md) | **Removed (2026-06-16)** — per-task 🕒 change-log tooltip, superseded by the sprint activity log |
| [sprint-activity-log.md](./sprint-activity-log.md) | Sprint-wide activity log — 🕒 toolbar entry opens a right-side drawer (timeline + by-member); append-only `events` store, the app's sole edit-history surface |
| [task-groups.md](./task-groups.md) | Group tasks under a parent task (nested, roll-up + collapse) |
| [scheduling.md](./scheduling.md) | Auto-scheduling engine (effort, prereqs, workdays) |
| [milestones.md](./milestones.md) | Effort-0 tasks shown as milestones — `◆ Milestone` pill + single collapsed date (List view) |
| [conflict-warning.md](./conflict-warning.md) | Warn when a member is double-booked (same start/end/prereq) |
| [dependencies.md](./dependencies.md) | Prerequisites, cycle prevention, blocked state |
| [status-and-priority.md](./status-and-priority.md) | Status circle/pill, priority chip |
| [date-picker.md](./date-picker.md) | Custom Cupertino calendar picker (sprint-aware, days-off dots + list) |
| [list-view.md](./list-view.md) | Grouped cards, sortable columns, column widths, drag-to-reorder |
| [member-header-summary.md](./member-header-summary.md) | Progress ring, overdue, next deadline, days off |
| [board-view.md](./board-view.md) | Cupertino kanban |
| [gantt-view.md](./gantt-view.md) | Timeline — Apple-Calendar swimlanes (one event block per task), per sprint |
| [search-and-keyboard.md](./search-and-keyboard.md) | Search filter, keyboard shortcuts |
| [dark-mode.md](./dark-mode.md) | Theme toggle |
| [app-icon-and-favicon.md](./app-icon-and-favicon.md) | Favicon (ring-on-squircle, dark-aware SVG) + link-preview og:image |

## Cross-cutting docs (kept in repo root)

- [`../design.md`](../design.md) — product spec: premises, scope, success criteria.
- [`../design-system.md`](../design-system.md) — UI/UX constitution: brand, typography,
  layout, component rules, anti-patterns. **Read before building any new component.**
