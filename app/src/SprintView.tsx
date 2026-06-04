import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Plus,
  Trash2,
  ChevronDown,
  UserPlus,
  MoreVertical,
  CornerDownRight,
  CornerUpLeft,
  AlertTriangle,
} from 'lucide-react'
import {
  db,
  uid,
  colorForName,
  deleteTask,
  setTaskParent,
  setDependencies,
  recomputeDates,
  computeWorkingPlan,
  isTaskBlocked,
  nextSequence,
  type Member,
  type Task,
  type Status,
} from './db'
import { Avatar, MemberDaysOffButton } from './members'
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
  todo: { label: 'To do', varName: 'var(--color-status-todo)' },
  in_progress: { label: 'In progress', varName: 'var(--color-status-progress)' },
  done: { label: 'Done', varName: 'var(--color-status-done)' },
}

export const STATUS_ORDER: Status[] = ['todo', 'in_progress', 'done']

const COLLAPSE_KEY = (sprintId: string) => `plan-up:collapsed:${sprintId}`
const GROUP_COLLAPSE_KEY = (parentId: string) =>
  `plan-up:taskgroup-collapsed:${parentId}`

/**
 * Detect schedule conflicts among one member's leaf tasks: a pair conflicts if
 * they share a computed start datetime, a computed end datetime, or any
 * prerequisite. Returns a per-task tooltip string (absent = no conflict). O(n²)
 * over a member's tasks (small). See design-docs/conflict-warning.md.
 */
function computeMemberConflicts(
  tasks: Task[],
  tasksById: Map<string, Task>,
  memberById: Map<string, Member>
): Map<string, string> {
  type Hit = { seq: number; kind: 'start' | 'end' | 'prereq' }
  // Unsized tasks (no effort) aren't really scheduled — exclude them from
  // double-booking detection. See design-docs/conflict-warning.md.
  const sized = tasks.filter((t) => t.estimate !== null)
  const plans = new Map(
    sized.map((t) => [t.id, computeWorkingPlan(t, tasksById, memberById)])
  )
  const startKey = (t: Task) => {
    const p = plans.get(t.id)!
    return p.startDate ? `${p.startDate}T${p.startTime ?? ''}` : null
  }
  const endKey = (t: Task) => {
    const p = plans.get(t.id)!
    return p.dueDate ? `${p.dueDate}T${p.endTime ?? ''}` : null
  }
  const hits = new Map<string, Hit[]>()
  const push = (id: string, h: Hit) => {
    const a = hits.get(id) ?? []
    a.push(h)
    hits.set(id, a)
  }
  for (let i = 0; i < sized.length; i++) {
    for (let j = i + 1; j < sized.length; j++) {
      const a = sized[i]
      const b = sized[j]
      const sa = startKey(a)
      const ea = endKey(a)
      if (sa && sa === startKey(b)) {
        push(a.id, { seq: b.sequence, kind: 'start' })
        push(b.id, { seq: a.sequence, kind: 'start' })
      }
      if (ea && ea === endKey(b)) {
        push(a.id, { seq: b.sequence, kind: 'end' })
        push(b.id, { seq: a.sequence, kind: 'end' })
      }
      if (a.dependsOn.some((d) => b.dependsOn.includes(d))) {
        push(a.id, { seq: b.sequence, kind: 'prereq' })
        push(b.id, { seq: a.sequence, kind: 'prereq' })
      }
    }
  }
  const label = (k: Hit['kind']) =>
    k === 'start' ? 'start time' : k === 'end' ? 'end time' : 'shared prerequisite'
  const tips = new Map<string, string>()
  for (const [id, list] of hits) {
    const byOther = new Map<number, Set<string>>()
    for (const h of list) {
      const s = byOther.get(h.seq) ?? new Set<string>()
      s.add(label(h.kind))
      byOther.set(h.seq, s)
    }
    const parts = [...byOther.entries()].map(
      ([seq, kinds]) => `#${seq} (${[...kinds].join(', ')})`
    )
    tips.set(id, `Overlaps with ${parts.join('; ')}`)
  }
  return tips
}

/** Roll-up status of a parent task derived from its children (display only). */
function derivedGroupStatus(children: Task[]): Status {
  if (children.length === 0) return 'todo'
  if (children.every((c) => c.status === 'done')) return 'done'
  if (children.some((c) => c.status === 'in_progress' || c.status === 'done'))
    return 'in_progress'
  return 'todo'
}

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
    <div className="space-y-4 max-w-5xl">
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
  // Leaf-based counting: a parent (a task with children in this list) is a
  // container, excluded from done/total/overdue so its work isn't double-counted
  // with its children. See design-docs/task-groups.md.
  const parentIds = useMemo(() => {
    const s = new Set<string>()
    for (const t of tasks) if (t.parentId) s.add(t.parentId)
    return s
  }, [tasks])
  const leafTasks = tasks.filter((t) => !parentIds.has(t.id))
  const total = leafTasks.length
  const done = leafTasks.filter((t) => t.status === 'done').length
  const pct = total ? Math.round((done / total) * 100) : 0
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  // Use each task's COMPUTED end (same plan the End column shows) so the header
  // never disagrees with the rows. overdue = past-due unfinished; nextDue =
  // earliest unfinished end that is today-or-later (the next upcoming deadline).
  let overdue = 0
  let nextDue: string | null = null
  for (const t of leafTasks) {
    if (t.status === 'done') continue
    const due = computeWorkingPlan(t, tasksById, memberById).dueDate
    if (!due) continue
    if (isOverdue(due, false)) overdue++
    else if (!nextDue || due < nextDue) nextDue = due
  }
  // Double-booking warnings among this member's leaf tasks (see
  // design-docs/conflict-warning.md). Cheap O(n²) over a member's tasks.
  const conflictTips = computeMemberConflicts(leafTasks, tasksById, memberById)
  return (
    <Card>
      <GroupHeader
        avatar={<AvatarRing member={member} pct={pct} />}
        name={member.name}
        title={member.title}
        count={total}
        countText={`${done}/${total}`}
        stats={<MemberStatsBar overdue={overdue} nextDue={nextDue} />}
        conflictCount={conflictTips.size}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        extras={<MemberDaysOffButton member={member} />}
      />
      {!collapsed && (
        // Horizontal scroll on narrow screens: fixed-width columns keep their
        // size and the table scrolls instead of crushing the title column.
        // Assignee column is omitted — every row in a member group is the same
        // person (shown in the group header avatar).
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            {tasks.length > 0 && (
              <TaskColumnHeader sort={sort} setSort={setSort} showAssignee={false} />
            )}
            <div className="divide-y divide-border">
              <TaskRows
                tasks={tasks}
                members={members}
                allTasks={allTasks}
                tasksById={tasksById}
                showAssignee={false}
                conflictTips={conflictTips}
              />
              <AddTaskRow
                projectId={projectId}
                sprintId={sprintId}
                sprintStartDate={sprintStartDate}
                assigneeId={member.id}
                showAssignee={false}
              />
            </div>
          </div>
        </div>
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
      <div className="overflow-x-auto">
        <div className="min-w-[896px]">
          {tasks.length > 0 && <TaskColumnHeader sort={sort} setSort={setSort} />}
          <div className="divide-y divide-border">
            <TaskRows
              tasks={tasks}
              members={members}
              allTasks={allTasks}
              tasksById={tasksById}
            />
          </div>
        </div>
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
              title={m.title}
              count={0}
              extras={<MemberDaysOffButton member={m} />}
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
    <div className="group/card bg-surface rounded-[14px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)]">
      {children}
    </div>
  )
}

function GroupHeader({
  avatar,
  name,
  title,
  count,
  countText,
  stats,
  conflictCount,
  muted,
  collapsed,
  onToggleCollapse,
  extras,
}: {
  avatar: React.ReactNode
  name: string
  /** Optional member role label, shown faint inline after the name. */
  title?: string
  count: number
  /** Overrides the bare count display (e.g. "3/7" done-of-total). */
  countText?: string
  /** Number of this member's tasks involved in a schedule conflict (amber badge). */
  conflictCount?: number
  /** Right-aligned stats (overdue/workload) rendered before extras. */
  stats?: React.ReactNode
  muted?: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** Extra action buttons rendered in the action group (e.g. days-off). */
  extras?: React.ReactNode
}) {
  const collapsible = onToggleCollapse !== undefined
  // Rename + delete live on the project settings page, not here — the list-view
  // header is read-mostly (see design-docs/project-member-settings.md).
  return (
    <div
      className={`flex items-center gap-2.5 px-[18px] py-[13px] ${
        collapsed ? '' : 'border-b border-border'
      } ${collapsible ? 'cursor-pointer transition hover:bg-surface-hover' : ''}`}
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
        className={`font-medium text-sm select-none shrink-0 ${muted ? 'text-ink-muted' : 'text-ink'}`}
      >
        {name}
      </span>
      {title && title.trim() && (
        <span
          className="text-sm text-ink-faint select-none truncate min-w-0"
          title={title}
        >
          · {title}
        </span>
      )}
      <span className="text-xs text-ink-faint select-none font-mono shrink-0">
        {countText ?? count}
      </span>
      <div className="ml-auto flex items-center gap-2.5">
        {conflictCount !== undefined && conflictCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums bg-priority-high/15 text-priority-high"
            title={`${conflictCount} task${conflictCount === 1 ? '' : 's'} double-booked (same start/end time or shared prerequisite)`}
          >
            <AlertTriangle size={12} />
            {conflictCount}
          </span>
        )}
        {stats}
        {extras}
      </div>
    </div>
  )
}

/**
 * Avatar wrapped in a Cupertino progress ring — the green arc = share of the
 * member's tasks that are done. A hairline surface gap separates the arc from
 * the avatar (Activity-ring look). Track + gap use tokens so it's dark-safe.
 */
function AvatarRing({ member, pct }: { member: Member; pct: number }) {
  return (
    <span
      className="relative flex items-center justify-center shrink-0 rounded-full p-[3px]"
      style={{
        background: `conic-gradient(var(--color-status-done) ${pct}%, var(--color-border) 0)`,
      }}
      title={`${pct}% done`}
    >
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white"
        style={{ background: member.color }}
      >
        {member.name.slice(0, 1).toUpperCase()}
      </span>
    </span>
  )
}

/**
 * Right-aligned member stats for the group header (Option 5 hybrid):
 * overdue alert (only when > 0) + the next upcoming deadline. Progress lives in
 * the AvatarRing; days-off lives in MemberDaysOffButton.
 */
function MemberStatsBar({ overdue, nextDue }: { overdue: number; nextDue: string | null }) {
  return (
    <>
      {overdue > 0 && (
        <span
          className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full select-none"
          style={{
            background: 'color-mix(in srgb, var(--color-priority-urgent) 14%, transparent)',
            color: 'color-mix(in srgb, var(--color-priority-urgent) 78%, var(--color-ink) 22%)',
          }}
          title={`${overdue} task${overdue === 1 ? '' : 's'} overdue`}
        >
          {overdue} overdue
        </span>
      )}
      {nextDue && (
        <span
          className="text-[11px] font-medium text-ink-faint select-none whitespace-nowrap"
          title="Next upcoming deadline"
        >
          due {formatShortDate(nextDue)}
        </span>
      )}
    </>
  )
}

function AddTaskRow({
  projectId,
  sprintId,
  sprintStartDate,
  assigneeId,
  showAssignee = true,
}: {
  projectId: string
  sprintId: string
  sprintStartDate: string
  assigneeId: string | null
  showAssignee?: boolean
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
      {showAssignee && <div className={COL.assignee} />}
      <div className={COL.effort} />
      <div className={COL.start} />
      <div className={COL.due} />
      <div className={COL.status} />
      <div className={COL.prereq} />
      <div className={COL.actions} />
    </div>
  )
}

// Column widths — kept in sync with TaskColumnHeader. If you change one,
// change the other. Order: status-dot · seq · title · assignee · effort · start · due · priority · status · prereq · delete
// Widths sized to measured content + a small buffer (see commit notes):
//   seq "123"≈24 · "Effort (day)" hdr 73 · date "Jun 30, 17:00"≈99 · "In progress"
//   pill 97 (+ pl-2). Title takes the slack via flex-1.
const COL = {
  dot: 'w-4 shrink-0',
  seq: 'w-8 text-sm text-ink-faint tabular-nums text-center shrink-0 font-mono',
  title: 'flex-1 min-w-[150px]',
  assignee: 'w-16 flex justify-center shrink-0',
  effort: 'w-20 flex justify-center shrink-0',
  start: 'w-28 flex justify-end shrink-0',
  due: 'w-28 flex justify-end shrink-0',
  status: 'w-28 flex justify-start shrink-0 pl-2',
  prereq: 'w-14 flex justify-end shrink-0',
  actions: 'w-4 flex justify-center shrink-0',
}

/**
 * Cupertino priority tag — soft-tint pill, only for urgent/high. Normal/Low/None
 * are the silent default (no tag), keeping the title row calm.
 */
const PRIORITY_STICKER: Record<string, { label: string; bg: string; fg: string }> = {
  urgent: { label: 'Urgent', bg: 'rgba(255,59,48,0.12)', fg: '#d70015' },
  high: { label: 'High', bg: 'rgba(255,149,0,0.15)', fg: '#b25e00' },
}
function PriorityChip({ priority }: { priority: string }) {
  const meta = PRIORITY_STICKER[priority]
  if (!meta) return null
  return (
    <span
      className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-[2px]"
      style={{ background: meta.bg, color: meta.fg }}
      title={`Priority: ${meta.label}`}
    >
      {meta.label}
    </span>
  )
}

function TitleTextarea({
  value,
  onChange,
  done,
  welcomeHint,
  priority,
  indent = false,
  warn,
}: {
  value: string
  onChange: (v: string) => void
  done: boolean
  welcomeHint: boolean
  priority: string
  indent?: boolean
  warn?: string
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
  // Re-fit height whenever the textarea's WIDTH changes (window resize, sidebar
  // drag, column changes) — otherwise wrapped lines reflow but the box keeps its
  // old taller height. Track last width so our own height writes don't re-trigger.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let lastW = el.clientWidth
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      if (w !== lastW) {
        lastW = w
        resize()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div
      className={`${COL.title} flex items-start gap-1.5 ${indent ? 'relative pl-5' : ''}`}
    >
      {indent && (
        <span
          className="absolute left-1.5 top-[0.7em] w-2.5 h-px"
          style={{ background: 'var(--color-ink-faint)' }}
          aria-hidden
        />
      )}
      <PriorityChip priority={priority} />
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
        className={`flex-1 min-w-0 editable bg-transparent resize-none overflow-hidden leading-snug whitespace-pre-wrap break-words ${
          done ? 'line-through text-ink-faint' : ''
        } ${welcomeHint ? 'welcome-hint' : ''}`}
      />
      {warn && (
        <span
          className="shrink-0 mt-0.5 text-priority-high"
          title={warn}
          aria-label={warn}
        >
          <AlertTriangle size={13} />
        </span>
      )}
    </div>
  )
}

/** Static (read-only) status pill — used for a group's derived status. */
function StatusPill({ status }: { status: Status }) {
  const meta = STATUS_META[status]
  const bg = `color-mix(in srgb, ${meta.varName} 15%, transparent)`
  const fg = `color-mix(in srgb, ${meta.varName} 100%, #000 22%)`
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 leading-none"
      style={{ background: bg }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: meta.varName }}
        aria-hidden
      />
      <span
        className="text-[11.5px] font-semibold leading-[1.35]"
        style={{ color: fg }}
      >
        {meta.label}
      </span>
    </span>
  )
}

/**
 * Parent ("group") task row: a real task that also heads a group. Its own
 * status/effort/dates are replaced by values rolled up from its children —
 * progress count + bar, derived status, summed effort, child date span. The
 * title stays editable; a chevron collapses the group. The parent is excluded
 * from member counts/capacity (leaf-based counting). See design-docs/task-groups.md.
 */
function TaskGroupRow({
  task,
  childrenTasks,
  members,
  tasksById,
  collapsed,
  onToggle,
}: {
  task: Task
  childrenTasks: Task[]
  members: Member[]
  tasksById: Map<string, Task>
  collapsed: boolean
  onToggle: () => void
}) {
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members]
  )
  const total = childrenTasks.length
  const done = childrenTasks.filter((c) => c.status === 'done').length
  const pct = total ? Math.round((done / total) * 100) : 0
  const derived = derivedGroupStatus(childrenTasks)
  const hasEffort = childrenTasks.some((c) => c.estimate !== null)
  const effortSum = childrenTasks.reduce((s, c) => s + (c.estimate ?? 0), 0)
  let minStart: string | null = null
  let maxDue: string | null = null
  for (const c of childrenTasks) {
    const { startDate, dueDate } = computeWorkingPlan(c, tasksById, memberById)
    if (startDate && (!minStart || startDate < minStart)) minStart = startDate
    if (dueDate && (!maxDue || dueDate > maxDue)) maxDue = dueDate
  }
  return (
    <div className="task-row group/row relative flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface-hover transition bg-accent/[0.025]">
      <div className={COL.dot}>
        <span
          className="block w-2 h-2 rounded-full"
          style={{ background: STATUS_META[derived].varName }}
          aria-hidden
        />
      </div>
      <div className={COL.seq} title="Task number">
        {task.sequence}
      </div>
      <div className={`${COL.title} flex items-center gap-1.5 min-w-0`}>
        <button
          onClick={onToggle}
          className="shrink-0 text-ink-faint hover:text-ink transition"
          aria-label={collapsed ? 'Expand group' : 'Collapse group'}
        >
          <ChevronDown
            size={14}
            className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
        </button>
        <TitleTextarea
          value={task.title}
          onChange={(v) => db.tasks.update(task.id, { title: v })}
          done={false}
          welcomeHint={false}
          priority={task.priority}
        />
        <span className="shrink-0 text-[11px] font-medium text-ink-faint tabular-nums">
          {done}/{total}
        </span>
        <span className="shrink-0 w-10 h-1.5 rounded-full bg-canvas-sunk overflow-hidden">
          <span
            className="block h-full rounded-full bg-status-done"
            style={{ width: `${pct}%` }}
          />
        </span>
      </div>
      <div className={COL.effort}>
        <span className="text-[13px] text-ink-muted tabular-nums">
          {hasEffort ? effortSum : '—'}
        </span>
      </div>
      <div className={COL.start}>
        <span className="text-[13px] text-ink-faint tabular-nums">
          {minStart ? formatShortDate(minStart) : '—'}
        </span>
      </div>
      <div className={COL.due}>
        <span className="text-[13px] text-ink-faint tabular-nums">
          {maxDue ? formatShortDate(maxDue) : '—'}
        </span>
      </div>
      <div className={COL.status}>
        <StatusPill status={derived} />
      </div>
      <div className={COL.prereq} />
      <div className={COL.actions}>
        <RowActionsMenu
          onDelete={() => {
            if (
              confirm(
                'Delete this group task? Its grouped tasks become ungrouped, not deleted.'
              )
            )
              deleteTask(task.id)
          }}
        />
      </div>
    </div>
  )
}

/**
 * Renders a member/unassigned task list as a one-level tree: top-level tasks in
 * sort order, each parent immediately followed by its (sorted) children. A child
 * whose parent isn't in this list (moved member/sprint) falls back to top-level.
 * Returns a fragment so the caller's `divide-y` separates every row uniformly.
 */
function TaskRows({
  tasks,
  members,
  allTasks,
  tasksById,
  showAssignee = true,
  conflictTips,
}: {
  tasks: Task[]
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
  showAssignee?: boolean
  /** taskId → conflict tooltip (member double-booking); absent map = no warnings. */
  conflictTips?: Map<string, string>
}) {
  const { topLevel, childrenByParent } = useMemo(() => {
    const idSet = new Set(tasks.map((t) => t.id))
    const childrenByParent = new Map<string, Task[]>()
    for (const t of tasks) {
      if (t.parentId && idSet.has(t.parentId)) {
        const arr = childrenByParent.get(t.parentId) ?? []
        arr.push(t)
        childrenByParent.set(t.parentId, arr)
      }
    }
    const isChild = (t: Task) => !!(t.parentId && idSet.has(t.parentId))
    return { topLevel: tasks.filter((t) => !isChild(t)), childrenByParent }
  }, [tasks])

  // Collapse state per parent, persisted to localStorage. Seed once for the
  // parents present; newly-created groups default to expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      for (const pid of childrenByParent.keys()) {
        if (localStorage.getItem(GROUP_COLLAPSE_KEY(pid)) === '1') next.add(pid)
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        localStorage.removeItem(GROUP_COLLAPSE_KEY(id))
      } else {
        next.add(id)
        localStorage.setItem(GROUP_COLLAPSE_KEY(id), '1')
      }
      return next
    })

  return (
    <>
      {topLevel.map((t) => {
        const kids = childrenByParent.get(t.id)
        if (kids && kids.length > 0) {
          const isCollapsed = collapsed.has(t.id)
          return (
            <Fragment key={t.id}>
              <TaskGroupRow
                task={t}
                childrenTasks={kids}
                members={members}
                tasksById={tasksById}
                collapsed={isCollapsed}
                onToggle={() => toggle(t.id)}
              />
              {!isCollapsed &&
                kids.map((c) => (
                  <TaskRow
                    key={c.id}
                    task={c}
                    members={members}
                    allTasks={allTasks}
                    tasksById={tasksById}
                    showAssignee={showAssignee}
                    isChild
                    onUngroup={() => setTaskParent(c.id, null)}
                    warn={conflictTips?.get(c.id)}
                  />
                ))}
            </Fragment>
          )
        }
        // Top-level leaf: can be grouped under any other top-level task.
        const candidates = topLevel.filter((x) => x.id !== t.id)
        return (
          <TaskRow
            key={t.id}
            task={t}
            members={members}
            allTasks={allTasks}
            tasksById={tasksById}
            showAssignee={showAssignee}
            groupCandidates={candidates}
            onGroupUnder={(pid) => setTaskParent(t.id, pid)}
            warn={conflictTips?.get(t.id)}
          />
        )
      })}
    </>
  )
}

function TaskRow({
  task,
  members,
  allTasks,
  tasksById,
  showAssignee = true,
  isChild = false,
  groupCandidates,
  onGroupUnder,
  onUngroup,
  warn,
}: {
  task: Task
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
  showAssignee?: boolean
  isChild?: boolean
  groupCandidates?: Task[]
  onGroupUnder?: (parentId: string) => void
  onUngroup?: () => void
  /** Conflict tooltip — renders an amber warning triangle after the title. */
  warn?: string
}) {
  const update = (patch: Partial<Task>) => db.tasks.update(task.id, patch)
  const assignee = members.find((m) => m.id === task.assigneeId) ?? null
  const blocked = isTaskBlocked(task, tasksById)
  const isWelcome = task.title.startsWith(WELCOME_PREFIX)
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members]
  )
  // Date + time from one live plan so they always agree and reflect current
  // data — never a stale stored dueDate paired with a freshly-computed time.
  const {
    startDate: liveStart,
    dueDate: liveDue,
    startTime,
    endTime,
  } = computeWorkingPlan(task, tasksById, memberById)
  const overdue = isOverdue(liveDue, task.status === 'done')

  return (
    <div
      className="task-row group/row relative flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface-hover transition"
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
        priority={task.priority}
        indent={isChild}
        warn={warn}
      />

      {showAssignee && (
        <div className={COL.assignee}>
          <AssigneePicker task={task} members={members} assignee={assignee} update={update} />
        </div>
      )}

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
          value={liveStart}
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
          value={liveDue}
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

      <div className={COL.actions}>
        <RowActionsMenu
          onDelete={() => {
            if (confirm('Delete this task?')) deleteTask(task.id)
          }}
          groupCandidates={groupCandidates}
          onGroupUnder={onGroupUnder}
          onUngroup={onUngroup}
        />
      </div>
    </div>
  )
}

/**
 * Kebab (⋯) menu rendered at the end of each task row. Always visible —
 * touch-friendly, no hover bias. Currently surfaces just Delete; room to add
 * Duplicate / Move-to-sprint / Archive later without changing the row layout.
 */
function RowActionsMenu({
  onDelete,
  groupCandidates,
  onGroupUnder,
  onUngroup,
}: {
  onDelete: () => void
  groupCandidates?: Task[]
  onGroupUnder?: (parentId: string) => void
  onUngroup?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState(false)
  // Menu is rendered in a portal (fixed, anchored to the trigger) so it is never
  // clipped by the member card's overflow-x-auto scroll container. Flips upward
  // when the trigger sits near the viewport bottom.
  const [pos, setPos] = useState<{
    top?: number
    bottom?: number
    right: number
  } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) {
        setOpen(false)
        setSub(false)
      }
    }
    const onScroll = () => {
      setOpen(false)
      setSub(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])
  const toggle = () => {
    if (open) {
      setOpen(false)
      setSub(false)
      return
    }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const right = window.innerWidth - r.right
      const openUp = window.innerHeight - r.bottom < 180
      setPos(
        openUp
          ? { bottom: window.innerHeight - r.top + 6, right }
          : { top: r.bottom + 6, right }
      )
    }
    setSub(false)
    setOpen(true)
  }
  const canGroup = !!(onGroupUnder && groupCandidates && groupCandidates.length > 0)
  const item =
    'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[7px] text-left transition'
  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        className="w-4 h-4 inline-flex items-center justify-center rounded text-ink-faint opacity-50 group-hover/row:opacity-100 hover:!opacity-100 hover:text-ink hover:bg-canvas-sunk transition"
        aria-label="Row actions"
      >
        <MoreVertical size={12} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: pos.top,
              bottom: pos.bottom,
              right: pos.right,
            }}
            className="z-50 min-w-[190px] rounded-[12px] border border-border-hair bg-surface shadow-[0_10px_30px_rgba(0,0,0,0.16)] p-1 text-sm"
          >
            {!sub && onUngroup && (
            <button
              onClick={() => {
                setOpen(false)
                onUngroup()
              }}
              className={`${item} text-ink hover:bg-surface-hover`}
            >
              <CornerUpLeft size={13} className="text-ink-faint" />
              Remove from group
            </button>
          )}
          {!sub && canGroup && (
            <button
              onClick={() => setSub(true)}
              className={`${item} text-ink hover:bg-surface-hover`}
            >
              <CornerDownRight size={13} className="text-ink-faint" />
              Group under…
            </button>
          )}
          {sub && canGroup && (
            <div className="max-h-56 overflow-auto">
              <div className="px-2.5 py-1 text-[11px] font-semibold text-ink-faint">
                Group under…
              </div>
              {groupCandidates!.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setOpen(false)
                    setSub(false)
                    onGroupUnder!(c.id)
                  }}
                  className={`${item} text-ink hover:bg-surface-hover`}
                >
                  <span className="font-mono text-ink-faint text-[12px] shrink-0">
                    {c.sequence}
                  </span>
                  <span className="truncate">{c.title || 'Untitled'}</span>
                </button>
              ))}
            </div>
          )}
          {!sub && (
            <button
              onClick={() => {
                setOpen(false)
                onDelete()
              }}
              className={`${item} text-red-500 hover:bg-red-500/10`}
            >
              <Trash2 size={13} />
              Delete task
            </button>
          )}
          </div>,
          document.body
        )}
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
  showAssignee = true,
}: {
  sort: { field: SortField; dir: 'asc' | 'desc' }
  setSort: React.Dispatch<
    React.SetStateAction<{ field: SortField; dir: 'asc' | 'desc' }>
  >
  showAssignee?: boolean
}) {
  const onSort = (field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    )
  }
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border-hair bg-canvas-sunk/40">
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
        className="flex-1 min-w-[150px]"
        field="title"
        label="Task"
        sort={sort}
        onSort={onSort}
      />
      {showAssignee && (
        <div className={`${COL.assignee} text-[11px] tracking-normal text-ink-faint font-medium text-center`}>
          Assignee
        </div>
      )}
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
      <div className={COL.actions} />
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
      className={`${className} group flex items-center gap-1 text-[11px] tracking-normal font-medium select-none py-0.5 hover:bg-black/[0.04] rounded transition ${
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
  // Cupertino status pill: soft tinted bg, colored dot + label, fully rounded.
  const bg = `color-mix(in srgb, ${meta.varName} 15%, transparent)`
  const fg = `color-mix(in srgb, ${meta.varName} 100%, #000 22%)`
  return (
    <div
      className="relative inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 cursor-pointer transition hover:opacity-90 leading-none"
      style={{ background: bg }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: meta.varName }}
        aria-hidden
      />
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as Status)}
        className="text-[11.5px] font-semibold px-0 m-0 border-0 bg-transparent appearance-none cursor-pointer outline-none leading-[1.35] h-auto"
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
        <span className="text-sm text-ink-faint">—</span>
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
      className="editable w-full text-sm text-center tabular-nums bg-transparent placeholder:text-ink-faint"
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
      className="editable w-full text-sm text-right tabular-nums bg-transparent placeholder:text-ink-faint"
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
        className="w-full text-sm text-ink-faint hover:text-ink hover:bg-canvas-sunk rounded-lg py-2.5 flex items-center justify-center gap-1.5 transition"
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
