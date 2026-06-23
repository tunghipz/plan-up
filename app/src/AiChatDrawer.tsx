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
  Paperclip,
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
import {
  AI_FILE_MAX_COUNT,
  buildFileAttachmentPrompt,
  formatAiFileSize,
  readAiChatFiles,
  splitAiMessageDisplayContent,
  unreadableFileNames,
  type AiChatFileAttachment,
} from './ai/files'
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
  const [chatMenuOpen, setChatMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [openAiAuth, setOpenAiAuth] = useState<OpenAiAuthState>({ status: 'idle' })
  const [projectManageSkill, setProjectManageSkill] = useState('')
  const [skillState, setSkillState] = useState<'idle' | 'loading' | 'loaded' | 'failed'>('idle')
  const [input, setInput] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AiChatFileAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingActions, setPendingActions] = useState<AiAction[]>([])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const titleButtonRef = useRef<HTMLButtonElement>(null)
  const chatMenuRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    const insertReference = (event: Event) => {
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text
      if (typeof text !== 'string' || !text.trim()) return
      setInput((current) => {
        const trimmed = current.trimEnd()
        return trimmed ? `${trimmed} ${text}` : text
      })
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
    window.addEventListener('plan-up:ai-insert-reference', insertReference)
    return () => window.removeEventListener('plan-up:ai-insert-reference', insertReference)
  }, [])

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
      if (
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>).configured === false
      ) {
        setOpenAiAuth({
          status: 'unavailable',
          error: 'OPENAI_API_KEY is not set on the gateway.',
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
    if (!open || !activeThreadId || projectManageSkill) return
    const id = window.setTimeout(() => {
      void loadProjectManagementSkill().catch(() => {
        // Chat still works through the normal action schema/local fallback.
      })
    }, 0)
    return () => window.clearTimeout(id)
  }, [open, activeThreadId, projectManageSkill, loadProjectManagementSkill])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!chatMenuOpen) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (chatMenuRef.current?.contains(target)) return
      if (titleButtonRef.current?.contains(target)) return
      setChatMenuOpen(false)
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setChatMenuOpen(false)
      setSettingsOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [chatMenuOpen])

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages, pendingActions, busy])

  const contextPreview = useMemo(() => buildAiContext(context), [context])

  const closeDrawer = () => {
    setChatMenuOpen(false)
    setSettingsOpen(false)
    onClose()
  }

  const startNewChat = async () => {
    if (!projectId || busy) return
    setError(null)
    setPendingActions([])
    setInput('')
    const id = await createThread(projectId)
    setActiveThreadId(id)
    setChatMenuOpen(false)
    setSettingsOpen(false)
  }

  const selectThread = (id: string) => {
    setActiveThreadId(id)
    setPendingActions([])
    setError(null)
    setAttachedFiles([])
    setChatMenuOpen(false)
    setSettingsOpen(false)
  }

  const attachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    try {
      const fileArray = Array.from(files)
      const rejected = unreadableFileNames(fileArray)
      const next = await readAiChatFiles(fileArray)
      setAttachedFiles((current) => [...current, ...next].slice(0, 4))
      if (rejected.length > 0) {
        setError(`Không đọc được file dạng binary: ${rejected.join(', ')}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeAttachedFile = (id: string) => {
    setAttachedFiles((current) => current.filter((file) => file.id !== id))
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
    if ((!text && attachedFiles.length === 0) || busy || !activeThreadId) return
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
    const content = `${text || 'Please read the attached file(s).'}${buildFileAttachmentPrompt(attachedFiles)}`
    const userMessage: AiChatMessage = {
      id: uid(),
      role: 'user',
      content,
      ts: Date.now(),
    }
    const nextMessages = [...messages, userMessage]
    const nextTitle =
      !activeThread || activeThread.title === NEW_THREAD_TITLE
        ? (text || attachedFiles[0]?.name || NEW_THREAD_TITLE).slice(0, 46)
        : undefined
    await appendMessage(activeThreadId, userMessage, nextTitle)
    setAttachedFiles([])
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
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden bg-surface text-ink">
      <header className="h-[54px] shrink-0 border-b border-border-hair bg-surface flex items-center px-5 gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-accent-soft text-accent">
          <Bot size={17} strokeWidth={1.9} />
        </span>
        <button
          ref={titleButtonRef}
          type="button"
          data-testid="ai-chat-title-menu-button"
          onClick={() => setChatMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={chatMenuOpen}
          className="-ml-1.5 flex min-w-0 flex-1 items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-left hover:bg-surface-hover transition"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-ink tracking-[-0.01em]">
              {activeThread?.title && activeThread.title !== NEW_THREAD_TITLE
                ? activeThread.title
                : 'AI Chat'}
            </span>
            <span className="block truncate text-[11.5px] text-ink-faint">
              {providerName(settings.provider)} · {settings.model}
            </span>
          </span>
          <ChevronDown
            size={15}
            className={`shrink-0 text-ink-faint transition-transform ${chatMenuOpen ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          onClick={closeDrawer}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-surface-hover transition"
          title="Close AI Chat (Esc)"
          aria-label="Close AI Chat"
        >
          <X size={16} />
        </button>
      </header>

      {chatMenuOpen && (
        <div
          ref={chatMenuRef}
          data-testid="ai-chat-title-menu"
          className="absolute left-3 right-3 top-[60px] z-30 max-h-[min(72vh,620px)] overflow-auto rounded-[12px] border border-border-hair bg-surface p-3 shadow-[0_16px_42px_rgba(15,23,42,0.18)]"
        >
          <div className="flex items-center gap-2">
            <MessageCircle size={15} className="text-ink-faint" />
            <span className="text-[13px] font-semibold text-ink">Project chats</span>
            <button
              type="button"
              onClick={() => void startNewChat()}
              disabled={!projectId || busy}
              className="ml-auto inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft disabled:opacity-40 transition"
            >
              <Plus size={13} /> New
            </button>
          </div>
          <div className="mt-2 max-h-40 overflow-auto space-y-1">
            {(threads ?? []).length === 0 ? (
              <div className="rounded-[9px] bg-canvas px-2.5 py-2 text-[12.5px] text-ink-faint">
                No saved chats yet.
              </div>
            ) : (
              (threads ?? []).map((thread) => (
                <button
                  key={thread.id}
                  type="button"
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
          <div className="mt-2 rounded-[9px] bg-canvas px-2.5 py-2 text-[11.5px] text-ink-faint">
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

          <div className="mt-3 border-t border-border-hair pt-3">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              className="w-full flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-left hover:bg-surface-hover transition"
              aria-expanded={settingsOpen}
            >
              <Settings2 size={15} className="text-ink-faint" />
              <span className="text-[13px] font-semibold text-ink">Provider</span>
              <span className="ml-auto min-w-0 truncate text-[12px] text-ink-faint">
                {providerLabel(settings, openAiAuth)}
              </span>
              <ChevronDown
                size={14}
                className={`shrink-0 text-ink-faint transition-transform ${settingsOpen ? 'rotate-180' : ''}`}
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
          </div>
        </div>
      )}

      <div ref={scrollerRef} className="flex-1 overflow-auto bg-canvas px-5 py-5">
        <div className="space-y-4">
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
        <div className="rounded-[12px] bg-canvas px-2 py-1.5">
          {attachedFiles.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
              {attachedFiles.map((file) => (
                <span
                  key={file.id}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-[8px] bg-surface px-2 py-1 text-[11.5px] text-ink-muted"
                >
                  <Paperclip size={12} />
                  <span className="max-w-[180px] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(file.id)}
                    className="grid h-4 w-4 place-items-center rounded hover:bg-surface-hover"
                    aria-label={`Remove ${file.name}`}
                    title="Remove file"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.cpp,.h,.hpp,.sql,.log,text/*,application/json,application/xml"
              onChange={(e) => void attachFiles(e.currentTarget.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || attachedFiles.length >= AI_FILE_MAX_COUNT}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-ink-muted hover:bg-surface-hover disabled:opacity-40 transition"
              aria-label="Attach files"
              title={`Attach text files (max ${AI_FILE_MAX_COUNT})`}
            >
              <Paperclip size={15} />
            </button>
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
              rows={4}
              placeholder={
                context.project
                  ? 'Ask, attach file, or type: thêm task "Design login"'
                  : 'Select a project first'
              }
              disabled={disabled}
              className="max-h-[148px] min-h-[104px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
            />
            <button
              onClick={() => void submit()}
              disabled={disabled || (!input.trim() && attachedFiles.length === 0)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition"
              aria-label="Send"
              title="Send"
            >
              <Send size={15} strokeWidth={2} />
            </button>
          </div>
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
  const display = splitAiMessageDisplayContent(message.content)
  const displayBody =
    display.attachments.length > 0 && display.body === 'Please read the attached file(s).'
      ? ''
      : display.body
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[86%] rounded-[14px] px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
          mine
            ? 'bg-accent text-white'
            : 'bg-surface text-ink border border-border-hair'
        }`}
      >
        {displayBody && <MarkdownContent content={displayBody} inverted={mine} />}
        {display.attachments.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 ${displayBody ? 'mt-2' : ''}`}>
            {display.attachments.map((file, index) => {
              const size = formatAiFileSize(file.size)
              return (
                <span
                  key={`${file.name}-${index}`}
                  className={`inline-flex max-w-full items-center gap-1.5 rounded-[8px] px-2 py-1 text-[11.5px] ${
                    mine
                      ? 'bg-white/15 text-white'
                      : 'bg-canvas text-ink-muted'
                  }`}
                  title={[file.name, file.type, size].filter(Boolean).join(' · ')}
                >
                  <Paperclip size={12} className="shrink-0" />
                  <span className="max-w-[180px] truncate">{file.name}</span>
                  {size && <span className="shrink-0 opacity-75">{size}</span>}
                </span>
              )
            })}
          </div>
        )}
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
