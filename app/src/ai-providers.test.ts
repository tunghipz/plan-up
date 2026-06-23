import { afterEach, describe, expect, it, vi } from 'vitest'
import { callAiProvider, loadAiSettings } from './ai/providers'
import type { AiRuntimeContext } from './ai/types'

const SETTINGS_KEY = 'plan-up:ai-chat-settings'

const context: AiRuntimeContext = {
  today: '2026-06-23',
  screen: 'project',
  containerKind: 'sprint',
  view: 'list',
  project: { id: 'p1', name: 'Project', createdAt: 0 },
  sprint: null,
  collection: null,
  members: [],
  tasks: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AI providers', () => {
  it('migrates legacy OpenAI API settings to OpenAI login', () => {
    const store = new Map<string, string>([
      [
        SETTINGS_KEY,
        JSON.stringify({
          provider: 'openai',
          model: 'gpt-5.5',
          apiKey: 'sk-old',
        }),
      ],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    })

    expect(loadAiSettings()).toMatchObject({
      provider: 'openai_login',
      model: 'gpt-5.5',
      apiKey: '',
      proxyUrl: '/api/ai/chat',
    })
  })

  it('sends OpenAI login chat through the gateway session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Ready', actions: [] }),
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)

    const proposal = await callAiProvider({
      settings: {
        provider: 'openai_login',
        model: 'gpt-5.5',
        apiKey: '',
        proxyUrl: '/api/ai/chat',
        authUrl: '/api/auth/openai/start',
        sessionUrl: '/api/auth/session',
        logoutUrl: '/api/auth/logout',
        temperature: 0.2,
      },
      messages: [{ id: 'm1', role: 'user', content: 'Plan this sprint', ts: 1 }],
      context,
    })

    expect(proposal.reply).toBe('Ready')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/ai/chat')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toMatchObject({
      provider: 'openai_login',
      model: 'gpt-5.5',
      temperature: 0.2,
    })
  })
})
