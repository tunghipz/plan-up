import { describe, expect, it } from 'vitest'
import type { ExportPayload } from './db'
import {
  chooseServerSnapshotAction,
  snapshotHasUserData,
  snapshotSignature,
} from './server-sync'

function payload(tasks: string[] = []): ExportPayload {
  return {
    version: 7,
    exportedAt: new Date().toISOString(),
    projects: [],
    members: [],
    sprints: [],
    collections: [],
    tasks: tasks.map((id, i) => ({
      id,
      projectId: 'p1',
      sprintId: 's1',
      collectionId: null,
      sectionId: null,
      title: `Task ${i + 1}`,
      assigneeId: null,
      status: 'todo',
      priority: 'normal',
      estimate: null,
      startDate: null,
      dueDate: null,
      dependsOn: [],
      sequence: i + 1,
      listOrder: i + 1,
      parentId: null,
      createdAt: 1_784_246_400_000,
    })),
    events: [],
    people: [],
    shares: [],
    aiThreads: [],
    aiMessages: [],
  }
}

describe('server snapshot sync policy', () => {
  it('ignores exportedAt when signing a snapshot', () => {
    const a = payload(['t1'])
    const b = { ...a, exportedAt: '2099-01-01T00:00:00.000Z' }

    expect(snapshotSignature(a)).toBe(snapshotSignature(b))
  })

  it('imports server when local cache is empty', () => {
    expect(
      chooseServerSnapshotAction({
        local: payload(),
        server: payload(['server-task']),
        lastAcceptedSignature: null,
      })
    ).toBe('import-server')
  })

  it('imports server when local still matches the last accepted server snapshot', () => {
    const local = payload(['old'])

    expect(
      chooseServerSnapshotAction({
        local,
        server: payload(['old', 'external']),
        lastAcceptedSignature: snapshotSignature(local),
      })
    ).toBe('import-server')
  })

  it('keeps local when it has unsynced edits', () => {
    const lastSynced = payload(['old'])

    expect(
      chooseServerSnapshotAction({
        local: payload(['old', 'local-edit']),
        server: lastSynced,
        lastAcceptedSignature: snapshotSignature(lastSynced),
      })
    ).toBe('keep-local')
  })

  it('keeps local on unknown first sync when local already has user data', () => {
    expect(
      chooseServerSnapshotAction({
        local: payload(['local-only']),
        server: payload(['server-only']),
        lastAcceptedSignature: null,
      })
    ).toBe('keep-local')
  })

  it('detects meaningful user data', () => {
    expect(snapshotHasUserData(payload())).toBe(false)
    expect(snapshotHasUserData(payload(['t1']))).toBe(true)
  })
})
