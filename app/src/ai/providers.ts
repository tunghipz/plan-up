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
  model: 'gpt-5.5',
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

export function loadAiSettings(): AiChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_AI_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AiChatSettings>
    const provider = normalizeProvider(parsed.provider)
    return {
      provider,
      model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : DEFAULT_AI_SETTINGS.model,
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

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Model response was not JSON.')
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
    return proposalFromUnknown(extractJson(content))
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
  return proposalFromUnknown(extractJson(content))
}

function quotedTitle(text: string): string | null {
  const quoted = text.match(/["“”']([^"“”']{2,})["“”']/)
  if (quoted?.[1]) return quoted[1].trim()
  return null
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
  const taskCount = context.tasks.length
  return {
    reply:
      taskCount > 0
        ? `Mình thấy ${taskCount} task trong context hiện tại. Hãy yêu cầu kiểu: “thêm task "Design login"” hoặc đăng nhập OpenAI qua gateway để chat thông minh hơn.`
        : 'Chưa có provider chạy thật nên mình chỉ xử lý lệnh local cơ bản. Hãy đăng nhập OpenAI qua gateway, cấu hình DeepSeek, hoặc thử: “thêm task "Design login"”.',
    actions: [],
  }
}
