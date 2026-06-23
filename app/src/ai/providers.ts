import { buildAiContext, aiSystemPrompt } from './context'
import { normalizeAiActions } from './actions'
import type {
  AiAssistantProposal,
  AiChatMessage,
  AiChatSettings,
  AiRuntimeContext,
} from './types'

const SETTINGS_KEY = 'plan-up:ai-chat-settings'

export const DEFAULT_AI_SETTINGS: AiChatSettings = {
  provider: 'openai_login',
  model: 'gpt-5.2',
  apiKey: '',
  proxyUrl: '/api/ai/chat',
  authUrl: '/api/auth/openai/start',
  sessionUrl: '/api/auth/session',
  logoutUrl: '/api/auth/logout',
  temperature: 0.2,
}

function normalizeProvider(provider: unknown): AiChatSettings['provider'] {
  if (provider === 'openai') return 'openai_login'
  if (provider === 'openai_login' || provider === 'deepseek' || provider === 'proxy') {
    return provider
  }
  return DEFAULT_AI_SETTINGS.provider
}

function normalizeModel(model: unknown, provider: AiChatSettings['provider']) {
  if (typeof model !== 'string' || !model.trim()) return DEFAULT_AI_SETTINGS.model
  const trimmed = model.trim()
  if (provider === 'openai_login' && trimmed === 'gpt-5.5') return DEFAULT_AI_SETTINGS.model
  return trimmed
}

export function loadAiSettings(): AiChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_AI_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AiChatSettings>
    const provider = normalizeProvider(parsed.provider)
    return {
      provider,
      model: normalizeModel(parsed.model, provider),
      apiKey: provider === 'deepseek' && typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      proxyUrl:
        typeof parsed.proxyUrl === 'string' && parsed.proxyUrl.trim()
          ? parsed.proxyUrl
          : DEFAULT_AI_SETTINGS.proxyUrl,
      authUrl:
        typeof parsed.authUrl === 'string' && parsed.authUrl.trim()
          ? parsed.authUrl
          : DEFAULT_AI_SETTINGS.authUrl,
      sessionUrl:
        typeof parsed.sessionUrl === 'string' && parsed.sessionUrl.trim()
          ? parsed.sessionUrl
          : DEFAULT_AI_SETTINGS.sessionUrl,
      logoutUrl:
        typeof parsed.logoutUrl === 'string' && parsed.logoutUrl.trim()
          ? parsed.logoutUrl
          : DEFAULT_AI_SETTINGS.logoutUrl,
      temperature:
        typeof parsed.temperature === 'number' && Number.isFinite(parsed.temperature)
          ? parsed.temperature
          : DEFAULT_AI_SETTINGS.temperature,
    }
  } catch {
    return DEFAULT_AI_SETTINGS
  }
}

export function saveAiSettings(settings: AiChatSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

function endpointFor(settings: AiChatSettings): string {
  if (settings.provider === 'openai_login' || settings.provider === 'proxy') {
    return settings.proxyUrl
  }
  return 'https://api.deepseek.com/chat/completions'
}

function extractJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    return JSON.parse(match[0])
  }
}

function proposalFromUnknown(value: unknown): AiAssistantProposal {
  if (typeof value !== 'object' || value === null) {
    return { reply: 'I could not parse the assistant response.', actions: [] }
  }
  const record = value as Record<string, unknown>
  const choices = Array.isArray(record.choices) ? record.choices : []
  const first = choices[0] as Record<string, unknown> | undefined
  const message = first?.message as Record<string, unknown> | undefined
  const content = typeof message?.content === 'string' ? message.content : ''
  if (content.trim()) {
    const json = extractJson(content)
    if (json) return proposalFromUnknown(json)
    return { reply: content.trim(), actions: [] }
  }
  return {
    reply:
      typeof record.reply === 'string' && record.reply.trim()
        ? record.reply.trim()
        : 'Done.',
    actions: normalizeAiActions(record.actions),
  }
}

export async function callAiProvider({
  settings,
  messages,
  context,
  projectManageSkill,
}: {
  settings: AiChatSettings
  messages: AiChatMessage[]
  context: AiRuntimeContext
  projectManageSkill?: string
}): Promise<AiAssistantProposal> {
  if (settings.provider === 'deepseek' && !settings.apiKey.trim()) {
    return localPlan(messages[messages.length - 1]?.content ?? '', context)
  }

  const system = `${aiSystemPrompt(projectManageSkill)}\n\nCurrent app context:\n${buildAiContext(context)}`
  const chatMessages = [
    { role: 'system', content: system },
    ...messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content })),
  ]

  const body =
    settings.provider === 'openai_login' || settings.provider === 'proxy'
      ? {
          provider: settings.provider,
          model: settings.model,
          messages: chatMessages,
          temperature: settings.temperature,
        }
      : {
          model: settings.model,
          messages: chatMessages,
          temperature: settings.temperature,
        }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.provider === 'deepseek') {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`
  }

  const res = await fetch(endpointFor(settings), {
    method: 'POST',
    headers,
    credentials: settings.provider === 'deepseek' ? 'same-origin' : 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI request failed (${res.status})${detail ? `: ${detail.slice(0, 240)}` : ''}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  if (settings.provider === 'openai_login' || settings.provider === 'proxy') {
    return proposalFromUnknown(data)
  }
  const choices = Array.isArray(data.choices) ? data.choices : []
  const first = choices[0] as Record<string, unknown> | undefined
  const message = first?.message as Record<string, unknown> | undefined
  const content = typeof message?.content === 'string' ? message.content : ''
  const json = extractJson(content)
  if (json) return proposalFromUnknown(json)
  return {
    reply: content.trim() || 'The model returned an empty response.',
    actions: [],
  }
}

function quotedTitle(text: string): string | null {
  const quoted = text.match(/["“”']([^"“”']{2,})["“”']/)
  if (quoted?.[1]) return quoted[1].trim()
  return null
}

function mentionedMemberName(text: string, context: AiRuntimeContext): string | null {
  const lower = text.toLowerCase()
  return (
    context.members.find((m) => lower.includes(m.name.toLowerCase()))?.name ??
    quotedTitle(text)
  )
}

function mentionedSprint(text: string, context: AiRuntimeContext): { id: string; name: string } | null {
  const lower = text.toLowerCase()
  return (
    context.sprints.find((s) => lower.includes(s.name.toLowerCase())) ??
    null
  )
}

function mentionedCollection(text: string, context: AiRuntimeContext): { id: string; name: string } | null {
  const lower = text.toLowerCase()
  return (
    context.collections.find((c) => lower.includes(c.name.toLowerCase())) ??
    null
  )
}

function localPlan(input: string, context: AiRuntimeContext): AiAssistantProposal {
  const text = input.trim()
  const lower = text.toLowerCase()
  const title = quotedTitle(text)
  if (/\b(member|thành viên|nguoi|người)\b/.test(lower) && /\b(add|create|thêm|tao|tạo)\b/.test(lower)) {
    const name = title ?? text.replace(/^(add|create|thêm|tao|tạo)\s+/i, '').replace(/\b(member|thành viên|người)\b/gi, '').trim()
    return name
      ? { reply: `Mình sẽ tạo member “${name}”.`, actions: [{ type: 'create_member', name }] }
      : { reply: 'Bạn muốn tạo member tên gì?', actions: [] }
  }
  if (/\b(milestone|mốc)\b/.test(lower) && /\b(add|create|thêm|tao|tạo)\b/.test(lower)) {
    const inferred = title ?? text.replace(/^(add|create|thêm|tao|tạo)\s+/i, '').replace(/\b(milestone|mốc)\b/gi, '').trim()
    return inferred
      ? { reply: `Mình sẽ tạo milestone “${inferred}”.`, actions: [{ type: 'create_milestone', title: inferred }] }
      : { reply: 'Bạn muốn tạo milestone tên gì?', actions: [] }
  }
  if (/\b(task|việc|todo)\b/.test(lower) && /\b(add|create|thêm|tao|tạo)\b/.test(lower)) {
    const inferred = title ?? text.replace(/^(add|create|thêm|tao|tạo)\s+/i, '').replace(/\b(task|việc|todo)\b/gi, '').trim()
    return inferred
      ? { reply: `Mình sẽ tạo task “${inferred}”.`, actions: [{ type: 'create_task', title: inferred }] }
      : { reply: 'Bạn muốn tạo task tên gì?', actions: [] }
  }
  if (/\b(sprint)\b/.test(lower) && /\b(add|create|thêm|tao|tạo)\b/.test(lower)) {
    return {
      reply: 'Mình sẽ tạo sprint mới theo cadence hiện tại.',
      actions: [{ type: 'create_sprint' }],
    }
  }
  if (/\b(collection|list|danh sách|danh sach)\b/.test(lower) && /\b(add|create|thêm|tao|tạo)\b/.test(lower)) {
    const name = title ?? text.replace(/^(add|create|thêm|tao|tạo)\s+/i, '').replace(/\b(collection|list|danh sách|danh sach)\b/gi, '').trim()
    return name
      ? { reply: `Mình sẽ tạo collection “${name}”.`, actions: [{ type: 'create_collection', name }] }
      : { reply: 'Bạn muốn tạo collection tên gì?', actions: [] }
  }
  if (/\b(collection|list|danh sách|danh sach)\b/.test(lower) && /\b(rename|edit|update|đổi tên|doi ten|sửa|sua)\b/.test(lower)) {
    const collection = mentionedCollection(text, context)
    const quoted = Array.from(text.matchAll(/["“”']([^"“”']{2,})["“”']/g)).map((m) => m[1].trim())
    const name = quoted[1] ?? quoted[0]
    if (name && collection) {
      return {
        reply: `Mình sẽ đổi tên collection “${collection.name}” thành “${name}”.`,
        actions: [{ type: 'update_collection', collectionId: collection.id, name }],
      }
    }
    return { reply: 'Bạn muốn đổi collection nào thành tên gì?', actions: [] }
  }
  if (/\b(collection|list|danh sách|danh sach)\b/.test(lower) && /\b(delete|remove|xoá|xóa|xoa)\b/.test(lower)) {
    const collection = mentionedCollection(text, context)
    const collectionName = collection?.name ?? title ?? undefined
    return collectionName
      ? {
          reply: `Mình sẽ xoá collection “${collectionName}”.`,
          actions: [collection ? { type: 'delete_collection', collectionId: collection.id } : { type: 'delete_collection', collectionName }],
        }
      : { reply: 'Bạn muốn xoá collection nào?', actions: [] }
  }
  if (/\b(day off|days off|off day|nghỉ|nghi|leave|vacation)\b/.test(lower)) {
    const date = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
    const memberName = mentionedMemberName(text, context)
    if (!date || !memberName) {
      return { reply: 'Bạn muốn đánh dấu day off cho member nào và ngày nào? Hãy dùng ngày ISO YYYY-MM-DD.', actions: [] }
    }
    if (/\b(remove|delete|xoá|xóa|xoa|bỏ|bo)\b/.test(lower)) {
      return {
        reply: `Mình sẽ xoá day off của ${memberName} vào ${date}.`,
        actions: [{ type: 'remove_member_day_off', memberName, date }],
      }
    }
    const halfDay = /\b(am|morning|sáng|sang)\b/.test(lower)
      ? 'am'
      : /\b(pm|afternoon|chiều|chieu)\b/.test(lower)
        ? 'pm'
        : 'all'
    return {
      reply: `Mình sẽ đánh dấu ${memberName} nghỉ ${halfDay === 'all' ? 'cả ngày' : halfDay.toUpperCase()} vào ${date}.`,
      actions: [{ type: 'set_member_day_off', memberName, date, halfDay }],
    }
  }
  if (/\b(task|việc|todo)\b/.test(lower) && /\b(delete|remove|xoá|xóa|xoa)\b/.test(lower)) {
    const seq = text.match(/#?\b(\d+)\b/)?.[1]
    const taskTitle = title ?? undefined
    if (seq || taskTitle) {
      return {
        reply: seq
          ? `Mình sẽ xoá task #${seq}.`
          : `Mình sẽ xoá task “${taskTitle}”.`,
        actions: [
          seq
            ? { type: 'delete_task', taskSeq: Number(seq) }
            : { type: 'delete_task', taskTitle },
        ],
      }
    }
    return { reply: 'Bạn muốn xoá task số mấy hoặc tên gì?', actions: [] }
  }
  if (/\b(task|việc|todo)\b/.test(lower) && /\b(move|chuyển|chuyen|đưa|dua)\b/.test(lower) && /\b(next sprint|sprint kế tiếp|sprint ke tiep|sprint tiếp|sprint tiep)\b/.test(lower)) {
    const seq = text.match(/#?\b(\d+)\b/)?.[1]
    const taskTitle = title ?? undefined
    if (seq || taskTitle) {
      return {
        reply: seq
          ? `Mình sẽ chuyển task #${seq} sang sprint kế tiếp.`
          : `Mình sẽ chuyển task “${taskTitle}” sang sprint kế tiếp.`,
        actions: [
          seq
            ? { type: 'move_task_to_next_sprint', taskSeq: Number(seq) }
            : { type: 'move_task_to_next_sprint', taskTitle },
        ],
      }
    }
    return { reply: 'Bạn muốn chuyển task số mấy hoặc tên gì sang sprint kế tiếp?', actions: [] }
  }
  if (/\b(task|việc|todo)\b/.test(lower) && /\b(move|chuyển|chuyen|đưa|dua|add|thêm|them)\b/.test(lower) && /\bsprint\b/.test(lower)) {
    const sprint = mentionedSprint(text, context)
    const seq = text.match(/#?\b(\d+)\b/)?.[1]
    const taskTitle = title ?? undefined
    if (sprint && (seq || taskTitle)) {
      return {
        reply: seq
          ? `Mình sẽ chuyển task #${seq} vào ${sprint.name}.`
          : `Mình sẽ chuyển task “${taskTitle}” vào ${sprint.name}.`,
        actions: [
          seq
            ? { type: 'move_task_to_sprint', taskSeq: Number(seq), sprintId: sprint.id }
            : { type: 'move_task_to_sprint', taskTitle, sprintId: sprint.id },
        ],
      }
    }
    return { reply: 'Bạn muốn chuyển task nào vào sprint nào?', actions: [] }
  }
  if (/\b(task|việc|todo)\b/.test(lower) && /\b(move|chuyển|chuyen|đưa|dua|add|thêm|them)\b/.test(lower) && /\b(collection|list|danh sách|danh sach)\b/.test(lower)) {
    const collection = mentionedCollection(text, context)
    const seq = text.match(/#?\b(\d+)\b/)?.[1]
    const taskTitle = title ?? undefined
    if (collection && (seq || taskTitle)) {
      return {
        reply: seq
          ? `Mình sẽ chuyển task #${seq} vào collection ${collection.name}.`
          : `Mình sẽ chuyển task “${taskTitle}” vào collection ${collection.name}.`,
        actions: [
          seq
            ? { type: 'move_task_to_collection', taskSeq: Number(seq), collectionId: collection.id }
            : { type: 'move_task_to_collection', taskTitle, collectionId: collection.id },
        ],
      }
    }
    return { reply: 'Bạn muốn chuyển task nào vào collection nào?', actions: [] }
  }
  if (/\b(task|việc|todo)\b/.test(lower) && /\b(move|chuyển|chuyen|đưa|dua)\b/.test(lower) && /\b(backlog)\b/.test(lower)) {
    const collection = context.collections.find((c) => c.name.trim().toLowerCase() === 'backlog')
    const seq = text.match(/#?\b(\d+)\b/)?.[1]
    const taskTitle = title ?? undefined
    if (!collection) {
      return {
        reply: 'Backlog hiện chỉ là collection thường. Hãy tạo collection tên Backlog trước, hoặc chọn collection đích khác.',
        actions: [],
      }
    }
    if (seq || taskTitle) {
      return {
        reply: seq
          ? `Mình sẽ chuyển task #${seq} vào Backlog.`
          : `Mình sẽ chuyển task “${taskTitle}” vào Backlog.`,
        actions: [
          seq
            ? { type: 'move_task_to_collection', taskSeq: Number(seq), collectionId: collection.id }
            : { type: 'move_task_to_collection', taskTitle, collectionId: collection.id },
        ],
      }
    }
    return { reply: 'Bạn muốn chuyển task số mấy hoặc tên gì vào Backlog?', actions: [] }
  }
  if (/\b(milestone|mốc)\b/.test(lower) && /\b(delete|remove|xoá|xóa|xoa)\b/.test(lower)) {
    const seq = text.match(/#?\b(\d+)\b/)?.[1]
    const taskTitle = title ?? undefined
    if (seq || taskTitle) {
      return {
        reply: seq
          ? `Mình sẽ xoá milestone #${seq}.`
          : `Mình sẽ xoá milestone “${taskTitle}”.`,
        actions: [
          seq
            ? { type: 'delete_milestone', taskSeq: Number(seq) }
            : { type: 'delete_milestone', taskTitle },
        ],
      }
    }
    return { reply: 'Bạn muốn xoá milestone số mấy hoặc tên gì?', actions: [] }
  }
  if (/\b(member|thành viên|nguoi|người)\b/.test(lower) && /\b(delete|remove|xoá|xóa|xoa)\b/.test(lower)) {
    const memberName = title ?? text.replace(/^(delete|remove|xoá|xóa|xoa)\s+/i, '').replace(/\b(member|thành viên|người)\b/gi, '').trim()
    return memberName
      ? { reply: `Mình sẽ xoá member “${memberName}”.`, actions: [{ type: 'delete_member', memberName }] }
      : { reply: 'Bạn muốn xoá member tên gì?', actions: [] }
  }
  if (/\b(sprint)\b/.test(lower) && /\b(delete|remove|xoá|xóa|xoa)\b/.test(lower)) {
    return {
      reply: 'Mình sẽ xoá sprint đang chọn.',
      actions: [{ type: 'delete_sprint' }],
    }
  }
  const taskCount = context.tasks.length
  return {
    reply:
      taskCount > 0
        ? `Mình thấy ${taskCount} task trong context hiện tại. Hãy yêu cầu kiểu: “thêm task "Design login"” hoặc đăng nhập OpenAI qua gateway để chat thông minh hơn.`
        : 'Chưa có provider chạy thật nên mình chỉ xử lý lệnh local cơ bản. Hãy đăng nhập OpenAI qua gateway, cấu hình DeepSeek, hoặc thử: “thêm task "Design login"”.',
    actions: [],
  }
}
