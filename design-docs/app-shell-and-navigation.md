# App shell & navigation

**Status:** Implemented
**Last updated:** 2026-06-03
**Code:** `app/src/App.tsx`

## Purpose
The three-pane macOS-style frame that hosts everything, plus the at-a-glance
capacity banner above the active view.

## User-facing behavior
Left → right:
1. **Icon rail** (58px, vibrancy) — one squircle tile per project (initial + brand color),
   active project ringed in accent; `+` opens New Project; dark-mode toggle pinned bottom.
2. **Sprint panel** (vibrancy, **resizable**) — project name + sprint/task counts, the
   sprint list (active row = accent bg), `+`/`n` to add a sprint. **Drag the right edge**
   to resize.
3. **Main column** — header toolbar (sprint name, star, date range, Roll over, view
   toggle, search, Export/Import), then the **capacity banner**, then the List/Board view.

## Capacity banner (`App.tsx` `CapacityBanner`)
Three cards, shown when a sprint is selected, computed from the current sprint's tasks:
- **Backlog** — `total` tasks ("Empty" hint when 0).
- **Assigned** — `round(assigned/total*100)%`, sub "X/Y have an owner".
- **Progress** — `round(done/total*100)%`, sub "X done · Y not estimated".

## Implementation
- Resizable sidebar: `SIDEBAR_MIN=200`, `SIDEBAR_MAX=460`, default `248`, `RAIL_W=58`.
  Drag handler maps `clientX - RAIL_W`, clamped. Persisted to `localStorage`.
- Live data via Dexie `useLiveQuery`: projects (by `createdAt`), sprints (by
  `currentProjectId`, ordered `startDate`), tasks (by `currentSprintId`), project-wide
  tasks (for sprint counts).

## Rules & edge cases
- **localStorage keys:** `plan-up:currentProjectId`, `plan-up:view`,
  `plan-up:sidebarWidth`, `plan-up:dark`, `plan-up:collapsed:<sprintId>`.
- Current **sprint** is *not* persisted across sessions — on load it defaults to the
  latest sprint (by `startDate`) in the current project; resets when the project changes.
- The header **star** button is a visual placeholder (no handler yet).
