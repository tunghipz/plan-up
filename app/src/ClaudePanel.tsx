import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowUp,
  Check,
  Download,
  ExternalLink,
  Eye,
  LoaderCircle,
  Presentation,
  RotateCw,
  Sparkles,
  Square,
  SquarePen,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import { db, type Member, type Project } from './db'
import { Avatar } from './members'
import {
  applyProposal,
  ask,
  clearChat,
  discardProposal,
  isRunning,
  loadModel,
  openDeck,
  retry,
  saveDeck,
  saveModel,
  stop,
  toggleAction,
  undoProposal,
  useChat,
  type AssistantTurn,
  type ClaudeRef,
  type Proposal,
} from './claude-chat'
import { REF_LINK_SOURCE } from './claude-prompt'
import type { ResolvedAction } from './claude-actions'
import { renderDeckHtml, type Deck } from './claude-deck'
import type { ClaudeModel } from './claude-run'
import { useConfirm } from './confirm-context'
import { ModalSheet } from './ModalSheet'
import { RichText } from './RichText'

/** After this long without a line from the CLI, macOS is probably holding a permission prompt. */
const STALL_HINT_MS = 8000

/** Sent as-is when tapped (they are the user's own words, so Vietnamese). */
const SUGGESTIONS = [
  'Làm slide tổng kết sprint này',
  'Tóm tắt tiến độ theo từng người',
  'Task nào đang trễ hoặc sắp trễ?',
  'Ai đang quá tải trong sprint này?',
]

/**
 * Claude assistant inspector (design-docs/claude-assistant.md). Desktop only: the
 * App mounts it only under Tauri. Lives in a right-hand column that pushes the
 * board aside instead of covering it, so applied changes show up beside the chat.
 */
/** Show a task / member / sprint in the plan — App owns navigation (claude-assistant.md). */
export interface ShowInPlan {
  task: (id: string) => void
  member: (id: string) => void
  sprint: (id: string) => void
}

/** What reference links need to render and act: live existence + avatars + navigation. */
interface LinkEnv {
  show: ShowInPlan
  members: Map<string, Member>
  taskIds: Set<string>
  sprintIds: Set<string>
}
const LinkEnvCtx = createContext<LinkEnv | null>(null)
/** The refs of the answer being rendered (handles differ per answer). */
const RefsCtx = createContext<Record<string, ClaudeRef> | undefined>(undefined)

export function ClaudePanel({
  open,
  project,
  currentSprintId,
  onClose,
  show,
}: {
  open: boolean
  project: Project
  /** The sprint on screen: Claude's default sprint, and whose activity it reads. */
  currentSprintId: string | null
  onClose: () => void
  show: ShowInPlan
}) {
  const chat = useChat(project.id)
  const running = isRunning(chat)
  const [model, setModelState] = useState<ClaudeModel>(loadModel)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState<Deck | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const live = useLiveQuery(
    async () => ({
      members: await db.members.where('projectId').equals(project.id).toArray(),
      taskIds: (await db.tasks.where('projectId').equals(project.id).primaryKeys()).map(String),
      sprintIds: (await db.sprints.where('projectId').equals(project.id).primaryKeys()).map(String),
    }),
    [project.id]
  )
  const showRef = useRef(show)
  useLayoutEffect(() => {
    showRef.current = show
  })
  const linkEnv = useMemo<LinkEnv>(
    () => ({
      // Stable wrapper: App re-creates its handlers every render.
      show: {
        task: (id) => showRef.current.task(id),
        member: (id) => showRef.current.member(id),
        sprint: (id) => showRef.current.sprint(id),
      },
      members: new Map((live?.members ?? []).map((m) => [m.id, m])),
      taskIds: new Set(live?.taskIds ?? []),
      sprintIds: new Set(live?.sprintIds ?? []),
    }),
    [live]
  )
  const counts = useLiveQuery(
    async () => ({
      sprints: await db.sprints.where('projectId').equals(project.id).count(),
      tasks: await db.tasks
        .where('projectId')
        .equals(project.id)
        .filter((t) => !!t.sprintId)
        .count(),
    }),
    [project.id]
  )

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Follow the answer as it streams in, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [chat])

  const setModel = (m: ClaudeModel) => {
    setModelState(m)
    saveModel(m)
  }

  const send = (text: string) => {
    if (running || !text.trim()) return
    stickRef.current = true
    void ask(project.id, currentSprintId, text, model)
    setDraft('')
  }

  const runningTurn = chat.turns.find(
    (t): t is AssistantTurn => t.role === 'assistant' && t.status === 'running'
  )

  return (
    <LinkEnvCtx value={linkEnv}>
    <div className="h-full flex flex-col rounded-[18px] bg-surface border border-border-hair shadow-[0_1px_3px_rgba(0,0,0,0.06),0_12px_36px_rgba(0,0,0,0.10)] overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 pt-3.5 pb-3 border-b border-border-hair">
        <div className="flex items-center gap-2">
          <Sparkles size={15} strokeWidth={1.9} className="text-accent shrink-0" aria-hidden />
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Claude</h2>
          <div className="ml-auto flex items-center gap-1">
            <ModelToggle value={model} onChange={setModel} />
            <button
              onClick={() => clearChat(project.id)}
              disabled={!chat.turns.length}
              title="New chat"
              aria-label="New chat"
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-faint hover:text-ink hover:bg-surface-hover transition disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <SquarePen size={14} strokeWidth={1.9} />
            </button>
            <button
              onClick={onClose}
              title="Close (⌘J)"
              aria-label="Close Claude"
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-faint hover:text-ink hover:bg-surface-hover transition"
            >
              <X size={15} strokeWidth={1.9} />
            </button>
          </div>
        </div>
        <p className="mt-1 text-[12px] text-ink-muted truncate tab-data">
          Reads <span className="text-ink font-medium">{project.name}</span>
          {counts && (
            <>
              {' '}
              · {counts.sprints} sprint{counts.sprints === 1 ? '' : 's'} · {counts.tasks} task
              {counts.tasks === 1 ? '' : 's'}
            </>
          )}
        </p>
      </div>

      {/* Conversation */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        // select-text: the desktop build turns selection off app-wide (index.css,
        // html.desktop body); the conversation is content, so it stays copyable.
        className={`flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4 ${
          chat.turns.length > 0 ? 'select-text' : ''
        }`}
      >
        {chat.turns.length === 0 ? (
          <EmptyState projectName={project.name} onPick={send} />
        ) : (
          chat.turns.map((t) =>
            t.role === 'user' ? (
              <div key={t.id} className="flex justify-end">
                <div className="max-w-[88%] rounded-[14px] bg-fill px-3 py-2 text-[13.5px] leading-[1.45] text-ink whitespace-pre-wrap break-words">
                  {t.text}
                </div>
              </div>
            ) : (
              <AssistantView
                key={t.id}
                turn={t}
                projectId={project.id}
                onPreview={setPreview}
                onRetry={() => retry(project.id, t.id, currentSprintId, model)}
              />
            )
          )
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 px-3 pb-3 pt-2">
        <div className="flex items-end gap-2 rounded-[14px] bg-fill px-3 py-2 focus-within:ring-2 focus-within:ring-accent/30">
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Vietnamese input methods compose with Enter too — never send mid-composition.
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
              e.preventDefault()
              send(draft)
            }}
            placeholder={running ? 'Claude is answering…' : 'Ask Claude about this project…'}
            aria-label="Message Claude"
            className="flex-1 resize-none bg-transparent text-[13.5px] leading-[1.45] text-ink placeholder:text-ink-faint outline-none max-h-[160px] [field-sizing:content] py-0.5"
          />
          {runningTurn ? (
            <button
              onClick={() => stop(runningTurn.id)}
              title="Stop"
              aria-label="Stop Claude"
              className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-ink text-surface transition hover:opacity-85"
            >
              <Square size={11} strokeWidth={0} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => send(draft)}
              disabled={!draft.trim()}
              title="Send (Enter)"
              aria-label="Send"
              className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full brand-btn text-white transition disabled:opacity-35"
            >
              <ArrowUp size={15} strokeWidth={2.2} />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-ink-faint">
          Runs Claude Code with your Claude subscription. Nothing changes until you press Apply.
        </p>
      </div>

      {preview && <DeckPreview deck={preview} onClose={() => setPreview(null)} />}
    </div>
    </LinkEnvCtx>
  )
}

function ModelToggle({ value, onChange }: { value: ClaudeModel; onChange: (m: ClaudeModel) => void }) {
  const opts: { id: ClaudeModel; label: string; hint: string }[] = [
    { id: 'sonnet', label: 'Sonnet', hint: 'Fast — most questions and decks' },
    { id: 'opus', label: 'Opus', hint: 'Slower, uses more of your limit — hard planning' },
  ]
  return (
    <div role="radiogroup" aria-label="Model" className="flex rounded-[8px] bg-fill p-[2px] mr-1">
      {opts.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={`px-2 py-[3px] rounded-[6px] text-[11.5px] font-medium transition ${
            value === o.id
              ? 'bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function EmptyState({ projectName, onPick }: { projectName: string; onPick: (text: string) => void }) {
  return (
    <div className="pt-6">
      <div className="w-10 h-10 rounded-[12px] bg-accent-soft text-accent flex items-center justify-center">
        <Sparkles size={19} strokeWidth={1.8} aria-hidden />
      </div>
      <h3 className="mt-3 text-[15px] font-semibold text-ink">Ask about {projectName}</h3>
      <p className="mt-1 text-[13px] leading-[1.45] text-ink-muted">
        Claude reads this project's sprints, tasks, members and days off. Ask for a summary, a slide deck,
        or changes — changes wait for your Apply.
      </p>
      <div className="mt-4 flex flex-col items-start gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="text-left rounded-full border border-border-hair px-3 py-1.5 text-[12.5px] text-ink hover:border-accent/40 hover:bg-accent-soft hover:text-accent transition"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function AssistantView({
  turn,
  projectId,
  onPreview,
  onRetry,
}: {
  turn: AssistantTurn
  projectId: string
  onPreview: (deck: Deck) => void
  onRetry: () => void
}) {
  // Clock for the elapsed counter and the stall hint, ticking only while running.
  const [now, setNow] = useState(turn.startedAt)
  useEffect(() => {
    if (turn.status !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [turn.status])
  const elapsed = Math.max(0, Math.floor((now - turn.startedAt) / 1000))
  const stalled = turn.status === 'running' && !turn.alive && now - turn.startedAt > STALL_HINT_MS

  return (
    <RefsCtx value={turn.refs}>
    <div className="space-y-3">
      {turn.reply ? (
        <Markdown text={turn.reply} />
      ) : turn.status === 'running' ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-muted">
          <LoaderCircle size={14} strokeWidth={2} className="animate-spin motion-reduce:animate-none" aria-hidden />
          {turn.alive ? 'Reading project…' : 'Starting Claude Code…'}
          <span className="text-ink-faint tab-data">{elapsed}s</span>
        </div>
      ) : null}

      {turn.status === 'running' && turn.reply && (
        <div className="flex items-center gap-1.5 text-[12px] text-ink-faint">
          <LoaderCircle size={12} strokeWidth={2} className="animate-spin motion-reduce:animate-none" aria-hidden />
          Writing… <span className="tab-data">{elapsed}s</span>
        </div>
      )}

      {stalled && (
        <div className="rounded-[10px] bg-[color-mix(in_srgb,var(--color-warn-ink)_10%,transparent)] px-3 py-2 text-[12.5px] leading-[1.45] text-warn-ink">
          macOS may be waiting for you to allow plan-up to access Documents (where Claude Code keeps its
          login). Look for a permission dialog, possibly behind this window.
        </div>
      )}

      {turn.status === 'stopped' && <p className="text-[12px] text-ink-faint">Stopped.</p>}

      {turn.status === 'error' && (
        <div className="rounded-[10px] bg-[color-mix(in_srgb,var(--color-overdue)_9%,transparent)] px-3 py-2.5">
          <div className="flex items-start gap-2 text-[12.5px] leading-[1.45] text-overdue">
            <TriangleAlert size={14} strokeWidth={2} className="shrink-0 mt-[2px]" aria-hidden />
            <span className="whitespace-pre-wrap break-words">{turn.error}</span>
          </div>
          <button
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
          >
            <RotateCw size={12} strokeWidth={2} /> Try again
          </button>
        </div>
      )}

      {turn.deck && <DeckCard deck={turn.deck} onPreview={() => onPreview(turn.deck!)} />}
      {turn.proposal && <ProposalCard proposal={turn.proposal} projectId={projectId} turnId={turn.id} />}
    </div>
    </RefsCtx>
  )
}

// ── Deck ─────────────────────────────────────────────────────────────────────

function useDeckFile(deck: Deck) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true)
    setNote(null)
    try {
      const path = await fn()
      if (path) setNote({ ok: true, text: `Saved to ${path.replace(/^\/Users\/[^/]+/, '~')}` })
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }
  return {
    busy,
    note,
    open: () => run(() => openDeck(deck)),
    save: () => run(() => saveDeck(deck)),
  }
}

const deckBtn =
  'inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-medium transition disabled:opacity-40'

function DeckCard({ deck, onPreview }: { deck: Deck; onPreview: () => void }) {
  const file = useDeckFile(deck)
  return (
    <div className="rounded-[12px] border border-border-hair p-3">
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 w-[30px] h-[30px] rounded-[8px] flex items-center justify-center bg-accent-soft text-accent">
          <Presentation size={15} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-ink truncate">{deck.title}</div>
          <div className="text-[12px] text-ink-muted tab-data">
            {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'} · HTML
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button onClick={onPreview} className={`${deckBtn} bg-fill text-ink hover:bg-[var(--color-surface-hover)]`}>
          <Eye size={13} strokeWidth={1.9} /> Preview
        </button>
        <button onClick={file.open} disabled={file.busy} className={`${deckBtn} text-accent hover:bg-accent-soft`}>
          <ExternalLink size={13} strokeWidth={1.9} /> Open in browser
        </button>
        <button onClick={file.save} disabled={file.busy} className={`${deckBtn} text-accent hover:bg-accent-soft`}>
          <Download size={13} strokeWidth={1.9} /> Save as…
        </button>
      </div>
      {file.note && (
        <p className={`mt-2 text-[11.5px] break-all ${file.note.ok ? 'text-ink-faint' : 'text-overdue'}`}>{file.note.text}</p>
      )}
    </div>
  )
}

function DeckPreview({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const file = useDeckFile(deck)
  return (
    <ModalSheet title={deck.title} onClose={onClose} maxWidth="max-w-5xl">
      {/* No scripts in the preview (sandbox): the deck reads as a stack of slides without them. */}
      <iframe
        title={`${deck.title} preview`}
        sandbox=""
        srcDoc={renderDeckHtml(deck, { script: false })}
        className="w-full h-[68vh] rounded-[12px] border border-border-hair bg-canvas"
      />
      <div className="flex items-center gap-2">
        {file.note && (
          <p className={`text-[12px] truncate ${file.note.ok ? 'text-ink-faint' : 'text-overdue'}`}>{file.note.text}</p>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={file.open} disabled={file.busy} className={`${deckBtn} text-accent hover:bg-accent-soft`}>
            <ExternalLink size={13} strokeWidth={1.9} /> Open in browser
          </button>
          <button onClick={file.save} disabled={file.busy} className={`${deckBtn} text-accent hover:bg-accent-soft`}>
            <Download size={13} strokeWidth={1.9} /> Save as…
          </button>
          <button onClick={onClose} className={`${deckBtn} brand-btn text-white px-4`}>
            Done
          </button>
        </div>
      </div>
    </ModalSheet>
  )
}

// ── Proposed changes ─────────────────────────────────────────────────────────

const VERB_CLASS: Record<ResolvedAction['verb'], string> = {
  Create: 'bg-accent-soft text-accent',
  Edit: 'bg-fill text-ink-muted',
  Move: 'bg-fill text-ink-muted',
  Prereqs: 'bg-fill text-ink-muted',
  Note: 'bg-fill text-ink-muted',
  Delete: 'bg-[color-mix(in_srgb,var(--color-overdue)_12%,transparent)] text-overdue',
}

function ProposalCard({ proposal, projectId, turnId }: { proposal: Proposal; projectId: string; turnId: string }) {
  const confirm = useConfirm()
  const pending = proposal.state === 'pending' || proposal.state === 'applying'
  const chosen = proposal.actions.filter((a) => !a.error && proposal.selected.includes(a.key)).length
  const total = proposal.actions.length

  return (
    <div className="rounded-[12px] border border-border-hair overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-border-hair">
        <span className="text-[12px] font-semibold text-ink-muted">Proposed changes</span>
        <span className="text-[12px] text-ink-faint tab-data">{total}</span>
      </div>
      <ul className={`divide-y divide-[var(--color-border-hair)] ${pending ? '' : 'opacity-60'}`}>
        {proposal.actions.map((a) => {
          const on = !a.error && proposal.selected.includes(a.key)
          return (
            <li key={a.key} className={`px-3 py-2 ${a.error ? 'opacity-50' : ''}`}>
              <label className={`flex items-start gap-2.5 ${pending && !a.error ? 'cursor-pointer' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!pending || !!a.error || proposal.state === 'applying'}
                  onChange={() => toggleAction(projectId, turnId, a.key)}
                  className="mt-[3px] accent-[var(--color-accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <span className={`shrink-0 rounded-full px-1.5 py-[1px] text-[10.5px] font-semibold ${VERB_CLASS[a.verb]}`}>
                      {a.verb}
                    </span>
                    <ProposalSubject action={a} />
                  </span>
                  {a.details.map((d, i) => (
                    <span key={i} className="block mt-0.5 text-[12px] text-ink-muted break-words">
                      {d}
                    </span>
                  ))}
                  {a.error ? (
                    <span className="block mt-0.5 text-[11.5px] text-overdue">{a.error}</span>
                  ) : (
                    a.reason && <span className="block mt-0.5 text-[11.5px] text-ink-faint">{a.reason}</span>
                  )}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="px-3 py-2.5 border-t border-border-hair">
        {proposal.state === 'pending' || proposal.state === 'applying' ? (
          <>
            {proposal.error && <p className="mb-2 text-[12px] text-overdue">{proposal.error}</p>}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => discardProposal(projectId, turnId)}
                disabled={proposal.state === 'applying'}
                className="rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium text-ink-muted hover:bg-surface-hover transition"
              >
                Discard
              </button>
              <button
                onClick={() => void applyProposal(projectId, turnId, confirm)}
                disabled={!chosen || proposal.state === 'applying'}
                className="brand-btn inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40"
              >
                {proposal.state === 'applying' && (
                  <LoaderCircle size={12} strokeWidth={2.2} className="animate-spin motion-reduce:animate-none" />
                )}
                Apply {chosen} change{chosen === 1 ? '' : 's'}
              </button>
            </div>
          </>
        ) : proposal.state === 'applied' ? (
          <div className="space-y-1.5">
            {proposal.error && <p className="text-[12px] text-overdue">{proposal.error}</p>}
            <div className="flex items-center gap-2">
              {!!proposal.applied && (
                <Check size={14} strokeWidth={2.2} className="text-status-done shrink-0" aria-hidden />
              )}
              <span className="text-[12.5px] text-ink">
                Applied {proposal.applied} change{proposal.applied === 1 ? '' : 's'}
                {proposal.summary && <span className="text-ink-muted"> · {proposal.summary}</span>}
              </span>
              {proposal.snapshot && (
                <button
                  onClick={() => void undoProposal(projectId, turnId, confirm)}
                  className="ml-auto inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12.5px] font-medium text-accent hover:bg-accent-soft transition"
                >
                  <Undo2 size={13} strokeWidth={2} /> Undo
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-muted">
            {proposal.state === 'undone' ? 'Applied, then undone.' : 'Discarded.'}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Markdown (the small subset Claude is asked to write) ─────────────────────

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let cur: Block | null = null
  const push = (b: Block) => {
    blocks.push(b)
    cur = b
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const head = /^#{1,6}\s+(.*)$/.exec(line)
    const c = cur as Block | null
    if (!line.trim()) cur = null
    else if (head) {
      push({ kind: 'h', text: head[1] })
      cur = null
    } else if (bullet) {
      if (c?.kind === 'ul') c.items.push(bullet[1])
      else push({ kind: 'ul', items: [bullet[1]] })
    } else if (num) {
      if (c?.kind === 'ol') c.items.push(num[1])
      else push({ kind: 'ol', items: [num[1]] })
    } else if (c?.kind === 'p') c.lines.push(line)
    else if ((c?.kind === 'ul' || c?.kind === 'ol') && /^\s{2,}/.test(raw)) {
      c.items[c.items.length - 1] += ` ${line.trim()}`
    } else push({ kind: 'p', lines: [line] })
  }
  return blocks
}

/**
 * Inline: reference links (`[#12 "Login"](t12)`, `[An](m1)`, `[Sprint 3](s2)`) become
 * clickable chips; the text between them goes through `code` spans and RichText.
 */
function Inline({ text }: { text: string }) {
  const re = new RegExp(REF_LINK_SOURCE, 'g')
  const out: React.ReactNode[] = []
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(<PlainInline key={`p${last}`} text={text.slice(last, m.index)} />)
    out.push(<RefLink key={`r${m.index}`} label={m[1]} handle={m[2]} />)
    last = m.index + m[0].length
  }
  if (last === 0) return <PlainInline text={text} />
  if (last < text.length) out.push(<PlainInline key={`p${last}`} text={text.slice(last)} />)
  return <>{out}</>
}

/** A task label as Claude writes it, `#12 "Login API"` → `#12 Login API` (calmer). */
function taskLabel(label: string): string {
  return label.replace(/^(#\d+)\s+"(.*)"(.*)$/, '$1 $2$3')
}

function RefLink({ label, handle }: { label: string; handle: string }) {
  const env = useContext(LinkEnvCtx)
  const ref = useContext(RefsCtx)?.[handle]
  // A new-task ref (n1) or a handle we never had: just the label.
  if (!env || !ref) return <RichText text={label} />
  const alive =
    ref.kind === 'task' ? env.taskIds.has(ref.id) : ref.kind === 'member' ? env.members.has(ref.id) : env.sprintIds.has(ref.id)
  if (!alive) {
    return (
      <span title="No longer in this project" className="text-ink-faint">
        <RichText text={ref.kind === 'task' ? taskLabel(label) : label} />
      </span>
    )
  }
  if (ref.kind === 'member') {
    const m = env.members.get(ref.id)!
    return (
      <button
        type="button"
        onClick={() => env.show.member(ref.id)}
        title={`Show ${m.name} in the plan`}
        className="inline-flex items-baseline gap-1 rounded-[5px] px-[3px] -mx-[1px] font-medium text-ink hover:bg-accent-soft hover:text-accent transition-colors"
      >
        <Avatar member={m} size={15} ring={false} className="self-center text-[8px]" />
        <RichText text={label} />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => (ref.kind === 'task' ? env.show.task(ref.id) : env.show.sprint(ref.id))}
      title={ref.kind === 'task' ? 'Show this task in the plan' : 'Open this sprint'}
      className="inline rounded-[5px] px-[3px] -mx-[1px] font-medium text-accent hover:bg-accent-soft transition-colors text-left"
    >
      <RichText text={ref.kind === 'task' ? taskLabel(label) : label} />
    </button>
  )
}

function ProposalSubject({ action: a }: { action: ResolvedAction }) {
  const env = useContext(LinkEnvCtx)
  const id = a.task && 'id' in a.task ? a.task.id : undefined
  const cls = `text-[13px] text-ink truncate ${a.verb === 'Delete' ? 'line-through decoration-[1.5px]' : ''}`
  if (!env || !id || !env.taskIds.has(id) || a.error) return <span className={cls}>{a.subject}</span>
  return (
    <button
      type="button"
      onClick={(e) => {
        // Inside the row's <label>: don't toggle the checkbox.
        e.preventDefault()
        env.show.task(id)
      }}
      title="Show this task in the plan"
      className={`${cls} text-left hover:text-accent hover:underline decoration-accent/40 underline-offset-2`}
    >
      {a.subject}
    </button>
  )
}

/** `code` spans, then RichText's **bold** / *italic* / ~~strike~~. */
function PlainInline({ text }: { text: string }) {
  const parts = text.split('`')
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 && i < parts.length - 1 ? (
          <code key={i} className="rounded-[4px] bg-fill px-1 py-[1px] text-[12.5px]">
            {p}
          </code>
        ) : (
          <RichText key={i} text={i % 2 === 1 ? `\`${p}` : p} />
        )
      )}
    </>
  )
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-[13.5px] leading-[1.5] text-ink break-words">
      {parseBlocks(text).map((b, i) => {
        if (b.kind === 'h') {
          return (
            <p key={i} className="font-semibold pt-1">
              <Inline text={b.text} />
            </p>
          )
        }
        if (b.kind === 'p') {
          return (
            <p key={i} className="whitespace-pre-wrap">
              <Inline text={b.lines.join('\n')} />
            </p>
          )
        }
        const List = b.kind
        return (
          <List key={i} className={`space-y-1 pl-5 ${b.kind === 'ul' ? 'list-disc' : 'list-decimal'} marker:text-ink-faint`}>
            {b.items.map((it, k) => (
              <li key={k}>
                <Inline text={it} />
              </li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
