import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  db,
  uid,
  colorForName,
  addMember,
  mergePeople,
  renamePerson,
  recolorPerson,
} from './db'
import { buildPersonBackfill } from './people'

// Cross-project People write paths against a real (fake) IndexedDB.
// See design-docs/home-dashboard.md.

beforeEach(async () => {
  await db.transaction('rw', db.members, db.people, async () => {
    await db.members.clear()
    await db.people.clear()
  })
})

describe('addMember', () => {
  it('creates a member linked to a fresh person', async () => {
    const m = await addMember('pA', 'Tùng')
    expect(m.personId).toBeTruthy()
    const people = await db.people.toArray()
    expect(people).toHaveLength(1)
    expect(people[0].id).toBe(m.personId)
    expect(people[0].name).toBe('Tùng')
  })

  it('links the same human across projects to ONE person (dedup by normalized name)', async () => {
    const a = await addMember('pA', 'Tùng')
    const b = await addMember('pB', ' tùng ') // different project, name variant
    expect(b.personId).toBe(a.personId)
    expect(await db.people.count()).toBe(1)
    const linked = await db.members.where('personId').equals(a.personId!).toArray()
    expect(linked.map((m) => m.projectId).sort()).toEqual(['pA', 'pB'])
  })

  it('gives distinct names distinct people', async () => {
    const a = await addMember('pA', 'Tùng')
    const b = await addMember('pA', 'Linh')
    expect(b.personId).not.toBe(a.personId)
    expect(await db.people.count()).toBe(2)
  })
})

describe('mergePeople', () => {
  it('reassigns src members to dst and deletes the src person', async () => {
    const a = await addMember('pA', 'Tung') // typo variant — own person
    const b = await addMember('pB', 'Tùng') // the "real" person
    expect(a.personId).not.toBe(b.personId)

    await mergePeople(a.personId!, b.personId!)

    expect(await db.people.get(a.personId!)).toBeUndefined()
    const survivors = await db.members.where('personId').equals(b.personId!).toArray()
    expect(survivors.map((m) => m.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('is a no-op when src === dst', async () => {
    const a = await addMember('pA', 'Tùng')
    await mergePeople(a.personId!, a.personId!)
    expect(await db.people.count()).toBe(1)
  })
})

// Reproduces the production v13 upgrade pattern (tx-scoped read →
// buildPersonBackfill → bulkAdd people → link members) on a real Dexie
// version bump, which a fresh-DB open never exercises. This is the migration
// risk the spec flagged. See design-docs/home-dashboard.md.
describe('v13-style migration backfill', () => {
  it('groups existing members by name across projects and links them', async () => {
    const NAME = 'mig-test-' + uid()
    const old = new Dexie(NAME)
    old.version(1).stores({ members: 'id, name, projectId' })
    await old.open()
    await old.table('members').bulkAdd([
      { id: 'm1', projectId: 'pA', name: 'Tùng', color: '#aaa', daysOff: [] },
      { id: 'm2', projectId: 'pB', name: 'tùng', color: '#bbb', daysOff: [] },
      { id: 'm3', projectId: 'pA', name: 'Linh', color: '#ccc', daysOff: [] },
    ])
    old.close()

    const up = new Dexie(NAME)
    up.version(1).stores({ members: 'id, name, projectId' })
    up
      .version(2)
      .stores({ members: 'id, name, projectId, personId', people: 'id, name' })
      .upgrade(async (tx) => {
        const members = await tx.table('members').toArray()
        const { people, links } = buildPersonBackfill(members, uid, colorForName, Date.now())
        if (people.length) await tx.table('people').bulkAdd(people)
        for (const { memberId, personId } of links) {
          await tx.table('members').update(memberId, { personId })
        }
      })
    await up.open()

    const people = await up.table('people').toArray()
    expect(people).toHaveLength(2) // Tùng (m1+m2) + Linh
    const m1 = await up.table('members').get('m1')
    const m2 = await up.table('members').get('m2')
    const m3 = await up.table('members').get('m3')
    expect(m1.personId).toBeTruthy()
    expect(m1.personId).toBe(m2.personId) // same human across projects → one person
    expect(m3.personId).not.toBe(m1.personId)
    up.close()
  })
})

describe('renamePerson / recolorPerson', () => {
  it('renames and recolors without touching member.name', async () => {
    const m = await addMember('pA', 'Tung')
    await renamePerson(m.personId!, 'Tùng Đỗ')
    await recolorPerson(m.personId!, '#0071E3')
    const p = await db.people.get(m.personId!)
    expect(p?.name).toBe('Tùng Đỗ')
    expect(p?.color).toBe('#0071E3')
    // the project membership name is unchanged (identity is separate)
    expect((await db.members.get(m.id))?.name).toBe('Tung')
  })

  it('ignores an empty rename', async () => {
    const m = await addMember('pA', 'Tùng')
    await renamePerson(m.personId!, '   ')
    expect((await db.people.get(m.personId!))?.name).toBe('Tùng')
  })
})
