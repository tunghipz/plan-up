import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  X,
  FilePlus2,
  CheckCircle2,
  Circle,
  CircleDot,
  User,
  Flag,
  Calendar,
  Clock,
  Link2,
  RotateCcw,
  Rocket,
  Pencil,
  type LucideIcon,
} from 'lucide-react'
import { sprintEvents, type ActivityEvent, type LoggableField, type Member, type Task } from './db'
import {
  STATUS_LABEL,
  PRIORITY_LABEL,
  FIELD_LABEL,
  formatShortDate,
  formatRelativeTime,
  formatTimestamp,
} from './lib'

/**
 * Sprint-wide activity log page (design-docs/sprint-activity-log.md). Aggregates
 * the append-only `events` store for one sprint into one timeline. Two views:
 * Timeline (day-grouped, newest-first) and By member (grouped by the task's
 * current assignee — single-user app, so "member" is an assignee label, never an
 * actor). Reuses the changeLog rendering grammar (old → new, semantic color on
 * the new value, "+ x" for added prereq/assignee) for visual parity with the
 * per-task 🕒 tooltip.
 */

type ActViewMode = 'timeline' | 'member'

/** Icon + semantic color for an event. Mirrors ChangeLogTooltip's cues. */
function visuals(e: ActivityEvent): { Icon: LucideIcon; color: string } {
  if (e.kind === 'created') return { Icon: FilePlus2, color: 'var(--color-accent)' }
  if (e.kind === 'rolled_over') return { Icon: RotateCcw, color: 'var(--color-ink-muted)' }
  if (e.kind === 'sprint_started') return { Icon: Rocket, color: 'var(--color-accent)' }
  // kind === 'edit'
  switch (e.field) {
    case 'status':
      if (e.to === 'done') return { Icon: CheckCircle2, color: 'var(--color-status-done)' }
      if (e.to === 'in_progress') return { Icon: CircleDot, color: 'var(--color-status-progress)' }
      return { Icon: Circle, color: 'var(--color-status-todo)' }
    case 'priority':
      return {
        Icon: Flag,
        color:
          e.to === 'urgent'
            ? 'var(--color-priority-urgent)'
            : e.to === 'high'
              ? 'var(--color-priority-high)'
              : 'var(--color-ink-muted)',
      }
    case 'assigneeId':
      return { Icon: User, color: 'var(--color-accent)' }
    case 'startDate':
    case 'dueDate':
      return { Icon: Calendar, color: 'var(--color-ink-muted)' }
    case 'estimate':
      return { Icon: Clock, color: 'var(--color-ink-muted)' }
    case 'dependsOn':
      return { Icon: Link2, color: 'var(--color-accent)' }
    default:
      return { Icon: Pencil, color: 'var(--color-ink-muted)' }
  }
}

/** Display text for a raw edit value (assignee/dependsOn are already labels). */
function formatValue(field: LoggableField, v: string | null): string {
  if (v === null) return '—'
  switch (field) {
    case 'status':
      return STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? v
    case 'priority':
      return PRIORITY_LABEL[v as keyof typeof PRIORITY_LABEL] ?? v
    case 'startDate':
    case 'dueDate':
      return formatShortDate(v)
    case 'estimate':
      return `${v}d`
    default:
      return v
  }
}

/** CSS color for the NEW value when the field carries a semantic color. */
function newValueColor(field: LoggableField, to: string): string | undefined {
  if (field === 'status')
    return `var(--color-status-${to === 'in_progress' ? 'progress' : to})`
  if (field === 'priority')
    return to === 'urgent' || to === 'high' ? `var(--color-priority-${to})` : undefined
  return undefined
}

/** The change phrase for one event. */
function ChangePhrase({ e }: { e: ActivityEvent }) {
  if (e.kind === 'created') return <span className="font-medium text-ink">Created</span>
  if (e.kind === 'sprint_started')
    return <span className="font-medium text-ink">Sprint started</span>
  if (e.kind === 'rolled_over')
    return (
      <span>
        Rolled over from <span className="font-medium text-ink">{e.from}</span>
      </span>
    )
  // edit — lean on add/remove when one side is the empty set
  if ((e.field === 'dependsOn' || e.field === 'assigneeId')) {
    if (e.from === null && e.to !== null)
      return (
        <span className="font-medium" style={{ color: 'var(--color-status-done)' }}>
          + {e.to}
        </span>
      )
    if (e.to === null && e.from !== null)
      return <span className="text-ink-faint line-through">{e.from}</span>
  }
  const noun = e.field ? FIELD_LABEL[e.field] : ''
  const color = e.to !== null && e.field ? newValueColor(e.field, e.to) : undefined
  return (
    <span>
      <span className="text-ink-muted">{noun} </span>
      <span className="text-ink-faint">{formatValue(e.field!, e.from)}</span>
      <span className="text-ink-faint mx-1.5">→</span>
      <span className="font-medium text-ink" style={color ? { color } : undefined}>
        {formatValue(e.field!, e.to)}
      </span>
    </span>
  )
}

function TaskRef({ e }: { e: ActivityEvent }) {
  if (e.taskSeq === null && e.taskTitle === null)
    return <span className="font-medium text-ink">Sprint</span>
  return (
    <span className="font-medium">
      {e.taskSeq !== null && (
        <span className="text-ink-faint tabular-nums mr-1.5">#{e.taskSeq}</span>
      )}
      <span className="text-ink">{e.taskTitle}</span>
    </span>
  )
}

function EventIcon({ e }: { e: ActivityEvent }) {
  const { Icon, color } = visuals(e)
  return (
    <span
      className="w-7 h-7 rounded-full grid place-items-center shrink-0"
      style={{ background: `color-mix(in srgb, ${color} 13%, transparent)` }}
    >
      <Icon size={15} color={color} strokeWidth={2} />
    </span>
  )
}

/* ---- day bucketing for the Timeline view ---- */
function dayKeyOf(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function dayLabel(key: string): string {
  const now = new Date()
  const today = dayKeyOf(now.getTime())
  const yest = dayKeyOf(now.getTime() - 86_400_000)
  if (key === today) return 'Today'
  if (key === yest) return 'Yesterday'
  return formatShortDate(key)
}

const CARD =
  'bg-surface rounded-[14px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)]'

function EventRow({ e }: { e: ActivityEvent }) {
  return (
    <div className="flex items-center gap-3 px-[18px] py-[11px] border-t border-border first:border-t-0 hover:bg-surface-hover transition-colors">
      <EventIcon e={e} />
      <div className="min-w-0 flex-1 text-[14.5px] leading-snug">
        <TaskRef e={e} />
        <span className="text-ink-faint mx-1.5">·</span>
        <ChangePhrase e={e} />
      </div>
      <span
        className="text-[12px] text-ink-faint tabular-nums whitespace-nowrap"
        title={formatTimestamp(e.ts)}
      >
        {formatRelativeTime(e.ts)}
      </span>
    </div>
  )
}

function TimelineView({ events }: { events: ActivityEvent[] }) {
  // events already newest-first; bucket into contiguous day groups preserving order
  const groups: { key: string; items: ActivityEvent[] }[] = []
  for (const e of events) {
    const key = dayKeyOf(e.ts)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(e)
    else groups.push({ key, items: [e] })
  }
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="flex items-baseline gap-2 px-1 pb-2">
            <span className="text-[13px] font-semibold text-ink">{dayLabel(g.key)}</span>
            <span className="text-[11px] text-ink-faint tabular-nums">{g.items.length}</span>
          </div>
          <div className={CARD}>
            {g.items.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MemberGroupView({
  events,
  tasksById,
  membersById,
}: {
  events: ActivityEvent[]
  tasksById: Map<string, Task>
  membersById: Map<string, Member>
}) {
  // group by the task's CURRENT assignee (single-user → a label, not an actor).
  // Sprint-level events (no task) are excluded.
  const groups = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, ActivityEvent[]>()
    for (const e of events) {
      if (!e.taskId) continue
      const assignee = tasksById.get(e.taskId)?.assigneeId ?? 'unassigned'
      if (!map.has(assignee)) {
        map.set(assignee, [])
        order.push(assignee)
      }
      map.get(assignee)!.push(e)
    }
    return order.map((key) => ({ key, items: map.get(key)! }))
  }, [events, tasksById])

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 px-1 text-[12px] text-ink-faint leading-snug">
        <User size={14} className="shrink-0 mt-[1px]" />
        <span>
          Single-user app — “member” is the task’s assignee label, not who made the change.
        </span>
      </p>
      {groups.map(({ key, items }) => {
        const m = membersById.get(key)
        return (
          <div key={key} className={CARD}>
            <div className="flex items-center gap-2.5 px-[18px] py-[13px] border-b border-border">
              {m ? (
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                  style={{ background: m.color }}
                >
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs text-ink-faint border border-dashed border-border-strong">
                  —
                </span>
              )}
              <span className="text-[15.5px] font-semibold text-ink">
                {m ? m.name : 'Unassigned'}
              </span>
              <span className="ml-auto text-[11px] text-ink-faint tabular-nums">
                {items.length}
              </span>
            </div>
            {items.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

export function ActivityLog({
  sprintId,
  sprintRange,
  tasks,
  members,
  onClose,
}: {
  sprintId: string
  sprintRange: string
  tasks: Task[]
  members: Member[]
  onClose: () => void
}) {
  const [view, setView] = useState<ActViewMode>('timeline')
  const events = useLiveQuery(() => sprintEvents(sprintId), [sprintId]) ?? []

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  // Drawer body (App.tsx owns the positioned shell + backdrop, mirroring the
  // ProjectSettingsView/settings-drawer pairing). Header matches the 54px
  // settings header; body is the scrolling inset-cards-on-canvas region.
  return (
    <div className="flex h-full flex-col min-w-0 overflow-hidden">
      <header className="h-[54px] shrink-0 border-b border-border-hair bg-surface flex items-center px-5 gap-2.5">
        <h1 className="text-[15px] font-semibold text-ink tracking-[-0.01em] shrink-0">
          Activity log
        </h1>
        <span className="text-[12px] text-ink-faint tabular-nums truncate min-w-0">
          {sprintRange} · {events.length} event{events.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={onClose}
          className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-faint hover:text-ink hover:bg-surface-hover transition shrink-0"
          title="Close activity log (Esc)"
          aria-label="Close activity log"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-auto bg-canvas px-5 py-4">
        <div className="inline-flex bg-fill rounded-[9px] p-0.5 mb-4">
          {(
            [
              ['timeline', 'Timeline'],
              ['member', 'By member'],
            ] as [ActViewMode, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={`text-[13px] px-3.5 py-1 rounded-[7px] transition-colors ${
                view === k
                  ? 'bg-surface text-ink font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]'
                  : 'text-ink-muted font-medium'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {events.length === 0 ? (
          <p className="text-center text-ink-faint text-[14px] py-16">
            No activity yet in this sprint.
          </p>
        ) : view === 'timeline' ? (
          <TimelineView events={events} />
        ) : (
          <MemberGroupView events={events} tasksById={tasksById} membersById={membersById} />
        )}
      </div>
    </div>
  )
}
