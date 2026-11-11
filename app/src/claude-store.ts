// Where the Claude assistant's conversations live between app launches
// (design-docs/claude-assistant.md, Data). A database of its own, apart from the plan
// database: chats stay out of backup/export/share, and the main schema is not bumped.

import Dexie, { type Table } from 'dexie'

export interface StoredChat {
  projectId: string
  /** Turns as claude-chat.ts prepared them (`toStoredTurns`). */
  turns: unknown[]
  updatedAt: number
}

class ClaudeDB extends Dexie {
  chats!: Table<StoredChat, string>
  constructor() {
    super('plan-up-claude')
    this.version(1).stores({ chats: 'projectId' })
  }
}

export const claudeDb = new ClaudeDB()

export async function loadStoredChat(projectId: string): Promise<unknown[] | null> {
  const row = await claudeDb.chats.get(projectId)
  return Array.isArray(row?.turns) ? row.turns : null
}

/** An empty chat is stored as no row. */
export async function saveStoredChat(projectId: string, turns: unknown[]): Promise<void> {
  if (turns.length === 0) await claudeDb.chats.delete(projectId)
  else await claudeDb.chats.put({ projectId, turns, updatedAt: Date.now() })
}

export async function deleteStoredChat(projectId: string): Promise<void> {
  await claudeDb.chats.delete(projectId)
}
