# App shell & navigation

**Status:** Implemented
**Last updated:** 2026-06-16 (project tiles: aria-label + aria-current for screen readers)
**Code:** `app/src/App.tsx`

## Purpose
The three-pane macOS-style frame that hosts everything, plus the at-a-glance
capacity banner above the active view.

## User-facing behavior
Left → right:
1. **Icon rail** (58px, vibrancy) — one squircle tile per project (initial + brand color),
   active project ringed in accent; `+` opens New Project; dark-mode toggle pinned bottom.
   Each project tile carries `aria-label={p.name}` (so the accessible name is the full
   project name, not the single visible initial) and `aria-current="true"` on the active
   one — screen readers announce e.g. "My Project, current, button" instead of just "M".
2. **Sprint panel** (vibrancy, **resizable**) — project name + sprint/task counts, the
   sprint list (active row = accent bg), `+`/`n` to add a sprint. **Drag the right edge**
   to resize.
3. **Main column** — header toolbar (sprint name, date range, Roll over, view
   toggle, search, Export/Import), then the **capacity banner**, then the List/Board view.

## Capacity banner (`App.tsx` `CapacityBanner`)
A single slim block (design-system §4.7 hybrid bar), shown when a sprint is selected,
computed from the current sprint's **leaf** tasks (parents excluded — see task-groups):
- **Inline summary** — `{total} tasks · {pctDone}% done · {pctAssigned}% assigned`.
- **Stacked bar** — `rounded-full`, segments done (green) / assigned (accent) / free (grey)
  by share of `total`.
- **Legend** — `X done · Y assigned · Z free`, plus `⚠ N not estimated`
  (`--color-warn-ink` — dark amber, WCAG AA on white; see design-system §2.2)
  only when `notEstimated > 0`.
- Empty sprint (`total === 0`) → "No tasks yet — add your first task below" call to action.

## Implementation
- Resizable sidebar: `SIDEBAR_MIN=200`, `SIDEBAR_MAX=460`, default `248`, `RAIL_W=58`.
  Drag handler maps `clientX - RAIL_W`, clamped. Persisted to `localStorage`.
- Live data via Dexie `useLiveQuery`: projects (by `createdAt`), sprints (by
  `currentProjectId`, ordered `startDate`), tasks (by `currentSprintId`), project-wide
  tasks (for sprint counts).
- **Sidebar list area — single scroll + collapsible sections (2026-06-08):** the
  **Sprints** and **Collections** lists share **one** `flex-1 overflow-auto` wrapper
  (neither list is `flex-1` itself), so Collections sits directly under Sprints and any
  leftover space falls *below* both — no dead gap between them. Each section header is a
  **collapsible row** (click toggles; `ChevronDown` rotates `-90°` when collapsed; a muted
  count shows next to the label when > 0). The `+` button `stopPropagation`s so it never
  toggles. Collapse state persists per section in `localStorage`.

- **Sidebar version footer (2026-06-16):** a calm `plan-up · v{version}` line pinned to the
  **bottom** of the resizable sidebar (`mt-auto`, hairline `border-t`, `text-[11px]`
  `text-ink-faint` tabular-nums) — shown in both the project-selected and empty states.
  Version is the **app release version from `package.json`**, injected at build time via Vite
  `define` (`__APP_VERSION__`), so there's one source of truth (no hardcoded string). It's
  reference info you rarely need, so it stays faint and never accent-tinted (accent is a
  signal, not chrome — design-system §2.1). When a **newer build is detected** the same line
  morphs in place into a glowing "Update" pill (`<VersionFooter />`) — see
  [version-and-updates.md](./version-and-updates.md).

## Rules & edge cases
- **localStorage keys:** `plan-up:currentProjectId`, `plan-up:view`,
  `plan-up:sidebarWidth`, `plan-up:dark`, `plan-up:collapsed:<sprintId>`,
  `plan-up:sidebarSprintsCollapsed`, `plan-up:sidebarCollectionsCollapsed`.
- Current **sprint** is *not* persisted across sessions — on load it defaults to the
  latest sprint (by `startDate`) in the current project; resets when the project changes.
