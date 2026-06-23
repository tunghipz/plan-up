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

export type CreateMemberAction = {
  type: 'create_member'
  name: string
  title?: string | null
}

export type AiAction =
  | CreateTaskAction
  | CreateMilestoneAction
  | UpdateTaskAction
  | CreateMemberAction

export type AiAssistantProposal = {
  reply: string
  actions: AiAction[]
}

export type AiActionResult = {
  ok: boolean
  label: string
  detail?: string
}
