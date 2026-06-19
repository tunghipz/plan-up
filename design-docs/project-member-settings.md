# Project & member settings

**Status:** Implemented
**Last updated:** 2026-06-16
**Code:** `app/src/ProjectSettingsView.tsx`, `app/src/members.tsx` (shared member
components), `app/src/App.tsx` (gear button + `settingsOpen` state), `app/src/SprintView.tsx`
(imports the shared components), `app/src/db.ts` (`updateProject`, `PALETTE`)

## Purpose
Give one calm place to view and edit a project's own info and its members, instead of
the editing being scattered (project rename/delete had **no UI at all**; member rename
lives in a double-click on the Sprint group header; days-off in a popover there). Also
fills two existing gaps: no way to rename a project, and `deleteProject()` was orphaned
(reachable only from code/tests).

## User-facing behavior
- A **gear button** in the sprint-panel header (next to the project name) opens the
  settings as a **right-side drawer** (`form: right drawer`, chosen 2026-06-04 over a
  centered modal / drop-down sheet — see `demo/settings-popup-options.html`). The drawer
  slides in from the right edge over a dimmed + blurred backdrop; the List/Board area
  **stays rendered behind** (visible but dimmed) so settings reads as an *inspector* you
  tweak and dismiss, not a separate page. Close via the gear again, an **X**, the backdrop,
  or `Escape`.
- **Keyboard while settings is open** (see [search-and-keyboard.md](./search-and-keyboard.md)):
  `Escape` closes settings **first** (takes priority over the search-clear behavior).
  `n` (new sprint) and `/` (focus search) are **disabled** while open — even though the
  search box now stays visible behind the backdrop, its shortcut is gated so typing can't
  land underneath, and a sprint dialog should not stack over settings.
- The page scopes to the **current project only** (the one selected in the icon rail) and
  its members. It is not a global project manager.
- Three inset-grouped cards (card-per-group, per `design-system.md`):
  1. **Project** — edit name (`.editable`), a multi-line **description** (textarea, saved
     **on blur** since `Enter` inserts a newline), an **icon** (emoji — curated grid +
     typed/pasted, "Aa" clears to the first-letter fallback; see
     [project-icon-emoji.md](./project-icon-emoji.md)), and a **color** chosen from the
     existing 8-color palette (swatch row; overrides the name-hash color used on the rail tile).
  2. **Members** — one **two-line** row per member: avatar + name (`.editable`) on top,
     and the member's **days off as a metric line underneath** — `📅 2 days off`, **always
     shown** (`No days off this sprint` when none, click to edit). Days off is the *primary*
     info here, so it reads as the member's stat rather than a faint trailing label. A
     **color dot** on the right (click → palette popover) overrides the name-hash color; it
     is deliberately quiet (color is secondary). A delete button (hover-reveal). Plus an
     **Add member** row (type a name → Enter, keeps focus for rapid entry).
  3. **Danger zone** — **Delete project** button (wires `deleteProject()`), behind a
     native `window.confirm()` step (consistent with `deleteMember`'s existing confirm)
     because it cascades.

## Data
- `Project` gains three **optional, non-indexed** fields:
  `description?: string`, `color?: string` (a hex from the palette), and `icon?: string`
  (one emoji grapheme). See [data-model.md](./data-model.md),
  [project-icon-emoji.md](./project-icon-emoji.md).
- `Member` is unchanged: `{ id, projectId, name, color, daysOff }` — name/color edited
  here, days-off still flows through `setMemberDaysOff` so scheduling recomputes.

### No Dexie version bump
`description`, `color`, and `icon` are **not indexed**, and Dexie only declares indexed properties
in `.stores()`. New properties on stored objects need no migration. Existing project rows
simply lack the fields; the UI falls back to `colorForName(name)` for color and an empty
description. (If we ever want to *query/sort* by these, that's when a `version().stores()`
bump is required — not now.)

## Implementation
Chosen approach: **B — extract shared member components** (one source of truth between the
Sprint header and this settings page).

- **`ProjectSettingsView.tsx`** — renders the three cards (header + scrollable body)
  sized for a narrow drawer (full height, single column, no `max-w` centering). Reuses
  `.editable`, `Avatar`, and the extracted member sub-components below.
- **App shell** (`App.tsx`) — a `settingsOpen` boolean (transient, **not** persisted).
  Gear button toggles it. The main List/Board column **always renders**; the settings
  drawer is a sibling overlay: a fixed backdrop (`bg-black/25 backdrop-blur-md`, click to
  close, `pointer-events-none` when closed) + a fixed right panel (`w-[440px] max-w-[90vw]`,
  `translate-x-full` → `translate-x-0`, eased slide). Both stay mounted whenever a project
  exists so the open/close transform animates; the view toggle + capacity banner are **no
  longer hidden** (they sit dimmed behind the backdrop).
  - **A11y while closed:** because the drawer stays mounted (just slid off-screen at
    `translate-x-full`), it carries **`inert={!settingsOpen}`** so its content — including
    the destructive **Delete project** button — is removed from the tab order and the
    accessibility tree when closed. Without `inert` a screen reader would announce the whole
    panel and `Tab` would land on hidden controls.
  - **Key handler ordering:** put `if (settingsOpen) { setSettingsOpen(false); return }`
    at the **top** of the global `Escape` branch (before the search-clear `return`), so
    Escape closes settings even when the search box has text. Gate `n` and `/` with an
    early `if (settingsOpen) return`. See [search-and-keyboard.md](./search-and-keyboard.md).
- **Shared member components** (`app/src/members.tsx`, imported by both `SprintView.tsx`
  and the new view). Also exports a generic `ColorSwatchRow` (used directly for the project
  color) and `Avatar`:
  - `MemberDaysOffButton` — the days-off popover, prop `{ member, variant? }`. Two trigger
    looks share one popover body: `variant="header"` (default — the Sprint group header
    chip, icon + `Nd off`, hover-revealed when 0) and `variant="metric"` (the settings
    row's always-visible metric line: calendar + `2 days off` / `No days off this sprint`).
    Calls `setMemberDaysOff` so dependents reschedule. **Helper deps moved with it:**
    `effectiveDaysOff`, `fmtDays`, `formatShortDate`.
  - `MemberColorDot` — **NEW** quiet color control: a single dot of the member's current
    color; click opens a small popover with `ColorSwatchRow` (the 8-color palette) and
    writes via `db.members.update(id, { color })`. Replaces the loud always-on 8-swatch row
    (that read as iconography slop ×N members).
  - `ColorSwatchRow` — generic palette row, used by `MemberColorDot`'s popover and directly
    for the **project** color (one instance, so kept inline there).
  - **Design-system note (§2.4):** the constitution says member color is deterministic
    (`colorForName`), *not* user-pickable. We keep a **minimal** picker (quiet dot) by
    explicit product choice — flagged here so the deviation is intentional, not accidental.
  - The Sprint group header keeps using `MemberDaysOffButton` (default variant) via import
    (behavior identical to today).
- **Add member:** the existing `AddMemberRow` (`SprintView.tsx:1787`) is **not**
  self-contained — it takes `active / onActivate / onDeactivate` props (toggle state lives
  in the parent). Either lift that state into the settings view too, or inline a simpler
  add row that just calls `db.members.add({ ...colorForName(name) })`.
- **db helpers:**
  - Add `updateProject(id, patch: Partial<Pick<Project,'name'|'description'|'color'>>)` →
    `db.projects.update(id, patch)`.
  - Member name/color: inline `db.members.update(id, { ... })` (pattern at `SprintView.tsx:317`).
  - Delete project: existing `deleteProject(projectId)` (`db.ts:229`) — already cascades
    tasks/sprints/members and strips cross-project `dependsOn`.
- **Project color usage:** the icon-rail tile (`App.tsx:329`) and avatars read
  `project.color ?? colorForName(project.name)`.

## Rules & edge cases
- **Color is palette-only** (no free color picker) to stay calm and consistent with the
  rail. Same 8-color palette as `colorForName`.
- **Deleting the current project** is destructive and cascading → require confirm. The
  fallback is **automatic**: `App.tsx`'s existing effect (≈`130-138`) watches the live
  `projects` list and, when `currentProjectId` no longer exists, sets it to `projects[0]`
  (first by `createdAt`). The settings view just calls `deleteProject()` and closes — it
  must **not** re-implement project selection.
- **Deleting the last project** → `projects` becomes empty, `currentProject` is `null`, and
  the main column has no sprint to show. Verify the app renders a sane **zero-project empty
  state** (prompt to create one via the rail `+`) and does not crash; add a minimal empty
  state if one doesn't already exist. Also close settings on delete (nothing to configure).
- Days-off edits here behave exactly as in the Sprint header (immediate reschedule); the
  two surfaces share one component, so they can never drift.
- `settingsOpen` is **not** persisted — opening the app never lands on the settings page.
- Renaming a project does **not** change its color (color is now independent once set;
  only name-hash fallback tracks the name).

## Future / open questions
- Per-member daily capacity / working hours and role/notes were considered and **deferred**
  (this round adds project fields only). If added later, they extend `Member` (non-indexed,
  same no-migration story) and surface in the member row here.
- A global "manage all projects" page (rename/delete across projects) was considered and
  **deferred** in favor of current-project scope.
