import type {
  Collection,
  Member,
  Priority,
  Project,
  Sprint,
  Status,
  Task,
} from '../db'

export type AiProviderMode = 'openai_login' | 'deepseek' | 'proxy'

export type AiChatSettings = {
  provider: AiProviderMode
  model: string
  apiKey: string
  proxyUrl: string
  authUrl: string
  sessionUrl: string
  logoutUrl: string
  temperature: number
}

export type AiChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
}

export type AiContainerKind = 'sprint' | 'collection'

export type AiRuntimeContext = {
  today: string
  screen: 'home' | 'project'
  containerKind: AiContainerKind
  view: string
  project: Project | null
  sprint: Sprint | null
  collection: Collection | null
  collections: Collection[]
  collectionItemCounts?: Record<string, number>
  sprints: Sprint[]
  members: Member[]
  tasks: Task[]
}

export type CreateTaskAction = {
  type: 'create_task'
  title: string
  assigneeName?: string | null
  status?: Status
  priority?: Priority
  estimate?: number | null
  startDate?: string | null
  dueDate?: string | null
}

export type CreateMilestoneAction = {
  type: 'create_milestone'
  title: string
  date?: string | null
  assigneeName?: string | null
  priority?: Priority
}

export type UpdateMilestoneAction = {
  type: 'update_milestone'
  taskSeq?: number | null
  taskTitle?: string | null
  title?: string
  date?: string | null
  assigneeName?: string | null
  priority?: Priority
}

export type DeleteMilestoneAction = {
  type: 'delete_milestone'
  taskSeq?: number | null
  taskTitle?: string | null
}

export type UpdateTaskAction = {
  type: 'update_task'
  taskSeq?: number | null
  taskTitle?: string | null
  title?: string
  assigneeName?: string | null
  status?: Status
  priority?: Priority
  estimate?: number | null
  startDate?: string | null
  dueDate?: string | null
}

export type DeleteTaskAction = {
  type: 'delete_task'
  taskSeq?: number | null
  taskTitle?: string | null
}

export type MoveTaskToNextSprintAction = {
  type: 'move_task_to_next_sprint'
  taskSeq?: number | null
  taskTitle?: string | null
}

export type MoveTaskToSprintAction = {
  type: 'move_task_to_sprint'
  taskSeq?: number | null
  taskTitle?: string | null
  sprintId?: string | null
  sprintName?: string | null
}

export type MoveTaskToCollectionAction = {
  type: 'move_task_to_collection'
  taskSeq?: number | null
  taskTitle?: string | null
  collectionId?: string | null
  collectionName?: string | null
}

export type CreateSprintAction = {
  type: 'create_sprint'
  startDate?: string | null
  note?: string | null
}

export type UpdateSprintAction = {
  type: 'update_sprint'
  startDate?: string | null
  note?: string | null
}

export type AddSprintNoteAction = {
  type: 'add_sprint_note'
  note: string
}

export type DeleteSprintAction = {
  type: 'delete_sprint'
}

export type CreateCollectionAction = {
  type: 'create_collection'
  name: string
}

export type UpdateCollectionAction = {
  type: 'update_collection'
  collectionId?: string | null
  collectionName?: string | null
  name: string
}

export type DeleteCollectionAction = {
  type: 'delete_collection'
  collectionId?: string | null
  collectionName?: string | null
}

export type CreateMemberAction = {
  type: 'create_member'
  name: string
  title?: string | null
}

export type UpdateMemberAction = {
  type: 'update_member'
  memberName: string
  name?: string
  title?: string | null
}

export type DeleteMemberAction = {
  type: 'delete_member'
  memberName: string
}

export type SetMemberDayOffAction = {
  type: 'set_member_day_off'
  memberName: string
  date: string
  halfDay?: 'all' | 'am' | 'pm'
}

export type RemoveMemberDayOffAction = {
  type: 'remove_member_day_off'
  memberName: string
  date: string
}

export type AiAction =
  | CreateTaskAction
  | CreateMilestoneAction
  | UpdateMilestoneAction
  | DeleteMilestoneAction
  | UpdateTaskAction
  | DeleteTaskAction
  | MoveTaskToNextSprintAction
  | MoveTaskToSprintAction
  | MoveTaskToCollectionAction
  | CreateSprintAction
  | UpdateSprintAction
  | AddSprintNoteAction
  | DeleteSprintAction
  | CreateCollectionAction
  | UpdateCollectionAction
  | DeleteCollectionAction
  | CreateMemberAction
  | UpdateMemberAction
  | DeleteMemberAction
  | SetMemberDayOffAction
  | RemoveMemberDayOffAction

export type AiAssistantProposal = {
  reply: string
  actions: AiAction[]
}

export type AiActionResult = {
  ok: boolean
  label: string
  detail?: string
}
