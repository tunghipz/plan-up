import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Plus,
  Trash2,
  ChevronDown,
  Calendar,
  UserPlus,
} from 'lucide-react'
import {
  db,
  uid,
  colorForName,
  deleteMember,
  deleteTask,
  setDependencies,
  setMemberDaysOff,
  recomputeDates,
  computeWorkingTimes,
  isTaskBlocked,
  nextSequence,
  type Member,
  type Task,
  type Status,
} from './db'
import { formatRelativeDate, formatShortDate, isOverdue } from './lib'

const WELCOME_PREFIX = 'Welcome —'

type SortField =
  | 'seq'
  | 'title'
  | 'effort'
  | 'startDate'
  | 'dueDate'
  | 'status'
  | 'dependsOn'
const STATUS_RANK: Record<Status, number> = {
  todo: 0,
  in_progress: 1,
  done: 2,
}
function compareTasks(a: Task, b: Task, field: SortField, dir: 'asc' | 'desc'): number {
  const mul = dir === 'asc' ? 1 : -1
  const va: string | number =
    field === 'seq'
      ? a.sequence
      : field === 'title'
        ? (a.title || '').toLowerCase()
        : field === 'effort'
          ? (a.estimate ?? Number.POSITIVE_INFINITY)
          : field === 'status'
            ? STATUS_RANK[a.status]
            : field === 'dependsOn'
              ? (a.dependsOn?.length ?? 0)
              : (a[field] ?? '￿')
  const vb: string | number =
    field === 'seq'
      ? b.sequence
      : field === 'title'
        ? (b.title || '').toLowerCase()
        : field === 'effort'
          ? (b.estimate ?? Number.POSITIVE_INFINITY)
          : field === 'status'
            ? STATUS_RANK[b.status]
            : field === 'dependsOn'
              ? (b.dependsOn?.length ?? 0)
              : (b[field] ?? '￿')
  if (va < vb) return -1 * mul
  if (va > vb) return 1 * mul
  return a.sequence - b.sequence // stable tiebreak by seq
}

export const STATUS_META: Record<Status, { label: string; varName: string }> = {
  todo: { label: 'TO DO', varName: 'var(--color-status-todo)' },
  in_progress: { label: 'IN PROGRESS', varName: 'var(--color-status-progress)' },
  done: { label: 'DONE', varName: 'var(--color-status-done)' },
}

export const STATUS_ORDER: Status[] = ['todo', 'in_progress', 'done']

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
  projectId,
  sprintId,
  sprintStartDate,
  tasks,
  search,
}: {
  projectId: string
  sprintId: string
  sprintStartDate: string
  tasks: Task[]
  search: string
}) {
  const members = useLiveQuery(
    () => db.members.where('projectId').equals(projectId).toArray(),
    [projectId]
  )
  const [showAddMember, setShowAddMember] = useState(false)
  const [showEmpty, setShowEmpty] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    loadCollapsed(sprintId)
  )
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({
    field: 'seq',
    dir: 'asc',
  })

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

  // Dependency picker + blocked check need an unfiltered lookup so a task's
  // prereq is still resolvable even when the user filters the view.
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])

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
    // Sort each member's tasks by the user-selected field (defaults to seq asc).
    const cmp = (a: Task, b: Task) => compareTasks(a, b, sort.field, sort.dir)
    for (const arr of byMember.values()) arr.sort(cmp)
    orphan.sort(cmp)
    const filled = ms.filter((m) => (byMember.get(m.id) ?? []).length > 0)
    const empty = ms.filter((m) => (byMember.get(m.id) ?? []).length === 0)
    return {
      groups: filled.map((m) => ({ member: m, tasks: byMember.get(m.id)! })),
      emptyMembers: empty,
      unassigned: orphan,
    }
  }, [members, filteredTasks, sort])

  if (!members) return <p className="text-ink-muted py-12 text-center">Loading…</p>

  const isEmpty = tasks.length === 0 && members.length === 0
  const isFilteredEmpty = filteredTasks.length === 0 && search.trim() !== ''

  return (
    <div className="space-y-3 max-w-5xl">
      {isEmpty && <EmptyState onAddMember={() => setShowAddMember(true)} />}

      {isFilteredEmpty && (
        <div className="bg-surface border border-border rounded-lg p-6 text-center text-sm text-ink-muted">
          No tasks match "{search}".
        </div>
      )}

      {groups.map(({ member, tasks: t }) => (
        <MemberCard
          key={member.id}
          projectId={projectId}
          member={member}
          tasks={t}
          sprintId={sprintId}
          sprintStartDate={sprintStartDate}
          members={members}
          allTasks={tasks}
          tasksById={tasksById}
          collapsed={collapsed.has(member.id)}
          onToggleCollapse={() => toggleCollapse(member.id)}
          sort={sort}
          setSort={setSort}
        />
      ))}

      {unassigned.length > 0 && (
        <UnassignedCard
          tasks={unassigned}
          members={members}
          allTasks={tasks}
          tasksById={tasksById}
          sort={sort}
          setSort={setSort}
        />
      )}

      {emptyMembers.length > 0 && (
        <CollapsedMembers
          projectId={projectId}
          members={emptyMembers}
          sprintId={sprintId}
          sprintStartDate={sprintStartDate}
          allMembers={members}
          expanded={showEmpty}
          onToggle={() => setShowEmpty((x) => !x)}
        />
      )}

      <AddMemberRow
        projectId={projectId}
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
  projectId,
  member,
  tasks,
  sprintId,
  sprintStartDate,
  members,
  allTasks,
  tasksById,
  collapsed,
  onToggleCollapse,
  sort,
  setSort,
}: {
  projectId: string
  member: Member
  tasks: Task[]
  sprintId: string
  sprintStartDate: string
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
  collapsed: boolean
  onToggleCollapse: () => void
  sort: { field: SortField; dir: 'asc' | 'desc' }
  setSort: React.Dispatch<
    React.SetStateAction<{ field: SortField; dir: 'asc' | 'desc' }>
  >
}) {
  return (
    <Card>
      <GroupHeader
        avatar={<Avatar member={member} />}
        name={member.name}
        count={tasks.length}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        onRename={(n) => db.members.update(member.id, { name: n })}
        extras={<MemberScheduleButton member={member} />}
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
        <>
          {tasks.length > 0 && <TaskColumnHeader sort={sort} setSort={setSort} />}
          <div className="divide-y divide-border">
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                members={members}
                allTasks={allTasks}
                tasksById={tasksById}
              />
            ))}
            <AddTaskRow
              projectId={projectId}
              sprintId={sprintId}
              sprintStartDate={sprintStartDate}
              assigneeId={member.id}
            />
          </div>
        </>
      )}
    </Card>
  )
}

function UnassignedCard({
  tasks,
  members,
  allTasks,
  tasksById,
  sort,
  setSort,
}: {
  tasks: Task[]
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
  sort: { field: SortField; dir: 'asc' | 'desc' }
  setSort: React.Dispatch<
    React.SetStateAction<{ field: SortField; dir: 'asc' | 'desc' }>
  >
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
      {tasks.length > 0 && <TaskColumnHeader sort={sort} setSort={setSort} />}
      <div className="divide-y divide-border">
        {tasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            members={members}
            allTasks={allTasks}
            tasksById={tasksById}
          />
        ))}
      </div>
    </Card>
  )
}

function CollapsedMembers({
  projectId,
  members,
  sprintId,
  sprintStartDate,
  allMembers,
  expanded,
  onToggle,
}: {
  projectId: string
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
        className="text-sm text-ink-muted hover:text-ink flex items-center gap-1.5 pl-1"
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
              onRename={(n) => db.members.update(m.id, { name: n })}
              extras={<MemberScheduleButton member={m} />}
              onDelete={() => {
                if (confirm(`Remove ${m.name}?`)) deleteMember(m.id)
              }}
            />
            <div className="divide-y divide-border">
              <AddTaskRow
                projectId={projectId}
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
  onRename,
  muted,
  collapsed,
  onToggleCollapse,
  extras,
}: {
  avatar: React.ReactNode
  name: string
  count: number
  onDelete?: () => void
  onRename?: (newName: string) => unknown
  muted?: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** Extra action buttons rendered before rename/delete in the action group. */
  extras?: React.ReactNode
}) {
  const collapsible = onToggleCollapse !== undefined
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(name)
      // next tick — input is freshly mounted
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, name])

  const commit = () => {
    const n = draft.trim()
    setEditing(false)
    if (n && n !== name && onRename) void onRename(n)
  }
  const cancel = () => {
    setDraft(name)
    setEditing(false)
  }

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-3 ${
        collapsed ? '' : 'border-b border-border'
      } ${collapsible && !editing ? 'cursor-pointer hover:bg-surface-hover transition' : ''}`}
      onClick={collapsible && !editing ? onToggleCollapse : undefined}
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
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          onBlur={commit}
          className="editable font-medium text-sm bg-transparent w-40"
          aria-label="Rename member"
        />
      ) : (
        <span
          className={`font-medium text-sm select-none ${muted ? 'text-ink-muted' : 'text-ink'} ${
            onRename ? 'cursor-text hover:underline decoration-dotted underline-offset-4' : ''
          }`}
          onDoubleClick={
            onRename
              ? (e) => {
                  e.stopPropagation()
                  setEditing(true)
                }
              : undefined
          }
          title={onRename ? 'Double-click to rename' : undefined}
        >
          {name}
        </span>
      )}
      <span className="text-xs text-ink-faint select-none font-mono">{count}</span>
      <div className="ml-auto flex items-center gap-2">
        {extras}
        {onRename && !editing && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
            className="text-ink-faint hover:text-ink opacity-0 group-hover/card:opacity-100 transition text-xs leading-none"
            title="Rename member"
            aria-label="Rename member"
          >
            ✎
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="text-ink-faint hover:text-red-500 opacity-0 group-hover/card:opacity-100 transition"
            title="Remove member"
            aria-label="Remove member"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
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

/**
 * Input-styled date picker. Shows formatted dd/mm/yy and opens the native
 * picker on click. `color-scheme` (set globally) themes the picker popup.
 */
function DateField({
  value,
  onChange,
  placeholder = 'dd/mm/yy',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
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
        /* fall through */
      }
    }
    el.focus()
    el.click()
  }
  return (
    <button
      type="button"
      onClick={open}
      className="relative flex-1 text-sm bg-canvas border border-border rounded px-2 py-1 text-left h-7 focus:border-accent outline-none"
    >
      {value ? (
        <span className="text-ink tabular-nums font-mono">
          {formatShortDate(value)}
        </span>
      ) : (
        <span className="text-ink-faint">{placeholder}</span>
      )}
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 pointer-events-none"
        tabIndex={-1}
        aria-hidden="true"
      />
    </button>
  )
}

/**
 * Calendar button on a member's group header. Opens a popover where the
 * manager picks days the member is off (vacation, holidays). Weekends are
 * already implicit; this is only the extra off-days. Saving recomputes
 * every task assigned to this member (and forward through their deps).
 */
function MemberScheduleButton({ member }: { member: Member }) {
  const [open, setOpen] = useState(false)
  const [draftDate, setDraftDate] = useState('')
  const [draftHalf, setDraftHalf] = useState<'all' | 'am' | 'pm'>('all')
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Popover lives in a portal (escapes Card's overflow-hidden). We track the
  // trigger's screen position and re-pin on scroll/resize so it stays glued.
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })

  useEffect(() => {
    if (!open) return
    const pin = () => {
      const rect = btnRef.current?.getBoundingClientRect()
      if (rect) {
        setPos({
          top: rect.bottom + 4,
          right: Math.max(8, window.innerWidth - rect.right),
        })
      }
    }
    pin()
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        popRef.current && !popRef.current.contains(target) &&
        btnRef.current && !btnRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('scroll', pin, true)
    window.addEventListener('resize', pin)
    document.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('scroll', pin, true)
      window.removeEventListener('resize', pin)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const days = member.daysOff ?? []
  const count = days.length

  const updateOne = async (date: string, half: 'all' | 'am' | 'pm') => {
    const next = days.filter((d) => d.date !== date)
    next.push(half === 'all' ? { date } : { date, half })
    await setMemberDaysOff(member.id, next)
  }
  const removeDay = async (date: string) => {
    await setMemberDaysOff(
      member.id,
      days.filter((d) => d.date !== date)
    )
  }
  const addDraft = async () => {
    if (!draftDate) return
    await updateOne(draftDate, draftHalf)
    setDraftDate('')
    setDraftHalf('all')
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={`inline-flex items-center gap-0.5 transition text-sm ${
          count > 0
            ? 'text-ink opacity-100'
            : 'text-ink-faint opacity-0 group-hover/card:opacity-100'
        } hover:text-ink`}
        title={
          count > 0
            ? `${count} day${count === 1 ? '' : 's'} off`
            : 'Set days off'
        }
        aria-label="Days off"
      >
        <Calendar size={14} />
        {count > 0 && <span className="text-[10px] font-medium">{count}</span>}
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-72 bg-surface border border-border rounded-lg shadow-lg p-2"
        >
          <div className="text-[10px] uppercase tracking-wider text-ink-faint px-1 pb-1.5">
            Days off — {member.name}
          </div>
          {days.length === 0 && (
            <div className="text-sm text-ink-faint px-1 pb-1.5">
              None. Weekends are already off.
            </div>
          )}
          {days.map((d) => (
            <div
              key={d.date}
              className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface-hover group/day"
            >
              <span className="text-sm text-ink tabular-nums w-16 shrink-0">
                {formatShortDate(d.date)}
              </span>
              <select
                value={d.half ?? 'all'}
                onChange={(e) =>
                  updateOne(d.date, e.target.value as 'all' | 'am' | 'pm')
                }
                className="flex-1 text-sm bg-transparent border border-transparent hover:border-border rounded px-1 py-0.5 outline-none focus:border-accent cursor-pointer"
              >
                <option value="all">Off all day</option>
                <option value="am">AM off (morning)</option>
                <option value="pm">PM off (afternoon)</option>
              </select>
              <button
                onClick={() => removeDay(d.date)}
                className="text-ink-faint hover:text-red-500 opacity-0 group-hover/day:opacity-100 transition"
                aria-label={`Remove ${d.date}`}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="border-t border-border mt-1 pt-2 space-y-1.5">
            <div className="flex gap-2">
              <DateField
                value={draftDate}
                onChange={setDraftDate}
                placeholder="dd/mm/yy"
              />
              <select
                value={draftHalf}
                onChange={(e) =>
                  setDraftHalf(e.target.value as 'all' | 'am' | 'pm')
                }
                className="text-sm bg-canvas border border-border rounded px-1.5 py-1 outline-none focus:border-accent cursor-pointer"
              >
                <option value="all">All</option>
                <option value="am">AM</option>
                <option value="pm">PM</option>
              </select>
              <button
                onClick={addDraft}
                disabled={!draftDate}
                className="text-sm px-2 py-1 rounded bg-accent text-white disabled:opacity-40"
              >
                Add
              </button>
            </div>
            <div className="text-[10px] text-ink-faint px-1">
              Half-day off counts as 0.5 day toward effort.
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

function AddTaskRow({
  projectId,
  sprintId,
  sprintStartDate,
  assigneeId,
}: {
  projectId: string
  sprintId: string
  sprintStartDate: string
  assigneeId: string | null
}) {
  const [title, setTitle] = useState('')
  const add = async () => {
    const t = title.trim()
    if (!t) return
    const seq = await nextSequence(sprintId)
    await db.tasks.add({
      id: uid(),
      projectId,
      sequence: seq,
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
      dependsOn: [],
    })
    setTitle('')
  }
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      <div className={COL.dot}>
        <Plus size={14} className="text-ink-faint" />
      </div>
      <div className={COL.seq} />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        placeholder="Add task"
        className={`${COL.title} editable placeholder:text-ink-faint bg-transparent`}
      />
      <div className={COL.assignee} />
      <div className={COL.effort} />
      <div className={COL.start} />
      <div className={COL.due} />
      <div className={COL.status} />
      <div className={COL.prereq} />
    </div>
  )
}

// Column widths — kept in sync with TaskColumnHeader. If you change one,
// change the other. Order: status-dot · seq · title · assignee · effort · start · due · priority · status · prereq · delete
const COL = {
  dot: 'w-4 shrink-0',
  seq: 'w-9 text-sm text-ink-faint tabular-nums text-center shrink-0 font-mono',
  title: 'flex-1 min-w-0',
  assignee: 'w-16 flex justify-center shrink-0',
  effort: 'w-24 flex justify-center shrink-0',
  start: 'w-36 flex justify-end shrink-0',
  due: 'w-36 flex justify-end shrink-0',
  status: 'w-36 flex justify-start shrink-0 pl-2',
  prereq: 'w-14 flex justify-end shrink-0',
  trash: 'w-5 flex justify-end shrink-0',
}

function TitleTextarea({
  value,
  onChange,
  done,
  welcomeHint,
}: {
  value: string
  onChange: (v: string) => void
  done: boolean
  welcomeHint: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  // Resize on mount + every value change. useLayoutEffect runs sync before paint
  // so users never see the "1-line then snap to N lines" flicker.
  useLayoutEffect(resize, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          ;(e.target as HTMLTextAreaElement).blur()
        }
      }}
      className={`${COL.title} editable bg-transparent resize-none overflow-hidden leading-snug whitespace-pre-wrap break-words ${
        done ? 'line-through text-ink-faint' : ''
      } ${welcomeHint ? 'welcome-hint' : ''}`}
    />
  )
}

function TaskRow({
  task,
  members,
  allTasks,
  tasksById,
}: {
  task: Task
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
}) {
  const update = (patch: Partial<Task>) => db.tasks.update(task.id, patch)
  const assignee = members.find((m) => m.id === task.assigneeId) ?? null
  const overdue = isOverdue(task.dueDate, task.status === 'done')
  const blocked = isTaskBlocked(task, tasksById)
  const isWelcome = task.title.startsWith(WELCOME_PREFIX)
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members]
  )
  const { startTime, endTime } = computeWorkingTimes(task, tasksById, memberById)

  return (
    <div
      className="task-row group/row relative flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface-hover transition divide-x divide-border-hair"
      title={blocked ? 'Blocked — waiting on a prerequisite task' : undefined}
    >
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

      <div className={COL.seq} title="Task number">{task.sequence}</div>

      <TitleTextarea
        value={task.title}
        onChange={(v) => update({ title: v })}
        done={task.status === 'done'}
        welcomeHint={isWelcome}
      />

      <div className={COL.assignee}>
        <AssigneePicker task={task} members={members} assignee={assignee} update={update} />
      </div>

      <div className={COL.effort}>
        <EffortCell
          value={task.estimate}
          onChange={async (v) => {
            await update({ estimate: v })
            await recomputeDates(task.id)
          }}
        />
      </div>

      <div className={COL.start}>
        <DatePickCell
          value={task.startDate}
          time={startTime}
          locked={task.dependsOn.length > 0}
          onChange={async (v) => {
            await update({ startDate: v })
            // Manual start change recomputes end when effort drives it.
            await recomputeDates(task.id)
          }}
          ariaLabel="Start date"
        />
      </div>

      <div className={COL.due}>
        <DatePickCell
          value={task.dueDate}
          time={endTime}
          locked={
            task.dependsOn.length > 0 ||
            (task.estimate !== null && task.estimate > 0)
          }
          highlight={overdue ? 'overdue' : null}
          onChange={(v) => update({ dueDate: v })}
          ariaLabel="Due date"
        />
      </div>

      <div className={COL.status}>
        <StatusPicker status={task.status} onChange={(s) => update({ status: s })} />
      </div>

      <div className={COL.prereq}>
        <PrereqInput task={task} allTasks={allTasks} tasksById={tasksById} />
      </div>

      <button
        onClick={() => {
          if (confirm('Delete this task?')) deleteTask(task.id)
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-red-500 opacity-0 group-hover/row:opacity-100 transition p-1 rounded bg-surface/80 backdrop-blur-sm"
        aria-label="Delete task"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

/**
 * Per-group column header rendered inside each MemberCard / UnassignedCard
 * (ClickUp pattern — every group has its own labelled columns right under
 * the member name). Quiet styling: no background, hairline border below.
 */
function TaskColumnHeader({
  sort,
  setSort,
}: {
  sort: { field: SortField; dir: 'asc' | 'desc' }
  setSort: React.Dispatch<
    React.SetStateAction<{ field: SortField; dir: 'asc' | 'desc' }>
  >
}) {
  const onSort = (field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    )
  }
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border-hair bg-canvas-sunk/40 divide-x divide-border-hair">
      <div className={COL.dot} />
      <SortHeader
        className={COL.seq}
        field="seq"
        label="ID"
        sort={sort}
        onSort={onSort}
        align="center"
      />
      <SortHeader
        className="flex-1 min-w-0"
        field="title"
        label="Task"
        sort={sort}
        onSort={onSort}
      />
      <div className={`${COL.assignee} text-[10px] uppercase tracking-wider text-ink-faint font-medium text-center`}>
        Assignee
      </div>
      <SortHeader
        className={COL.effort}
        field="effort"
        label="Effort (day)"
        sort={sort}
        onSort={onSort}
        align="center"
      />
      <SortHeader
        className={COL.start}
        field="startDate"
        label="Start"
        sort={sort}
        onSort={onSort}
        align="end"
      />
      <SortHeader
        className={COL.due}
        field="dueDate"
        label="End"
        sort={sort}
        onSort={onSort}
        align="end"
      />
      <SortHeader
        className={COL.status}
        field="status"
        label="Status"
        sort={sort}
        onSort={onSort}
      />
      <SortHeader
        className={COL.prereq}
        field="dependsOn"
        label="Prereq"
        sort={sort}
        onSort={onSort}
        align="end"
      />
    </div>
  )
}

function SortHeader({
  className,
  field,
  label,
  sort,
  onSort,
  align,
}: {
  className: string
  field: SortField
  label: string
  sort: { field: SortField; dir: 'asc' | 'desc' }
  onSort: (f: SortField) => void
  align?: 'start' | 'center' | 'end'
}) {
  const isActive = sort.field === field
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`${className} group flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium select-none py-0.5 hover:bg-black/[0.04] rounded transition ${
        align === 'end'
          ? 'justify-end'
          : align === 'center'
            ? 'justify-center'
            : ''
      } ${isActive ? 'text-accent' : 'text-ink-faint hover:text-ink'}`}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span
        className={`text-[9px] leading-none ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}
        aria-hidden
      >
        {isActive ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}
      </span>
    </button>
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
      className="w-4 h-4 shrink-0 transition hover:scale-110 flex items-center justify-center"
      style={{ color: meta.varName }}
      title={`${meta.label} — click to cycle`}
      aria-label={`Status: ${meta.label}`}
    >
      <StatusIcon status={status} />
    </button>
  )
}

/**
 * ClickUp-style status icons. Color comes from the parent's `color` (via
 * `currentColor`), so callers control hue with one inline style.
 *   - todo:        dashed circle outline
 *   - in_progress: outline with bottom-half filled (50% pie)
 *   - done:        filled circle with white check
 */
export function StatusIcon({ status }: { status: Status }) {
  if (status === 'todo') {
    return (
      <svg viewBox="0 0 16 16" className="w-full h-full" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r="6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2 1.5"
        />
      </svg>
    )
  }
  if (status === 'in_progress') {
    return (
      <svg viewBox="0 0 16 16" className="w-full h-full" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r="6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {/* right-half fill — clockwise arc from top through right to bottom */}
        <path
          d="M 8 1.5 A 6.5 6.5 0 0 1 8 14.5 Z"
          fill="currentColor"
        />
      </svg>
    )
  }
  // done
  return (
    <svg viewBox="0 0 16 16" className="w-full h-full" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path
        d="M 4.5 8 L 7 10.5 L 11.5 6"
        stroke="white"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
  // Jira-style lozenge: solid filled for in_progress/done, outline for todo
  const solid = status !== 'todo'
  const bg = solid
    ? meta.varName
    : `color-mix(in srgb, ${meta.varName} 14%, transparent)`
  const fg = solid ? '#ffffff' : meta.varName
  const border = solid ? meta.varName : `color-mix(in srgb, ${meta.varName} 50%, transparent)`
  return (
    <div
      className="relative inline-flex items-center rounded-full pl-2 pr-1 py-1 cursor-pointer transition hover:opacity-90 leading-none"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <span
        className="w-3 h-3 shrink-0 mr-1.5 inline-flex items-center justify-center"
        style={{ color: fg }}
        aria-hidden
      >
        <StatusIcon status={status} />
      </span>
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as Status)}
        className="text-[10.5px] font-bold tracking-wider uppercase pr-4 pl-0 m-0 border-0 bg-transparent appearance-none cursor-pointer outline-none leading-none h-auto"
        style={{ color: fg, width: 'auto', minWidth: 'max-content' }}
        aria-label="Status"
      >
        {Object.entries(STATUS_META).map(([k, m]) => (
          <option
            key={k}
            value={k}
            style={{ color: '#172b4d', background: '#fff' }}
          >
            {m.label}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] leading-none"
        style={{ color: fg, opacity: 0.7 }}
        aria-hidden
      >
        ▾
      </span>
    </div>
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
        onChange={async (e) => {
          update({ assigneeId: e.target.value || null })
          // Reassign may change which member's daysOff apply → recompute.
          await recomputeDates(task.id)
        }}
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
  locked = false,
  time,
  onChange,
  ariaLabel,
}: {
  value: string | null
  highlight?: 'overdue' | null
  locked?: boolean
  /**
   * Optional fixed time-of-day shown after the date (e.g. "08:00" for
   * start-of-day, "17:00" for end-of-day). Display-only — the underlying
   * Task.startDate / Task.dueDate values stay yyyy-mm-dd.
   */
  time?: string
  onChange: (v: string | null) => void
  ariaLabel: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const date = formatRelativeDate(value)
  const label = value && time ? `${date}, ${time}` : date

  const open = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (locked) return
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
      disabled={locked}
      aria-label={ariaLabel}
      title={
        locked
          ? 'Computed from prerequisites. Clear Pre to edit manually.'
          : undefined
      }
      className={`relative inline-flex items-center justify-end w-full h-8 px-2 rounded-md border border-transparent transition ${valueCls} ${
        locked
          ? 'cursor-default'
          : 'cursor-pointer hover:border-border-strong hover:bg-canvas'
      }`}
    >
      {value ? (
        <span className="text-sm whitespace-nowrap">{label}</span>
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

/**
 * Compact effort input — number of days. Empty = unset (treated as 1 day
 * when prereqs trigger date computation).
 */
function EffortCell({
  value,
  onChange,
}: {
  value: number | null
  onChange: (v: number | null) => void
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  useEffect(() => {
    setDraft(value == null ? '' : String(value))
  }, [value])
  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (value !== null) onChange(null)
      return
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < 0) {
      setDraft(value == null ? '' : String(value))
      return
    }
    if (n !== value) onChange(n)
  }
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(value == null ? '' : String(value))
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      placeholder="—"
      title="Effort in days"
      aria-label="Effort in days"
      className="w-full text-sm text-center tabular-nums bg-transparent outline-none focus:bg-canvas rounded px-1 h-7 placeholder:text-ink-faint"
    />
  )
}

/**
 * Text input for prerequisites. User types a comma-separated list of task
 * sequence numbers (e.g. "2, 3"). On blur/Enter, we resolve sequences to
 * task IDs and call setDependencies(). Invalid numbers / self-link / cycles
 * are dropped silently — the input snaps back to the saved state.
 */
function PrereqInput({
  task,
  allTasks,
  tasksById,
}: {
  task: Task
  allTasks: Task[]
  tasksById: Map<string, Task>
}) {
  const currentLabel = task.dependsOn
    .map((id) => tasksById.get(id)?.sequence)
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b)
    .join(', ')

  const [draft, setDraft] = useState(currentLabel)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(currentLabel)
  }, [currentLabel, focused])

  // Sequence numbers are per-sprint now, so resolve only within the same
  // sprint as this task. Cross-sprint dependencies (rare) can't be set by
  // number — would need a different UX if we ever need them.
  const seqToId = useMemo(() => {
    const m = new Map<number, string>()
    for (const t of allTasks) {
      if (t.sprintId === task.sprintId) m.set(t.sequence, t.id)
    }
    return m
  }, [allTasks, task.sprintId])

  const commit = async () => {
    const nums = draft
      .split(/[,\s]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0)
    const ids: string[] = []
    for (const n of nums) {
      const id = seqToId.get(n)
      if (id) ids.push(id)
    }
    const saved = await setDependencies(task.id, ids)
    const final = saved
      .map((id) => tasksById.get(id)?.sequence)
      .filter((n): n is number => typeof n === 'number')
      .sort((a, b) => a - b)
      .join(', ')
    setDraft(final)
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(currentLabel)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      placeholder="—"
      title="Prerequisite task numbers, comma-separated (e.g. 2, 3)"
      aria-label="Prerequisite task numbers"
      className="w-full text-sm text-right tabular-nums bg-transparent outline-none focus:bg-canvas rounded px-1 h-7 placeholder:text-ink-faint"
    />
  )
}

function AddMemberRow({
  projectId,
  active,
  onActivate,
  onDeactivate,
}: {
  projectId: string
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
    await db.members.add({
      id: uid(),
      projectId,
      name: n,
      color: colorForName(n),
      daysOff: [],
    })
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
        className="text-sm text-ink-muted px-2 py-1 hover:bg-surface-hover rounded"
      >
        Done
      </button>
    </div>
  )
}
