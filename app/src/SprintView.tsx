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
  AlertTriangle,
  Check,
  FolderPlus,
  Ungroup,
} from 'lucide-react'
import {
  db,
  uid,
  colorForName,
  deleteTask,
  setTaskParent,
  createGroupFromSelection,
  setDependencies,
  findCyclePath,
  recomputeDates,
  computeWorkingPlan,
  isTaskBlocked,
  nextSequence,
  type Member,
  type Task,
  type Status,
} from './db'
import { Avatar, MemberDaysOffButton } from './members'
import {
  formatRelativeDate,
  formatShortDate,
  isOverdue,
  parsePrereqSeqs,
  formatSeqRanges,
} from './lib'

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
    k === 'start' ? 'giờ bắt đầu' : k === 'end' ? 'giờ kết thúc' : 'chung prereq'
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
    tips.set(id, `Trùng lịch với ${parts.join('; ')}`)
  }
  return tips
}

/** Roll-up status of a parent task derived from its children (display only). */
export function derivedGroupStatus(children: Task[]): Status {
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
  sprintEndDate,
  tasks,
  search,
}: {
  projectId: string
  sprintId: string
  sprintStartDate: string
  sprintEndDate: string
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
  // Multi-select for the group-via-selection flow. Clears on sprint change.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const clearSelection = () => setSelectedIds(new Set())

  useEffect(() => {
    setCollapsed(loadCollapsed(sprintId))
    setSelectedIds(new Set())
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
          sprintEndDate={sprintEndDate}
          members={members}
          allTasks={tasks}
          tasksById={tasksById}
          collapsed={collapsed.has(member.id)}
          onToggleCollapse={() => toggleCollapse(member.id)}
          sort={sort}
          setSort={setSort}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
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
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
      )}

      {emptyMembers.length > 0 && (
        <CollapsedMembers
          projectId={projectId}
          members={emptyMembers}
          sprintId={sprintId}
          sprintStartDate={sprintStartDate}
          sprintEndDate={sprintEndDate}
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

      <SelectionBar
        selectedIds={selectedIds}
        tasksById={tasksById}
        allTasks={tasks}
        onClear={clearSelection}
      />
    </div>
  )
}

/**
 * Floating action bar shown while ≥1 task is selected (group-via-selection flow).
 * "Gom nhóm" creates a new group parent from the selection (same member, ≥2, none a
 * group head); "Bỏ nhóm" ungroups any selected children; "Xoá" deletes the selection
 * (confirm first; deleting a group head ungroups its children, doesn't cascade). This
 * bar is the only place to delete a task — there is no per-row kebab.
 * See design-docs/task-groups.md.
 */
function SelectionBar({
  selectedIds,
  tasksById,
  allTasks,
  onClear,
}: {
  selectedIds: Set<string>
  tasksById: Map<string, Task>
  allTasks: Task[]
  onClear: () => void
}) {
  const n = selectedIds.size
  const parentIds = useMemo(() => {
    const s = new Set<string>()
    for (const t of allTasks) if (t.parentId) s.add(t.parentId)
    return s
  }, [allTasks])
  const selected = [...selectedIds]
    .map((id) => tasksById.get(id))
    .filter((t): t is Task => !!t)
  // Group is valid when ≥2 are selected, all share one assignee, and none is a
  // group head (parents can't be nested — one level).
  const sameMember =
    selected.length >= 2 &&
    selected.every((t) => t.assigneeId === selected[0].assigneeId)
  const noneParent = selected.every((t) => !parentIds.has(t.id))
  const canGroup = sameMember && noneParent
  const anyChild = selected.some((t) => !!t.parentId)

  const doGroup = async () => {
    if (!canGroup) return
    await createGroupFromSelection(selected.map((t) => t.id))
    onClear()
  }
  const doUngroup = async () => {
    await Promise.all(
      selected.filter((t) => t.parentId).map((t) => setTaskParent(t.id, null))
    )
    onClear()
  }
  const doDelete = async () => {
    if (n === 0) return
    const hasGroup = selected.some((t) => parentIds.has(t.id))
    const msg = hasGroup
      ? `Xoá ${n} task đã chọn? Task con của nhóm sẽ được gỡ nhóm, không bị xoá.`
      : `Xoá ${n} task đã chọn?`
    if (!confirm(msg)) return
    // Sequential: deleting a parent promotes its children to top-level, so a
    // concurrent run could race a selected child's own delete.
    for (const t of selected) await deleteTask(t.id)
    onClear()
  }

  return (
    <div
      className={`fixed left-1/2 bottom-6 z-40 -translate-x-1/2 flex items-center gap-3 rounded-[14px] bg-ink dark:bg-[#2c2c2e] dark:ring-1 dark:ring-white/10 text-white pl-4 pr-2 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.22),0_0_0_0.5px_rgba(0,0,0,0.06)] transition-all duration-200 ${
        n > 0
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-3 pointer-events-none'
      }`}
      role="toolbar"
      aria-label="Selected tasks"
    >
      <span className="text-[13.5px]">
        <b className="font-semibold tabular-nums">{n}</b> đã chọn
      </span>
      {anyChild && (
        <button
          onClick={doUngroup}
          className="inline-flex items-center gap-1.5 text-[13px] text-white/80 hover:text-white px-2.5 py-1.5 rounded-[9px] hover:bg-white/10 transition"
        >
          <Ungroup size={14} /> Bỏ nhóm
        </button>
      )}
      <button
        onClick={doGroup}
        disabled={!canGroup}
        title={
          canGroup
            ? undefined
            : 'Chọn ≥2 task cùng một người (không phải nhóm) để gom'
        }
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-[9px] px-3 py-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed bg-white text-[#1d1d1f] hover:bg-white/90"
      >
        <FolderPlus size={14} /> Gom nhóm
      </button>
      <button
        onClick={doDelete}
        className="inline-flex items-center gap-1.5 text-[13px] text-red-300 hover:text-white hover:bg-red-500/80 px-2.5 py-1.5 rounded-[9px] transition"
      >
        <Trash2 size={14} /> Xoá
      </button>
      <span className="w-px self-stretch bg-white/15" aria-hidden />
      <button
        onClick={onClear}
        className="text-[13px] text-white/70 hover:text-white px-2 py-1.5"
      >
        Huỷ
      </button>
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
  sprintEndDate,
  members,
  allTasks,
  tasksById,
  collapsed,
  onToggleCollapse,
  sort,
  setSort,
  selectedIds,
  onToggleSelect,
}: {
  projectId: string
  member: Member
  tasks: Task[]
  sprintId: string
  sprintStartDate: string
  sprintEndDate: string
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
  collapsed: boolean
  onToggleCollapse: () => void
  sort: { field: SortField; dir: 'asc' | 'desc' }
  setSort: React.Dispatch<
    React.SetStateAction<{ field: SortField; dir: 'asc' | 'desc' }>
  >
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
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
        extras={
          <MemberDaysOffButton
            member={member}
            range={{ start: sprintStartDate, end: sprintEndDate }}
          />
        }
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
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
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
  selectedIds,
  onToggleSelect,
}: {
  tasks: Task[]
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
  sort: { field: SortField; dir: 'asc' | 'desc' }
  setSort: React.Dispatch<
    React.SetStateAction<{ field: SortField; dir: 'asc' | 'desc' }>
  >
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
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
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
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
  sprintEndDate,
  allMembers,
  expanded,
  onToggle,
}: {
  projectId: string
  members: Member[]
  sprintId: string
  sprintStartDate: string
  sprintEndDate: string
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
              extras={
                <MemberDaysOffButton
                  member={m}
                  range={{ start: sprintStartDate, end: sprintEndDate }}
                />
              }
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
            title="Task trùng lịch: cùng giờ bắt đầu/kết thúc, hoặc chung prereq"
          >
            <AlertTriangle size={12} />
            {conflictCount} trùng lịch
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
      <div className={COL.lead} />
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
    </div>
  )
}

// Column widths — kept in sync with TaskColumnHeader. If you change one,
// change the other. Order: status-dot · seq · title · assignee · effort · start · due · priority · status · prereq
// Widths sized to measured content + a small buffer (see commit notes):
//   seq "123"≈24 · "Effort (day)" hdr 73 · date "Jun 30, 17:00"≈99 · "In progress"
//   pill 97 (+ pl-2). Title takes the slack via flex-1. (Row delete moved off the
//   row into the multi-select SelectionBar — no per-row actions column.)
const COL = {
  lead: 'w-5 shrink-0 flex justify-center items-center',
  dot: 'w-4 shrink-0',
  seq: 'w-8 text-sm text-ink-faint tabular-nums text-center shrink-0 font-mono',
  title: 'flex-1 min-w-[150px]',
  assignee: 'w-16 flex justify-center shrink-0',
  effort: 'w-20 flex justify-center shrink-0',
  start: 'w-28 flex justify-end shrink-0',
  due: 'w-28 flex justify-end shrink-0',
  status: 'w-28 flex justify-start shrink-0 pl-2',
  prereq: 'w-20 flex justify-end shrink-0',
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
  bold = false,
}: {
  value: string
  onChange: (v: string) => void
  done: boolean
  welcomeHint: boolean
  priority: string
  indent?: boolean
  bold?: boolean
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
      className={`${COL.title} flex items-start gap-1.5 ${indent ? 'pl-5' : ''}`}
    >
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
        } ${welcomeHint ? 'welcome-hint' : ''} ${bold ? 'font-semibold' : ''}`}
      />
    </div>
  )
}

/** Static (read-only) status pill — used for a group's derived status. */
function StatusPill({ status }: { status: Status }) {
  const meta = STATUS_META[status]
  const bg = `color-mix(in srgb, ${meta.varName} 15%, transparent)`
  const fg = `color-mix(in srgb, ${meta.varName} 100%, #000 22%)`
  // The interactive StatusPicker's native <select> reserves space for the
  // widest option ("In progress"), so its pill is always that wide. Reserve
  // the same width here via an invisible sizer so the group's read-only pill
  // matches a normal row's pill exactly (see design-docs/task-groups.md).
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
      <span className="grid">
        <span
          className="invisible col-start-1 row-start-1 text-[11.5px] font-semibold leading-[1.35]"
          aria-hidden
        >
          In progress
        </span>
        <span
          className="col-start-1 row-start-1 text-[11.5px] font-semibold leading-[1.35]"
          style={{ color: fg }}
        >
          {meta.label}
        </span>
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
  const derived = derivedGroupStatus(childrenTasks)
  const hasEffort = childrenTasks.some((c) => c.estimate !== null)
  const effortSum = childrenTasks.reduce((s, c) => s + (c.estimate ?? 0), 0)
  // Span = earliest child start … latest child end, shown with the same
  // date+time format/size as a normal task row (see design-docs/task-groups.md).
  let startLabel: string | null = null
  let endLabel: string | null = null
  let minKey: string | null = null
  let maxKey: string | null = null
  for (const c of childrenTasks) {
    const plan = computeWorkingPlan(c, tasksById, memberById)
    if (plan.startDate) {
      const k = `${plan.startDate}T${plan.startTime ?? ''}`
      if (!minKey || k < minKey) {
        minKey = k
        startLabel = plan.startTime
          ? `${formatRelativeDate(plan.startDate)}, ${plan.startTime}`
          : formatRelativeDate(plan.startDate)
      }
    }
    if (plan.dueDate) {
      const k = `${plan.dueDate}T${plan.endTime ?? ''}`
      if (!maxKey || k > maxKey) {
        maxKey = k
        endLabel = plan.endTime
          ? `${formatRelativeDate(plan.dueDate)}, ${plan.endTime}`
          : formatRelativeDate(plan.dueDate)
      }
    }
  }
  return (
    <div className="task-row group/row relative flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface-hover transition bg-accent/[0.025]">
      <div className={COL.lead} />
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
          bold
        />
        <span className="shrink-0 text-[11px] font-medium text-ink-faint tabular-nums">
          {done}/{total}
        </span>
      </div>
      <div className={COL.effort}>
        <span className="text-sm text-ink-muted tabular-nums">
          {hasEffort ? effortSum : '—'}
        </span>
      </div>
      <div className={COL.start}>
        <span className="inline-flex items-center justify-end w-full h-8 px-2 text-sm text-ink-muted whitespace-nowrap">
          {startLabel ?? '—'}
        </span>
      </div>
      <div className={COL.due}>
        <span className="inline-flex items-center justify-end w-full h-8 px-2 text-sm text-ink-muted whitespace-nowrap">
          {endLabel ?? '—'}
        </span>
      </div>
      <div className={COL.status}>
        <StatusPill status={derived} />
      </div>
      <div className={COL.prereq} />
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
  selectedIds,
  onToggleSelect,
}: {
  tasks: Task[]
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
  showAssignee?: boolean
  /** taskId → conflict tooltip (member double-booking); absent map = no warnings. */
  conflictTips?: Map<string, string>
  /** Multi-select state for the group-via-selection flow. */
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
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
                    warn={conflictTips?.get(c.id)}
                    selected={selectedIds?.has(c.id)}
                    onToggleSelect={
                      onToggleSelect ? () => onToggleSelect(c.id) : undefined
                    }
                  />
                ))}
            </Fragment>
          )
        }
        return (
          <TaskRow
            key={t.id}
            task={t}
            members={members}
            allTasks={allTasks}
            tasksById={tasksById}
            showAssignee={showAssignee}
            warn={conflictTips?.get(t.id)}
            selected={selectedIds?.has(t.id)}
            onToggleSelect={
              onToggleSelect ? () => onToggleSelect(t.id) : undefined
            }
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
  warn,
  selected = false,
  onToggleSelect,
}: {
  task: Task
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
  showAssignee?: boolean
  isChild?: boolean
  /** Conflict tooltip — renders an amber warning triangle in the lead gutter. */
  warn?: string
  selected?: boolean
  onToggleSelect?: () => void
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
      className={`task-row group/row relative flex items-center gap-3 px-4 py-2 text-sm transition ${
        selected ? 'bg-accent-soft' : 'hover:bg-surface-hover'
      }`}
      title={blocked ? 'Blocked — waiting on a prerequisite task' : undefined}
    >
      <div className={`${COL.lead} relative self-stretch`}>
        {/* Conflict triangle at rest; hidden while hovering the row or when selected. */}
        {warn && (
          <span
            className={`absolute inset-0 grid place-items-center text-priority-high pointer-events-none transition-opacity group-hover/row:opacity-0 ${
              selected ? 'opacity-0' : ''
            }`}
            title={warn}
            aria-label={warn}
          >
            <AlertTriangle size={14} />
          </span>
        )}
        {/* Select checkbox: hover-revealed, stays visible while selected. */}
        {onToggleSelect && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect()
            }}
            aria-label={selected ? 'Deselect task' : 'Select task'}
            aria-pressed={selected}
            className={`absolute inset-0 grid place-items-center transition-opacity ${
              selected
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none group-hover/row:opacity-100 group-hover/row:pointer-events-auto'
            }`}
          >
            <span
              className={`w-[17px] h-[17px] rounded-[5px] border flex items-center justify-center transition ${
                selected
                  ? 'bg-accent border-accent text-white'
                  : 'border-border-strong bg-surface text-transparent'
              }`}
            >
              <Check size={11} strokeWidth={3.5} />
            </span>
          </button>
        )}
      </div>
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
      <div className={COL.lead} />
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
  const seqOf = (id: string): number | undefined => tasksById.get(id)?.sequence
  // Display dependsOn as a compact range label (e.g. "2-5, 8").
  const currentLabel = formatSeqRanges(
    task.dependsOn
      .map(seqOf)
      .filter((n): n is number => typeof n === 'number')
  )

  const [draft, setDraft] = useState(currentLabel)
  const [focused, setFocused] = useState(false)
  // Why some typed numbers didn't apply (cycle / not found). Shown in a small
  // popover instead of the old silent snap-back. Each cycle line carries the
  // loop path so it's checkable at a glance. Null = nothing to report.
  const [notice, setNotice] = useState<
    { head: string; pathSeqs?: number[]; hint?: string }[] | null
  >(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })

  useEffect(() => {
    if (!focused) setDraft(currentLabel)
  }, [currentLabel, focused])

  // Auto-dismiss the rejection notice so it never lingers.
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4500)
    return () => clearTimeout(t)
  }, [notice])

  // Pin the notice popover to the input (portal escapes the card's overflow).
  useEffect(() => {
    if (!notice) return
    const pin = () => {
      const r = inputRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
    }
    pin()
    window.addEventListener('scroll', pin, true)
    window.addEventListener('resize', pin)
    return () => {
      window.removeEventListener('scroll', pin, true)
      window.removeEventListener('resize', pin)
    }
  }, [notice])

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
    const seqs = parsePrereqSeqs(draft)
    const known: { seq: number; id: string }[] = []
    const unknown: number[] = []
    for (const n of seqs) {
      if (n === task.sequence) continue // self-link: not "unknown", just skip
      const id = seqToId.get(n)
      if (id) known.push({ seq: n, id })
      else unknown.push(n)
    }
    const saved = await setDependencies(
      task.id,
      known.map((k) => k.id)
    )
    const savedSet = new Set(saved)
    // Known numbers that setDependencies refused = cycles (would loop back).
    const cyclic = known.filter((k) => !savedSet.has(k.id))
    setDraft(
      formatSeqRanges(
        saved.map(seqOf).filter((n): n is number => typeof n === 'number')
      )
    )
    const items: { head: string; pathSeqs?: number[]; hint?: string }[] = []
    for (const k of cyclic) {
      // Build the loop as sequence numbers: this task → dep → …existing path… → this task.
      const idPath = findCyclePath(task.id, k.id, allTasks)
      const seqs = idPath
        ? [task.sequence, ...idPath.map(seqOf)].filter(
            (n): n is number => typeof n === 'number'
          )
        : null
      // The back-edge that closes the loop is `backNode → this task`; removing
      // this task from backNode's prereqs breaks it.
      const backSeq =
        idPath && idPath.length >= 2 ? seqOf(idPath[idPath.length - 2]) : undefined
      items.push({
        head: `Dropped #${k.seq} — creates a cycle`,
        pathSeqs: seqs && seqs.length > 1 ? seqs : undefined,
        hint:
          backSeq !== undefined
            ? `Remove #${task.sequence} from #${backSeq} to break it`
            : undefined,
      })
    }
    if (unknown.length)
      items.push({
        head: `Dropped ${unknown.map((n) => `#${n}`).join(', ')} — not in this sprint`,
      })
    setNotice(items.length ? items : null)
  }

  return (
    <>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          setFocused(true)
          setNotice(null)
        }}
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
        title="Prereq task numbers — list or ranges, e.g. 2-5, 8"
        aria-label="Prerequisite task numbers"
        className={`editable w-full text-sm text-right tabular-nums bg-transparent placeholder:text-ink-faint ${
          notice ? 'text-priority-high' : ''
        }`}
      />
      {notice &&
        createPortal(
          <div
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className="z-50 max-w-[280px] rounded-[10px] border border-priority-high/30 bg-surface px-2.5 py-1.5 text-[12px] leading-snug text-priority-high shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
            role="status"
          >
            {notice.map((it, i) => (
              <div key={i} className={i ? 'mt-2' : ''}>
                <div>{it.head}</div>
                {it.pathSeqs && (
                  <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                    {it.pathSeqs.map((n, j) => (
                      <Fragment key={j}>
                        {j > 0 && (
                          <span
                            className="prereq-arrow"
                            style={
                              { '--d': `${Math.max(0, j * 0.1 - 0.05)}s` } as React.CSSProperties
                            }
                          >
                            →
                          </span>
                        )}
                        <span
                          className={`prereq-chip${j === 0 ? ' prereq-chip--head' : ''}${
                            j === it.pathSeqs!.length - 1 ? ' prereq-chip--close' : ''
                          }`}
                          style={{ '--d': `${j * 0.1}s` } as React.CSSProperties}
                        >
                          {n}
                        </span>
                      </Fragment>
                    ))}
                  </div>
                )}
                {it.hint && (
                  <div className="mt-1.5 text-[11px] text-ink-muted">{it.hint}</div>
                )}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
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
