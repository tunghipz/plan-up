import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Trash2, Flag, ChevronDown, Calendar, UserPlus } from 'lucide-react'
import {
  db,
  uid,
  colorForName,
  deleteMember,
  type Member,
  type Task,
  type Status,
  type Priority,
} from './db'
import { formatRelativeDate, isOverdue } from './lib'

const WELCOME_PREFIX = 'Welcome —'

const STATUS_META: Record<Status, { label: string; varName: string }> = {
  todo: { label: 'To do', varName: 'var(--color-status-todo)' },
  in_progress: { label: 'In progress', varName: 'var(--color-status-progress)' },
  done: { label: 'Done', varName: 'var(--color-status-done)' },
}

const PRIORITY_META: Record<Priority, { label: string; varName: string }> = {
  urgent: { label: 'Urgent', varName: 'var(--color-priority-urgent)' },
  high: { label: 'High', varName: 'var(--color-priority-high)' },
  normal: { label: 'Normal', varName: 'var(--color-priority-normal)' },
  low: { label: 'Low', varName: 'var(--color-priority-low)' },
  none: { label: 'None', varName: 'var(--color-priority-none)' },
}

const COLLAPSE_KEY = (sprintId: string) => `plan-tmp:collapsed:${sprintId}`

function loadCollapsed(sprintId: string): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY(sprintId))
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function saveCollapsed(sprintId: string, set: Set<string>) {
  try {
    localStorage.setItem(COLLAPSE_KEY(sprintId), JSON.stringify([...set]))
  } catch {
    // localStorage unavailable, swallow
  }
}

export function SprintView({
  sprintId,
  sprintStartDate,
  tasks,
  search,
}: {
  sprintId: string
  sprintStartDate: string
  tasks: Task[]
  search: string
}) {
  const members = useLiveQuery(() => db.members.toArray(), [])
  const [showAddMember, setShowAddMember] = useState(false)
  const [showEmpty, setShowEmpty] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    loadCollapsed(sprintId)
  )

  useEffect(() => {
    setCollapsed(loadCollapsed(sprintId))
  }, [sprintId])

  const toggleCollapse = (memberId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      saveCollapsed(sprintId, next)
      return next
    })
  }

  const filteredTasks = useMemo(() => {
    if (!search.trim()) return tasks
    const q = search.toLowerCase()
    return tasks.filter((t) => t.title.toLowerCase().includes(q))
  }, [tasks, search])

  const { groups, emptyMembers, unassigned } = useMemo(() => {
    const ms = members ?? []
    const byMember = new Map<string, Task[]>()
    for (const m of ms) byMember.set(m.id, [])
    const orphan: Task[] = []
    for (const t of filteredTasks) {
      const owner = ms.some((m) => m.id === t.assigneeId) ? t.assigneeId : null
      if (owner) byMember.get(owner)!.push(t)
      else orphan.push(t)
    }
    const filled = ms.filter((m) => (byMember.get(m.id) ?? []).length > 0)
    const empty = ms.filter((m) => (byMember.get(m.id) ?? []).length === 0)
    return {
      groups: filled.map((m) => ({ member: m, tasks: byMember.get(m.id)! })),
      emptyMembers: empty,
      unassigned: orphan,
    }
  }, [members, filteredTasks])

  if (!members) return <p className="text-ink-muted py-12 text-center">Loading…</p>

  const isEmpty = tasks.length === 0 && members.length === 0
  const isFilteredEmpty = filteredTasks.length === 0 && search.trim() !== ''

  const hasAnyTask = groups.length > 0 || unassigned.length > 0

  return (
    <div className="space-y-3 max-w-5xl">
      {isEmpty && <EmptyState onAddMember={() => setShowAddMember(true)} />}

      {isFilteredEmpty && (
        <div className="bg-surface border border-border rounded-lg p-6 text-center text-sm text-ink-muted">
          No tasks match "{search}".
        </div>
      )}

      {hasAnyTask && <TaskColumnHeader />}

      {groups.map(({ member, tasks: t }) => (
        <MemberCard
          key={member.id}
          member={member}
          tasks={t}
          sprintId={sprintId}
          sprintStartDate={sprintStartDate}
          members={members}
          collapsed={collapsed.has(member.id)}
          onToggleCollapse={() => toggleCollapse(member.id)}
        />
      ))}

      {unassigned.length > 0 && (
        <UnassignedCard tasks={unassigned} members={members} />
      )}

      {emptyMembers.length > 0 && (
        <CollapsedMembers
          members={emptyMembers}
          sprintId={sprintId}
          sprintStartDate={sprintStartDate}
          allMembers={members}
          expanded={showEmpty}
          onToggle={() => setShowEmpty((x) => !x)}
        />
      )}

      <AddMemberRow
        active={showAddMember}
        onActivate={() => setShowAddMember(true)}
        onDeactivate={() => setShowAddMember(false)}
      />
    </div>
  )
}

function EmptyState({ onAddMember }: { onAddMember: () => void }) {
  return (
    <div className="bg-surface border border-dashed border-border-strong rounded-lg p-10 text-center">
      <div className="text-base font-medium text-ink mb-1">No members yet</div>
      <p className="text-sm text-ink-muted max-w-sm mx-auto mb-4">
        Add a teammate to start assigning tasks. Members are labels — they don't
        need an account.
      </p>
      <button
        onClick={onAddMember}
        className="text-sm px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded inline-flex items-center gap-1.5"
      >
        <UserPlus size={14} /> Add first member
      </button>
    </div>
  )
}

function MemberCard({
  member,
  tasks,
  sprintId,
  sprintStartDate,
  members,
  collapsed,
  onToggleCollapse,
}: {
  member: Member
  tasks: Task[]
  sprintId: string
  sprintStartDate: string
  members: Member[]
  collapsed: boolean
  onToggleCollapse: () => void
}) {
  return (
    <Card>
      <GroupHeader
        avatar={<Avatar member={member} />}
        name={member.name}
        count={tasks.length}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        onDelete={() => {
          if (
            confirm(
              `Remove ${member.name}? Their tasks will become Unassigned.`
            )
          )
            deleteMember(member.id)
        }}
      />
      {!collapsed && (
        <div className="divide-y divide-border">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} members={members} />
          ))}
          <AddTaskRow
            sprintId={sprintId}
            sprintStartDate={sprintStartDate}
            assigneeId={member.id}
          />
        </div>
      )}
    </Card>
  )
}

function UnassignedCard({
  tasks,
  members,
}: {
  tasks: Task[]
  members: Member[]
}) {
  return (
    <Card>
      <GroupHeader
        avatar={
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs text-ink-faint border border-dashed border-border-strong">
            —
          </span>
        }
        name="Unassigned"
        count={tasks.length}
        muted
      />
      <div className="divide-y divide-border">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} members={members} />
        ))}
      </div>
    </Card>
  )
}

function CollapsedMembers({
  members,
  sprintId,
  sprintStartDate,
  allMembers,
  expanded,
  onToggle,
}: {
  members: Member[]
  sprintId: string
  sprintStartDate: string
  allMembers: Member[]
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="space-y-3">
      <button
        onClick={onToggle}
        className="text-xs text-ink-muted hover:text-ink flex items-center gap-1.5 pl-1"
      >
        <ChevronDown
          size={12}
          className={`transition-transform ${expanded ? '' : '-rotate-90'}`}
        />
        {members.length} member{members.length === 1 ? '' : 's'} with no tasks
      </button>
      {expanded &&
        members.map((m) => (
          <Card key={m.id}>
            <GroupHeader
              avatar={<Avatar member={m} />}
              name={m.name}
              count={0}
              onDelete={() => {
                if (confirm(`Remove ${m.name}?`)) deleteMember(m.id)
              }}
            />
            <div className="divide-y divide-border">
              <AddTaskRow
                sprintId={sprintId}
                sprintStartDate={sprintStartDate}
                assigneeId={m.id}
              />
            </div>
          </Card>
        ))}
      {expanded === false && null}
      {/* keep allMembers ref stable */}
      <span className="hidden">{allMembers.length}</span>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  // `group/card` enables hover-reveal of delete button inside GroupHeader.
  return (
    <div className="group/card bg-surface border border-border rounded-lg overflow-hidden">
      {children}
    </div>
  )
}

function GroupHeader({
  avatar,
  name,
  count,
  onDelete,
  muted,
  collapsed,
  onToggleCollapse,
}: {
  avatar: React.ReactNode
  name: string
  count: number
  onDelete?: () => void
  muted?: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const collapsible = onToggleCollapse !== undefined
  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-3 ${
        collapsed ? '' : 'border-b border-border'
      } ${collapsible ? 'cursor-pointer hover:bg-surface-hover transition' : ''}`}
      onClick={collapsible ? onToggleCollapse : undefined}
      role={collapsible ? 'button' : undefined}
      aria-expanded={collapsible ? !collapsed : undefined}
    >
      {collapsible && (
        <ChevronDown
          size={14}
          className={`text-ink-faint transition-transform ${
            collapsed ? '-rotate-90' : ''
          }`}
        />
      )}
      {avatar}
      <span
        className={`font-medium text-sm select-none ${muted ? 'text-ink-muted' : 'text-ink'}`}
      >
        {name}
      </span>
      <span className="text-xs text-ink-faint select-none">{count}</span>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="ml-auto text-ink-faint hover:text-red-500 opacity-0 group-hover/card:opacity-100 transition"
          title="Remove member"
          aria-label="Remove member"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

function Avatar({ member }: { member: Member }) {
  return (
    <span
      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
      style={{ background: member.color }}
      title={member.name}
    >
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function AddTaskRow({
  sprintId,
  sprintStartDate,
  assigneeId,
}: {
  sprintId: string
  sprintStartDate: string
  assigneeId: string | null
}) {
  const [title, setTitle] = useState('')
  const add = async () => {
    const t = title.trim()
    if (!t) return
    await db.tasks.add({
      id: uid(),
      title: t,
      assigneeId,
      sprintId,
      status: 'todo',
      priority: 'normal',
      // Default start = sprint start. User can override after creation.
      startDate: sprintStartDate,
      dueDate: null,
      estimate: null,
      createdAt: Date.now(),
    })
    setTitle('')
  }
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      <div className={COL.dot}>
        <Plus size={14} className="text-ink-faint" />
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        placeholder="Add task"
        className={`${COL.title} outline-none placeholder:text-ink-faint bg-transparent`}
      />
      <div className={COL.assignee} />
      <div className={COL.start} />
      <div className={COL.due} />
      <div className={COL.priority} />
      <div className={COL.status} />
      <div className={COL.trash} />
    </div>
  )
}

// Column widths — kept in sync with TaskColumnHeader. If you change one,
// change the other. Order: status-dot · title · assignee · start · due · priority · status · delete
const COL = {
  dot: 'w-4 shrink-0',
  title: 'flex-1 min-w-0',
  assignee: 'w-7 flex justify-center shrink-0',
  start: 'w-20 flex justify-end shrink-0',
  due: 'w-20 flex justify-end shrink-0',
  priority: 'w-6 flex justify-center shrink-0',
  status: 'w-28 flex justify-start shrink-0',
  trash: 'w-5 flex justify-end shrink-0',
}

function TaskRow({ task, members }: { task: Task; members: Member[] }) {
  const update = (patch: Partial<Task>) => db.tasks.update(task.id, patch)
  const assignee = members.find((m) => m.id === task.assigneeId) ?? null
  const overdue = isOverdue(task.dueDate, task.status === 'done')
  const isWelcome = task.title.startsWith(WELCOME_PREFIX)

  return (
    <div className="group/row flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface-hover transition">
      <div className={COL.dot}>
        <StatusDot
          status={task.status}
          onCycle={() => {
            const next: Status =
              task.status === 'todo'
                ? 'in_progress'
                : task.status === 'in_progress'
                  ? 'done'
                  : 'todo'
            update({ status: next })
          }}
        />
      </div>

      <input
        value={task.title}
        onChange={(e) => update({ title: e.target.value })}
        className={`${COL.title} outline-none bg-transparent ${
          task.status === 'done' ? 'line-through text-ink-faint' : ''
        } ${isWelcome ? 'welcome-hint' : ''}`}
      />

      <div className={COL.assignee}>
        <AssigneePicker task={task} members={members} assignee={assignee} update={update} />
      </div>

      <div className={COL.start}>
        <DatePickCell
          value={task.startDate}
          onChange={(v) => update({ startDate: v })}
          ariaLabel="Start date"
        />
      </div>

      <div className={COL.due}>
        <DatePickCell
          value={task.dueDate}
          highlight={overdue ? 'overdue' : null}
          onChange={(v) => update({ dueDate: v })}
          ariaLabel="Due date"
        />
      </div>

      <div className={COL.priority}>
        <PriorityCell
          priority={task.priority}
          onChange={(p) => update({ priority: p })}
        />
      </div>

      <div className={COL.status}>
        <StatusPicker status={task.status} onChange={(s) => update({ status: s })} />
      </div>

      <div className={COL.trash}>
        <button
          onClick={() => {
            if (confirm('Delete this task?')) db.tasks.delete(task.id)
          }}
          className="text-ink-faint hover:text-red-500 opacity-0 group-hover/row:opacity-100 transition"
          aria-label="Delete task"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

function TaskColumnHeader() {
  const labelCls = 'text-[10px] uppercase tracking-wider text-ink-faint font-medium'
  return (
    <div
      className="flex items-center gap-3 px-4 py-1.5 sticky top-[57px] z-[5] bg-canvas/80 backdrop-blur-sm rounded-md"
      aria-hidden
    >
      <div className={COL.dot} />
      <div className={`${labelCls} flex-1 min-w-0`}>Task</div>
      <div className={`${COL.assignee} ${labelCls}`}>Who</div>
      <div className={`${COL.start} ${labelCls} justify-end`}>Start</div>
      <div className={`${COL.due} ${labelCls} justify-end`}>Due</div>
      <div className={`${COL.priority} ${labelCls}`}>Pri</div>
      <div className={`${COL.status} ${labelCls}`}>Status</div>
      <div className={COL.trash} />
    </div>
  )
}

function StatusDot({
  status,
  onCycle,
}: {
  status: Status
  onCycle: () => void
}) {
  const meta = STATUS_META[status]
  return (
    <button
      onClick={onCycle}
      className="w-4 h-4 rounded-full border-2 shrink-0 transition hover:scale-110"
      style={{
        borderColor: meta.varName,
        background: status === 'done' ? meta.varName : 'transparent',
      }}
      title={`${meta.label} — click to cycle`}
      aria-label={`Status: ${meta.label}`}
    />
  )
}

function StatusPicker({
  status,
  onChange,
}: {
  status: Status
  onChange: (s: Status) => void
}) {
  const meta = STATUS_META[status]
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as Status)}
      className="text-xs font-medium rounded px-2 py-1 border-0 bg-transparent appearance-none cursor-pointer hover:bg-surface-hover"
      style={{ color: meta.varName }}
      aria-label="Status"
    >
      {Object.entries(STATUS_META).map(([k, m]) => (
        <option key={k} value={k}>
          {m.label}
        </option>
      ))}
    </select>
  )
}

function AssigneePicker({
  task,
  members,
  assignee,
  update,
}: {
  task: Task
  members: Member[]
  assignee: Member | null
  update: (p: Partial<Task>) => void
}) {
  const ref = useRef<HTMLSelectElement>(null)
  return (
    <label className="relative inline-flex" title={assignee?.name ?? 'Unassigned'}>
      {assignee ? (
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white cursor-pointer ring-1 ring-transparent hover:ring-accent/40"
          style={{ background: assignee.color }}
          onClick={() => ref.current?.focus()}
        >
          {assignee.name.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-ink-faint border border-dashed border-border-strong cursor-pointer hover:border-accent"
          onClick={() => ref.current?.focus()}
        >
          ?
        </span>
      )}
      <select
        ref={ref}
        value={task.assigneeId ?? ''}
        onChange={(e) => update({ assigneeId: e.target.value || null })}
        className="absolute inset-0 opacity-0 cursor-pointer"
        aria-label="Assignee"
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function DatePickCell({
  value,
  highlight = null,
  onChange,
  ariaLabel,
}: {
  value: string | null
  highlight?: 'overdue' | null
  onChange: (v: string | null) => void
  ariaLabel: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const label = formatRelativeDate(value)

  // Open the picker explicitly — `showPicker()` is supported in modern
  // Chrome/Edge/Firefox/Safari 16+. Fallback to focus+click for older WebKit.
  const open = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = ref.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker()
        return
      } catch {
        /* gesture-required failure, fall through */
      }
    }
    el.focus()
    el.click()
  }

  const valueCls = value
    ? highlight === 'overdue'
      ? 'text-red-500 font-medium'
      : 'text-ink-muted'
    : 'text-ink-faint'

  return (
    <button
      type="button"
      onClick={open}
      aria-label={ariaLabel}
      className={`relative inline-flex items-center justify-end w-full h-8 px-2 rounded-md cursor-pointer border border-transparent hover:border-border-strong hover:bg-canvas transition ${valueCls}`}
    >
      {value ? (
        <span className="text-xs whitespace-nowrap">{label}</span>
      ) : (
        <Calendar size={14} />
      )}
      <input
        ref={ref}
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="absolute inset-0 opacity-0 pointer-events-none"
        tabIndex={-1}
        aria-hidden="true"
      />
    </button>
  )
}

function PriorityCell({
  priority,
  onChange,
}: {
  priority: Priority
  onChange: (p: Priority) => void
}) {
  const ref = useRef<HTMLSelectElement>(null)
  const meta = PRIORITY_META[priority]
  return (
    <label className="relative inline-flex" title={`Priority: ${meta.label}`}>
      <span
        className="cursor-pointer p-1 rounded hover:bg-surface-hover"
        onClick={() => ref.current?.focus()}
      >
        <Flag size={14} style={{ color: meta.varName }} fill={priority === 'none' ? 'none' : meta.varName} />
      </span>
      <select
        ref={ref}
        value={priority}
        onChange={(e) => onChange(e.target.value as Priority)}
        className="absolute inset-0 opacity-0 cursor-pointer"
        aria-label="Priority"
      >
        {Object.entries(PRIORITY_META).map(([k, m]) => (
          <option key={k} value={k}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function AddMemberRow({
  active,
  onActivate,
  onDeactivate,
}: {
  active: boolean
  onActivate: () => void
  onDeactivate: () => void
}) {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])

  const submit = async () => {
    const n = name.trim()
    if (!n) {
      onDeactivate()
      return
    }
    await db.members.add({ id: uid(), name: n, color: colorForName(n) })
    setName('')
    inputRef.current?.focus()
  }

  if (!active) {
    return (
      <button
        onClick={onActivate}
        className="w-full text-sm text-ink-muted hover:text-accent hover:bg-accent-soft border border-dashed border-border-strong hover:border-accent rounded-lg py-2.5 flex items-center justify-center gap-1.5 transition"
      >
        <UserPlus size={14} /> Add member
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 bg-surface border border-border rounded-lg p-2">
      <UserPlus size={14} className="text-ink-faint ml-2" />
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') {
            setName('')
            onDeactivate()
          }
        }}
        placeholder="Member name (press Enter)"
        className="flex-1 outline-none text-sm bg-transparent placeholder:text-ink-faint"
      />
      <button
        onClick={() => {
          setName('')
          onDeactivate()
        }}
        className="text-xs text-ink-muted px-2 py-1 hover:bg-surface-hover rounded"
      >
        Done
      </button>
    </div>
  )
}
