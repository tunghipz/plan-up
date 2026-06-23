import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, exportAll, importAll } from './db'

const P = 'project-ai'

beforeEach(async () => {
  await db.transaction(
    'rw',
    [db.projects, db.aiThreads, db.aiMessages],
    async () => {
      await db.aiMessages.clear()
      await db.aiThreads.clear()
      await db.projects.clear()
      await db.projects.add({ id: P, name: 'AI Project', createdAt: 1 })
    }
  )
})

describe('AI chat history persistence', () => {
  it('round-trips threads and messages through full backup', async () => {
    await db.aiThreads.add({
      id: 'thread-1',
      projectId: P,
      title: 'Risk review',
      createdAt: 2,
      updatedAt: 3,
      skillId: 'project-management',
    })
    await db.aiMessages.add({
      id: 'msg-1',
      projectId: P,
      threadId: 'thread-1',
      role: 'user',
      content: 'Review this sprint',
      ts: 3,
    })

    const payload = await exportAll()
    expect(payload.version).toBe(5)
    expect(payload.aiThreads).toHaveLength(1)
    expect(payload.aiMessages).toHaveLength(1)

    await db.aiMessages.clear()
    await db.aiThreads.clear()
    await importAll(payload)

    expect(await db.aiThreads.count()).toBe(1)
    expect(await db.aiMessages.count()).toBe(1)
    expect((await db.aiMessages.toArray())[0]?.threadId).toBe('thread-1')
  })
})
