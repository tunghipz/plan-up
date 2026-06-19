import Dexie, { type Table } from 'dexie'
import { formatSeqRanges, defaultSprintDates, todayLocalISO } from './lib'
import { remapBundle, type ProjectBundle } from './project-io'

export type Status = 'todo' | 'in_progress' | 'done'
export type Priority = 'urgent' | 'high' | 'normal' | 'low' | 'none'

/**
 * Fields whose user-initiated edits are recorded in the sprint activity log.
 * `dependsOn` is part of the union but NOT in LOGGABLE_FIELDS: it never arrives
 * via an updateTask patch — it flows through setDependencies, which logs it
 * itself (with sequence-range labels). See design-docs/sprint-activity-log.md.
 */
export type LoggableField =
  | 'title'
  | 'status'
  | 'priority'
  | 'assigneeId'
  | 'startDate'
  | 'dueDate'
  | 'estimate'
  | 'dependsOn'

export const LOGGABLE_FIELDS: readonly LoggableField[] = [
  'title',
  'status',
  'priority',
  'assigneeId',
  'startDate',
  'dueDate',
  'estimate',
]

/**
 * One recorded edit — the activity log's internal entry shape (built by
 * updateTask/logStatusChange/setDependencies, then mirrored into an
 * `ActivityEvent` of kind 'edit' via logTaskEdits). `from`/`to` store the RAW
 * value for stable fields (formatted at render); only `assigneeId` freezes the
 * resolved member NAME at write time so history survives the member being
 * deleted. See design-docs/sprint-activity-log.md.
 */
export interface ChangeLogEntry {
  field: LoggableField
  from: string | null
  to: string | null
  /** epoch ms, captured at write time */
  ts: number
}

/**
 * Kind of a sprint activity event (design-docs/sprint-activity-log.md, storage A).
 * - `created` — a task was added to the sprint
 * - `edit` — one field changed (reuses the changeLog `field`/`from`/`to` grammar)
 * - `rolled_over` — a task carried over from a previous sprint (`from` = its name)
 * - `sprint_started` — the sprint was created (task-less, sprint-level)
 */
export type ActivityKind =
  | 'created'
  | 'edit'
  | 'rolled_over'
  | 'sprint_started'
  | 'sprint_archived'
  | 'sprint_unarchived'

/**
 * One row in the append-only, uncapped sprint activity store — the app's sole
 * edit-history surface (the per-task `Task.changeLog` it once complemented was
 * removed in v11). Events live in their own table, so they survive task deletion
 * and aggregate sprint-wide. Display fields (`taskSeq`/`taskTitle`) are FROZEN at
 * write time so the log stays readable after renumbering or deletion.
 */
export interface ActivityEvent {
  id: string
  projectId: string
  /** The sprint this event belongs to. Collection tasks (no sprint) are never logged. */
  sprintId: string
  /** null for sprint-level events (`sprint_started`). */
  taskId: string | null
  taskSeq: number | null
  taskTitle: string | null
  kind: ActivityKind
  /** present iff `kind === 'edit'`. */
  field?: LoggableField
  from: string | null
  to: string | null
  /** epoch ms, captured at write time. */
  ts: number
}

/**
 * A day off for a member.
 * - `half` omitted → entire day off (contributes 0 to effort)
 * - `half: 'am'` → morning off, afternoon worked (contributes 0.5)
 * - `half: 'pm'` → afternoon off, morning worked (contributes 0.5)
 * AM vs PM is for human reference only; both half kinds contribute equally
 * (0.5 working day) since we don't model intra-day scheduling.
 */
export interface DayOff {
  date: string
  half?: 'am' | 'pm'
}

export interface Project {
  id: string
  name: string
  createdAt: number
  /** Optional free-text description, edited from the settings page. */
  description?: string
  /**
   * Optional hand-picked tile color (a hex from PALETTE). When unset, the UI
   * falls back to `colorForName(name)`. Non-indexed → no Dexie version bump.
   */
  color?: string
}

export interface Member {
  id: string
  projectId: string
  name: string
  color: string
  /**
   * Additional non-working days for this member, on top of weekends.
   * Pushes tasks forward when their start/end is computed from prereqs.
   */
  daysOff: DayOff[]
  /**
   * Optional free-text role label ("Backend Engineer", "Designer", "PM").
   * Pure display metadata — never affects scheduling/capacity/assignment.
   * Non-indexed, so it needs no Dexie version bump (same as Project.description).
   * See design-docs/member-title.md.
   */
  title?: string
  /**
   * Optional custom avatar. `avatarImage` is a resized (≤128px square) image
   * data-URL; `avatarEmoji` is a single emoji grapheme. Mutually exclusive
   * (`setMemberAvatar` clears the other). Both optional + non-indexed → no Dexie
   * version bump (same as `title`). Render falls back image → emoji → colored
   * initial. See design-docs/member-avatars.md.
   */
  avatarImage?: string
  avatarEmoji?: string
  /**
   * Manual lane order (per project): sorts member cards in the List view
   * (drag-to-reorder) and the Board view's `member` sort. Fractional, like
   * `Task.listOrder`. Optional + non-indexed (no Dexie index change); backfilled
   * to `0..N-1` per project in v12. Absent rows sort as 0 (tiebreak name → id).
   * See design-docs/member-lane-order.md.
   */
  order?: number
}

export interface Sprint {
  id: string
  projectId: string
  name: string
  startDate: string
  endDate: string
  /** Optional, non-indexed sprint-goal note (edited via header goal banner).
   * Needs no Dexie version bump — rows without it read as empty. */
  note?: string
  /** Epoch ms when archived; absent = active. Optional, non-indexed → no Dexie
   * version bump (same pattern as `note`). See design-docs/sprint-archive.md. */
  archivedAt?: number
}

export interface Section {
  id: string
  name: string
  /** Optional hex tô chấm header (từ COLLECTION_PALETTE). */
  color?: string
}

/** Một status do người dùng tạo trong một collection. */
export interface CollectionStatus {
  id: string
  name: string
  /** Hex từ COLLECTION_PALETTE. */
  color: string
}

export interface Collection {
  id: string
  projectId: string
  name: string
  /** Thứ tự hiển thị trong sidebar (fractional/integer). */
  order: number
  /** Bảng (tables) trong collection, có thứ tự. Luôn ≥ 1 phần tử. */
  sections: Section[]
  /** Bộ status do user tự tạo. Có thể rỗng. */
  statuses: CollectionStatus[]
  createdAt: number
}

export interface Task {
  id: string
  projectId: string
  /** Stable, never-reused sequence number (per-project). UI prereq input. */
  sequence: number
  title: string
  assigneeId: string | null
  sprintId: string | null
  status: Status
  priority: Priority
  startDate: string | null
  dueDate: string | null
  /** Effort in days. Drives end-date computation when prereqs exist. */
  estimate: number | null
  createdAt: number
  /** IDs of tasks that must be `done` before this one can start. */
  dependsOn: string[]
  /**
   * Optional parent task this task is grouped under (one level only — a child
   * cannot itself be a parent). Organizational display only; NOT a scheduling
   * constraint (unlike dependsOn). Non-indexed → no Dexie version bump; children
   * are grouped in memory. See design-docs/task-groups.md.
   */
  parentId?: string | null
  /**
   * Manual board ordering within a status column (fractional index). Set when a
   * card is dropped at a position on the Board; absent tasks fall back to
   * `sequence`. Board-only, non-indexed → no Dexie bump, no effect on List order.
   * See design-docs/board-view.md.
   */
  boardOrder?: number
  /**
   * Manual List ordering within a member card, in the default (seq) sort order
   * (fractional index). Set when a row is dragged to a new position in the List;
   * absent tasks fall back to `sequence`. Non-indexed → no Dexie bump; never logged
   * and never touches `sequence`. See design-docs/list-view.md.
   */
  listOrder?: number
  /**
   * Collection chứa task này (khi task nằm ngoài sprint). Bất biến: đúng MỘT
   * trong {sprintId, collectionId} khác null. Indexed để query theo collection.
   */
  collectionId?: string | null
  /** Bảng (Section.id) trong collection. Non-indexed. */
  sectionId?: string | null
  /** Trỏ tới CollectionStatus.id trong collection. Non-indexed. */
  collectionStatusId?: string | null
}

class PlanDB extends Dexie {
  projects!: Table<Project, string>
  members!: Table<Member, string>
  sprints!: Table<Sprint, string>
  tasks!: Table<Task, string>
  collections!: Table<Collection, string>
  events!: Table<ActivityEvent, string>

  constructor() {
    super('plan-up')
    this.version(1).stores({
      members: 'id, name',
      sprints: 'id, startDate',
      tasks: 'id, sprintId, assigneeId, status, createdAt',
    })
    // v2 (2026-06-03): add Task.startDate. Indexes unchanged; just backfill data.
    this.version(2).upgrade((tx) =>
      tx
        .table('tasks')
        .toCollection()
        .modify((t: Task) => {
          if (t.startDate === undefined) t.startDate = null
        })
    )
    // v3 (2026-06-03): add Task.dependsOn (array of task IDs). Backfill [].
    this.version(3).upgrade((tx) =>
      tx
        .table('tasks')
        .toCollection()
        .modify((t: Task) => {
          if (!Array.isArray(t.dependsOn)) t.dependsOn = []
        })
    )
    // v4 (2026-06-03): add Task.sequence. Backfill in createdAt order so
    // existing rows get stable 1, 2, 3, ... numbers.
    this.version(4).upgrade(async (tx) => {
      const rows = await tx.table('tasks').toArray()
      rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      let n = 1
      for (const r of rows) {
        await tx.table('tasks').update(r.id, { sequence: n++ })
      }
    })
    // v5 (2026-06-03): add Member.daysOff (array of yyyy-mm-dd). Backfill [].
    this.version(5).upgrade((tx) =>
      tx
        .table('members')
        .toCollection()
        .modify((m: Member) => {
          if (!Array.isArray(m.daysOff)) m.daysOff = []
        })
    )
    // v6 (2026-06-03): daysOff shape changes from string[] to DayOff[]
    // (object with optional `half`). Convert old strings → {date: s}.
    this.version(6).upgrade((tx) =>
      tx
        .table('members')
        .toCollection()
        .modify((m: Member) => {
          const raw = m.daysOff as unknown as Array<string | DayOff>
          if (!Array.isArray(raw)) {
            m.daysOff = []
            return
          }
          m.daysOff = raw.map((d) =>
            typeof d === 'string' ? { date: d } : d
          )
        })
    )
    // v7 (2026-06-03): multi-project. Add projects table + projectId on
    // members/sprints/tasks. Backfill existing data to a default project.
    this.version(7)
      .stores({
        projects: 'id, name, createdAt',
        members: 'id, name, projectId',
        sprints: 'id, startDate, projectId',
        tasks: 'id, sprintId, assigneeId, status, createdAt, projectId',
      })
      .upgrade(async (tx) => {
        const projects = tx.table<Project>('projects')
        const existing = await projects.toArray()
        let defaultId: string
        if (existing.length > 0) {
          defaultId = existing[0].id
        } else {
          defaultId =
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : Math.random().toString(36).slice(2, 10)
          await projects.add({
            id: defaultId,
            name: 'My Project',
            createdAt: Date.now(),
          })
        }
        for (const table of ['members', 'sprints', 'tasks']) {
          await tx
            .table(table)
            .toCollection()
            .modify((row: { projectId?: string }) => {
              if (!row.projectId) row.projectId = defaultId
            })
        }
      })
    // v8 (2026-06-03): sequence becomes per-SPRINT (was per-project). Each
    // sprint resets at 1 so users see a clean 1..N column per sprint view.
    // Existing dependsOn references point to task IDs — unaffected.
    this.version(8).upgrade(async (tx) => {
      const tasks = await tx.table('tasks').toArray()
      const bySprint = new Map<string, typeof tasks>()
      for (const t of tasks) {
        const arr = bySprint.get(t.sprintId) ?? []
        arr.push(t)
        bySprint.set(t.sprintId, arr)
      }
      for (const arr of bySprint.values()) {
        arr.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        let n = 1
        for (const t of arr) {
          await tx.table('tasks').update(t.id, { sequence: n++ })
        }
      }
    })
    // v9 (2026-06-05): collections (task ngoài sprint). New `collections` table;
    // tasks gain collectionId (indexed) + sectionId/collectionStatusId (non-indexed);
    // sprintId becomes nullable. Existing tasks stay sprint tasks (collectionId=null).
    this.version(9)
      .stores({
        projects: 'id, name, createdAt',
        members: 'id, name, projectId',
        sprints: 'id, startDate, projectId',
        collections: 'id, projectId, order',
        tasks: 'id, sprintId, assigneeId, status, createdAt, projectId, collectionId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('tasks')
          .toCollection()
          .modify((t: Task) => {
            if (t.collectionId === undefined) t.collectionId = null
          })
      })
    // v10 (2026-06-12): sprint activity log (design-docs/sprint-activity-log.md).
    // New append-only `events` table, indexed by sprintId (+ ts for ordering,
    // projectId for project-scoped wipes). No data backfill — history starts now;
    // pre-existing tasks have no recorded events.
    this.version(10).stores({
      projects: 'id, name, createdAt',
      members: 'id, name, projectId',
      sprints: 'id, startDate, projectId',
      collections: 'id, projectId, order',
      tasks: 'id, sprintId, assigneeId, status, createdAt, projectId, collectionId',
      events: 'id, sprintId, ts, projectId',
    })

    // v11 — per-task change log removed (design-docs/task-change-log.md). Strip
    // the dead, non-indexed `changeLog` field from existing task rows. No index
    // change, so this is an upgrade-only bump (the v10 stores carry forward).
    this.version(11).upgrade((tx) =>
      tx
        .table('tasks')
        .toCollection()
        .modify((t: Record<string, unknown>) => {
          delete t.changeLog
        })
    )
    // v12 (2026-06-19): manual member-lane order (design-docs/member-lane-order.md).
    // Add non-indexed `Member.order`; backfill per project to 0..N-1 in the current
    // `toArray()` order so the first render is identical to today's implicit order.
    // No index change → upgrade-only bump (v10 stores carry forward).
    this.version(12).upgrade(async (tx) => {
      const members = await tx.table<Member>('members').toArray()
      const byProject = new Map<string, Member[]>()
      for (const m of members) {
        const arr = byProject.get(m.projectId) ?? []
        arr.push(m)
        byProject.set(m.projectId, arr)
      }
      for (const arr of byProject.values()) {
        let i = 0
        for (const m of arr) {
          await tx.table('members').update(m.id, { order: i++ })
        }
      }
    })
  }
}

export const db = new PlanDB()

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)

export const PALETTE = [
  '#a855f7', '#f97316', '#3b82f6', '#10b981',
  '#ef4444', '#eab308', '#ec4899', '#14b8a6',
]
export function colorForName(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

/** Palette hệ Apple cho status/section màu (design-system §2.4 + đỏ/xám). */
export const COLLECTION_PALETTE = [
  '#0071E3', '#34C759', '#FF9500', '#FF3B30', '#AF52DE',
  '#FF2D55', '#5AC8FA', '#5856D6', '#FF6482', '#8E8E93',
] as const

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
  const today = new Date().toISOString().slice(0, 10)
  // One transaction so the maxSeq read + add can't interleave with another add:
  // two rapid "add item" clicks would otherwise read the same maxSeq and produce
  // duplicate per-project sequences.
  return db.transaction('rw', db.collections, db.tasks, async () => {
    const c = await db.collections.get(collectionId)
    const projectId = c?.projectId ?? ''
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
      collectionStatusId: c?.statuses[0]?.id ?? null,
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

/** Next sequence number within a sprint. Sequences are never reused. */
export async function nextSequence(sprintId: string): Promise<number> {
  const all = await db.tasks.where('sprintId').equals(sprintId).toArray()
  let max = 0
  for (const t of all) if ((t.sequence ?? 0) > max) max = t.sequence ?? 0
  return max + 1
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
  patch: Partial<Pick<Project, 'name' | 'description' | 'color'>>
): Promise<void> {
  await db.projects.update(id, patch)
}

/**
 * Delete a project and everything it owns: members, sprints, tasks. Tasks
 * in this project that are referenced as dependsOn by tasks in OTHER
 * projects (rare) are stripped from those references.
 */
export async function deleteProject(projectId: string): Promise<void> {
  await db.transaction(
    'rw',
    db.projects,
    db.members,
    db.sprints,
    db.tasks,
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
      await db.projects.delete(projectId)
    }
  )
}

/**
 * Add `days` calendar days to a yyyy-mm-dd string. Returns yyyy-mm-dd.
 * Anchored in UTC so the result is timezone-independent.
 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** True if the date falls on Saturday or Sunday. */
export function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + 'T00:00:00Z').getUTCDay()
  return day === 0 || day === 6
}

/**
 * Returns dateStr if it's a working day, else the next working day.
 * `extraOff` is an optional set of additional yyyy-mm-dd days that count
 * as non-working (member-specific vacation).
 */
export function nextBusinessDay(
  dateStr: string,
  extraOff?: ReadonlySet<string>
): string {
  let d = dateStr
  while (isWeekend(d) || extraOff?.has(d)) d = addDays(d, 1)
  return d
}

/**
 * Add `n` working days to `dateStr`. Assumes dateStr is already a working
 * day. Sat/Sun and any day in `extraOff` do not consume `n`.
 */
export function addBusinessDays(
  dateStr: string,
  n: number,
  extraOff?: ReadonlySet<string>
): string {
  let d = dateStr
  let remaining = n
  while (remaining > 0) {
    d = addDays(d, 1)
    if (!isWeekend(d) && !extraOff?.has(d)) remaining--
  }
  return d
}

/**
 * Compute (start, end) for a task based on its prereqs and effort.
 * - If task has no prereqs: returns (task.startDate, task.dueDate) — manual.
 * - If prereqs exist: start = max(prereq.dueDate) + 1 day.
 * - end = start + (estimate - 1) days; if no estimate, end = start.
 * Returns null fields if the calculation can't run (e.g. no prereq has an end).
 */
/**
 * Working fraction contributed by a single day for the given off-map.
 * - Sat/Sun: 0
 * - In off-map with full off (no `half`): 0
 * - In off-map with `half`: 0.5
 * - Otherwise: 1
 */
export function workingFraction(
  date: string,
  contribByDate?: ReadonlyMap<string, 0 | 0.5>
): number {
  if (isWeekend(date)) return 0
  if (contribByDate?.has(date)) return contribByDate.get(date) as number
  return 1
}

const EPS = 1e-9

/**
 * Internal plan for a task — dates, plus the wall-clock fractions of the
 * start and end days needed to render times and chain to dependents.
 *
 * Wall-clock fraction model: 0 = 08:00, 0.5 = 12:00 (lunch / 13:00 resume),
 * 1 = 17:00. Lunch is treated as a non-counting break; work either fills
 * (0..0.5] AM or (0.5..1] PM.
 */
interface TaskPlan {
  startDate: string | null
  dueDate: string | null
  /** Wall fraction at which work begins on startDate (0=08:00, 0.5=13:00). */
  startOffset: number
  /** Wall fraction at which work ends on dueDate (0.5=12:00, 1=17:00). */
  dueFraction: number
}

function planFor(
  task: Task,
  byId: Map<string, Task>,
  memberById: Map<string, Member> | undefined,
  cache: Map<string, TaskPlan>
): TaskPlan {
  const hit = cache.get(task.id)
  if (hit) return hit

  const member = task.assigneeId ? memberById?.get(task.assigneeId) : undefined
  const halfByDate = new Map<string, 'am' | 'pm'>()
  const contribByDate = new Map<string, 0 | 0.5>()
  if (member?.daysOff) {
    for (const d of member.daysOff) {
      contribByDate.set(d.date, d.half ? 0.5 : 0)
      if (d.half) halfByDate.set(d.date, d.half)
    }
  }
  const dayContrib = (date: string): number => {
    if (isWeekend(date)) return 0
    if (contribByDate.has(date)) return contribByDate.get(date) as number
    return 1
  }
  // Wall position where work naturally begins on `date`. AM-off → 0.5.
  const naturalWallStart = (date: string): number =>
    dayContrib(date) === 0.5 && halfByDate.get(date) === 'am' ? 0.5 : 0
  // Wall position where work naturally ends on `date`. PM-off → 0.5.
  const naturalWallEnd = (date: string): number => {
    const c = dayContrib(date)
    if (c === 0) return 0
    if (c === 0.5 && halfByDate.get(date) === 'pm') return 0.5
    return 1
  }
  // Available work fraction on `date` given a wall-clock start offset.
  const availOnDay = (date: string, offset: number): number => {
    const ws = naturalWallStart(date)
    const we = naturalWallEnd(date)
    return Math.max(0, we - Math.max(offset, ws))
  }

  // Step 1: pick start. With prereqs, find the latest prereq end moment.
  let start: string | null = task.startDate
  let startOffset = 0
  if (task.dependsOn?.length > 0) {
    let bestDate: string | null = null
    let bestFrac = 0
    for (const id of task.dependsOn) {
      const p = byId.get(id)
      if (!p) continue
      const pPlan = planFor(p, byId, memberById, cache)
      if (!pPlan.dueDate) continue
      if (
        bestDate === null ||
        pPlan.dueDate > bestDate ||
        (pPlan.dueDate === bestDate && pPlan.dueFraction > bestFrac)
      ) {
        bestDate = pPlan.dueDate
        bestFrac = pPlan.dueFraction
      }
    }
    if (bestDate) {
      // Can the dependent start the same day with leftover capacity?
      // "Leftover" exists if this task's natural-end on bestDate extends
      // beyond the wall position where the prereq stopped working.
      if (naturalWallEnd(bestDate) > bestFrac + EPS) {
        start = bestDate
        startOffset = Math.max(naturalWallStart(bestDate), bestFrac)
      } else {
        let d = addDays(bestDate, 1)
        while (dayContrib(d) <= 0) d = addDays(d, 1)
        start = d
        startOffset = 0
      }
    }
  }

  if (!start) {
    const plan: TaskPlan = {
      startDate: null,
      dueDate: task.dueDate,
      startOffset: 0,
      dueFraction: 1,
    }
    cache.set(task.id, plan)
    return plan
  }

  // Step 2: normalize start past off days when caller set it on one.
  while (dayContrib(start) <= 0) {
    start = addDays(start, 1)
    startOffset = 0
  }
  // If the day naturally starts later (AM-off), lift offset to match.
  startOffset = Math.max(startOffset, naturalWallStart(start))

  // No effort → end stays manual.
  if (!task.estimate || task.estimate <= 0) {
    const plan: TaskPlan = {
      startDate: start,
      dueDate: task.dueDate,
      startOffset,
      dueFraction: 1,
    }
    cache.set(task.id, plan)
    return plan
  }

  // Step 3: walk forward consuming effort.
  let d = start
  let remaining = task.estimate
  let end = start
  let isFirst = true
  let lastUse = 0
  let lastWallStart = startOffset
  while (remaining > EPS) {
    const avail = isFirst ? availOnDay(d, startOffset) : availOnDay(d, 0)
    if (avail > 0) {
      const use = Math.min(remaining, avail)
      remaining -= use
      end = d
      lastUse = use
      lastWallStart = isFirst
        ? Math.max(naturalWallStart(d), startOffset)
        : naturalWallStart(d)
    }
    isFirst = false
    if (remaining > EPS) d = addDays(d, 1)
  }
  const dueFraction = Math.min(1, lastWallStart + lastUse)
  const plan: TaskPlan = { startDate: start, dueDate: end, startOffset, dueFraction }
  cache.set(task.id, plan)
  return plan
}

/**
 * The live display plan for a task: start/due DATES plus their wall-clock
 * TIMES, all from a single `planFor` pass. Use this for rendering so the
 * date and time always share one source and can never drift apart (e.g. a
 * stored `dueDate` going stale against a freshly-computed time). For tasks
 * with no effort/prereqs this returns the manual stored dates unchanged.
 *
 * Time mapping: fractions → {08:00, 12:00, 13:00, 17:00}. Sub-half-day usage
 * rounds to lunch (12:00) or 17:00.
 */
export function computeWorkingPlan(
  task: Task,
  byId: Map<string, Task>,
  memberById?: Map<string, Member>
): { startDate: string | null; dueDate: string | null; startTime: string; endTime: string } {
  const plan = planFor(task, byId, memberById, new Map())
  return {
    startDate: plan.startDate,
    dueDate: plan.dueDate,
    startTime: plan.startOffset >= 0.5 - EPS ? '13:00' : '08:00',
    endTime: plan.dueFraction > 0.5 + EPS ? '17:00' : '12:00',
  }
}

/**
 * Wall-clock display times. Maps the plan's fractions to {08:00, 12:00,
 * 13:00, 17:00}. Sub-half-day usage is rounded to lunch (12:00) or 17:00.
 */
export function computeWorkingTimes(
  task: Task,
  byId: Map<string, Task>,
  memberById?: Map<string, Member>
): { startTime: string; endTime: string } {
  const { startTime, endTime } = computeWorkingPlan(task, byId, memberById)
  return { startTime, endTime }
}

/**
 * Recompute a task's start/end from its prereqs, effort, and the assignee's
 * off-days.
 *
 * Rules:
 *   - If task has prereqs with end dates → start = next working day after
 *     latest prereq end. Otherwise start = task.startDate (manual).
 *   - If effort > 0 → end = start + effort working days, consuming
 *     half-off days as 0.5 and skipping weekends + full-off days.
 *     Otherwise end = task.dueDate (manual).
 *   - If start lands on a non-working day (weekend or full-off), it's
 *     pushed forward to the next working day.
 *
 * Returns task.startDate / task.dueDate unchanged when there's nothing to
 * compute (no prereqs AND no effort).
 */
export function computeStartEnd(
  task: Task,
  byId: Map<string, Task>,
  memberById?: Map<string, Member>
): { startDate: string | null; dueDate: string | null } {
  const plan = planFor(task, byId, memberById, new Map())
  return { startDate: plan.startDate, dueDate: plan.dueDate }
}

// ──────────────────────────────────────────────────────────────────────────
// Edit tracking → sprint activity log (design-docs/sprint-activity-log.md).
//
//   user edit ──▶ updateTask / logStatusChange / setDependencies
//                 ──▶ diff into ChangeLogEntry[] ──▶ logTaskEdits ──▶ events
//   scheduler  ──▶ raw db.tasks.update ─────────────────────────▶ NO log
//                 (recomputeDates, rollover, …)   — premise #2
// ──────────────────────────────────────────────────────────────────────────

/** Window in which consecutive TITLE keystrokes collapse into one event. */
const TITLE_COALESCE_MS = 2 * 60 * 1000

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

// ──────────────────────────────────────────────────────────────────────────
// Sprint activity log (design-docs/sprint-activity-log.md, storage model A).
// Append-only `events` store written from user-edit write sites. Scheduler
// recomputes (raw db.tasks.update) are never logged — premise #2. Collection
// tasks (no sprintId) are never logged.
// ──────────────────────────────────────────────────────────────────────────

/** Append one activity event (id auto-assigned). */
export async function logEvent(e: Omit<ActivityEvent, 'id'>): Promise<void> {
  await db.events.add({ id: uid(), ...e })
}

/** A sprint's activity, newest-first (ts desc). */
export async function sprintEvents(sprintId: string): Promise<ActivityEvent[]> {
  const rows = await db.events.where('sprintId').equals(sprintId).toArray()
  return rows.sort((a, b) => b.ts - a.ts)
}

/**
 * Mirror the just-built changeLog `entries` into the activity store. Sprint-only.
 * `title` coalesces within TITLE_COALESCE_MS (like the changeLog) so a keystroke
 * burst is one event, not one per character. MUST run inside a transaction whose
 * scope includes db.events. Display fields are frozen at write time.
 */
async function logTaskEdits(task: Task, entries: ChangeLogEntry[]): Promise<void> {
  if (!task.sprintId) return
  for (const e of entries) {
    if (e.field === 'title') {
      const prior = (await db.events.where('sprintId').equals(task.sprintId).toArray())
        .filter((ev) => ev.taskId === task.id && ev.kind === 'edit' && ev.field === 'title')
        .sort((a, b) => b.ts - a.ts)[0]
      if (prior && e.ts - prior.ts <= TITLE_COALESCE_MS) {
        await db.events.update(prior.id, { to: e.to, ts: e.ts })
        continue
      }
    }
    await db.events.add({
      id: uid(),
      projectId: task.projectId,
      sprintId: task.sprintId,
      taskId: task.id,
      taskSeq: task.sequence ?? null,
      taskTitle: task.title,
      kind: 'edit',
      field: e.field,
      from: e.from,
      to: e.to,
      ts: e.ts,
    })
  }
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
 * Recompute dates for `taskId` and walk forward to any tasks that depend on
 * it. Idempotent — stops when a task's computed dates equal current ones.
 */
export async function recomputeDates(taskId: string): Promise<void> {
  await db.transaction('rw', db.tasks, db.members, async () => {
    const members = await db.members.toArray()
    const memberById = new Map(members.map((m) => [m.id, m]))
    // Read the table ONCE. The dependency graph (`dependsOn`) never changes
    // during a recompute — only dates do — so we keep `byId` fresh in-memory
    // after each write instead of re-materialising the whole table every queue
    // step (which was O(chain × N) full-table reads inside one transaction).
    const all = await db.tasks.toArray()
    const byId = new Map(all.map((t) => [t.id, t]))
    const visited = new Set<string>()
    const queue: string[] = [taskId]
    while (queue.length) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      const task = byId.get(id)
      if (!task) continue
      const next = computeStartEnd(task, byId, memberById)
      if (
        next.startDate !== task.startDate ||
        next.dueDate !== task.dueDate
      ) {
        // Keep the in-memory snapshot current so dependents downstream in this
        // same walk compute against the freshly-written dates.
        byId.set(id, { ...task, startDate: next.startDate, dueDate: next.dueDate })
        await db.tasks.update(id, {
          startDate: next.startDate,
          dueDate: next.dueDate,
        })
      }
      for (const t of all) {
        if (t.dependsOn?.includes(id) && !visited.has(t.id)) {
          queue.push(t.id)
        }
      }
    }
  })
}

/**
 * Recompute and persist start/due for EVERY task in the DB, healing stored
 * dates that drifted out of sync — e.g. a dueDate computed under an older
 * off-day state whose recompute was never re-triggered. `planFor` derives
 * computed tasks from scratch (it never trusts the stored dueDate), so the
 * pass is order-independent and only writes rows whose result actually
 * changed. Idempotent and cheap; safe to run once on app load. Returns the
 * number of tasks updated.
 */
export async function recomputeAllDates(): Promise<number> {
  return db.transaction('rw', db.tasks, db.members, async () => {
    const members = await db.members.toArray()
    const memberById = new Map(members.map((m) => [m.id, m]))
    const all = await db.tasks.toArray()
    const byId = new Map(all.map((t) => [t.id, t]))
    let changed = 0
    for (const task of all) {
      const next = computeStartEnd(task, byId, memberById)
      if (next.startDate !== task.startDate || next.dueDate !== task.dueDate) {
        await db.tasks.update(task.id, {
          startDate: next.startDate,
          dueDate: next.dueDate,
        })
        changed++
      }
    }
    return changed
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
 * - Moved tasks get the new sprintId. If their startDate is now before
 *   the target sprint's start, it's bumped to the target start. Dates
 *   are then recomputed (effort + off-days + prereq chain still apply).
 * - dependsOn links survive across sprints — prereq IDs stay valid.
 */
export async function moveUnfinishedToNextSprint(
  sourceSprintId: string
): Promise<{ movedCount: number; targetSprintId: string | null }> {
  // One transaction so the move is atomic: a renumber/move that throws (or a tab
  // close) midway must NOT leave the source sprint half-emptied with inconsistent
  // sequences. recomputeDates nests safely — its scope (tasks+members) is a subset.
  return db.transaction('rw', db.tasks, db.members, db.sprints, db.events, async () => {
    const sprints = await db.sprints.orderBy('startDate').toArray()
    const sourceIdx = sprints.findIndex((s) => s.id === sourceSprintId)
    if (sourceIdx === -1) return { movedCount: 0, targetSprintId: null }
    const source = sprints[sourceIdx]
    // Target = the next NON-archived sprint (archived sprints are out of the
    // active flow — never rollover targets). See design-docs/sprint-archive.md.
    const target = sprints.slice(sourceIdx + 1).find((s) => s.archivedAt == null)
    if (!target) return { movedCount: 0, targetSprintId: null }

    const unfinished = await db.tasks
      .where('sprintId')
      .equals(sourceSprintId)
      .filter((t) => t.status !== 'done')
      .toArray()

    const rolledAt = Date.now()
    for (const t of unfinished) {
      // Sequence is per-sprint, so a moved task must be renumbered into the
      // target — otherwise it keeps its source number and collides with an
      // existing task there. Awaited in-loop so each call sees the prior insert.
      const patch: Partial<Task> = {
        sprintId: target.id,
        sequence: await nextSequence(target.id),
      }
      // Pull stale starts forward so the task lands inside the new sprint.
      if (!t.startDate || t.startDate < target.startDate) {
        patch.startDate = target.startDate
      }
      await db.tasks.update(t.id, patch)
      // Record the carry-over on the TARGET sprint's activity log.
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
    for (const t of unfinished) await recomputeDates(t.id)

    return { movedCount: unfinished.length, targetSprintId: target.id }
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
 * Resize an image file to a centered square data-URL for use as an avatar.
 * Client-side (canvas) so the DB and per-project export file stay small — a
 * multi-MB photo becomes a few KB. Decodes via `createImageBitmap` with
 * `imageOrientation: 'from-image'` so EXIF orientation is honored — phone photos
 * (which carry an orientation tag) aren't drawn sideways. Prefers webp; webp
 * encoding silently returns a PNG on browsers that can't encode it (it does not
 * throw), so we check the result prefix and re-encode to JPEG. Rejects
 * non-raster/oversized/undecodable input. GIF decodes to its first frame.
 * See design-docs/member-avatars.md.
 */
export async function resizeImageToDataURL(
  file: File,
  size = 128
): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new Error('Unsupported format — use PNG, JPEG, WebP or GIF.')
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image too large (max 10MB).')
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('Could not decode image.')
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not available.')
    // Center-crop the (orientation-corrected) bitmap to a square.
    const s = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - s) / 2
    const sy = (bitmap.height - s) / 2
    ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, size, size)
    let out = canvas.toDataURL('image/webp', 0.85)
    if (!out.startsWith('data:image/webp')) {
      out = canvas.toDataURL('image/jpeg', 0.85) // silent-PNG fallback
    }
    return out
  } finally {
    bitmap.close()
  }
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
  const [parent, hasChildren] = await Promise.all([
    db.tasks.get(parentId),
    // parentId is non-indexed → filter, not where()
    db.tasks.filter((t) => t.parentId === childId).count(),
  ])
  // Guard: target must exist & be top-level; child must not be a parent itself.
  if (!parent || parent.parentId || hasChildren > 0) return
  await db.tasks.update(childId, { parentId })
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
 * Returns true if adding `newDepId` to `taskId`'s dependsOn would form a cycle.
 * A cycle exists if `taskId` is reachable from `newDepId` via existing edges.
 */
export function wouldCreateCycle(
  taskId: string,
  newDepId: string,
  tasks: Task[]
): boolean {
  if (taskId === newDepId) return true
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const stack = [newDepId]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === taskId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    const t = byId.get(cur)
    if (t) stack.push(...t.dependsOn)
  }
  return false
}

/**
 * If adding `newDepId` as a prerequisite of `taskId` would create a cycle,
 * return the existing path of task IDs from `newDepId` back to `taskId`
 * (shortest, via BFS over `dependsOn`). The full loop is then
 * `taskId → newDepId → …returned… (ends at taskId)`. Returns null when no such
 * path exists (i.e. no cycle). Companion to `wouldCreateCycle` that also yields
 * the path so the UI can show *where* the loop runs.
 */
export function findCyclePath(
  taskId: string,
  newDepId: string,
  tasks: Task[]
): string[] | null {
  if (taskId === newDepId) return [newDepId]
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const parent = new Map<string, string | null>([[newDepId, null]])
  const queue = [newDepId]
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === taskId) {
      const path: string[] = []
      let n: string | null = cur
      while (n != null) {
        path.unshift(n)
        n = parent.get(n) ?? null
      }
      return path
    }
    const t = byId.get(cur)
    if (!t) continue
    for (const d of t.dependsOn) {
      if (!parent.has(d)) {
        parent.set(d, cur)
        queue.push(d)
      }
    }
  }
  return null
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
}

export async function removeDependency(taskId: string, depId: string) {
  const task = await db.tasks.get(taskId)
  if (!task) return
  await db.tasks.update(taskId, {
    dependsOn: task.dependsOn.filter((id) => id !== depId),
  })
  await recomputeDates(taskId)
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
}

/**
 * A task is "blocked" if any of its prerequisites is not yet `done`.
 * Done tasks themselves are never blocked (visual nicety).
 */
export function isTaskBlocked(task: Task, byId: Map<string, Task>): boolean {
  if (task.status === 'done') return false
  if (!task.dependsOn || task.dependsOn.length === 0) return false
  return task.dependsOn.some((id) => {
    const dep = byId.get(id)
    return dep && dep.status !== 'done'
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
// rather than disappearing from the UI.
export async function deleteMember(memberId: string) {
  await db.transaction('rw', db.members, db.tasks, async () => {
    await db.tasks
      .where('assigneeId')
      .equals(memberId)
      .modify({ assigneeId: null })
    await db.members.delete(memberId)
  })
}

export interface ExportPayload {
  version: 1 | 2 | 3 | 4
  exportedAt: string
  /** v2 introduces multi-project. v1 payloads have no `projects` field. */
  projects?: Project[]
  members: Member[]
  sprints: Sprint[]
  /** v3 introduces collections (task ngoài sprint). */
  collections?: Collection[]
  tasks: Task[]
  /** v4 introduces the sprint activity log. Older payloads have no `events`. */
  events?: ActivityEvent[]
}

export async function exportAll(): Promise<ExportPayload> {
  const [projects, members, sprints, collections, tasks, events] = await Promise.all([
    db.projects.toArray(),
    db.members.toArray(),
    db.sprints.toArray(),
    db.collections.toArray(),
    db.tasks.toArray(),
    db.events.toArray(),
  ])
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    projects,
    members,
    sprints,
    collections,
    tasks,
    events,
  }
}

export async function importAll(data: ExportPayload) {
  if (!data || ![1, 2, 3, 4].includes(data.version)) {
    throw new Error('Unsupported export version')
  }
  // Validate shape BEFORE the transaction clears anything. A payload can carry
  // a valid `version` yet have missing/non-array collections (truncated backup,
  // hand-edited JSON, or a foreign file that happens to set `version`). The
  // `as ExportPayload` cast at the call site is no runtime guarantee — without
  // this guard the clears below succeed and the later `.map()` throws, leaving
  // the user with a wiped DB and a cryptic "x.map is not a function".
  if (
    !Array.isArray(data.members) ||
    !Array.isArray(data.sprints) ||
    !Array.isArray(data.tasks) ||
    (data.projects !== undefined && !Array.isArray(data.projects)) ||
    (data.collections !== undefined && !Array.isArray(data.collections)) ||
    (data.events !== undefined && !Array.isArray(data.events))
  ) {
    throw new Error('Not a valid plan-up backup')
  }
  try {
   await db.transaction(
    'rw',
    [db.projects, db.members, db.sprints, db.collections, db.tasks, db.events],
    async () => {
      await db.events.clear()
      await db.tasks.clear()
      await db.sprints.clear()
      await db.members.clear()
      await db.collections.clear()
      await db.projects.clear()
      // v1 payloads predate multi-project — synthesize a default project
      // and stamp it onto every row. Any payload that carries `projects`
      // (v2, v3, …) must keep its real project ids, otherwise sprints/
      // collections/tasks (which reference projectId) get orphaned.
      let projects: Project[]
      let defaultId: string | null = null
      if (data.projects && data.projects.length > 0) {
        projects = data.projects
      } else {
        defaultId = uid()
        projects = [
          { id: defaultId, name: 'My Project', createdAt: Date.now() },
        ]
      }
      await db.projects.bulkAdd(projects)
      const fallbackId = defaultId ?? projects[0].id
      const pidOf = (row: { projectId?: string }) => row.projectId ?? fallbackId

      const members: Member[] = data.members.map((m) => {
        const raw = (m.daysOff ?? []) as Array<string | DayOff>
        const daysOff: DayOff[] = raw.map((d) =>
          typeof d === 'string' ? { date: d } : d
        )
        return { ...m, projectId: pidOf(m), daysOff }
      })
      await db.members.bulkAdd(members)

      const sprints: Sprint[] = data.sprints.map((s) => ({
        ...s,
        projectId: pidOf(s),
      }))
      await db.sprints.bulkAdd(sprints)

      if (data.version >= 3 && Array.isArray(data.collections)) {
        await db.collections.bulkAdd(
          data.collections.map((c) => ({ ...c, projectId: pidOf(c) }))
        )
      }

      // Sequence backfill is per-project for v1 payloads.
      const seqCounter = new Map<string, number>()
      const sorted = [...data.tasks].sort(
        (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)
      )
      const tasks: Task[] = sorted.map((t) => {
        const pid = pidOf(t)
        let seq: number
        if (typeof t.sequence === 'number') {
          seq = t.sequence
        } else {
          const cur = seqCounter.get(pid) ?? 0
          seq = cur + 1
          seqCounter.set(pid, seq)
        }
        return {
          ...t,
          projectId: pid,
          startDate: t.startDate ?? null,
          dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
          sequence: seq,
          collectionId: t.collectionId ?? null,
          sectionId: t.sectionId ?? null,
          collectionStatusId: t.collectionStatusId ?? null,
        }
      })
      await db.tasks.bulkAdd(tasks)

      // v4+ carries the sprint activity log. Older payloads have none — the log
      // simply starts empty after importing them. Event rows reference real ids
      // (taskId/sprintId/projectId) which are preserved above for v2+ payloads.
      if (data.version >= 4 && Array.isArray(data.events) && data.events.length) {
        await db.events.bulkAdd(data.events)
      }
    }
   )
  } catch (err) {
    // Dexie aborts + rolls back the transaction on any failure, so the clears
    // above are undone and the user's existing data survives. Translate its raw
    // BulkError / ConstraintError (duplicate or conflicting ids in the payload)
    // into a message the import dialog can show plainly, not Dexie internals.
    const name = err instanceof Error ? err.name : ''
    if (name === 'BulkError' || name === 'ConstraintError') {
      throw new Error('Backup file contains duplicate or conflicting records.', {
        cause: err,
      })
    }
    throw err
  }
}

/**
 * Export a SINGLE project to a portable, self-contained `ProjectBundle`
 * (version 5) — the "share one project" counterpart to the full-DB `exportAll`.
 * Reads each table filtered by `projectId`; the result can be imported into
 * another plan-up without touching existing data. See project-io.ts and
 * design-docs/project-export-import.md.
 */
export async function exportProject(projectId: string): Promise<ProjectBundle> {
  const [project, members, sprints, collections, tasks, events] =
    await Promise.all([
      db.projects.get(projectId),
      db.members.where('projectId').equals(projectId).toArray(),
      db.sprints.where('projectId').equals(projectId).toArray(),
      db.collections.where('projectId').equals(projectId).toArray(),
      db.tasks.where('projectId').equals(projectId).toArray(),
      db.events.where('projectId').equals(projectId).toArray(),
    ])
  if (!project) throw new Error('Project not found')
  return {
    version: 5,
    kind: 'project',
    exportedAt: new Date().toISOString(),
    project,
    members,
    sprints,
    collections,
    tasks,
    events,
  }
}

/**
 * Import a `ProjectBundle` as a BRAND-NEW project alongside existing ones —
 * non-destructive and repeatable (each import = a fresh copy). Regenerates every
 * id via `remapBundle` (a pure, unit-tested function), then bulk-adds into all
 * tables in ONE rw transaction. No clears. Returns the new projectId so the
 * caller can select it. On bulk error Dexie rolls back (existing data safe);
 * BulkError/ConstraintError are translated like `importAll`.
 */
export async function importProject(
  bundle: ProjectBundle
): Promise<{ projectId: string; projectName: string; taskCount: number }> {
  const remapped = remapBundle(bundle, uid)
  try {
    await db.transaction(
      'rw',
      [db.projects, db.members, db.sprints, db.collections, db.tasks, db.events],
      async () => {
        await db.projects.add(remapped.project)
        if (remapped.members.length) await db.members.bulkAdd(remapped.members)
        if (remapped.sprints.length) await db.sprints.bulkAdd(remapped.sprints)
        if (remapped.collections.length)
          await db.collections.bulkAdd(remapped.collections)
        if (remapped.tasks.length) await db.tasks.bulkAdd(remapped.tasks)
        if (remapped.events.length) await db.events.bulkAdd(remapped.events)
      }
    )
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'BulkError' || name === 'ConstraintError') {
      throw new Error('Project file contains duplicate or conflicting records.', {
        cause: err,
      })
    }
    throw err
  }
  return {
    projectId: remapped.project.id,
    projectName: remapped.project.name,
    taskCount: remapped.tasks.length,
  }
}

// Module-level promise lock prevents StrictMode double-mount from seeding twice.
let seedPromise: Promise<void> | null = null
export function seedIfEmpty(): Promise<void> {
  if (!seedPromise) {
    // On failure, release the lock so a later call (e.g. after a transient
    // IndexedDB hiccup clears) can retry — otherwise a single rejected seed is
    // cached forever and the app can never seed without a full reload.
    seedPromise = doSeed().catch((e) => {
      seedPromise = null
      throw e
    })
  }
  return seedPromise
}
/** Test-only: reset the per-module seed lock so a freshly cleared DB can re-seed. */
export function __resetSeedLockForTests() {
  seedPromise = null
}

/**
 * Merge sprints with duplicate names (legacy artifact of pre-lock seed race).
 * For each duplicate group: keep the sprint with most tasks, reassign tasks
 * from duplicates to keeper, then delete the duplicates. Idempotent.
 * Returns the number of duplicate sprints removed.
 */
export async function dedupeSprints(): Promise<number> {
  return db.transaction('rw', db.sprints, db.tasks, async () => {
    const sprints = await db.sprints.toArray()
    const tasks = await db.tasks.toArray()

    // Scope by (projectId, name) — same name across projects is NOT a
    // duplicate. (Pre-v7 single-project bucketed by name alone, which
    // accidentally merged cross-project sprints once multi-project shipped.)
    const byName = new Map<string, Sprint[]>()
    for (const s of sprints) {
      const key = `${s.projectId}::${s.name}`
      const bucket = byName.get(key) ?? []
      bucket.push(s)
      byName.set(key, bucket)
    }

    let removed = 0
    for (const group of byName.values()) {
      if (group.length <= 1) continue
      // keep the sprint with the most tasks (tie-break: earliest startDate)
      group.sort((a, b) => {
        const ca = tasks.filter((t) => t.sprintId === a.id).length
        const cb = tasks.filter((t) => t.sprintId === b.id).length
        if (cb !== ca) return cb - ca
        return a.startDate.localeCompare(b.startDate)
      })
      const keeper = group[0]
      const dups = group.slice(1)
      for (const dup of dups) {
        // Renumber as we move — sequence is per-sprint, so a plain sprintId
        // swap would carry the dup's numbers over and collide with the keeper's.
        const dupTasks = await db.tasks.where('sprintId').equals(dup.id).toArray()
        for (const t of dupTasks) {
          await db.tasks.update(t.id, {
            sprintId: keeper.id,
            sequence: await nextSequence(keeper.id),
          })
        }
        await db.sprints.delete(dup.id)
        removed++
      }
    }
    return removed
  })
}

async function doSeed() {
  await db.transaction(
    'rw',
    db.projects,
    db.members,
    db.sprints,
    db.tasks,
    async () => {
      // Ensure at least one project exists (the migration creates one for
      // upgrading users; first-launch needs us to handle it here too).
      let project = (await db.projects.toArray())[0]
      if (!project) {
        project = {
          id: uid(),
          name: 'My Project',
          createdAt: Date.now(),
        }
        await db.projects.add(project)
      }
      const memberCount = await db.members.count()
      if (memberCount > 0) return
      await seedFresh(project.id)
    }
  )
}

async function seedFresh(projectId: string) {
  const names = ['Alice', 'Bob', 'Charlie']
  const members: Member[] = names.map((name) => ({
    id: uid(),
    projectId,
    name,
    color: colorForName(name),
    daysOff: [],
  }))
  await db.members.bulkAdd(members)

  // Seeded Sprint 1 must honor the Monday-locked, 2-week cadence too — the
  // dialog isn't the only creation path. See design-docs/sprint-cadence.md.
  const { startDate, endDate } = defaultSprintDates(null, todayLocalISO())
  const sprint: Sprint = {
    id: uid(),
    projectId,
    name: 'Sprint 1',
    startDate,
    endDate,
  }
  await db.sprints.add(sprint)

  await db.tasks.add({
    id: uid(),
    projectId,
    sequence: 1,
    title: 'Welcome — click to edit, or use ＋ Add Task',
    assigneeId: members[0].id,
    sprintId: sprint.id,
    status: 'in_progress',
    priority: 'normal',
    startDate, // sprint start (a Monday) — keeps the welcome task inside the sprint
    dueDate: null,
    estimate: null,
    createdAt: Date.now(),
    dependsOn: [],
  })
}
