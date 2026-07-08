import type {
  ActivityEvent,
  Collection,
  DayOff,
  Member,
  Person,
  Project,
  Sprint,
  Task,
} from './types'
import { db, uid, colorForName, nextSequence } from './schema'
import { buildPersonBackfill, normalizePersonName } from './people'
import { defaultSprintDates, todayLocalISO } from './lib'
import { remapBundle, type ProjectBundle } from './project-io'

export interface ExportPayload {
  version: 1 | 2 | 3 | 4 | 5
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
  /**
   * v5 carries People (cross-project identity). Without it a restore rebuilds
   * people from member names, silently undoing merges, renames and colors.
   */
  people?: Person[]
}

export async function exportAll(): Promise<ExportPayload> {
  const [projects, members, sprints, collections, tasks, events, people] =
    await Promise.all([
      db.projects.toArray(),
      db.members.toArray(),
      db.sprints.toArray(),
      db.collections.toArray(),
      db.tasks.toArray(),
      db.events.toArray(),
      db.people.toArray(),
    ])
  return {
    version: 5,
    exportedAt: new Date().toISOString(),
    projects,
    members,
    sprints,
    collections,
    tasks,
    events,
    people,
  }
}

export async function importAll(data: ExportPayload) {
  if (!data || ![1, 2, 3, 4, 5].includes(data.version)) {
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
    (data.events !== undefined && !Array.isArray(data.events)) ||
    (data.people !== undefined && !Array.isArray(data.people))
  ) {
    throw new Error('Not a valid plan-up backup')
  }
  try {
   await db.transaction(
    'rw',
    [db.projects, db.members, db.sprints, db.collections, db.tasks, db.events, db.people],
    async () => {
      await db.events.clear()
      await db.tasks.clear()
      await db.sprints.clear()
      await db.members.clear()
      await db.collections.clear()
      await db.projects.clear()
      await db.people.clear()
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
      if (data.version >= 5 && Array.isArray(data.people)) {
        // v5+: People travel with the backup — restore them verbatim so
        // merges, renames and colors survive the round-trip. Members keep
        // their personId links; a dangling link (hand-edited/truncated file)
        // re-links by normalized name or gets a fresh person, so every
        // member ends up linked either way.
        const people = [...data.people]
        const validIds = new Set(people.map((p) => p.id))
        const idByName = new Map(
          people.map((p) => [normalizePersonName(p.name), p.id])
        )
        for (const m of members) {
          if (m.personId && validIds.has(m.personId)) continue
          const key = normalizePersonName(m.name)
          let pid = idByName.get(key)
          if (!pid) {
            pid = uid()
            idByName.set(key, pid)
            validIds.add(pid)
            people.push({
              id: pid,
              name: m.name.trim(),
              color: m.color || colorForName(m.name),
              createdAt: Date.now(),
            })
          }
          m.personId = pid
        }
        if (people.length) await db.people.bulkAdd(people)
      } else {
        // Pre-v5 payloads carry no People — rebuild them from the imported
        // members (any personId in the payload references the source DB and
        // is meaningless here), grouped by normalized name so a person
        // recurring across projects re-unifies.
        const { people, links } = buildPersonBackfill(members, uid, colorForName, Date.now())
        const personByMember = new Map(links.map((l) => [l.memberId, l.personId]))
        for (const m of members) m.personId = personByMember.get(m.id)
        if (people.length) await db.people.bulkAdd(people)
      }
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
      [db.projects, db.members, db.sprints, db.collections, db.tasks, db.events, db.people],
      async () => {
        await db.projects.add(remapped.project)
        // Link each imported member to a Person in THIS db by normalized name
        // (reuse an existing same-name person, else create) — the bundle's
        // personId references the source DB. Read existing people ONCE and build
        // a name→id map, rather than re-scanning the table per member (O(n²)).
        // New names dedupe within the bundle too. See design-docs/home-dashboard.md.
        const byName = new Map<string, string>()
        for (const pp of await db.people.toArray()) byName.set(normalizePersonName(pp.name), pp.id)
        const newPeople: Person[] = []
        for (const m of remapped.members) {
          const key = normalizePersonName(m.name)
          let pid = byName.get(key)
          if (!pid) {
            pid = uid()
            byName.set(key, pid)
            newPeople.push({ id: pid, name: m.name.trim(), color: colorForName(m.name), createdAt: Date.now() })
          }
          m.personId = pid
        }
        if (newPeople.length) await db.people.bulkAdd(newPeople)
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
// Resolves `true` when this boot actually seeded demo data into an empty DB —
// the app surfaces that as a "fresh start" notice instead of seeding silently
// (an empty DB on a known-good browser usually means a different origin, e.g.
// a Vercel preview URL — see design-docs/persistence-and-backup.md).
let seedPromise: Promise<boolean> | null = null
export function seedIfEmpty(): Promise<boolean> {
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
  return db.transaction('rw', db.sprints, db.tasks, db.events, async () => {
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
        // The dup's activity rows would reference a deleted sprintId forever —
        // no view loads them and exports would ship the orphans. Drop them.
        await db.events.where('sprintId').equals(dup.id).delete()
        await db.sprints.delete(dup.id)
        removed++
      }
    }
    return removed
  })
}

async function doSeed(): Promise<boolean> {
  return db.transaction(
    'rw',
    [db.projects, db.members, db.sprints, db.tasks, db.people],
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
      if (memberCount > 0) return false
      await seedFresh(project.id)
      return true
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
  // Link each seeded member to a fresh Person (one per distinct name).
  const { people, links } = buildPersonBackfill(members, uid, colorForName, Date.now())
  const personByMember = new Map(links.map((l) => [l.memberId, l.personId]))
  for (const m of members) m.personId = personByMember.get(m.id)
  if (people.length) await db.people.bulkAdd(people)
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
