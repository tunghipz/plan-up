import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertCircle,
  Bot,
  ChevronDown,
  KeyRound,
  LogIn,
  LogOut,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react'
import { callAiProvider, loadAiSettings, saveAiSettings } from './ai/providers'
import { buildAiContext } from './ai/context'
import { describeAiAction, executeAiActions } from './ai/actions'
import { MarkdownContent } from './ai/markdown'
import type {
  AiAction,
  AiActionResult,
  AiChatMessage,
  AiChatSettings,
  AiRuntimeContext,
} from './ai/types'
import { db, uid, type AiMessage, type AiThread } from './db'

const SKILL_ID = 'project-management'
const SKILL_URL = '/skills/project-management/SKILL.md'
const NEW_THREAD_TITLE = 'New chat'

type OpenAiAuthState = {
  status: 'idle' | 'checking' | 'signed-in' | 'signed-out' | 'unavailable'
  label?: string
  error?: string
}

function providerModel(provider: AiChatSettings['provider']) {
  if (provider === 'deepseek') return 'deepseek-v4-pro'
  return 'gpt-5.5'
}

export function AiChatDrawer({
  open,
  context,
  onClose,
}: {
  open: boolean
  context: AiRuntimeContext
  onClose: () => void
}) {
  const [settings, setSettings] = useState<AiChatSettings>(() => loadAiSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [openAiAuth, setOpenAiAuth] = useState<OpenAiAuthState>({ status: 'idle' })
  const [projectManageSkill, setProjectManageSkill] = useState('')
  const [skillState, setSkillState] = useState<'idle' | 'loading' | 'loaded' | 'failed'>('idle')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingActions, setPendingActions] = useState<AiAction[]>([])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const projectId = context.project?.id ?? null

  const threads = useLiveQuery<AiThread[]>(
    () =>
      projectId
        ? db.aiThreads
            .where('projectId')
            .equals(projectId)
            .sortBy('updatedAt')
            .then((rows) => rows.reverse())
        : Promise.resolve([]),
    [projectId]
  )
  const storedMessages = useLiveQuery<AiMessage[]>(
    () =>
      activeThreadId
        ? db.aiMessages.where('threadId').equals(activeThreadId).sortBy('ts')
        : Promise.resolve([]),
    [activeThreadId]
  )
  const messages: AiChatMessage[] = useMemo(
    () =>
      (storedMessages ?? []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        ts: m.ts,
      })),
    [storedMessages]
  )
  const activeThread = useMemo(
    () => (threads ?? []).find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  )

  useEffect(() => {
    saveAiSettings(settings)
  }, [settings])

  const checkOpenAiSession = useCallback(async () => {
    if (settings.provider !== 'openai_login') {
      setOpenAiAuth({ status: 'idle' })
      return true
    }
    if (!settings.sessionUrl.trim()) {
      setOpenAiAuth({
        status: 'unavailable',
        error: 'Session URL is empty.',
      })
      return false
    }
    setOpenAiAuth({ status: 'checking' })
    try {
      const res = await fetch(settings.sessionUrl, { credentials: 'include' })
      if (res.status === 401 || res.status === 403) {
        setOpenAiAuth({ status: 'signed-out' })
        return false
      }
      if (!res.ok) {
        setOpenAiAuth({
          status: 'unavailable',
          error: `Session endpoint returned ${res.status}.`,
        })
        return false
      }
      const payload = await res.json().catch(() => undefined)
      if (payload === undefined) {
        setOpenAiAuth({
          status: 'unavailable',
          error: 'Session endpoint did not return JSON.',
        })
        return false
      }
      const session = readOpenAiSession(payload)
      setOpenAiAuth(
        session.signedIn
          ? { status: 'signed-in', label: session.label }
          : { status: 'signed-out' }
      )
      return session.signedIn
    } catch (err) {
      setOpenAiAuth({
        status: 'unavailable',
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }, [settings.provider, settings.sessionUrl])

  const signInOpenAi = useCallback(() => {
    window.location.assign(withReturnTo(settings.authUrl))
  }, [settings.authUrl])

  const signOutOpenAi = useCallback(async () => {
    if (openAiAuth.status !== 'signed-in') return
    if (!settings.logoutUrl.trim()) {
      setOpenAiAuth({ status: 'unavailable', error: 'Logout URL is empty.' })
      return
    }
    setOpenAiAuth({ status: 'checking' })
    try {
      const res = await fetch(settings.logoutUrl, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`Logout endpoint returned ${res.status}.`)
      setOpenAiAuth({ status: 'signed-out' })
    } catch (err) {
      setOpenAiAuth({
        status: 'unavailable',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [openAiAuth.status, settings.logoutUrl])

  useEffect(() => {
    if (!open || settings.provider !== 'openai_login') return
    const id = window.setTimeout(() => {
      void checkOpenAiSession()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open, settings.provider, settings.sessionUrl, checkOpenAiSession])

  const loadProjectManagementSkill = useCallback(async () => {
    setSkillState('loading')
    try {
      const res = await fetch(SKILL_URL)
      if (!res.ok) throw new Error(`Could not load ${SKILL_URL}`)
      const text = await res.text()
      setProjectManageSkill(text)
      setSkillState('loaded')
      return text
    } catch (err) {
      setProjectManageSkill('')
      setSkillState('failed')
      throw err
    }
  }, [])

  const createThread = useCallback(
    async (pid: string) => {
      let loaded = false
      try {
        await loadProjectManagementSkill()
        loaded = true
      } catch {
        // Chat still works through the normal action schema/local fallback.
      }
      const now = Date.now()
      const thread: AiThread = {
        id: uid(),
        projectId: pid,
        title: NEW_THREAD_TITLE,
        createdAt: now,
        updatedAt: now,
        skillId: SKILL_ID,
      }
      const message: AiMessage = {
        id: uid(),
        projectId: pid,
        threadId: thread.id,
        role: 'assistant',
        content: loaded
          ? 'Đã bắt đầu chat mới và load skill project-management.'
          : 'Đã bắt đầu chat mới. Skill project-management chưa load được, nhưng tôi vẫn có thể dùng action schema cơ bản.',
        ts: now,
      }
      await db.transaction('rw', db.aiThreads, db.aiMessages, async () => {
        await db.aiThreads.add(thread)
        await db.aiMessages.add(message)
      })
      return thread.id
    },
    [loadProjectManagementSkill]
  )

  useEffect(() => {
    if (!open || !projectId) return
    let cancelled = false
    ;(async () => {
      const rows = await db.aiThreads
        .where('projectId')
        .equals(projectId)
        .sortBy('updatedAt')
      const latest = rows.at(-1)
      const id = latest?.id ?? (await createThread(projectId))
      if (!cancelled) setActiveThreadId(id)
    })()
    return () => {
      cancelled = true
    }
  }, [open, projectId, createThread])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages, pendingActions, busy])

  const contextPreview = useMemo(() => buildAiContext(context), [context])

  const startNewChat = async () => {
    if (!projectId || busy) return
    setError(null)
    setPendingActions([])
    setInput('')
    const id = await createThread(projectId)
    setActiveThreadId(id)
  }

  const selectThread = (id: string) => {
    setActiveThreadId(id)
    setPendingActions([])
    setError(null)
  }

  const appendMessage = async (
    threadId: string,
    message: Omit<AiMessage, 'projectId' | 'threadId'>,
    title?: string
  ) => {
    if (!projectId) return
    await db.transaction('rw', db.aiThreads, db.aiMessages, async () => {
      await db.aiMessages.add({
        ...message,
        projectId,
        threadId,
      })
      await db.aiThreads.update(threadId, {
        updatedAt: message.ts,
        ...(title ? { title } : {}),
      })
    })
  }

  const submit = async () => {
    const text = input.trim()
    if (!text || busy || !activeThreadId) return
    if (settings.provider === 'openai_login' && openAiAuth.status !== 'signed-in') {
      const signedIn = await checkOpenAiSession()
      if (!signedIn) {
        setError('Đăng nhập OpenAI qua gateway trước khi gửi chat.')
        return
      }
    }
    setInput('')
    setError(null)
    setPendingActions([])
    const userMessage: AiChatMessage = {
      id: uid(),
      role: 'user',
      content: text,
      ts: Date.now(),
    }
    const nextMessages = [...messages, userMessage]
    const nextTitle =
      !activeThread || activeThread.title === NEW_THREAD_TITLE
        ? text.slice(0, 46)
        : undefined
    await appendMessage(activeThreadId, userMessage, nextTitle)
    setBusy(true)
    try {
      const proposal = await callAiProvider({
        settings,
        messages: nextMessages,
        context,
        projectManageSkill,
      })
      await appendMessage(activeThreadId, {
        id: uid(),
        role: 'assistant',
        content: proposal.reply,
        ts: Date.now(),
      })
      setPendingActions(proposal.actions)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const applyActions = async () => {
    if (!pendingActions.length || busy || !activeThreadId) return
    setBusy(true)
    setError(null)
    try {
      const results = await executeAiActions(pendingActions, context)
      setPendingActions([])
      await appendMessage(activeThreadId, {
        id: uid(),
        role: 'assistant',
        content: summarizeResults(results),
        ts: Date.now(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || !context.project || !activeThreadId

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-surface text-ink">
      <header className="h-[54px] shrink-0 border-b border-border-hair bg-surface flex items-center px-5 gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-accent-soft text-accent">
          <Bot size={17} strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-ink tracking-[-0.01em]">
            AI Chat
          </h1>
          <div className="text-[11.5px] text-ink-faint truncate">
            {providerName(settings.provider)} · {settings.model}
          </div>
        </div>
        <button
          onClick={onClose}
          className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-faint hover:text-ink hover:bg-surface-hover transition"
          title="Close AI Chat (Esc)"
          aria-label="Close AI Chat"
        >
          <X size={16} />
        </button>
      </header>

      <div ref={scrollerRef} className="flex-1 overflow-auto bg-canvas px-5 py-5">
        <div className="space-y-4">
          <section className="bg-surface rounded-[14px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-2">
              <MessageCircle size={15} className="text-ink-faint" />
              <span className="text-[13px] font-semibold text-ink">Project chats</span>
              <button
                onClick={() => void startNewChat()}
                disabled={!projectId || busy}
                className="ml-auto inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft disabled:opacity-40 transition"
              >
                <Plus size={13} /> New
              </button>
            </div>
            <div className="mt-3 max-h-32 overflow-auto space-y-1">
              {(threads ?? []).length === 0 ? (
                <div className="text-[12.5px] text-ink-faint">No saved chats yet.</div>
              ) : (
                (threads ?? []).map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => selectThread(thread.id)}
                    className={`w-full rounded-[9px] px-2.5 py-2 text-left transition ${
                      thread.id === activeThreadId
                        ? 'bg-accent-soft text-accent'
                        : 'hover:bg-surface-hover text-ink'
                    }`}
                  >
                    <span className="block truncate text-[13px] font-medium">
                      {thread.title}
                    </span>
                    <span className="block text-[11.5px] text-ink-faint tab-data">
                      {formatThreadTime(thread.updatedAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="mt-2 text-[11.5px] text-ink-faint">
              Skill:{' '}
              <span className={skillState === 'loaded' ? 'text-status-done' : ''}>
                {skillState === 'loaded'
                  ? 'project-management loaded'
                  : skillState === 'loading'
                    ? 'loading project-management…'
                    : skillState === 'failed'
                      ? 'project-management unavailable'
                      : 'project-management'}
              </span>
            </div>
          </section>

          <section className="bg-surface rounded-[14px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_rgba(0,0,0,0.04)]">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className="w-full flex items-center gap-2 text-left"
              aria-expanded={settingsOpen}
            >
              <Settings2 size={15} className="text-ink-faint" />
              <span className="text-[13px] font-semibold text-ink">Provider</span>
              <span className="ml-auto text-[12px] text-ink-faint">
                {providerLabel(settings, openAiAuth)}
              </span>
              <ChevronDown
                size={14}
                className={`text-ink-faint transition-transform ${settingsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {settingsOpen && (
              <ProviderSettings
                settings={settings}
                authState={openAiAuth}
                onChange={setSettings}
                onCheckSession={checkOpenAiSession}
                onSignIn={signInOpenAi}
                onSignOut={signOutOpenAi}
              />
            )}
          </section>

          <div className="space-y-2.5">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-[12.5px] text-ink-faint px-1">
                <Sparkles size={14} className="text-accent" />
                Thinking…
              </div>
            )}
          </div>

          {pendingActions.length > 0 && (
            <section className="bg-surface rounded-[14px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-accent" />
                <h2 className="text-[13px] font-semibold text-ink">
                  Proposed changes
                </h2>
                <span className="ml-auto text-[12px] text-ink-faint tab-data">
                  {pendingActions.length}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {pendingActions.map((action, index) => (
                  <div
                    key={`${action.type}-${index}`}
                    className="rounded-[10px] bg-canvas px-3 py-2 text-[13px] text-ink"
                  >
                    {describeAiAction(action, context)}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setPendingActions([])}
                  className="px-3 py-1.5 rounded-[8px] text-[13px] font-medium text-ink-muted hover:bg-surface-hover transition"
                >
                  Cancel
                </button>
                <button
                  onClick={applyActions}
                  disabled={busy}
                  className="px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition"
                >
                  Apply
                </button>
              </div>
            </section>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-[12px] border border-red-500/25 bg-red-500/[0.06] px-3 py-2.5 text-[12.5px] text-red-600 dark:text-red-400">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          <details className="group rounded-[14px] bg-surface p-4 text-[12px] text-ink-muted shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_rgba(0,0,0,0.04)]">
            <summary className="cursor-pointer list-none font-semibold text-ink flex items-center gap-2">
              <KeyRound size={14} className="text-ink-faint" />
              Context sent
              <ChevronDown size={13} className="ml-auto text-ink-faint transition group-open:rotate-180" />
            </summary>
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-[10px] bg-canvas p-3 text-[11.5px] leading-relaxed text-ink-muted">
              {contextPreview}
            </pre>
          </details>
        </div>
      </div>

      <footer className="shrink-0 border-t border-border-hair bg-surface p-2">
        <div className="flex items-end gap-2 rounded-[12px] bg-canvas px-2 py-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
            rows={1}
            placeholder={
              context.project
                ? 'Ask or type: thêm task "Design login"'
                : 'Select a project first'
            }
            disabled={disabled}
            className="max-h-[84px] min-h-[34px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
          />
          <button
            onClick={() => void submit()}
            disabled={disabled || !input.trim()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition"
            aria-label="Send"
            title="Send"
          >
            <Send size={15} strokeWidth={2} />
          </button>
        </div>
      </footer>
    </div>
  )
}

function providerName(provider: AiChatSettings['provider']) {
  if (provider === 'openai_login') return 'OpenAI login'
  if (provider === 'deepseek') return 'DeepSeek API'
  return 'Custom gateway'
}

function providerLabel(settings: AiChatSettings, authState: OpenAiAuthState) {
  if (settings.provider === 'openai_login') {
    if (authState.status === 'signed-in') return authState.label ?? 'signed in'
    if (authState.status === 'checking') return 'checking'
    if (authState.status === 'unavailable') return 'gateway unavailable'
    return 'not signed in'
  }
  if (settings.provider === 'proxy') return settings.proxyUrl
  return settings.apiKey.trim() ? 'configured' : 'local fallback'
}

function ProviderSettings({
  settings,
  authState,
  onChange,
  onCheckSession,
  onSignIn,
  onSignOut,
}: {
  settings: AiChatSettings
  authState: OpenAiAuthState
  onChange: (settings: AiChatSettings) => void
  onCheckSession: () => Promise<boolean>
  onSignIn: () => void
  onSignOut: () => Promise<void>
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const setProvider = (provider: AiChatSettings['provider']) => {
    onChange({
      ...settings,
      provider,
      model: providerModel(provider),
      apiKey: provider === 'deepseek' ? settings.apiKey : '',
    })
  }
  return (
    <div className="mt-4 space-y-3">
      <label className="block">
        <span className="text-[12px] text-ink-muted">Provider</span>
        <select
          value={settings.provider}
          onChange={(e) => setProvider(e.target.value as AiChatSettings['provider'])}
          className="mt-1 w-full rounded-[8px] border border-border bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        >
          <option value="openai_login">OpenAI Login</option>
          <option value="deepseek">DeepSeek API</option>
          <option value="proxy">Custom gateway</option>
        </select>
      </label>
      <label className="block">
        <span className="text-[12px] text-ink-muted">Model</span>
        <input
          value={settings.model}
          onChange={(e) => onChange({ ...settings, model: e.target.value })}
          className="mt-1 w-full rounded-[8px] border border-border bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      </label>

      {settings.provider === 'openai_login' && (
        <>
          {advancedOpen && (
            <>
          <label className="block">
            <span className="text-[12px] text-ink-muted">Chat endpoint</span>
            <input
              value={settings.proxyUrl}
              onChange={(e) => onChange({ ...settings, proxyUrl: e.target.value })}
              className="mt-1 w-full rounded-[8px] border border-border bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <label className="block">
            <span className="text-[12px] text-ink-muted">Sign-in URL</span>
            <input
              value={settings.authUrl}
              onChange={(e) => onChange({ ...settings, authUrl: e.target.value })}
              className="mt-1 w-full rounded-[8px] border border-border bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <div className="grid grid-cols-1 gap-3">
            <label className="block">
              <span className="text-[12px] text-ink-muted">Session URL</span>
              <input
                value={settings.sessionUrl}
                onChange={(e) => onChange({ ...settings, sessionUrl: e.target.value })}
                className="mt-1 w-full rounded-[8px] border border-border bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="block">
              <span className="text-[12px] text-ink-muted">Logout URL</span>
              <input
                value={settings.logoutUrl}
                onChange={(e) => onChange({ ...settings, logoutUrl: e.target.value })}
                className="mt-1 w-full rounded-[8px] border border-border bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
          </div>
            </>
          )}
          <div className="rounded-[10px] bg-canvas px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
            <p className="mb-2">
              {authHelpText(authState)}
            </p>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${authDotClass(authState)}`} />
              <span className="min-w-0 truncate">{authText(authState)}</span>
            </div>
            {authState.error && (
              <div className={`mt-1 break-words ${authErrorClass(authState)}`}>
                {authState.error}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={
                  authState.status === 'unavailable' || authState.status === 'checking'
                    ? () => void onCheckSession()
                    : onSignIn
                }
                disabled={authState.status === 'signed-in'}
                title={
                  authState.status === 'signed-in'
                    ? 'Already connected'
                    : authState.status === 'unavailable'
                      ? 'Check whether the gateway is available'
                    : 'Open gateway login'
                }
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-40 transition"
              >
                {authState.status === 'unavailable' || authState.status === 'checking' ? (
                  <RefreshCw
                    size={13}
                    className={authState.status === 'checking' ? 'animate-spin' : ''}
                  />
                ) : (
                  <LogIn size={13} />
                )}
                {authPrimaryLabel(authState)}
              </button>
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                aria-expanded={advancedOpen}
                className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium text-ink-muted hover:bg-surface-hover transition"
              >
                <Settings2 size={13} />
                Advanced
                <ChevronDown
                  size={13}
                  className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                />
              </button>
              <button
                type="button"
                onClick={() => void onSignOut()}
                disabled={authState.status !== 'signed-in'}
                title={
                  authState.status === 'signed-in'
                    ? 'Sign out from the gateway session'
                    : 'No active gateway session'
                }
                className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium text-ink-muted hover:bg-surface-hover disabled:opacity-40 transition"
              >
                <LogOut size={13} /> Sign out
              </button>
            </div>
          </div>
        </>
      )}

      {settings.provider === 'proxy' && (
        <label className="block">
          <span className="text-[12px] text-ink-muted">Gateway endpoint</span>
          <input
            value={settings.proxyUrl}
            onChange={(e) => onChange({ ...settings, proxyUrl: e.target.value })}
            className="mt-1 w-full rounded-[8px] border border-border bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>
      )}

      {settings.provider === 'deepseek' && (
        <label className="block">
          <span className="text-[12px] text-ink-muted">API key</span>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => onChange({ ...settings, apiKey: e.target.value })}
            placeholder="DeepSeek key"
            className="mt-1 w-full rounded-[8px] border border-border bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 placeholder:text-ink-faint"
          />
        </label>
      )}
    </div>
  )
}

function readOpenAiSession(value: unknown): { signedIn: boolean; label?: string } {
  if (typeof value !== 'object' || value === null) return { signedIn: false }
  const record = value as Record<string, unknown>
  const user =
    typeof record.user === 'object' && record.user !== null
      ? (record.user as Record<string, unknown>)
      : typeof record.account === 'object' && record.account !== null
        ? (record.account as Record<string, unknown>)
        : record
  const label =
    typeof user.email === 'string' && user.email.trim()
      ? user.email.trim()
      : typeof user.name === 'string' && user.name.trim()
        ? user.name.trim()
        : undefined
  if (
    record.authenticated === false ||
    record.signedIn === false ||
    record.loggedIn === false
  ) {
    return { signedIn: false, label }
  }
  const signedIn =
    record.authenticated === true ||
    record.signedIn === true ||
    record.loggedIn === true ||
    Boolean(label)
  return { signedIn, label }
}

function withReturnTo(rawUrl: string) {
  try {
    const url = new URL(rawUrl, window.location.origin)
    url.searchParams.set('returnTo', window.location.href)
    return url.toString()
  } catch {
    return rawUrl
  }
}

function authText(authState: OpenAiAuthState) {
  if (authState.status === 'signed-in') {
    return authState.label ? `Signed in as ${authState.label}` : 'Signed in'
  }
  if (authState.status === 'checking') return 'Checking session'
  if (authState.status === 'unavailable') return 'Gateway unavailable'
  if (authState.status === 'signed-out') return 'Not signed in'
  return 'Session not checked'
}

function authHelpText(authState: OpenAiAuthState) {
  if (authState.status === 'signed-in') return 'OpenAI is connected through your gateway.'
  if (authState.status === 'checking') return 'Checking the gateway session.'
  if (authState.status === 'signed-out') return 'Connect through the OpenAI gateway to start chatting.'
  if (authState.status === 'unavailable') {
    return 'Start or configure the OpenAI login gateway, then check again.'
  }
  return 'Connect OpenAI through a login gateway. ChatGPT web login is not reused directly.'
}

function authPrimaryLabel(authState: OpenAiAuthState) {
  if (authState.status === 'signed-in') return 'Connected'
  if (authState.status === 'unavailable' || authState.status === 'checking') {
    return 'Check gateway'
  }
  return 'Connect OpenAI'
}

function authErrorClass(authState: OpenAiAuthState) {
  if (authState.status === 'unavailable') return 'text-ink-faint'
  return 'text-red-600 dark:text-red-400'
}

function authDotClass(authState: OpenAiAuthState) {
  if (authState.status === 'signed-in') return 'bg-status-done'
  if (authState.status === 'checking') return 'bg-accent'
  if (authState.status === 'unavailable') return 'bg-red-500'
  return 'bg-ink-faint'
}

function ChatBubble({ message }: { message: AiChatMessage }) {
  const mine = message.role === 'user'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[86%] rounded-[14px] px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
          mine
            ? 'bg-accent text-white'
            : 'bg-surface text-ink border border-border-hair'
        }`}
      >
        <MarkdownContent content={message.content} inverted={mine} />
      </div>
    </div>
  )
}

function summarizeResults(results: AiActionResult[]) {
  const ok = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  if (failed.length === 0) {
    return ok.length === 1 ? ok[0].label : `Applied ${ok.length} changes.`
  }
  const lines = [
    ok.length ? `Applied ${ok.length} change${ok.length === 1 ? '' : 's'}.` : '',
    ...failed.map((r) => `Could not apply: ${r.label}${r.detail ? ` (${r.detail})` : ''}`),
  ].filter(Boolean)
  return lines.join('\n')
}

function formatThreadTime(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
