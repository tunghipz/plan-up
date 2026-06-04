# Task groups (parent task with nested children)

**Status:** Implemented
**Last updated:** 2026-06-04
**Code (planned):** `app/src/db.ts` (`Task.parentId`), `app/src/SprintView.tsx`
(`MemberCard` task tree render, `TaskRow` nesting + parent roll-up, kebab "group"
actions), `app/src/lib.ts` or local (collapse persistence)

## Purpose
Inside a member's task list, let related tasks be **gathered under a parent task**
that acts as a group heading — e.g. `32) build 3` with `33/34/35` nested beneath it
(see the user's reference image). The parent is a real task (has a sequence number)
that doubles as the group title. Gives structure to a long member list without a
separate epic/tag system. Approach **B** chosen 2026-06-04 (see
`demo/task-group-options.html`): nested render **plus** parent roll-up + collapse.

## User-facing behavior
- **Nest:** a task's row kebab (⋯) → **"Group under…"** picks a sibling task (same
  member + same sprint) as its parent. The chosen parent becomes a group; the task
  renders indented beneath it with a connector tick. **"Remove from group"** clears it.
  (Alt entry: a sequence-number input, deferred — kebab is less confusable with the
  prereq sequence input.)
- **One level only.** A child cannot itself be a parent, and a task that already has
  children cannot become someone's child. Enforced when setting `parentId`.
- **Roll-up on the parent row (Approach B):** the parent shows
  - a **progress count** `done/total` of its **children** + a small progress bar,
  - a **derived status** badge (done if all children done; in-progress if any child
    is in-progress/done but not all done; else to-do) — display-only, computed on
    render, not written to the parent's stored `status`,
  - a **summed effort** (sum of children `estimate`) in the Effort cell,
  - **dates** = the span of children (earliest child start → latest child end),
    read-only.
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
- `parentId` is **organizational only** — it is **not** a scheduling constraint
  (distinct from `dependsOn`). Grouping never reorders or blocks the scheduler.
- The parent's displayed dates are a read-only **span** of its children.

## Implementation notes
1. **`db.ts`** — add `parentId?: string | null` to `Task`. No `.stores()` change.
   - Helper: `setTaskParent(childId, parentId | null)` with the one-level guard
     (reject if target has a parent, or if child already has children).
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
   - `TaskRow` gains a `depth`/`isChild` style (left padding + connector) and, for a
     parent, a chevron + roll-up cluster (progress count, mini bar, derived status,
     summed effort).
   - Counting: compute `leafTasks = tasks.filter(t => !hasChildren(t))`; use those for
     `total`/`done`/overdue/capacity.
3. **Collapse** — local state keyed by parentId, persisted to
   `localStorage['plan-up:taskgroup-collapsed:'+parentId]`; reset semantics like the
   member-group collapse.
4. **Kebab actions** — add "Group under…" (sibling picker, same member+sprint) and
   "Remove from group" to `RowActionsMenu`.

## Rules & edge cases
- **One level**: enforced in `setTaskParent`; UI hides "Group under…" on tasks that
  already have children, and excludes parents from the sibling picker.
- **Empty group**: a parent whose children are all removed/ungrouped silently reverts
  to a normal leaf task (no special "empty group" state).
- **Cross-member / cross-sprint**: groups never span members or sprints; moving a task
  out clears `parentId`.
- **Board view**: out of scope this round — `parentId` is ignored in BoardView (tasks
  show flat). Flag if grouping is wanted there later.
- **Dark mode**: all via tokens (connector = `ink-faint`, bar = `status-done` green).

## Approaches considered
- **A · parentId + nested render (no roll-up).** Children indented under parent, each
  task fully independent. Smallest diff. Was the minimal option.
- **B · A + roll-up + collapse (CHOSEN).** Adds parent progress/derived-status/summed-
  effort + collapse, and leaf-based counting so capacity stays correct. More code,
  touches the member-group counting, but the parent reads as a real "mini group."
- **C · separate Group entity.** A named Group table + `groupId` on tasks, rendered as
  sub-headers. Rejected: the parent is then **not** a task, which contradicts the
  reference image (parent `32) build 3` has a sequence number), and adds a table.

## The assignment / next step
Implement Approach B in order: `db.ts` field + `setTaskParent` guard + delete-promote →
`MemberCard` tree render + leaf-based counting → `TaskRow` parent roll-up + collapse →
kebab "Group under…/Remove from group". Then `npx tsc --noEmit && npm run build &&
npx vitest run`, plus a quick check that a pre-`parentId` export still imports and that
member `done/total` + capacity exclude parents.

## Future / open questions
- **Roll-up of parent dates/effort**: shipped as display-only span/sum — revisit if a
  stored, schedulable parent is ever wanted.
- **Multi-level nesting** (groups within groups): deliberately cut for calm; revisit
  only on real need.
- **Board view grouping**: deferred.
- **Parent assignee change**: this round ungroups children rather than moving them —
  confirm that's the desired behavior in use.
