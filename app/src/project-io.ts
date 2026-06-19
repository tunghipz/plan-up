import type {
  Project,
  Member,
  Sprint,
  Collection,
  Task,
  ActivityEvent,
} from './db'

/**
 * Self-describing, single-project export payload — the "share one project"
 * counterpart to the full-DB `ExportPayload` (db.ts). It carries exactly ONE
 * `project` (not `projects?: Project[]`) plus that project's rows from the other
 * five tables. The `kind: 'project'` + `version: 5` discriminator lets the single
 * Import entry point tell it apart from a legacy full backup (v1–4) and route it
 * to the non-destructive "add as new project" path instead of replace-all.
 *
 * See design-docs/project-export-import.md.
 */
export interface ProjectBundle {
  version: 5
  kind: 'project'
  exportedAt: string
  project: Project
  members: Member[]
  sprints: Sprint[]
  collections: Collection[]
  tasks: Task[]
  events: ActivityEvent[]
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

/**
 * Cheap "does this file CLAIM to be a single project?" check — true whenever
 * `kind === 'project'`, regardless of whether the rest of the payload is valid.
 * The import entry point uses this to commit a file to the project path FIRST,
 * so a damaged/truncated project file is reported as corrupt rather than falling
 * through to the destructive full-backup replace-all prompt. Pair with
 * `isProjectBundle` (the full shape check) to tell "claims project" from
 * "is a valid project". See design-docs/project-export-import.md.
 */
export function looksLikeProjectBundle(data: unknown): boolean {
  return isObj(data) && data.kind === 'project'
}

/**
 * Type guard / validation for the single import entry point. Reject-whole-file:
 * a `version: 5` payload must have `kind: 'project'`, an object `project`, and all
 * five arrays present and well-shaped. A single missing/wrong-typed field rejects
 * the file (mirrors `importAll`'s pre-clear guard) — nothing is imported on a bad
 * file rather than a partial, corrupt project.
 */
export function isProjectBundle(data: unknown): data is ProjectBundle {
  if (!isObj(data)) return false
  if (data.kind !== 'project' || data.version !== 5) return false
  if (!isObj(data.project)) return false
  return (
    Array.isArray(data.members) &&
    Array.isArray(data.sprints) &&
    Array.isArray(data.collections) &&
    Array.isArray(data.tasks) &&
    Array.isArray(data.events)
  )
}

/**
 * PURE (no Dexie). Returns a deep copy of `bundle` with every id regenerated via
 * `newId`, so the imported project lands as a brand-new project that cannot
 * collide with anything in the target DB, and the same file can be imported
 * repeatedly (each import = a fresh, independent copy).
 *
 * `Task.sequence` is NOT an id — it is the user-facing per-sprint prereq number
 * and is preserved verbatim; the next task created afterwards self-corrects via
 * `nextSequence` (max+1). Dangling references (to entities outside the bundle)
 * are dropped: unresolved `dependsOn`/`parentId`/`sectionId`/`collectionStatusId`
 * are filtered/nulled, and a task-level event whose `taskId` doesn't resolve is
 * dropped whole (a sprint-level event with `taskId: null` is kept).
 *
 * See design-docs/project-export-import.md for the full remap table.
 */
export function remapBundle(
  bundle: ProjectBundle,
  newId: () => string
): ProjectBundle {
  const projectId = newId()

  // id → new id maps, built up-front so references can resolve in any order.
  const memberMap = new Map<string, string>()
  const sprintMap = new Map<string, string>()
  const collectionMap = new Map<string, string>()
  const taskMap = new Map<string, string>()
  // section/status ids are nested per-collection but globally unique in app data,
  // so a single flat map per kind is enough.
  const sectionMap = new Map<string, string>()
  const statusMap = new Map<string, string>()

  for (const m of bundle.members) memberMap.set(m.id, newId())
  for (const s of bundle.sprints) sprintMap.set(s.id, newId())
  for (const c of bundle.collections) {
    collectionMap.set(c.id, newId())
    for (const sec of c.sections) sectionMap.set(sec.id, newId())
    for (const st of c.statuses) statusMap.set(st.id, newId())
  }
  for (const t of bundle.tasks) taskMap.set(t.id, newId())

  const project: Project = { ...bundle.project, id: projectId }

  const members: Member[] = bundle.members.map((m) => ({
    ...m,
    id: memberMap.get(m.id)!,
    projectId,
  }))

  const sprints: Sprint[] = bundle.sprints.map((s) => ({
    ...s,
    id: sprintMap.get(s.id)!,
    projectId,
  }))

  const collections: Collection[] = bundle.collections.map((c) => ({
    ...c,
    id: collectionMap.get(c.id)!,
    projectId,
    sections: c.sections.map((sec) => ({ ...sec, id: sectionMap.get(sec.id)! })),
    statuses: c.statuses.map((st) => ({ ...st, id: statusMap.get(st.id)! })),
  }))

  const tasks: Task[] = bundle.tasks.map((t) => {
    const remapped: Task = {
      ...t,
      id: taskMap.get(t.id)!,
      projectId,
      sprintId: t.sprintId != null ? (sprintMap.get(t.sprintId) ?? null) : null,
      assigneeId:
        t.assigneeId != null ? (memberMap.get(t.assigneeId) ?? null) : null,
      // dangling refs are dropped — they can't resolve in the new id space
      dependsOn: (t.dependsOn ?? [])
        .map((d) => taskMap.get(d))
        .filter((d): d is string => d != null),
    }
    if (t.collectionId !== undefined) {
      remapped.collectionId =
        t.collectionId != null ? (collectionMap.get(t.collectionId) ?? null) : null
    }
    if (t.sectionId !== undefined) {
      remapped.sectionId =
        t.sectionId != null ? (sectionMap.get(t.sectionId) ?? null) : null
    }
    if (t.collectionStatusId !== undefined) {
      remapped.collectionStatusId =
        t.collectionStatusId != null
          ? (statusMap.get(t.collectionStatusId) ?? null)
          : null
    }
    if (t.parentId !== undefined) {
      remapped.parentId =
        t.parentId != null ? (taskMap.get(t.parentId) ?? null) : null
    }
    return remapped
  })

  const events: ActivityEvent[] = []
  for (const e of bundle.events) {
    let taskId: string | null
    if (e.taskId == null) {
      // sprint-level event (e.g. sprint_started) — keep, no task to resolve
      taskId = null
    } else {
      const mapped = taskMap.get(e.taskId)
      // task-level event whose task isn't in the bundle is meaningless → drop
      if (mapped == null) continue
      taskId = mapped
    }
    events.push({
      ...e,
      id: newId(),
      projectId,
      sprintId: sprintMap.get(e.sprintId) ?? e.sprintId,
      taskId,
      // taskSeq/taskTitle are frozen display snapshots — left verbatim
    })
  }

  return {
    version: 5,
    kind: 'project',
    exportedAt: bundle.exportedAt,
    project,
    members,
    sprints,
    collections,
    tasks,
    events,
  }
}
