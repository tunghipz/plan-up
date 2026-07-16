# Task groups (parent task with nested children)

**Status:** Implemented
**Last updated:** 2026-07-02 (`setTaskParent` enforces parent + child share the same sprint)
**Code:** `app/src/db.ts` (`Task.parentId`, `createGroupFromSelection`, `setTaskParent`),
`app/src/SprintView.tsx` (`MemberCard` task tree render, `TaskGroupRow` parent roll-up,
`SelectionBar` group/ungroup/delete), collapse persisted in `localStorage`

## Purpose
Inside a member's task list, let related tasks be **gathered under a parent task**
that acts as a group heading — e.g. `32) build 3` with `33/34/35` nested beneath it
(see the user's reference image). The parent is a real task (has a sequence number)
that doubles as the group title. Gives structure to a long member list without a
separate epic/tag system. Approach **B** chosen 2026-06-04 (see
`demo/task-group-options.html`): nested render **plus** parent roll-up + collapse.

## User-facing behavior
- **Create a group (multi-select):** hover a task row → a **checkbox** appears in the
  left gutter; check several tasks **of the same member**. A **floating action bar**
  slides up at the bottom (English labels): *"N selected · [Ungroup] · [Chain prereqs] ·
  [Clear prereqs] · [Group] · [Delete] · [Cancel]"*.
  - **Group** creates a **new parent task** titled `New group` (rename inline) and
    nests the selected tasks under it. Enabled only when ≥2 are selected, all share the
    same assignee, and none is already a group head (one level).
  - **Ungroup** ungroups any selected children (clears their `parentId`); shown when the
    selection contains ≥1 grouped task.
  - **Chain prereqs** / **Clear prereqs** set or clear prerequisites across the selection —
    see [dependencies.md](./dependencies.md#bulk-actions-multi-select).
  - **Delete** deletes the selected tasks (confirm first; works on a multi-select).
    Deleting a group head ungroups its children rather than cascade-deleting them; the
    confirm copy says so when the selection contains a group head. Deletes run
    sequentially so a parent's child-promotion can't race a selected child's own delete.
  - **Cancel** clears the selection. Selection also clears on sprint change.
  - Checkboxes are hover-revealed (hidden at rest, kept visible while selected) so the
    resting list stays calm; they share the left gutter with the conflict triangle.
  - **There is no per-row kebab (⋯).** Grouping is select-driven and **delete also lives
    on the selection bar** — the row has no actions column at all.
  - Children render indented beneath the parent (left padding, no connector tick).
- **One level only.** A child cannot itself be a parent, and a task that already has
  children cannot become someone's child. Enforced when setting `parentId`.
- **Roll-up on the parent row (Approach B):** the parent shows
  - a **progress count** `done/total` of its **children** (text only — no progress
    bar; the empty grey track read as noise at 0%, removed 2026-06-04),
  - a **derived status** badge (done if all children done; in-progress if any child
    is in-progress/done but not all done; else to-do) — display-only, computed on
    render, not written to the parent's stored `status`. The badge is the read-only
    `StatusPill`, sized to match a normal row's interactive pill exactly: that pill's
    native `<select>` reserves the widest label's width ("In progress"), so `StatusPill`
    reserves the same via an invisible sizer (no magic px) — group and normal status
    pills line up regardless of the displayed status,
  - a **summed effort** (sum of children `estimate`) in the Effort cell,
  - **dates** = the span of children (earliest child start → latest child end),
    read-only, shown with the **same date+time format and size as a normal row**
    (e.g. `Jun 8, 17:00`).
- **Collapse/expand:** the parent row has a chevron; collapsing hides its children.
  Persisted per parent in `localStorage` (`plan-up:taskgroup-collapsed:{parentId}`),
  mirroring the member-group collapse pattern (design-system §5.9 / §6.2).
- **Ordering with sort:** top-level tasks render in the current column sort order;
  each parent is immediately followed by its own children (children sorted within the
  group). Nesting is preserved regardless of sort.

## Data
- `Task` gains one **optional, non-indexed** field: `parentId?: string | null`
  (id of the parent task; absent/null = top-level). See [data-model.md](./data-model.md).

### No Dexie version bump
`parentId` is **not indexed**; children are grouped in memory from the already-loaded
sprint tasks. New optional property → no migration (same precedent as `member.title`,
`project.description`). Export/import serialise whole `Task` objects, so `parentId`
rides along; **`ExportPayload.version` unchanged**; older exports import fine (every
task simply top-level).

## Counting & capacity (the Approach-B decision)
A parent (a task **with** children) is treated as a **container**, not a leaf:
- It is **excluded** from the member header `done/total` and from capacity effort sums.
  Only **leaf** tasks (no children) count. This avoids double-counting the work that
  actually lives in the children, and makes the parent's roll-up the single source of
  truth.
- The parent's own stored `status`/`estimate`/dates are **ignored for counting** while
  it has children (its displayed status/effort/dates are derived from children).
- A task with **no** children counts normally (today's behavior unchanged).

This is the one place Approach B touches existing logic: wherever the member group
computes `total`, `done`, overdue, and capacity, it must skip tasks that have children.

## Scheduling
- **Children schedule independently** — each keeps its own `estimate` / `dependsOn` /
  dates and flows through `computeWorkingPlan` exactly as today.
- `parentId` is **organizational only** for the children — grouping never reorders the
  children or makes a child wait on a sibling.
- The parent's dates are a read-only **span** of its children — but that span is now
  computed inside `planFor` itself (min child start → latest child end+fraction), not just
  in the row render, so it has ONE source and can be **used as a prereq anchor** (below).

### Group as a prerequisite (2026-06-25)
A normal task can depend on a **group (parent) task** — `dependsOn` may reference a parent's
sequence number. The dependent then starts after the group's rolled-up **end** (the latest
child finish), exactly as if it depended on the latest child. Mechanics:
- `planFor(parent)` returns the rolled-up span (it recurses into children), so a dependent
  reads a real `dueDate` to anchor on. If **no** child has a date yet, the span end is null →
  the dependent has no anchor and its start clears (same rule as any unscheduled prereq).
- **Blocked state**: a task whose prereq is a group is *blocked* until **every child** of that
  group is done (not the parent's stale stored status). See [dependencies.md](./dependencies.md).
- **Cascade**: editing a child re-flows tasks that depend on the child's parent (the group's
  end shifted) — `recomputeDates` enqueues dependents of the changed task's `parentId` too.
- **Cycle safety**: depending on a group means depending on all its children, so the cycle
  check treats `parent → children` as edges. A child that tries to depend back on a task which
  waits on its own group is rejected inline like any other cycle.
- **Out of scope**: you still cannot set a prereq *on* a group (the parent row's prereq cell
  stays empty) — a group is a container, not a schedulable unit with its own dependency.

## Implementation notes
1. **`db.ts`** — add `parentId?: string | null` to `Task`. No `.stores()` change.
   - Helper: `setTaskParent(childId, parentId | null)` with the one-level guard
     (reject if target has a parent, or if child already has children) **and a
     same-sprint guard** (reject if `child.sprintId !== parent.sprintId` — a
     cross-sprint parent link would break rollover cohesion; `planSprintRollover`
     assumes a group moves as one unit within its sprint). The guards run inside a
     transaction so they can't go stale between the reads and the write (two
     overlapping group edits would otherwise TOCTOU past them).
   - On **delete** of a parent: promote children to top-level (`parentId = null`),
     **do not** cascade-delete. Confirm dialog notes "its grouped tasks become
     ungrouped, not deleted."
   - **Cross-member / cross-sprint moves** are handled by the **render**, not by
     mutating data: `TaskRows` resolves children only against tasks in the *same*
     member+sprint list, so a child whose parent isn't present (assignee/sprint
     changed, or parent rolled over) simply falls back to rendering top-level. No
     need to intercept every assignee/sprint update to clear `parentId`.
2. **`SprintView.tsx` → `MemberCard`** — build a render tree from the flat task list:
   top-level tasks (sorted) each followed by their children (sorted), indent children.
   - `TaskRow` gains a `depth`/`isChild` style (left padding only, no connector) and, for a
     parent, a chevron + roll-up cluster (progress count, mini bar, derived status,
     summed effort).
   - Counting: compute `leafTasks = tasks.filter(t => !hasChildren(t))`; use those for
     `total`/`done`/overdue/capacity.
3. **Collapse** — local state keyed by parentId, persisted to
   `localStorage['plan-up:taskgroup-collapsed:'+parentId]`; reset semantics like the
   member-group collapse.
4. **Selection bar** — group/ungroup/delete all live on `SelectionBar` (the floating
   bar). There is no per-row kebab/`RowActionsMenu` and no actions column on the row.

## Rules & edge cases
- **One level**: enforced in `setTaskParent`; UI hides "Group under…" on tasks that
  already have children, and excludes parents from the sibling picker.
- **Empty group**: a parent whose children are all removed/ungrouped silently reverts
  to a normal leaf task (no special "empty group" state).
- **Cross-member / cross-sprint**: groups never span members or sprints; moving a task
  out clears `parentId`, and `setTaskParent` refuses a parent in a different sprint.
- **Board view**: out of scope this round — `parentId` is ignored in BoardView (tasks
  show flat). Flag if grouping is wanted there later.
- **Dark mode**: all via tokens (derived status dot via `STATUS_META` varName).

## Approaches considered
- **A · parentId + nested render (no roll-up).** Children indented under parent, each
  task fully independent. Smallest diff. Was the minimal option.
- **B · A + roll-up + collapse (CHOSEN).** Adds parent progress/derived-status/summed-
  effort + collapse, and leaf-based counting so capacity stays correct. More code,
  touches the member-group counting, but the parent reads as a real "mini group."
- **C · separate Group entity.** A named Group table + `groupId` on tasks, rendered as
  sub-headers. Rejected: the parent is then **not** a task, which contradicts the
  reference image (parent `32) build 3` has a sequence number), and adds a table.

## Status / history
Shipped as Approach B: `db.ts` field + `setTaskParent` guard + delete-promote →
`MemberCard` tree render + leaf-based counting → `TaskGroupRow` parent roll-up + collapse →
`SelectionBar` group/ungroup/**delete** (the per-row kebab was removed entirely; the bar
is now the only group/delete affordance). Verified with `npx tsc --noEmit && npm run build
&& npx vitest run`, plus a check that a pre-`parentId` export still imports and that member
`done/total` + capacity exclude parents.

## Future / open questions
- **Roll-up of parent dates/effort**: span/sum. The date span is now also a **prereq anchor**
  (a task can depend on a group; see "Group as a prerequisite") — computed on the fly in
  `planFor`, still **not persisted** on the parent. Setting a prereq *on* a group, or a
  stored/schedulable parent, remains out of scope.
- **Multi-level nesting** (groups within groups): deliberately cut for calm; revisit
  only on real need.
- **Board view grouping**: deferred.
- **Parent assignee change**: this round ungroups children rather than moving them —
  confirm that's the desired behavior in use.
