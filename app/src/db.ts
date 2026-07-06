// Facade over the split DB modules: everything that was ever importable from
// './db' stays importable from './db', so no other file's imports change.
export * from './types'
export * from './schema'
export * from './scheduling'
export { MAX_EVENTS_PER_SPRINT, logEvent, createSprint, sprintEvents } from './activity-log'
export * from './io'
export { resizeImageToDataURL } from './image-utils'

import { formatSeqRanges, todayLocalISO } from './lib'
import { normalizePersonName } from './people'
import {
  LOGGABLE_FIELDS,
  type ChangeLogEntry,
  type Collection,
  type CollectionStatus,
  type DayOff,
  type LoggableField,
  type Member,
  type Person,
  type Priority,
  type Project,
  type Status,
  type Task,
} from './types'
import { db, uid, colorForName, nextSequence } from './schema'
import { recomputeDates, wouldCreateCycle } from './scheduling'
import { logEvent, logTaskEdits } from './activity-log'

/** Status mặc định khi tạo collection (user sửa được sau). */
function defaultStatuses(): CollectionStatus[] {
  return [
    { id: uid(), name: 'FEATURE', color: '#FF9500' },
    { id: uid(), name: 'EVENT', color: '#0071E3' },
  ]
}

/** Tạo collection mới: 1 section "All" + bộ status mặc định. order = max+1. */
export async function createCollection(
  projectId: string,
  name: string
): Promise<Collection> {
  const existing = await db.collections.where('projectId').equals(projectId).toArray()
  const order = existing.reduce((m, c) => Math.max(m, c.order), -1) + 1
  const col: Collection = {
    id: uid(),
    projectId,
    name: name.trim() || 'Untitled',
    order,
    sections: [{ id: uid(), name: 'All' }],
    statuses: defaultStatuses(),
    createdAt: Date.now(),
  }
  await db.collections.add(col)
  return col
}

/** Đổi tên collection (trim, bỏ qua nếu rỗng). */
export async function renameCollection(id: string, name: string): Promise<void> {
  const n = name.trim()
  if (!n) return
  await db.collections.update(id, { name: n })
}

/** Xoá collection + toàn bộ item của nó (destructive — caller confirm trước). */
export async function deleteCollection(id: string): Promise<void> {
  await db.transaction('rw', db.collections, db.tasks, async () => {
    await db.tasks.where('collectionId').equals(id).delete()
    await db.collections.delete(id)
  })
}

export async function addSection(collectionId: string, name: string): Promise<void> {
  const c = await db.collections.get(collectionId)
  if (!c) return
  const sections = [...c.sections, { id: uid(), name: name.trim() || 'New table' }]
  await db.collections.update(collectionId, { sections })
}

export async function renameSection(
  collectionId: string,
  sectionId: string,
  name: string
): Promise<void> {
  const n = name.trim()
  if (!n) return
  const c = await db.collections.get(collectionId)
  if (!c) return
  const sections = c.sections.map((s) => (s.id === sectionId ? { ...s, name: n } : s))
  await db.collections.update(collectionId, { sections })
}

/** Xoá 1 bảng: item của nó dồn về bảng đầu. Không cho xoá bảng cuối cùng. */
export async function deleteSection(
  collectionId: string,
  sectionId: string
): Promise<void> {
  await db.transaction('rw', db.collections, db.tasks, async () => {
    const c = await db.collections.get(collectionId)
    if (!c || c.sections.length <= 1) return
    const remaining = c.sections.filter((s) => s.id !== sectionId)
    if (remaining.length === c.sections.length) return
    const fallback = remaining[0].id
    await db.tasks
      .where('collectionId')
      .equals(collectionId)
      .filter((t) => t.sectionId === sectionId)
      .modify({ sectionId: fallback })
    await db.collections.update(collectionId, { sections: remaining })
  })
}

export async function moveTaskToSection(taskId: string, sectionId: string): Promise<void> {
  await db.tasks.update(taskId, { sectionId })
}

/**
 * Move a collection item to `sectionId` AND set its manual `listOrder` in one
 * update — the drop half of the pointer-based drag in CollectionView. Reordering
 * within the same table and moving across tables are the same gesture, so both
 * fields are written together (target section may equal the current one). Order
 * comes from `orderBetween` over the target table's neighbours; collisions fall
 * back to `renormalizeListOrder`. Arrangement only — not logged. See
 * design-docs/collections.md.
 */
export async function moveCollectionItem(
  taskId: string,
  sectionId: string,
  listOrder: number
): Promise<void> {
  await db.tasks.update(taskId, { sectionId, listOrder })
}

export async function addStatus(
  collectionId: string,
  name: string,
  color: string
): Promise<void> {
  const c = await db.collections.get(collectionId)
  if (!c) return
  const statuses = [...c.statuses, { id: uid(), name: name.trim() || 'New status', color }]
  await db.collections.update(collectionId, { statuses })
}

export async function renameStatus(
  collectionId: string,
  statusId: string,
  name: string
): Promise<void> {
  const n = name.trim()
  if (!n) return
  const c = await db.collections.get(collectionId)
  if (!c) return
  await db.collections.update(collectionId, {
    statuses: c.statuses.map((s) => (s.id === statusId ? { ...s, name: n } : s)),
  })
}

export async function recolorStatus(
  collectionId: string,
  statusId: string,
  color: string
): Promise<void> {
  const c = await db.collections.get(collectionId)
  if (!c) return
  await db.collections.update(collectionId, {
    statuses: c.statuses.map((s) => (s.id === statusId ? { ...s, color } : s)),
  })
}

/** Xoá status: item đang dùng nó về null (ô Status trống). */
export async function deleteStatus(collectionId: string, statusId: string): Promise<void> {
  await db.transaction('rw', db.collections, db.tasks, async () => {
    const c = await db.collections.get(collectionId)
    if (!c) return
    await db.collections.update(collectionId, {
      statuses: c.statuses.filter((s) => s.id !== statusId),
    })
    await db.tasks
      .where('collectionId')
      .equals(collectionId)
      .filter((t) => t.collectionStatusId === statusId)
      .modify({ collectionStatusId: null })
  })
}

/**
 * Tạo một collection-item (Task ngoài sprint). status mặc định = status đầu tiên
 * của collection (hoặc null nếu chưa có status), startDate = hôm nay, dueDate=null,
 * sprintId=null. sequence per-project (collection không có numbering riêng).
 */
export async function addCollectionItem(
  collectionId: string,
  sectionId: string,
  patch: Partial<Task> & { title: string }
): Promise<Task> {
  // Local-calendar today, NOT the UTC slice — see todayLocalISO's docstring.
  const today = todayLocalISO()
  // One transaction so the maxSeq read + add can't interleave with another add:
  // two rapid "add item" clicks would otherwise read the same maxSeq and produce
  // duplicate per-project sequences.
  return db.transaction('rw', db.collections, db.tasks, async () => {
    const c = await db.collections.get(collectionId)
    // A deleted/unknown collection must fail loudly — falling back to
    // projectId '' would insert an invisible orphan row no view ever loads.
    if (!c) throw new Error(`Collection ${collectionId} not found`)
    const projectId = c.projectId
    const maxSeq = (
      await db.tasks.where('projectId').equals(projectId).toArray()
    ).reduce((m, t) => Math.max(m, t.sequence ?? 0), 0)
    // Build the task: spread patch for caller overrides (e.g. title, priority),
    // then RE-PIN the derived fields so patch can never override the computed
    // sequence / project ownership or violate the "exactly one container"
    // invariant (sprintId=null, collectionId+sectionId pinned).
    const base: Task = {
      id: uid(),
      projectId,
      sequence: maxSeq + 1,
      assigneeId: null,
      sprintId: null,
      status: 'todo',
      priority: 'normal',
      startDate: today,
      dueDate: null,
      estimate: null,
      createdAt: Date.now(),
      dependsOn: [],
      collectionStatusId: c.statuses[0]?.id ?? null,
      collectionId,
      sectionId,
      ...patch,
    }
    const task: Task = {
      ...base,
      projectId,
      sequence: maxSeq + 1,
      sprintId: null,
      collectionId,
      sectionId,
    }
    await db.tasks.add(task)
    return task
  })
}

/** Set (or clear) a sprint's optional goal note. Trimmed empty → field removed. */
export async function setSprintNote(
  sprintId: string,
  note: string
): Promise<void> {
  const trimmed = note.trim()
  await db.sprints.update(sprintId, { note: trimmed || undefined })
}

/**
 * Archive (or unarchive) a sprint — a reversible hide, not a delete. Sets/clears
 * `archivedAt` and records a sprint-level activity event. Archived sprints leave
 * the active flow (auto-select, new-sprint default, rollover target). See
 * design-docs/sprint-archive.md.
 */
export async function setSprintArchived(
  sprintId: string,
  archived: boolean
): Promise<void> {
  return db.transaction('rw', db.sprints, db.events, async () => {
    const sprint = await db.sprints.get(sprintId)
    if (!sprint) return
    await db.sprints.update(sprintId, {
      archivedAt: archived ? Date.now() : undefined,
    })
    await logEvent({
      projectId: sprint.projectId,
      sprintId,
      taskId: null,
      taskSeq: null,
      taskTitle: null,
      kind: archived ? 'sprint_archived' : 'sprint_unarchived',
      from: null,
      to: null,
      ts: Date.now(),
    })
  })
}

/**
 * Atomically allocate a sequence and insert a new leaf task into a sprint.
 * The `nextSequence` read and the `add` MUST share one rw transaction — IndexedDB
 * serialises overlapping readwrite transactions, so two rapid "Add task" submits
 * each see the other's committed row and never collide on `sequence` (a collision
 * would corrupt prereq-by-number resolution). All UI sprint-task creation goes
 * through here (List AddTaskRow + Board composer) so the guarantee holds everywhere.
 */
export async function addSprintTask(input: {
  projectId: string
  sprintId: string
  title: string
  startDate: string
  assigneeId?: string | null
  status?: Status
  priority?: Priority
}): Promise<Task> {
  return db.transaction('rw', db.tasks, db.events, async () => {
    const task: Task = {
      id: uid(),
      projectId: input.projectId,
      sequence: await nextSequence(input.sprintId),
      title: input.title,
      assigneeId: input.assigneeId ?? null,
      sprintId: input.sprintId,
      status: input.status ?? 'todo',
      priority: input.priority ?? 'normal',
      // Default start = sprint start. User can override after creation.
      startDate: input.startDate,
      dueDate: null,
      estimate: null,
      createdAt: Date.now(),
      dependsOn: [],
    }
    await db.tasks.add(task)
    // Record creation on the sprint activity log.
    await logEvent({
      projectId: task.projectId,
      sprintId: input.sprintId,
      taskId: task.id,
      taskSeq: task.sequence,
      taskTitle: task.title,
      kind: 'created',
      from: null,
      to: null,
      ts: task.createdAt,
    })
    return task
  })
}

/**
 * Fractional order strictly between two displayed neighbours' effective orders,
 * for List drag-reorder. `null` = no neighbour on that side. Both null → 0 (lone
 * item, order untouched-equivalent). The displayed lane is sorted by effective
 * order, so the midpoint always lands the row exactly where it was dropped.
 */
export function orderBetween(before: number | null, after: number | null): number {
  if (before == null && after == null) return 0
  if (before == null) return after! - 1
  if (after == null) return before + 1
  return (before + after) / 2
}

/** Persist a List manual order (raw — not logged, no date recompute). */
export async function setListOrder(taskId: string, order: number): Promise<void> {
  await db.tasks.update(taskId, { listOrder: order })
}

/**
 * Rewrite a whole lane's `listOrder` to clean integer spacing (0..N-1) in the
 * given display order, in one transaction. Fallback for `orderBetween` when
 * repeated midpoint inserts into the same gap exhaust float precision
 * (`(a+b)/2 === a`) and two rows would otherwise collide on an equal order —
 * which made a drag silently "not take". Never touches the immutable `sequence`.
 */
export async function renormalizeListOrder(orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.tasks, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.tasks.update(orderedIds[i], { listOrder: i })
    }
  })
}

/**
 * Total order for member lanes (per project). Sorts by `Member.order` ascending;
 * an absent order counts as 0 so an un-migrated/imported project stays stable.
 * Tiebreaks by name then id so equal orders are deterministic across renders.
 * Single source of truth shared by the List view and the Board `member` sort.
 * See design-docs/member-lane-order.md.
 */
export function compareMembersByOrder(a: Member, b: Member): number {
  const d = (a.order ?? 0) - (b.order ?? 0)
  if (d !== 0) return d
  const n = a.name.localeCompare(b.name)
  if (n !== 0) return n
  return a.id.localeCompare(b.id)
}

/** Next lane order for a new member in a project: max existing order + 1 (0 if none). */
export async function nextMemberOrder(projectId: string): Promise<number> {
  const members = await db.members.where('projectId').equals(projectId).toArray()
  let max = -1
  for (const m of members) if ((m.order ?? -1) > max) max = m.order ?? -1
  return max + 1
}

/** Persist one member's manual lane order (raw — like `setListOrder`). */
export async function setMemberOrder(memberId: string, order: number): Promise<void> {
  await db.members.update(memberId, { order })
}

/**
 * Rewrite a project's member `order` to clean integer spacing (0..N-1) in the
 * given display order, in one transaction. Fallback for `orderBetween` when
 * repeated midpoint inserts exhaust float precision (mirrors `renormalizeListOrder`).
 */
export async function renormalizeMemberOrder(orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.members, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.members.update(orderedIds[i], { order: i })
    }
  })
}

/**
 * Create a new project. The new project is empty — caller is responsible
 * for adding members / sprints. Returns the created project.
 */
export async function createProject(name: string): Promise<Project> {
  const trimmed = name.trim() || 'Untitled Project'
  const project: Project = { id: uid(), name: trimmed, createdAt: Date.now() }
  await db.projects.add(project)
  return project
}

/**
 * Patch a project's editable fields (name / description / color). Name is
 * never emptied — callers should pass a trimmed, non-empty name.
 */
export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'color' | 'icon'>>
): Promise<void> {
  await db.projects.update(id, patch)
}

/**
 * Delete a project and everything it owns: members, sprints, tasks,
 * collections and activity events (the projectId index on events exists for
 * exactly this wipe). Tasks in this project that are referenced as dependsOn
 * by tasks in OTHER projects (rare) are stripped from those references.
 */
export async function deleteProject(projectId: string): Promise<void> {
  // Table-array form: Dexie's variadic transaction() overloads stop at 5
  // tables and this wipe spans 6.
  await db.transaction(
    'rw',
    [db.projects, db.members, db.sprints, db.tasks, db.collections, db.events],
    async () => {
      const taskIds = (
        await db.tasks.where('projectId').equals(projectId).toArray()
      ).map((t) => t.id)
      // Strip cross-project dep references (paranoid; same-project case is
      // moot because dependents are deleted alongside).
      const taskIdSet = new Set(taskIds)
      const others = await db.tasks
        .filter((t) => t.projectId !== projectId && t.dependsOn?.some((id) => taskIdSet.has(id)))
        .toArray()
      for (const t of others) {
        await db.tasks.update(t.id, {
          dependsOn: t.dependsOn.filter((id) => !taskIdSet.has(id)),
        })
      }
      await db.tasks.where('projectId').equals(projectId).delete()
      await db.sprints.where('projectId').equals(projectId).delete()
      await db.members.where('projectId').equals(projectId).delete()
      await db.collections.where('projectId').equals(projectId).delete()
      await db.events.where('projectId').equals(projectId).delete()
      await db.projects.delete(projectId)
    }
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Edit tracking → sprint activity log (design-docs/sprint-activity-log.md).
//
//   user edit ──▶ updateTask / logStatusChange / setDependencies
//                 ──▶ diff into ChangeLogEntry[] ──▶ logTaskEdits ──▶ events
//   scheduler  ──▶ raw db.tasks.update ─────────────────────────▶ NO log
//                 (recomputeDates, rollover, …)   — premise #2
// ──────────────────────────────────────────────────────────────────────────

/** Value-based equality for a loggable field (all 7 are scalars or null). */
function loggableValuesEqual(a: unknown, b: unknown): boolean {
  return a === b
}

/** Resolve a raw field value to the string stored in a ChangeLogEntry. */
function changeLogValue(
  field: LoggableField,
  raw: unknown,
  members: Member[] | null
): string | null {
  if (raw === null || raw === undefined) return null
  if (field === 'assigneeId') {
    // Freeze the member NAME (survives the member being deleted later).
    return members?.find((m) => m.id === raw)?.name ?? null
  }
  return String(raw)
}

/**
 * Canonical USER-edit path for a task. Diffs `patch` against LOGGABLE_FIELDS,
 * records one entry per actually-changed field, and writes patch + changeLog in
 * a single transaction. Does NOT recompute dates — callers keep their explicit
 * recomputeDates() after (which uses the raw, unlogged write path).
 */
export async function updateTask(
  id: string,
  patch: Partial<Task>
): Promise<void> {
  await db.transaction('rw', db.tasks, db.members, db.events, async () => {
    const task = await db.tasks.get(id)
    if (!task) return
    // Only load members when an assignee label needs freezing (title fires per
    // keystroke — don't scan members on every character).
    const members: Member[] | null =
      'assigneeId' in patch ? await db.members.toArray() : null
    const now = Date.now()
    const entries: ChangeLogEntry[] = []
    for (const field of LOGGABLE_FIELDS) {
      if (!(field in patch)) continue
      const before = task[field as keyof Task]
      const after = (patch as Record<string, unknown>)[field]
      if (loggableValuesEqual(before, after)) continue
      entries.push({
        field,
        from: changeLogValue(field, before, members),
        to: changeLogValue(field, after, members),
        ts: now,
      })
    }
    await db.tasks.update(id, patch)
    // Record into the sprint activity log (sprint tasks only; no-op otherwise).
    if (entries.length) await logTaskEdits(task, entries)
  })
}

/**
 * Log a status change from the Board, where editing happens via drag /
 * click-to-cycle rather than the List funnel. Kept separate from updateTask so
 * it opens a `db.tasks`-only transaction — calling updateTask (scope
 * `db.tasks, db.members`) from inside the Board's sorted-column reindex
 * transaction (scope `db.tasks`) would violate Dexie sub-transaction scoping
 * and throw. `from`/`to` are passed explicitly so this is safe to call AFTER a
 * raw write has already persisted the new status.
 */
export async function logStatusChange(
  id: string,
  from: Status,
  to: Status
): Promise<void> {
  if (from === to) return
  // db.events is safe in scope here: all Board callers invoke logStatusChange
  // OUTSIDE any open transaction (the sorted-column path calls it in `.then()`
  // after its reindex commits), so this opens its own top-level transaction —
  // it is never nested inside a narrower db.tasks-only parent.
  await db.transaction('rw', db.tasks, db.events, async () => {
    const task = await db.tasks.get(id)
    if (!task) return
    const entry: ChangeLogEntry = { field: 'status', from, to, ts: Date.now() }
    await db.tasks.update(id, { status: to })
    await logTaskEdits(task, [entry])
  })
}

/**
 * Replace a member's vacation days. Sorts + dedupes + filters invalid dates,
 * then recomputes every task assigned to that member (forward through their
 * dependents too).
 */
/**
 * Move every not-done task in `sourceSprintId` to the next sprint
 * (chronologically — the smallest startDate greater than source's).
 *
 * Returns `{ movedCount, targetSprintId }`. Returns null target if there
 * is no next sprint.
 *
 * Behavior:
 * - Done tasks stay put.
 * - Moved tasks get the new sprintId (+ a fresh per-sprint sequence). Their
 *   startDate/dueDate are KEPT AS-IS — a rollover preserves all task info, so
 *   a start the user set is never rewritten to the target sprint's start
 *   (design-docs/sprint-rollover.md, decision 2026-07-06). Dates are still
 *   recomputed afterwards (effort + off-days + prereq chain apply as always),
 *   which re-derives computed dates but never clobbers a manual start.
 * - dependsOn links survive across sprints — prereq IDs stay valid.
 */
/**
 * Pure planner for a sprint rollover: given every task currently in the source
 * sprint, decide what moves to the next sprint while keeping task GROUPS
 * cohesive (a group must never be split across sprints — see
 * design-docs/sprint-rollover.md). A group is judged by its leaf children's
 * done-ness, NOT the parent's own stored `status` (a derived/container field):
 *   - ≥1 unfinished child → parent + unfinished children move; each done child
 *     stays behind and is UNGROUPED (`parentId → null`).
 *   - all children done → whole group stays put (parent never moves alone).
 *   - standalone task (no parent, no children) → moves iff not done.
 *
 * Returns id sets so the DB move and the preview popover share one source of
 * truth. `parentIds` are the container parents inside `moveIds` — excluded from
 * the user-facing "N tasks" count (leaf work items only).
 */
export function planSprintRollover(sprintTasks: Task[]): {
  moveIds: Set<string>
  ungroupIds: Set<string>
  parentIds: Set<string>
} {
  const idSet = new Set(sprintTasks.map((t) => t.id))
  const childrenByParent = new Map<string, Task[]>()
  for (const t of sprintTasks) {
    if (t.parentId && idSet.has(t.parentId)) {
      const a = childrenByParent.get(t.parentId)
      if (a) a.push(t)
      else childrenByParent.set(t.parentId, [t])
    }
  }
  const moveIds = new Set<string>()
  const ungroupIds = new Set<string>()
  const parentIds = new Set<string>()
  for (const t of sprintTasks) {
    const kids = childrenByParent.get(t.id)
    if (kids && kids.length) {
      // Container parent: roll the group over iff any child is still unfinished.
      if (kids.some((k) => k.status !== 'done')) {
        moveIds.add(t.id)
        parentIds.add(t.id)
        for (const k of kids) {
          if (k.status !== 'done') moveIds.add(k.id)
          else ungroupIds.add(k.id) // done child left behind → cut its parent link
        }
      }
      // else: fully-done group → nothing moves, stays grouped as-is.
    } else if (!(t.parentId && idSet.has(t.parentId))) {
      // Standalone leaf (children are handled by their parent branch above).
      if (t.status !== 'done') moveIds.add(t.id)
    }
  }
  return { moveIds, ungroupIds, parentIds }
}

export async function moveUnfinishedToNextSprint(
  sourceSprintId: string
): Promise<{ movedCount: number; targetSprintId: string | null }> {
  // One transaction so the move is atomic: a renumber/move that throws (or a tab
  // close) midway must NOT leave the source sprint half-emptied with inconsistent
  // sequences. recomputeDates nests safely — its scope (tasks+members) is a subset.
  return db.transaction('rw', db.tasks, db.members, db.sprints, db.events, async () => {
    // Scope to the SOURCE sprint's project. orderBy('startDate') across the whole
    // table mixes in other projects' sprints — a foreign sprint sharing (or
    // sorting near) the start date would be picked as the "next" sprint, so the
    // roll-over silently lands tasks in a DIFFERENT project (and the current
    // project's real next sprint stays empty). Must match App.tsx `nextSprint`,
    // which is already per-project. See design-docs/sprint-rollover.md.
    const sourceSprint = await db.sprints.get(sourceSprintId)
    if (!sourceSprint) return { movedCount: 0, targetSprintId: null }
    const sprints = await db.sprints
      .where('projectId')
      .equals(sourceSprint.projectId)
      .sortBy('startDate')
    const sourceIdx = sprints.findIndex((s) => s.id === sourceSprintId)
    if (sourceIdx === -1) return { movedCount: 0, targetSprintId: null }
    const source = sprints[sourceIdx]
    // Target = the next NON-archived sprint (archived sprints are out of the
    // active flow — never rollover targets). See design-docs/sprint-archive.md.
    const target = sprints.slice(sourceIdx + 1).find((s) => s.archivedAt == null)
    if (!target) return { movedCount: 0, targetSprintId: null }

    const sprintTasks = await db.tasks.where('sprintId').equals(sourceSprintId).toArray()
    const { moveIds, ungroupIds, parentIds } = planSprintRollover(sprintTasks)

    // Done children that stay behind lose their (now cross-sprint) parent link
    // so they don't render as orphans nested under an absent group head.
    for (const id of ungroupIds) await db.tasks.update(id, { parentId: null })

    const toMove = sprintTasks.filter((t) => moveIds.has(t.id))
    const rolledAt = Date.now()
    for (const t of toMove) {
      // Sequence is per-sprint, so a moved task must be renumbered into the
      // target — otherwise it keeps its source number and collides with an
      // existing task there. Awaited in-loop so each call sees the prior insert.
      // Keep ALL task info on the move — only sprintId + sequence change.
      // startDate/dueDate are deliberately preserved (no pull-forward to the
      // target start): the user's dates are theirs. A task whose start predates
      // the new sprint keeps that earlier start. See sprint-rollover.md.
      const patch: Partial<Task> = {
        sprintId: target.id,
        sequence: await nextSequence(target.id),
      }
      await db.tasks.update(t.id, patch)
      // Record the carry-over on the TARGET sprint's activity log — leaf work
      // items only (container parents tag along silently; leaf-based counting).
      if (parentIds.has(t.id)) continue
      await logEvent({
        projectId: t.projectId,
        sprintId: target.id,
        taskId: t.id,
        taskSeq: patch.sequence ?? null,
        taskTitle: t.title,
        kind: 'rolled_over',
        from: source.name,
        to: target.name,
        ts: rolledAt,
      })
    }
    // Recompute after the bulk move so prereq chains settle in their new
    // home (and assignee off-days reapply).
    for (const t of toMove) await recomputeDates(t.id)

    const movedCount = toMove.filter((t) => !parentIds.has(t.id)).length
    return { movedCount, targetSprintId: target.id }
  })
}

export async function setMemberDaysOff(
  memberId: string,
  daysOff: DayOff[]
): Promise<DayOff[]> {
  // Dedupe by date (last entry wins), drop bad dates, sort.
  const byDate = new Map<string, DayOff>()
  for (const d of daysOff) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue
    byDate.set(d.date, d.half ? { date: d.date, half: d.half } : { date: d.date })
  }
  const clean = Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  )
  // Atomic: persist the new off-days AND recompute every owned task's dates in
  // one transaction, so the page closing mid-loop can't leave stored dates stale
  // relative to the just-saved off-days. recomputeDates nests (subset scope).
  return db.transaction('rw', db.members, db.tasks, async () => {
    await db.members.update(memberId, { daysOff: clean })
    const owned = await db.tasks.where('assigneeId').equals(memberId).toArray()
    for (const t of owned) await recomputeDates(t.id)
    return clean
  })
}

/**
 * Set (or clear) a member's avatar. Image and emoji are mutually exclusive: when
 * one is set the other is cleared. Pass `null` to clear a field (back to the
 * colored-initial fallback). See design-docs/member-avatars.md.
 */
export async function setMemberAvatar(
  memberId: string,
  patch: { avatarImage?: string | null; avatarEmoji?: string | null }
): Promise<void> {
  const next: Partial<Member> = {}
  // Truthy (not `!= null`) so an empty string clears too — a blank avatar is
  // never a valid value, only a clear.
  if (patch.avatarImage) {
    next.avatarImage = patch.avatarImage
    next.avatarEmoji = undefined // setting an image clears any emoji
  } else if (patch.avatarEmoji) {
    next.avatarEmoji = patch.avatarEmoji
    next.avatarImage = undefined // setting an emoji clears any image
  } else {
    // nothing set → explicit clear of whatever was there
    next.avatarImage = undefined
    next.avatarEmoji = undefined
  }
  await db.members.update(memberId, next)
}

/**
 * Cascade-safe task delete: also strips the task ID from any other task's
 * `dependsOn` array so we don't leave dangling references.
 */
/**
 * Group `childId` under `parentId` (or pass null to ungroup). Enforces a single
 * level of nesting: the target parent must be top-level (no parent of its own),
 * and the child must not already have children. See design-docs/task-groups.md.
 */
export async function setTaskParent(
  childId: string,
  parentId: string | null
): Promise<void> {
  if (parentId === null) {
    await db.tasks.update(childId, { parentId: null })
    return
  }
  if (parentId === childId) return
  // Transactional so the guards below can't go stale between the reads and
  // the write (two overlapping group edits would otherwise TOCTOU past them).
  await db.transaction('rw', db.tasks, async () => {
    const [child, parent, hasChildren] = await Promise.all([
      db.tasks.get(childId),
      db.tasks.get(parentId),
      // parentId is non-indexed → filter, not where()
      db.tasks.filter((t) => t.parentId === childId).count(),
    ])
    // Guard: target must exist & be top-level; child must not be a parent
    // itself; both must live in the SAME sprint — a cross-sprint parent link
    // would break rollover cohesion (planSprintRollover assumes a group moves
    // as one unit within its sprint).
    if (!child || !parent || parent.parentId || hasChildren > 0) return
    if (child.sprintId !== parent.sprintId) return
    await db.tasks.update(childId, { parentId })
  })
}

/**
 * Create a new "New group" parent task and nest the given tasks under it. The
 * tasks must all share one member + sprint, and any that are already group heads
 * (have children) are skipped (one level only). Returns the new parent's id, or
 * null if nothing eligible. See design-docs/task-groups.md.
 */
export async function createGroupFromSelection(
  taskIds: string[]
): Promise<string | null> {
  if (taskIds.length === 0) return null
  return db.transaction('rw', db.tasks, db.sprints, async () => {
    const loaded = (await Promise.all(taskIds.map((id) => db.tasks.get(id)))).filter(
      (t): t is Task => !!t
    )
    const eligible: Task[] = []
    for (const t of loaded) {
      const kids = await db.tasks.filter((x) => x.parentId === t.id).count()
      if (kids === 0 && !t.parentId) eligible.push(t)
    }
    if (eligible.length < 2) return null
    const { assigneeId, sprintId, projectId } = eligible[0]
    // Grouping is a sprint-only operation; collection items (sprintId=null)
    // are never grouped here.
    if (!sprintId) return null
    if (eligible.some((t) => t.assigneeId !== assigneeId || t.sprintId !== sprintId))
      return null
    const sprint = await db.sprints.get(sprintId)
    const parentId = uid()
    await db.tasks.add({
      id: parentId,
      projectId,
      sequence: await nextSequence(sprintId),
      title: 'New group',
      assigneeId,
      sprintId,
      status: 'todo',
      priority: 'normal',
      startDate: sprint?.startDate ?? null,
      dueDate: null,
      estimate: null,
      createdAt: Date.now(),
      dependsOn: [],
      parentId: null,
    })
    for (const t of eligible) await db.tasks.update(t.id, { parentId })
    return parentId
  })
}

export async function deleteTask(taskId: string) {
  const touched: string[] = []
  await db.transaction('rw', db.tasks, async () => {
    await db.tasks.delete(taskId)
    // Promote any grouped children to top-level (do NOT cascade-delete them).
    const children = await db.tasks.filter((t) => t.parentId === taskId).toArray()
    for (const c of children) {
      await db.tasks.update(c.id, { parentId: null })
    }
    const dependents = await db.tasks
      .filter((t) => t.dependsOn?.includes(taskId))
      .toArray()
    for (const d of dependents) {
      await db.tasks.update(d.id, {
        dependsOn: d.dependsOn.filter((id) => id !== taskId),
      })
      touched.push(d.id)
    }
  })
  for (const id of touched) await recomputeDates(id)
}

/**
 * Add `depId` as a prerequisite of `taskId`. Refuses cycles silently
 * (returns false). Returns true on success.
 */
export async function addDependency(
  taskId: string,
  depId: string
): Promise<boolean> {
  if (taskId === depId) return false
  // One transaction: the cycle check, the dependsOn read-modify-write and the
  // recompute must not interleave with another dependency edit (a stale-array
  // overwrite would silently drop an edge) or split on a mid-write crash.
  return db.transaction('rw', db.tasks, db.members, async () => {
    const tasks = await db.tasks.toArray()
    if (wouldCreateCycle(taskId, depId, tasks)) return false
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return false
    if (task.dependsOn.includes(depId)) return true // already there
    await db.tasks.update(taskId, {
      dependsOn: [...task.dependsOn, depId],
    })
    await recomputeDates(taskId)
    return true
  })
}

export async function removeDependency(taskId: string, depId: string) {
  // Same transaction rationale as addDependency.
  await db.transaction('rw', db.tasks, db.members, async () => {
    const task = await db.tasks.get(taskId)
    if (!task) return
    await db.tasks.update(taskId, {
      dependsOn: task.dependsOn.filter((id) => id !== depId),
    })
    await recomputeDates(taskId)
  })
}

/**
 * Replace the full dependency set for `taskId`. Filters out self-links and
 * any edge that would create a cycle. Returns the cleaned array that was
 * actually saved.
 */
export async function setDependencies(
  taskId: string,
  depIds: string[]
): Promise<string[]> {
  // One transaction spanning the deps write, the recompute AND the activity
  // log: logTaskEdits' own contract requires db.events in scope, and a crash
  // between the write and the log must not leave deps changed with no entry.
  return db.transaction('rw', db.tasks, db.members, db.events, async () => {
    const tasks = await db.tasks.toArray()
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return []
    const clean: string[] = []
    // Build cumulatively so a later dep can't bypass a cycle check via an
    // earlier dep we're about to add in the same call.
    const probe = { ...task, dependsOn: [] as string[] }
    const byId = new Map(tasks.map((t) => [t.id, t]))
    byId.set(taskId, probe)
    for (const id of depIds) {
      if (id === taskId) continue
      if (clean.includes(id)) continue
      if (!byId.has(id)) continue
      if (wouldCreateCycle(taskId, id, Array.from(byId.values()))) continue
      clean.push(id)
      probe.dependsOn = clean
    }
    const changed =
      task.dependsOn.length !== clean.length ||
      task.dependsOn.some((d) => !clean.includes(d))

    // Snapshot this task's own dates BEFORE recompute so we can log the old→new
    // shift the prereq change causes on THIS task (the direct consequence of the
    // user's edit). Indirect ripple onto OTHER tasks stays unlogged (premise #2).
    const oldStart = task.startDate
    const oldDue = task.dueDate

    await db.tasks.update(taskId, { dependsOn: clean })
    await recomputeDates(taskId)

    if (changed) {
      const after = await db.tasks.get(taskId)
      if (after) {
        const label = (ids: string[]): string | null => {
          const seqs = ids
            .map((id) => byId.get(id)?.sequence)
            .filter((n): n is number => typeof n === 'number')
          return seqs.length ? formatSeqRanges(seqs) : null
        }
        const ts = Date.now()
        // Built so the prereq entry ends up newest (top): the date entries are
        // unshifted first, then dependsOn. seq is frozen (per-sprint renumbering).
        const entries: ChangeLogEntry[] = []
        if (after.startDate !== oldStart)
          entries.push({ field: 'startDate', from: oldStart, to: after.startDate, ts })
        if (after.dueDate !== oldDue)
          entries.push({ field: 'dueDate', from: oldDue, to: after.dueDate, ts })
        entries.push({
          field: 'dependsOn',
          from: label(task.dependsOn),
          to: label(clean),
          ts,
        })
        // Record prereq + caused date shifts into the sprint activity log.
        await logTaskEdits(task, entries)
      }
    }
    return clean
  })
}

/**
 * True if another member in the same project already has this name
 * (case-insensitive, trimmed). `exceptId` skips the row being renamed so
 * re-saving an unchanged name isn't flagged as its own duplicate. Keeps the
 * assignee dropdown unambiguous (no two identically-named, same-coloured avatars).
 */
export async function memberNameExists(
  projectId: string,
  name: string,
  exceptId?: string
): Promise<boolean> {
  const target = name.trim().toLowerCase()
  if (!target) return false
  const members = await db.members.where('projectId').equals(projectId).toArray()
  return members.some(
    (m) => m.id !== exceptId && m.name.trim().toLowerCase() === target
  )
}

// Cascade-safe member delete: orphaned tasks become Unassigned (assigneeId=null)
// rather than disappearing from the UI. The linked Person is intentionally kept
// (it may still belong to other projects; a zero-member person is hidden from
// the roster, not deleted — design-docs/home-dashboard.md).
export async function deleteMember(memberId: string) {
  // Tasks scheduled around this member's daysOff keep those pushed-out dates
  // once unassigned — recompute them (and their dependents) right away instead
  // of leaving stale dates until the next app-load heal pass.
  const affected = (
    await db.tasks.where('assigneeId').equals(memberId).toArray()
  ).map((t) => t.id)
  await db.transaction('rw', db.members, db.tasks, async () => {
    await db.tasks
      .where('assigneeId')
      .equals(memberId)
      .modify({ assigneeId: null })
    await db.members.delete(memberId)
  })
  for (const id of affected) await recomputeDates(id)
}

// ---- People (cross-project identity) — design-docs/home-dashboard.md ----

/** Existing global person whose normalized name matches `name`, else undefined. */
async function findPersonByName(name: string): Promise<Person | undefined> {
  const target = normalizePersonName(name)
  if (!target) return undefined
  const all = await db.people.toArray()
  return all.find((p) => normalizePersonName(p.name) === target)
}

/**
 * Link a name to a Person: reuse an existing person with the same normalized
 * name (across all projects), else create one. Returns the personId. Joins the
 * ambient Dexie transaction when called inside one (import/seed paths).
 */
export async function linkOrCreatePerson(name: string): Promise<string> {
  const existing = await findPersonByName(name)
  if (existing) return existing.id
  const person: Person = {
    id: uid(),
    name: name.trim(),
    color: colorForName(name),
    createdAt: Date.now(),
  }
  await db.people.add(person)
  return person.id
}

/**
 * The single member-creation write path. Creates the member with a linked
 * person (reuse same-name person, else create) + lane order. Does NOT enforce
 * per-project name uniqueness — callers decide (settings shows an inline error;
 * the sprint inline add allows it). Returns the created member.
 */
export async function addMember(projectId: string, name: string): Promise<Member> {
  const n = name.trim()
  const [personId, order] = await Promise.all([
    linkOrCreatePerson(n),
    nextMemberOrder(projectId),
  ])
  const member: Member = {
    id: uid(),
    projectId,
    name: n,
    color: colorForName(n),
    daysOff: [],
    order,
    personId,
  }
  await db.members.add(member)
  return member
}

/** Merge `srcId` into `dstId`: reassign src's members to dst, delete src person. */
export async function mergePeople(srcId: string, dstId: string): Promise<void> {
  if (srcId === dstId) return
  await db.transaction('rw', db.people, db.members, async () => {
    await db.members.where('personId').equals(srcId).modify({ personId: dstId })
    await db.people.delete(srcId)
  })
}

/** Rename a person (display name only; does not touch member.name). */
export async function renamePerson(personId: string, name: string): Promise<void> {
  const n = name.trim()
  if (!n) return
  await db.people.update(personId, { name: n })
}

/** Recolor a person (avatar color). */
export async function recolorPerson(personId: string, color: string): Promise<void> {
  await db.people.update(personId, { color })
}
