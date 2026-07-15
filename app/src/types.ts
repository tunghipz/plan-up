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
 * One row in the append-only sprint activity store (capped per sprint at
 * MAX_EVENTS_PER_SPRINT — older rows pruned on write) — the app's sole
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
  /**
   * Optional emoji shown on the icon-rail tile instead of the name's first
   * letter. When unset, the UI falls back to the first letter. One grapheme,
   * non-indexed → no Dexie version bump (see project-icon-emoji.md).
   */
  icon?: string
}

/**
 * A real person, shared across projects. A `Member` is one project's membership
 * for a person (`Member.personId` → `Person.id`); the same human appearing in
 * several projects is several members but ONE person. Identity only — days-off
 * and assignment stay on `Member`, so the scheduler is untouched.
 * See design-docs/home-dashboard.md.
 */
export interface Person {
  id: string
  name: string
  color: string
  createdAt: number
}

export interface Member {
  id: string
  projectId: string
  name: string
  color: string
  /**
   * Links this membership to a global {@link Person}. Backfilled in v13 (group
   * members by normalized name across all projects → one person each); set on
   * every new member via `addMember` / import. Indexed so a person's members
   * are queryable. See design-docs/home-dashboard.md.
   */
  personId?: string
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

/**
 * Local record of a hosted share link (Dexie `shares`, v14). Maps a sprint /
 * collection to its short `/view/<slug>-<id>` link so the Share button knows it's
 * already shared and can Update/Revoke it. The `writeToken` is a secret that
 * authorizes writes to the store — it lives ONLY on this machine (and travels in
 * the full backup) and is never sent to a viewer. See design-docs/hosted-share-link.md.
 */
export interface ShareRecord {
  /** The store key = the `<id>` suffix of the /view URL. */
  id: string
  /** The shared sprintId or collectionId (indexed → "is this plan shared?"). */
  refId: string
  kind: 'sprint' | 'collection'
  /** Cosmetic slug at share time (URL prefix); rebuilt on Update after a rename. */
  slug: string
  /** Write-capability token for PUT/DELETE. Secret — local only. */
  writeToken: string
  /** The full shareable URL last shown/copied. */
  url: string
  createdAt: number
  updatedAt: number
  projectId: string
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
