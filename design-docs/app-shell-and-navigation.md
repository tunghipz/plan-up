# App shell & navigation

**Status:** Implemented
**Last updated:** 2026-07-06
**Code:** `app/src/App.tsx`

> **v3 · Project switcher + compact sprint rows (2026-07-06)** — the always-on
> **58px icon rail** (one squircle per project) is **removed**. Project switching
> now lives in a **header dropdown** at the top of the sidebar (the current project
> only; a popover switches to any other). The functions the rail used to own move
> into that popover (New project, Home / All projects) and the sidebar footer +
> Home header (dark-mode toggle). Sprint rows are also **compacted** to a two-tier
> layout (tighter padding, meta as a small caption). The two-pane frame below is
> now the whole app; there is no third rail pane.
>
> **v3.1 · Overview hidden (2026-07-06)** — the Home / All-projects overview is
> **temporarily hidden** behind `HOME_ENABLED = false` in `App.tsx`. The
> **"Home / All projects"** item is dropped from the switcher popover, the app never
> lands on `screen === 'home'`, and `HomeDashboard` is never rendered. Everything else
> below is unchanged. To restore, flip `HOME_ENABLED` back to `true`. See
> [home-dashboard.md](./home-dashboard.md).

## Purpose
The two-pane macOS-style frame (sidebar + main) that hosts everything, plus the
at-a-glance capacity banner above the active view.

## Top-level screen (`screen`)
`App.tsx` holds a top-level `screen: 'home' | 'project'`, persisted at
`localStorage['plan-up:screen']`. `'project'` is the three-pane frame below;
`'home'` replaces the sprint panel + main column with the full-width
[Home dashboard](./home-dashboard.md) (the rail stays). The per-project selection
is preserved while on Home, so returning restores it. Reload lands on the last
screen — Home is **never** force-shown over a project you left open.

**As of 2026-07-06 the Home screen is gated off** by `HOME_ENABLED = false`: the
`screen` state is forced to `'project'` on load regardless of the persisted value, so
in practice the app is always the two-pane project frame today. The `screen` machinery
is left intact so restoring the overview is a one-line flip.

## User-facing behavior
Left → right:
1. **Sidebar** (vibrancy, **resizable**) — top to bottom:
   - **Project switcher** (header dropdown) — a full-width button showing the **current
     project only** (squircle icon = emoji/initial + brand color, project name, and the
     `{n} sprints · {m} tasks` counts as a sub-line) with a `ChevronDown`. Clicking it opens a
     **popover** listing **all** projects (each = squircle + name, a `Check` on the active one;
     clicking one switches project), then a divider and the footer action **New project**
     (`Plus`). *(The **Home / All projects** item is hidden while `HOME_ENABLED = false`; it
     reappears when the overview is restored.)* The trigger
     carries `aria-haspopup="menu"` + `aria-expanded`; the active project row carries
     `aria-current`. The popover closes on outside-press / Escape (shared `usePinnedPopover`
     wiring) and caps its list height (scrolls) so many projects don't overflow the pane.
     A **settings gear** sits beside the switcher (unchanged).
   - **Sprints + Collections** — the sprint list (active row = accent bg), `+`/`n` to add a
     sprint, then Collections. Both are collapsible sections (unchanged).
   - **Footer** — `plan-up · v{version}` (see below) with the **dark-mode toggle** (`Moon`/`Sun`)
     pinned at its right. **Drag the right edge** of the sidebar to resize.
2. **Main column** — header toolbar (sprint name, date range, Roll over, view
   toggle, search, Export/Import), then the **capacity banner**, then the List/Board view.

The **Home overview** (portfolio) *(currently hidden — see banner)* replaces the main column
full-width when `screen==='home'`; its header carries its own **New project** + **dark-mode
toggle** buttons (top-right), since the sidebar/switcher isn't shown there. The **empty state**
(no project selected/created) shows a
**New project** call-to-action so a fresh install can bootstrap without the old rail `+`.

### Sprint row layout (compact, 2026-07-06)
Each sprint row is a **two-tier** button, tightened from the earlier taller row:
- **Top line** — `SprintStateDot` + sprint **name** (`text-[14px]`, medium; note glyph hugs the
  title) + the **task count** right-aligned (`text-[11.5px]` muted, tabular-nums).
- **Meta line** — the date range (`text-[11.5px]` muted, tabular-nums), indented under the name;
  archived rows append `· archived {mon d}`.
- **Active** row keeps the macOS **accent fill** (`bg-accent text-white`); meta/count go
  `white/80`. Padding is reduced (`px-2.5 py-1.5`, `gap-2`) so more sprints fit without scroll.
The hover **archive/unarchive** action (absolute right, appears on hover) is unchanged.

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
- Resizable sidebar: `SIDEBAR_MIN=200`, `SIDEBAR_MAX=460`, default `248`. The sidebar is now
  the leftmost pane (no rail), so the drag handler maps `clientX` directly, clamped. Persisted
  to `localStorage`.
- **Project switcher:** local `switcherOpen` state + `usePinnedPopover` for outside-press /
  Escape (no `place` — the popover is `absolute` inside the switcher's `relative` header, so it
  scrolls with the pane). Reuses `firstGrapheme`/`colorForName` for the squircle, same as the
  old rail tiles + Home cards.
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
- **Switcher popover** opens/closes on the shared calm transition (fade + slight rise); the
  chevron rotates 180° while open. Rows hover on `surface-hover`.
- Sprint rows intentionally **do not** get a press effect — they already glide their accent
  fill on select, and adding a second motion there would be the scattered-microinteraction
  anti-pattern (§6.5 / §8.3).
- *Historical:* the removed icon rail carried a `.tile-press` depress
  (`active:scale-[0.92]`, spring easing) on its squircle tiles — see git history / the earlier
  `demo/sidebar-activitylog-motion.html`. The `.tile-press` class stays in `index.css` for any
  future dock-style control.

## Rules & edge cases
- **localStorage keys:** `plan-up:screen`, `plan-up:currentProjectId`, `plan-up:currentSprintId`,
  `plan-up:selKind`, `plan-up:selCollectionId`, `plan-up:view`, `plan-up:collectionView`,
  `plan-up:sidebarWidth`, `plan-up:dark`, `plan-up:collapsed:<sprintId>`,
  `plan-up:sidebarSprintsCollapsed`, `plan-up:sidebarCollectionsCollapsed`.
- **Restore the last screen on reload/relaunch:** project, sprint, container kind
  (sprint vs collection), collection, and view (list/board/timeline + collection's
  list/calendar) are all persisted, so a reload lands back exactly where the user was.
  The selected **sprint** (`currentSprintId`) is validated against the current project's
  sprints on load; if it's stale (deleted/archived or belongs to another project) it
  falls back to the latest non-archived sprint (`sprintToSelect`). Switching projects
  re-resolves the sprint the same way.
- **Loading vs empty:** the `sprints`/`collections` live queries return `undefined`
  (not `[]`) until seeded + a project is chosen. An empty array means "this project has
  zero sprints" and would wipe the restored selection during the load window; `undefined`
  means "still loading" and every consumer treats it as such (`sprints ?? []`, `!sprints`).
