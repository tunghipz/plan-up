# App shell & navigation

**Status:** Implemented
**Last updated:** 2026-06-19 (section headers promoted to **titles** — 15.5px semibold
ink-muted, lists indented beneath — plus the muted type icon: Sprints = `FolderSync`,
Collections = `Layers`; **icon-rail tiles now depress on press** — see [Motion](#motion))
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
  - **Type icon (2026-06-19):** between the caret and the label each header carries a muted
    `16px` lucide icon marking it as a *kind* of container — **Sprints = `FolderSync`** (a
    folder of recurring, Monday-locked biweekly time-boxes — the sync arrows carry the cadence
    meaning the earlier `Repeat` glyph held, now in folder/container form), **Collections =
    `Layers`** (a stack of standing groups). Two distinct silhouettes — a *folder* vs a *stack*,
    and the sync arrows keep Sprints from reading as a generic container next to Collections —
    so the peer sections separate at a glance.
    Kept `text-ink-faint`, **never accent** — wayfinding, not decoration (design-system §2.1).
    These are the only per-section icons; row-level icons stay reserved for state/actions to
    avoid icon slop.
  - **Title weight + indent (2026-06-19):** the section labels are **titles**, not the old
    faint tags — `text-[15.5px] font-semibold tracking-[-0.01em] text-ink-muted` (caret + type
    icon stay `text-ink-faint`; the count beside is `text-[13px]` muted). The lists sit
    **indented** (`pl-[26px]`) so rows nest beneath their title. This gives a deliberate
    three-step scale — **project name 21 › section title 15.5 › row 14** — that makes hierarchy
    clear while staying close to the calm macOS section-label idiom (promoted from `ink-faint`
    to `ink-muted` for heading weight, not full ink). The archived disclosure sits at the list
    indent; archived rows nest one step deeper (`pl-3`).

- **Sidebar version footer (2026-06-16):** a calm `plan-up · v{version}` line pinned to the
  **bottom** of the resizable sidebar (`mt-auto`, hairline `border-t`, `text-[11px]`
  `text-ink-faint` tabular-nums) — shown in both the project-selected and empty states.
  Version is the **app release version from `package.json`**, injected at build time via Vite
  `define` (`__APP_VERSION__`), so there's one source of truth (no hardcoded string). It's
  reference info you rarely need, so it stays faint and never accent-tinted (accent is a
  signal, not chrome — design-system §2.1). When a **newer build is detected** the same line
  morphs in place into a glowing "Update" pill (`<VersionFooter />`) — see
  [version-and-updates.md](./version-and-updates.md).

## Motion
- **Icon-rail tile press (2026-06-19):** every rail button — project tiles, the `+` New
  Project tile, and the dark-mode toggle — **depresses on press** (`active:scale-[0.92]`,
  springing back on the shared **spring** easing `cubic-bezier(.34,1.56,.64,1)` via the
  `.tile-press` class in `index.css`). The rail is a dock of app-icon squircles; like
  macOS/iOS home icons, tapping one should feel physical. Hover (opacity → 1) and the
  accent selection ring are unchanged; this only adds the tactile *press*. Honours
  `prefers-reduced-motion` (no scale). Calm, ≤120ms, serves the real act of selecting a
  project — explored in `demo/sidebar-activitylog-motion.html` (verdict: ship). Sprint rows
  intentionally **do not** get a press effect — they already glide their accent fill on
  select, and adding a second motion there would be the scattered-microinteraction
  anti-pattern (§6.5 / §8.3).

## Rules & edge cases
- **localStorage keys:** `plan-up:currentProjectId`, `plan-up:view`,
  `plan-up:sidebarWidth`, `plan-up:dark`, `plan-up:collapsed:<sprintId>`,
  `plan-up:sidebarSprintsCollapsed`, `plan-up:sidebarCollectionsCollapsed`.
- Current **sprint** is *not* persisted across sessions — on load it defaults to the
  latest sprint (by `startDate`) in the current project; resets when the project changes.
