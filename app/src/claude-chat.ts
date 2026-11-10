// Conversation state and actions of the Claude assistant (design-docs/claude-assistant.md).
// One chat per project, kept in memory for the life of the app. A module store (not React
// state) so a run keeps writing into its chat after the panel closes or the project changes.

import { useSyncExternalStore } from 'react'
import {
  projectPlanSignature,
  restoreProjectPlan,
  snapshotProjectPlan,
  type ProjectPlanSnapshot,
} from './db'
import { buildContext, loadContextData } from './claude-context'
import { applyActions, resolveActions, summarizeActions, type ResolvedAction } from './claude-actions'
import { deckFileName, renderDeckHtml, sanitizeDeck, type Deck } from './claude-deck'
import { ANSWER_SCHEMA, SYSTEM_PROMPT, buildPrompt, stripRefLinks, type HistoryTurn } from './claude-prompt'
import { describeClaudeError, runClaude, type ClaudeModel } from './claude-run'
import type { ConfirmOpts } from './confirm-context'
import { safeStorage, todayLocalISO } from './lib'

/** Earlier turns re-told in each prompt (the CLI keeps no session). */
const HISTORY_TURNS = 12
const MODEL_KEY = 'plan-up:claudeModel'

export interface UserTurn {
  id: string
  role: 'user'
  text: string
}

export interface Proposal {
  actions: ResolvedAction[]
  /** Keys of the rows that are ticked. */
  selected: string[]
  state: 'pending' | 'applying' | 'applied' | 'discarded' | 'undone'
  applied?: number
  summary?: string
  error?: string
  snapshot?: ProjectPlanSnapshot
  /** Plan signature right after Apply — a different one at Undo means later edits. */
  sigAfter?: string
}

/** What a link in an answer points at (handle → real id, frozen at question time). */
export interface ClaudeRef {
  kind: 'task' | 'member' | 'sprint'
  id: string
}

export interface AssistantTurn {
  id: string
  role: 'assistant'
  status: 'running' | 'done' | 'error' | 'stopped'
  reply: string
  /** The CLI printed its first line. */
  alive: boolean
  startedAt: number
  /** The question that started it (Try again). */
  request: string
  error?: string
  /** Handles of the snapshot this answer was written against. */
  refs?: Record<string, ClaudeRef>
  deck?: Deck
  proposal?: Proposal
}

export type Turn = UserTurn | AssistantTurn

export interface Chat {
  turns: Turn[]
}

const EMPTY: Chat = { turns: [] }
const chats = new Map<string, Chat>()
const controllers = new Map<string, AbortController>()
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function setChat(projectId: string, fn: (c: Chat) => Chat) {
  chats.set(projectId, fn(chats.get(projectId) ?? EMPTY))
  for (const l of listeners) l()
}

function patchTurn(projectId: string, turnId: string, patch: (t: AssistantTurn) => Partial<AssistantTurn>) {
  setChat(projectId, (c) => ({
    turns: c.turns.map((t) => (t.id === turnId && t.role === 'assistant' ? { ...t, ...patch(t) } : t)),
  }))
}

function patchProposal(projectId: string, turnId: string, patch: (p: Proposal) => Partial<Proposal>) {
  patchTurn(projectId, turnId, (t) => (t.proposal ? { proposal: { ...t.proposal, ...patch(t.proposal) } } : {}))
}

function findTurn(projectId: string, turnId: string): AssistantTurn | undefined {
  const t = chats.get(projectId)?.turns.find((x) => x.id === turnId)
  return t?.role === 'assistant' ? t : undefined
}

export function useChat(projectId: string): Chat {
  return useSyncExternalStore(subscribe, () => chats.get(projectId) ?? EMPTY)
}

export function isRunning(chat: Chat): boolean {
  return chat.turns.some((t) => t.role === 'assistant' && t.status === 'running')
}

export function loadModel(): ClaudeModel {
  return safeStorage.get(MODEL_KEY) === 'opus' ? 'opus' : 'sonnet'
}

export function saveModel(m: ClaudeModel) {
  safeStorage.set(MODEL_KEY, m)
}

/** What became of an answer, for the next prompt. */
function outcomes(t: AssistantTurn): string[] {
  const out: string[] = []
  if (t.deck) out.push(`made deck "${t.deck.title}" (${t.deck.slides.length} slides)`)
  const p = t.proposal
  if (p) {
    const n = p.actions.filter((a) => !a.error).length
    if (p.state === 'applied') out.push(`proposed ${n} changes; the user applied ${p.applied ?? 0} (${p.summary ?? ''})${p.error ? `, then: ${p.error}` : ''}`)
    else if (p.state === 'undone') out.push(`proposed ${n} changes; the user applied them, then undid them`)
    else if (p.state === 'discarded') out.push(`proposed ${n} changes; the user discarded them`)
    else out.push(`proposed ${n} changes; the user has not acted on them yet`)
  }
  return out
}

function toHistory(turns: Turn[]): HistoryTurn[] {
  return turns.slice(-HISTORY_TURNS).map((t) => {
    if (t.role === 'user') return { role: 'user', text: t.text }
    if (t.status === 'done') return { role: 'assistant', text: stripRefLinks(t.reply), outcomes: outcomes(t) }
    return {
      role: 'assistant',
      text: stripRefLinks(t.reply) || '(no answer)',
      outcomes: [t.status === 'stopped' ? 'stopped by the user' : 'failed'],
    }
  })
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export async function ask(
  projectId: string,
  currentSprintId: string | null,
  text: string,
  model: ClaudeModel
): Promise<void> {
  const request = text.trim()
  if (!request) return
  const history = toHistory((chats.get(projectId) ?? EMPTY).turns)
  const turn: AssistantTurn = {
    id: newId(),
    role: 'assistant',
    status: 'running',
    reply: '',
    alive: false,
    startedAt: Date.now(),
    request,
  }
  setChat(projectId, (c) => ({ turns: [...c.turns, { id: newId(), role: 'user', text: request }, turn] }))
  const controller = new AbortController()
  controllers.set(turn.id, controller)
  try {
    const data = await loadContextData(projectId, currentSprintId, todayLocalISO())
    if (!data) throw new Error('This project no longer exists.')
    const ctx = buildContext(data)
    const refs: Record<string, ClaudeRef> = {}
    for (const [h, id] of ctx.handles.task) refs[h] = { kind: 'task', id }
    for (const [h, id] of ctx.handles.member) refs[h] = { kind: 'member', id }
    for (const [h, id] of ctx.handles.sprint) refs[h] = { kind: 'sprint', id }
    // Before the run: links become clickable while the answer is still streaming.
    patchTurn(projectId, turn.id, () => ({ refs }))
    const result = (await runClaude({
      model,
      systemPrompt: SYSTEM_PROMPT,
      prompt: buildPrompt(ctx.text, history, request),
      jsonSchema: ANSWER_SCHEMA,
      signal: controller.signal,
      onAlive: () => patchTurn(projectId, turn.id, () => ({ alive: true })),
      onReply: (reply) => patchTurn(projectId, turn.id, () => ({ reply })),
    })) as Record<string, unknown> | null
    const actions = resolveActions(result?.actions, data, ctx.handles)
    patchTurn(projectId, turn.id, () => ({
      status: 'done',
      reply: typeof result?.reply === 'string' ? result.reply : '',
      deck: sanitizeDeck(result?.deck) ?? undefined,
      proposal: actions.length
        ? { actions, selected: actions.filter((a) => !a.error).map((a) => a.key), state: 'pending' }
        : undefined,
    }))
  } catch (err) {
    if (controller.signal.aborted) {
      patchTurn(projectId, turn.id, () => ({ status: 'stopped' }))
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      patchTurn(projectId, turn.id, () => ({ status: 'error', error: describeClaudeError(msg) }))
    }
  } finally {
    controllers.delete(turn.id)
  }
}

export function stop(turnId: string) {
  controllers.get(turnId)?.abort()
}

/** Drop a failed answer (and its question), then ask again. */
export function retry(projectId: string, turnId: string, currentSprintId: string | null, model: ClaudeModel) {
  const turns = (chats.get(projectId) ?? EMPTY).turns
  const i = turns.findIndex((t) => t.id === turnId)
  const turn = turns[i]
  if (i < 0 || turn.role !== 'assistant') return
  const from = i > 0 && turns[i - 1].role === 'user' ? i - 1 : i
  setChat(projectId, (c) => ({ turns: c.turns.filter((_, k) => k < from || k > i) }))
  void ask(projectId, currentSprintId, turn.request, model)
}

export function clearChat(projectId: string) {
  for (const t of (chats.get(projectId) ?? EMPTY).turns) if (t.role === 'assistant') stop(t.id)
  setChat(projectId, () => EMPTY)
}

export function toggleAction(projectId: string, turnId: string, key: string) {
  patchProposal(projectId, turnId, (p) => ({
    selected: p.selected.includes(key) ? p.selected.filter((k) => k !== key) : [...p.selected, key],
  }))
}

export function discardProposal(projectId: string, turnId: string) {
  patchProposal(projectId, turnId, () => ({ state: 'discarded' }))
}

type Confirm = (opts: ConfirmOpts) => Promise<boolean>

export async function applyProposal(projectId: string, turnId: string, confirm: Confirm) {
  const p = findTurn(projectId, turnId)?.proposal
  if (!p || p.state !== 'pending') return
  const chosen = p.actions.filter((a) => !a.error && p.selected.includes(a.key))
  if (!chosen.length) return
  const deletes = chosen.filter((a) => a.op === 'delete_task')
  if (deletes.length) {
    const ok = await confirm({
      title: deletes.length === 1 ? 'Delete 1 task?' : `Delete ${deletes.length} tasks?`,
      subject: deletes.length === 1 ? deletes[0].subject : `${deletes[0].subject} and ${deletes.length - 1} more`,
      message: 'Claude proposed this. Their subtasks move to the top level. You can Undo right after.',
      confirmLabel: 'Apply',
      destructive: true,
      icon: 'trash',
    })
    if (!ok) return
  }
  patchProposal(projectId, turnId, () => ({ state: 'applying' }))
  try {
    const snapshot = await snapshotProjectPlan(projectId)
    const res = await applyActions(chosen, projectId)
    const sigAfter = await projectPlanSignature(projectId)
    patchProposal(projectId, turnId, () => ({
      state: 'applied',
      applied: res.applied,
      summary: summarizeActions(chosen.filter((a) => !a.error).slice(0, res.applied)),
      error: res.error,
      snapshot: res.applied ? snapshot : undefined,
      sigAfter,
    }))
  } catch (err) {
    patchProposal(projectId, turnId, () => ({
      state: 'pending',
      error: err instanceof Error ? err.message : String(err),
    }))
  }
}

export async function undoProposal(projectId: string, turnId: string, confirm: Confirm) {
  const p = findTurn(projectId, turnId)?.proposal
  if (!p || p.state !== 'applied' || !p.snapshot) return
  if ((await projectPlanSignature(projectId)) !== p.sigAfter) {
    const ok = await confirm({
      title: "Undo Claude's changes?",
      message: 'This project changed after Apply. Undo puts every task and sprint back to how they were before Apply, so those later edits are reverted too.',
      confirmLabel: 'Undo',
      destructive: true,
      icon: 'warning',
    })
    if (!ok) return
  }
  await restoreProjectPlan(p.snapshot)
  patchProposal(projectId, turnId, () => ({ state: 'undone', snapshot: undefined }))
}

/** "Open in browser": written to the app's decks folder. Returns the path. */
export async function openDeck(deck: Deck): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('open_deck', { fileName: deckFileName(deck.title), html: renderDeckHtml(deck) })
}

/** "Save as…": native save panel. Returns the path, or null when cancelled. */
export async function saveDeck(deck: Deck): Promise<string | null> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string | null>('save_deck', { fileName: deckFileName(deck.title), html: renderDeckHtml(deck) })
}
