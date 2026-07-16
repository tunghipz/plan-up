import Dexie, { type Table } from 'dexie'
import type {
  ActivityEvent,
  AiMessage,
  AiThread,
  Collection,
  DayOff,
  Member,
  Person,
  Project,
  ShareRecord,
  Sprint,
  Task,
} from './types'
import { buildPersonBackfill } from './people'

export class PlanDB extends Dexie {
  projects!: Table<Project, string>
  members!: Table<Member, string>
  sprints!: Table<Sprint, string>
  tasks!: Table<Task, string>
  collections!: Table<Collection, string>
  events!: Table<ActivityEvent, string>
  people!: Table<Person, string>
  shares!: Table<ShareRecord, string>
  aiThreads!: Table<AiThread, string>
  aiMessages!: Table<AiMessage, string>

  constructor(name = 'plan-up') {
    super(name)
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
    // v13 (2026-06-20): cross-project People (design-docs/home-dashboard.md).
    // New `people` table; members gain indexed `personId`. Re-declare the full
    // members index (append personId — keep projectId/name) and carry forward
    // every other table from v10. Backfill groups existing members by normalized
    // name across ALL projects into one person each (buildPersonBackfill, the
    // unit-tested pure fn) and links them — all within this version's upgrade tx
    // (the people store is created before the upgrade runs).
    this.version(13)
      .stores({
        projects: 'id, name, createdAt',
        members: 'id, name, projectId, personId',
        sprints: 'id, startDate, projectId',
        collections: 'id, projectId, order',
        tasks: 'id, sprintId, assigneeId, status, createdAt, projectId, collectionId',
        events: 'id, sprintId, ts, projectId',
        people: 'id, name',
      })
      .upgrade(async (tx) => {
        const members = await tx.table<Member>('members').toArray()
        const { people, links } = buildPersonBackfill(
          members,
          uid,
          colorForName,
          Date.now()
        )
        if (people.length) await tx.table<Person>('people').bulkAdd(people)
        for (const { memberId, personId } of links) {
          await tx.table('members').update(memberId, { personId })
        }
      })
    // v14 (2026-07-15): hosted share links (design-docs/hosted-share-link.md).
    // New `shares` table mapping a sprint/collection to its short `/view/<id>`
    // link + the local-only write token. No backfill — nobody has a share yet.
    // Carry forward every v13 table (only `shares` is added). `refId` is indexed
    // (per-ref: sprintId/collectionId; project-scope sprint link: projectId) and
    // `projectId` for project-scoped lookups (getProjectShare) + wipes.
    this.version(14).stores({
      projects: 'id, name, createdAt',
      members: 'id, name, projectId, personId',
      sprints: 'id, startDate, projectId',
      collections: 'id, projectId, order',
      tasks: 'id, sprintId, assigneeId, status, createdAt, projectId, collectionId',
      events: 'id, sprintId, ts, projectId',
      people: 'id, name',
      shares: 'id, refId, projectId',
    })
    // v15: adopt legacy per-ref sprint shares into the project-scope model (Hướng A).
    // Before this, a sprint link was keyed by refId=sprintId with no `scope`. The Share
    // modal now looks sprint links up by project (getProjectShare), so a legacy row would
    // be invisible — the user would create a duplicate link and the old public link would
    // be unrevocable from the UI. Rewrite each legacy sprint share so refId=projectId,
    // scope='project', currentRefId=<old sprintId>. Collections stay per-ref (skipped).
    // Same store shape — no index change; the upgrade only mutates rows.
    this.version(15)
      .stores({
        projects: 'id, name, createdAt',
        members: 'id, name, projectId, personId',
        sprints: 'id, startDate, projectId',
        collections: 'id, projectId, order',
        tasks: 'id, sprintId, assigneeId, status, createdAt, projectId, collectionId',
        events: 'id, sprintId, ts, projectId',
        people: 'id, name',
        shares: 'id, refId, projectId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('shares')
          .toCollection()
          .modify((s) => {
            if (s.kind === 'sprint' && !s.scope) {
              s.scope = 'project'
              s.currentRefId = s.refId // capture the old sprintId BEFORE overwriting refId
              s.refId = s.projectId
            }
          })
      })
    // v16 (2026-07-16): per-project AI Chat history, merged after hosted share
    // links. Threads/messages are project-scoped and intentionally independent
    // from hosted shares.
    this.version(16).stores({
      projects: 'id, name, createdAt',
      members: 'id, name, projectId, personId',
      sprints: 'id, startDate, projectId',
      collections: 'id, projectId, order',
      tasks: 'id, sprintId, assigneeId, status, createdAt, projectId, collectionId',
      events: 'id, sprintId, ts, projectId',
      people: 'id, name',
      shares: 'id, refId, projectId',
      aiThreads: 'id, projectId, updatedAt',
      aiMessages: 'id, threadId, projectId, ts',
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

/** Next sequence number within a sprint. Sequences are never reused. */
export async function nextSequence(sprintId: string): Promise<number> {
  const all = await db.tasks.where('sprintId').equals(sprintId).toArray()
  let max = 0
  for (const t of all) if ((t.sequence ?? 0) > max) max = t.sequence ?? 0
  return max + 1
}
