import {
  Fragment,
  memo,
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
  Link2,
  Link2Off,
} from 'lucide-react'
import { useDragHandle, useDragHover, type RowDrag } from './DragHandle'
import { computeDropSlot, resolveDropOrder } from './reorder'
import {
  db,
  addMember,
  deleteTask,
  setTaskParent,
  createGroupFromSelection,
  setDependencies,
  setListOrder,
  renormalizeListOrder,
  compareMembersByOrder,
  setMemberOrder,
  renormalizeMemberOrder,
  findCyclePath,
  recomputeDates,
  updateTask,
  computeWorkingPlan,
  computeAllWorkingPlans,
  isTaskBlocked,
  addSprintTask,
  type Member,
  type Task,
  type Status,
  type WorkingPlan,
} from './db'
import { Avatar, MemberDaysOffButton } from './members'
import {
  STATUS_META,
  computeMemberConflicts,
  derivedGroupStatus,
} from './sprint-logic'
import { DatePickCell, SprintRangeContext } from './DatePicker'
import { useConfirm } from './confirm-context'
import { AddGroupButton } from './AddGroupButton'
import {
  formatRelativeDate,
  formatShortDate,
  isOverdue,
  parsePrereqSeqs,
  formatSeqRanges,
  flattenDisplayOrder,
  PRIORITY_TAG,
} from './lib'

// Re-exported so existing importers (BoardView) keep `from './SprintView'`.
export { DatePickCell }

const WELCOME_PREFIX = 'Welcome —'

// Fallback for a row whose task somehow isn't in the view's planById pass
// (never expected — the pass covers every sprint task). Matches planFor's
// NULL_PLAN rendering: no dates, default day-part times.
const NULL_WORKING_PLAN: WorkingPlan = {
  startDate: null,
  dueDate: null,
  startTime: '08:00',
  endTime: '12:00',
}

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
/** Composite `date+time` sort keys per task id, mirroring what Start/End cells render. */
type DateSortKeys = Map<string, { startDate: string; dueDate: string }>
const EMPTY_DATE_KEY = '￿' // no date → sorts last ascending (matches the raw-field sentinel)

/**
 * Build the Start/End sort keys that MATCH the displayed cells. A leaf row shows its
 * *scheduled* plan date, and a group-head row shows a rollup (earliest child start …
 * latest child end) that its own stored `startDate`/`dueDate` never tracks — so sorting
 * by the raw field puts parents out of order (usually last, since a parent's raw dueDate
 * is empty). Computed per lane (the array being sorted) so the rollup considers exactly
 * the children nested under the parent in that card. See design-docs/list-view.md.
 */
export function buildDateSortKeys(
  lane: Task[],
  planById: Map<string, WorkingPlan>
): DateSortKeys {
  const idSet = new Set(lane.map((t) => t.id))
  const kidsByParent = new Map<string, Task[]>()
  for (const t of lane) {
    if (t.parentId && idSet.has(t.parentId)) {
      const arr = kidsByParent.get(t.parentId) ?? []
      arr.push(t)
      kidsByParent.set(t.parentId, arr)
    }
  }
  const keys: DateSortKeys = new Map()
  for (const t of lane) {
    const kids = kidsByParent.get(t.id)
    if (kids?.length) {
      // Group head: min child start … max child end (same as the TaskGroupRow cell).
      let minStart: string | null = null
      let maxDue: string | null = null
      for (const c of kids) {
        const plan = planById.get(c.id)
        if (plan?.startDate) {
          const k = `${plan.startDate}T${plan.startTime ?? ''}`
          if (!minStart || k < minStart) minStart = k
        }
        if (plan?.dueDate) {
          const k = `${plan.dueDate}T${plan.endTime ?? ''}`
          if (!maxDue || k > maxDue) maxDue = k
        }
      }
      keys.set(t.id, {
        startDate: minStart ?? EMPTY_DATE_KEY,
        dueDate: maxDue ?? EMPTY_DATE_KEY,
      })
    } else {
      const plan = planById.get(t.id)
      keys.set(t.id, {
        startDate: plan?.startDate
          ? `${plan.startDate}T${plan.startTime ?? ''}`
          : EMPTY_DATE_KEY,
        dueDate: plan?.dueDate
          ? `${plan.dueDate}T${plan.endTime ?? ''}`
          : EMPTY_DATE_KEY,
      })
    }
  }
  return keys
}

export function compareTasks(
  a: Task,
  b: Task,
  field: SortField,
  dir: 'asc' | 'desc',
  dateKeys?: DateSortKeys
): number {
  const mul = dir === 'asc' ? 1 : -1
  const valueOf = (t: Task): string | number =>
    field === 'seq'
      ? (t.listOrder ?? t.sequence)
      : field === 'title'
        ? (t.title || '').toLowerCase()
        : field === 'effort'
          ? (t.estimate ?? Number.POSITIVE_INFINITY)
          : field === 'status'
            ? STATUS_RANK[t.status]
            : field === 'dependsOn'
              ? (t.dependsOn?.length ?? 0)
              : field === 'startDate' || field === 'dueDate'
                ? // Sort by the displayed computed/rollup date, not the raw field.
                  (dateKeys?.get(t.id)?.[field] ?? t[field] ?? '￿')
                : (t[field] ?? '￿')
  const va = valueOf(a)
  const vb = valueOf(b)
  if (va < vb) return -1 * mul
  if (va > vb) return 1 * mul
  return a.sequence - b.sequence // stable tiebreak by seq
}

const COLLAPSE_KEY = (sprintId: string) => `plan-up:collapsed:${sprintId}`
const GROUP_COLLAPSE_KEY = (parentId: string) =>
  `plan-up:taskgroup-collapsed:${parentId}`
// One global sort preference (shared across all member cards, not per-sprint), so it
// survives switching view/sprint/project and a page reload. See list-view.md.
const SORT_KEY = 'plan-up:sort'

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

// `field: null` is the NEUTRAL state — no column sorted, rows fall back to the
// manual order (listOrder ?? sequence) and no header shows an arrow. It's the
// third stop in every column's asc → desc → off cycle. Keeping it distinct from
// `seq asc` is what lets the ID/seq column clear its arrow too (off ≠ seq asc
// visually identical rows, but the indicator disappears). See list-view.md.
type Sort = { field: SortField | null; dir: 'asc' | 'desc' }
const DEFAULT_SORT: Sort = { field: null, dir: 'asc' }
const SORT_FIELDS: SortField[] = [
  'seq',
  'title',
  'effort',
  'startDate',
  'dueDate',
  'status',
  'dependsOn',
]

function loadSort(): Sort {
  try {
    const raw = localStorage.getItem(SORT_KEY)
    if (!raw) return DEFAULT_SORT
    const parsed = JSON.parse(raw) as Partial<Sort>
    // Persisted neutral state (no field) restores as-is.
    if (parsed && parsed.field == null) return DEFAULT_SORT
    // Legacy migration: before the neutral state existed, `seq asc` WAS the
    // default/off state. It renders identically to neutral (manual order), so
    // map an old persisted `seq asc` onto neutral — otherwise an upgrading user
    // keeps seeing the ID column stuck with an arrow. An explicit `seq desc` is
    // a real choice → kept.
    if (parsed && parsed.field === 'seq' && parsed.dir === 'asc') return DEFAULT_SORT
    if (
      parsed &&
      SORT_FIELDS.includes(parsed.field as SortField) &&
      (parsed.dir === 'asc' || parsed.dir === 'desc')
    ) {
      return { field: parsed.field as SortField, dir: parsed.dir }
    }
    return DEFAULT_SORT
  } catch {
    return DEFAULT_SORT
  }
}

function saveSort(sort: Sort) {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(sort))
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
}: {
  projectId: string
  sprintId: string
  sprintStartDate: string
  sprintEndDate: string
  tasks: Task[]
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
  const [sort, setSort] = useState<Sort>(loadSort)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sprint switch swaps the persisted collapse set + clears selection
    setCollapsed(loadCollapsed(sprintId))
    setSelectedIds(new Set())
  }, [sprintId])

  // Persist the (shared) sort on every change so it survives remounts — switching
  // view/sprint/project — and a page reload.
  useEffect(() => {
    saveSort(sort)
  }, [sort])

  const toggleCollapse = (memberId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      saveCollapsed(sprintId, next)
      return next
    })
  }

  // Dependency picker + blocked check need a full lookup so a task's prereq is
  // always resolvable.
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const memberById = useMemo(
    () => new Map((members ?? []).map((m) => [m.id, m])),
    [members]
  )
  // ONE plan pass for every row in the view, recomputed only when data changes.
  // Rows used to call computeWorkingPlan inline — each call re-walked its full
  // prereq/group chain with a fresh cache, on EVERY render (drag hover, select,
  // sidebar resize), which visibly janked large sprints.
  const planById = useMemo(
    () => computeAllWorkingPlans(tasks, tasksById, memberById),
    [tasks, tasksById, memberById]
  )

  // ── Member-lane drag-to-reorder (per project) ───────────────────────────
  // Mirrors the row drag in TaskRows: state lives here, scoped to this view.
  // Only the filled lanes (groups) are draggable. See member-lane-order.md.
  const [dragMemberId, setDragMemberId] = useState<string | null>(null)
  const laneHover = useDragHover()

  const { groups, emptyMembers, unassigned } = useMemo(() => {
    // Lanes follow the manual per-project order (drag-to-reorder); both the
    // filled lanes and the empty-members section derive from this sorted list.
    const ms = (members ?? []).slice().sort(compareMembersByOrder)
    const byMember = new Map<string, Task[]>()
    for (const m of ms) byMember.set(m.id, [])
    const orphan: Task[] = []
    for (const t of tasks) {
      const owner = ms.some((m) => m.id === t.assigneeId) ? t.assigneeId : null
      if (owner) byMember.get(owner)!.push(t)
      else orphan.push(t)
    }
    // Sort each member's tasks by the user-selected field. Neutral (field null)
    // falls back to the manual order — same as `seq asc`. Start/End sort by the
    // displayed computed/rollup date via per-lane dateKeys (see buildDateSortKeys).
    const sortLane = (arr: Task[]) => {
      const dateKeys =
        sort.field === 'startDate' || sort.field === 'dueDate'
          ? buildDateSortKeys(arr, planById)
          : undefined
      arr.sort((a, b) =>
        compareTasks(a, b, sort.field ?? 'seq', sort.field ? sort.dir : 'asc', dateKeys)
      )
    }
    for (const arr of byMember.values()) sortLane(arr)
    sortLane(orphan)
    const filled = ms.filter((m) => (byMember.get(m.id) ?? []).length > 0)
    const empty = ms.filter((m) => (byMember.get(m.id) ?? []).length === 0)
    return {
      groups: filled.map((m) => ({ member: m, tasks: byMember.get(m.id)! })),
      emptyMembers: empty,
      unassigned: orphan,
    }
  }, [members, tasks, sort, planById])

  // Flat top-to-bottom order exactly as rendered (lanes in order, group children
  // nested, Unassigned last). The selection bar's "Chain prereqs" links tasks in
  // this order — NOT the raw `tasks` DB array, which is unsorted. See design-docs/dependencies.md.
  const orderedTasks = useMemo(
    () => flattenDisplayOrder([...groups.map((g) => g.tasks), unassigned]),
    [groups, unassigned]
  )

  if (!members) return <p className="text-ink-muted py-12 text-center">Loading…</p>

  const isEmpty = tasks.length === 0 && members.length === 0

  // The ordered draggable lanes (filled member cards). Empty members and the
  // Unassigned card are not draggable.
  const laneMembers = groups.map((g) => g.member)
  const laneOrder = (m: Member) => m.order ?? 0

  const endLaneDrag = () => {
    setDragMemberId(null)
    laneHover.cancel()
  }
  const hoverLane = (targetEl: Element | null | undefined, clientY: number) => {
    const targetId = targetEl instanceof HTMLElement ? targetEl.dataset.laneId : undefined
    if (!dragMemberId || !targetId || targetId === dragMemberId) {
      laneHover.clear()
      return
    }
    // Suppress the insertion line on an own-gap no-op (same guard as dropOnLane).
    const r = (targetEl as HTMLElement).getBoundingClientRect()
    const pos: 'before' | 'after' = clientY - r.top > r.height / 2 ? 'after' : 'before'
    const slot = computeDropSlot(laneMembers, (m) => m.id, dragMemberId, targetId, pos)
    if (!slot || slot.ownGap) {
      laneHover.clear()
      return
    }
    laneHover.hover(targetId, targetEl as HTMLElement, clientY)
  }
  const dropOnLane = (targetEl: Element | null | undefined, clientY: number) => {
    const id = dragMemberId
    const targetId = targetEl instanceof HTMLElement ? targetEl.dataset.laneId : undefined
    if (!id || !targetId) return
    const arr = laneMembers
    const dragged = arr.find((m) => m.id === id)
    if (!dragged) return
    const r = (targetEl as HTMLElement).getBoundingClientRect()
    const pos: 'before' | 'after' =
      clientY - r.top > r.height / 2 ? 'after' : 'before'
    const slot = computeDropSlot(arr, (m) => m.id, id, targetId, pos)
    if (!slot || slot.ownGap) return
    const { order, collides } = resolveDropOrder(slot, laneOrder)
    // Renormalize the lane list when float precision is exhausted (same guard
    // as the row drag), otherwise two lanes would collide on an equal order.
    if (collides) {
      const orderedIds = arr.filter((m) => m.id !== id).map((m) => m.id)
      orderedIds.splice(slot.insertAt, 0, id)
      void renormalizeMemberOrder(orderedIds)
    } else if (order !== dragged.order) {
      void setMemberOrder(id, order)
    }
  }
  const laneDragFor = (m: Member): RowDrag => ({
    id: m.id,
    enabled: laneMembers.length > 1,
    dragging: dragMemberId === m.id,
    over: laneHover.over?.id === m.id ? laneHover.over.pos : null,
    onStart: () => setDragMemberId(m.id),
    onMove: (x, y) =>
      hoverLane(document.elementFromPoint(x, y)?.closest('[data-lane-id]'), y),
    onDrop: (x, y) =>
      dropOnLane(document.elementFromPoint(x, y)?.closest('[data-lane-id]'), y),
    onEnd: endLaneDrag,
  })

  return (
    <SprintRangeContext.Provider value={{ start: sprintStartDate, end: sprintEndDate }}>
    <div className="space-y-4">
      {isEmpty && <EmptyState onAddMember={() => setShowAddMember(true)} />}

      {/* One column header for the whole list — pinned to the top of the scroll
          area (sticks because nothing between here and the scroller is an overflow
          box; the per-card overflow-x-auto that trapped the old per-group headers
          is now BELOW this element). Member layout (no Assignee column); the
          Unassigned card keeps its own header since it adds that column. Matches
          the member cards' overflow-x-auto/min-w so columns line up on wide screens.
          See design-docs/list-view.md v4. */}
      {groups.length > 0 && (
        <div className="sticky top-0 z-20 -mx-6 px-6 bg-canvas">
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <TaskColumnHeader sort={sort} setSort={setSort} showAssignee={false} />
            </div>
          </div>
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
          planById={planById}
          collapsed={collapsed.has(member.id)}
          onToggleCollapse={() => toggleCollapse(member.id)}
          sort={sort}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          drag={laneDragFor(member)}
        />
      ))}

      {unassigned.length > 0 && (
        <UnassignedCard
          tasks={unassigned}
          members={members}
          allTasks={tasks}
          tasksById={tasksById}
          planById={planById}
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
        allTasks={orderedTasks}
        onClear={clearSelection}
      />
    </div>
    </SprintRangeContext.Provider>
  )
}

/**
 * Floating action bar shown while ≥1 task is selected (group-via-selection flow).
 * "Group" creates a new group parent from the selection (same member, ≥2, none a
 * group head); "Ungroup" ungroups any selected children; "Chain prereqs" links the
 * selection top-to-bottom (each depends on the one above, keeping existing prereqs,
 * ≥2 needed); "Clear prereqs" wipes dependsOn on the selection; "Delete" deletes the
 * selection (confirm first; deleting a group head ungroups its children, doesn't
 * cascade). This bar is the only place to delete a task — there is no per-row kebab.
 * See design-docs/task-groups.md and design-docs/dependencies.md.
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
  const confirm = useConfirm()
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

  // Chain follows the displayed top-to-bottom order: `allTasks` arrives already
  // flattened in render order (flattenDisplayOrder), so filtering it keeps that
  // order — not Set insertion or raw DB order. ≥2 needed to form a chain.
  const selectedInOrder = allTasks.filter((t) => selectedIds.has(t.id))
  const canChain = selectedInOrder.length >= 2
  const canClearPrereq = selected.some((t) => t.dependsOn.length > 0)

  const doGroup = async () => {
    if (!canGroup) return
    await createGroupFromSelection(selected.map((t) => t.id))
    onClear()
  }
  // Chain prereqs: for each adjacent pair (A above B), make B depend on A,
  // keeping B's existing prereqs. Run top-to-bottom so each link sees the
  // prior task's recomputed dates before the next is computed.
  const doChain = async () => {
    if (!canChain) return
    for (let i = 1; i < selectedInOrder.length; i++) {
      const prev = selectedInOrder[i - 1]
      const cur = selectedInOrder[i]
      const next = [...new Set([...cur.dependsOn, prev.id])]
      await setDependencies(cur.id, next)
    }
    onClear()
  }
  const doClearPrereq = async () => {
    if (!canClearPrereq) return
    for (const t of selected) {
      if (t.dependsOn.length > 0) await setDependencies(t.id, [])
    }
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
    const ok = await confirm({
      title: `Delete ${n} task${n === 1 ? '' : 's'}?`,
      message: hasGroup
        ? 'Group children will be ungrouped, not deleted.'
        : undefined,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    // Sequential: deleting a parent promotes its children to top-level, so a
    // concurrent run could race a selected child's own delete.
    for (const t of selected) await deleteTask(t.id)
    onClear()
  }

  return (
    <div
      className={`fixed left-1/2 bottom-6 z-40 -translate-x-1/2 flex items-center gap-3 rounded-[14px] bg-ink dark:bg-[#2c2c2e] dark:ring-1 dark:ring-white/10 text-white pl-4 pr-2 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.22),0_0_0_0.5px_rgba(0,0,0,0.06)] transition-[opacity,transform] duration-200 ${
        n > 0
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-3 pointer-events-none'
      }`}
      role="toolbar"
      aria-label="Selected tasks"
    >
      <span className="text-[13.5px]">
        <b className="font-semibold tabular-nums">{n}</b> selected
      </span>
      {anyChild && (
        <button
          onClick={doUngroup}
          className="inline-flex items-center gap-1.5 text-[13px] text-white/80 hover:text-white px-2.5 py-1.5 rounded-[9px] hover:bg-white/10 transition"
        >
          <Ungroup size={14} /> Ungroup
        </button>
      )}
      <button
        onClick={doChain}
        disabled={!canChain}
        title={canChain ? undefined : 'Select ≥2 tasks to chain'}
        className="inline-flex items-center gap-1.5 text-[13px] text-white/80 hover:text-white px-2.5 py-1.5 rounded-[9px] hover:bg-white/10 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <Link2 size={14} /> Chain prereqs
      </button>
      <button
        onClick={doClearPrereq}
        disabled={!canClearPrereq}
        title={canClearPrereq ? undefined : 'No prereqs to clear'}
        className="inline-flex items-center gap-1.5 text-[13px] text-white/80 hover:text-white px-2.5 py-1.5 rounded-[9px] hover:bg-white/10 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <Link2Off size={14} /> Clear prereqs
      </button>
      <button
        onClick={doGroup}
        disabled={!canGroup}
        title={
          canGroup
            ? undefined
            : 'Select ≥2 tasks with the same assignee (not a group) to group'
        }
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-[9px] px-3 py-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed bg-white text-[#1d1d1f] hover:bg-white/90"
      >
        <FolderPlus size={14} /> Group
      </button>
      <button
        onClick={doDelete}
        className="inline-flex items-center gap-1.5 text-[13px] text-red-300 hover:text-white hover:bg-red-500/80 px-2.5 py-1.5 rounded-[9px] transition"
      >
        <Trash2 size={14} /> Delete
      </button>
      <span className="w-px self-stretch bg-white/15" aria-hidden />
      <button
        onClick={onClear}
        className="text-[13px] text-white/70 hover:text-white px-2 py-1.5"
      >
        Cancel
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

// Lane grip: same affordance as the row grip but revealed on card hover and
// centred in the (relative) GroupHeader. See design-docs/member-lane-order.md.
const LANE_GRIP_CLASS =
  'absolute left-0.5 top-1/2 -translate-y-1/2 z-20 grid place-items-center w-4 h-6 text-ink-faint/70 hover:text-ink-muted opacity-0 group-hover/card:opacity-100 transition-opacity cursor-grab active:cursor-grabbing touch-none'

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
  planById,
  collapsed,
  onToggleCollapse,
  sort,
  selectedIds,
  onToggleSelect,
  drag,
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
  planById: Map<string, WorkingPlan>
  collapsed: boolean
  onToggleCollapse: () => void
  // sort drives `canReorder` (drag is only allowed in the manual/seq-asc order).
  // setSort is no longer needed here — the column header is a single sticky bar
  // hoisted above the list (see SprintView top), not per member card.
  sort: Sort
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  /** Lane drag-to-reorder wiring (absent → card is not draggable). */
  drag?: RowDrag
}) {
  // Leaf-based counting: a parent (a task with children in this list) is a
  // container, excluded from done/total/overdue so its work isn't double-counted
  // with its children. See design-docs/task-groups.md.
  const parentIds = useMemo(() => {
    const s = new Set<string>()
    for (const t of tasks) if (t.parentId) s.add(t.parentId)
    return s
  }, [tasks])
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  // All header stats derive from the same inputs — memoize them as one block so
  // they don't recompute (incl. the O(n²) conflict scan + a computeWorkingPlan
  // per task) on every unrelated re-render of this card (e.g. a selection toggle
  // elsewhere). Recomputes only when this member's tasks/members actually change.
  const { total, done, pct, overdue, nextDue, conflictTips } = useMemo(() => {
    const leafTasks = tasks.filter((t) => !parentIds.has(t.id))
    const total = leafTasks.length
    const done = leafTasks.filter((t) => t.status === 'done').length
    const pct = total ? Math.round((done / total) * 100) : 0
    // Use each task's COMPUTED end (same plan the End column shows) so the header
    // never disagrees with the rows. overdue = past-due unfinished; nextDue =
    // earliest unfinished end that is today-or-later (the next upcoming deadline).
    let overdue = 0
    let nextDue: string | null = null
    for (const t of leafTasks) {
      if (t.status === 'done') continue
      const plan = planById.get(t.id) ?? computeWorkingPlan(t, tasksById, memberById)
      // Milestones (effort 0) have no due span — their deadline is the milestone
      // date (start), so they count toward overdue / next-due like any task.
      const due = t.estimate === 0 ? plan.startDate : plan.dueDate
      if (!due) continue
      if (isOverdue(due, false)) overdue++
      else if (!nextDue || due < nextDue) nextDue = due
    }
    // Double-booking warnings among this member's leaf tasks (see
    // design-docs/conflict-warning.md). Cheap O(n²) over a member's tasks.
    const conflictTips = computeMemberConflicts(leafTasks, tasksById, memberById)
    return { total, done, pct, overdue, nextDue, conflictTips }
  }, [tasks, parentIds, tasksById, memberById, planById])
  const { grip, rowProps, dragging } = useDragHandle(drag, LANE_GRIP_CLASS, 'data-lane-id')
  return (
    <Card className={`relative ${dragging ? 'opacity-40' : ''}`} {...rowProps}>
      {drag?.over === 'before' && (
        <div className="absolute left-3 right-3 top-0 h-0.5 rounded-full bg-accent pointer-events-none z-30" />
      )}
      {drag?.over === 'after' && (
        <div className="absolute left-3 right-3 bottom-0 h-0.5 rounded-full bg-accent pointer-events-none z-30" />
      )}
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
        grip={grip}
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
            {/* Column header hoisted to a single sticky header above the whole
                list (see SprintView top). Member cards no longer carry their own. */}
            <div className="divide-y divide-border">
              <TaskRows
                tasks={tasks}
                members={members}
                allTasks={allTasks}
                tasksById={tasksById}
                planById={planById}
                showAssignee={false}
                conflictTips={conflictTips}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
                canReorder={sort.field == null || (sort.field === 'seq' && sort.dir === 'asc')}
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
  planById,
  sort,
  setSort,
  selectedIds,
  onToggleSelect,
}: {
  tasks: Task[]
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
  planById: Map<string, WorkingPlan>
  sort: Sort
  setSort: React.Dispatch<
    React.SetStateAction<Sort>
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
              planById={planById}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              canReorder={sort.field == null || (sort.field === 'seq' && sort.dir === 'asc')}
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
  expanded,
  onToggle,
}: {
  projectId: string
  members: Member[]
  sprintId: string
  sprintStartDate: string
  sprintEndDate: string
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
    </div>
  )
}

function Card({
  children,
  className = '',
  ...rest
}: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  // `group/card` enables hover-reveal of the grip + delete button in GroupHeader.
  return (
    <div
      className={`group/card bg-surface rounded-[14px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)] ${className}`}
      {...rest}
    >
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
  grip,
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
  /** Optional drag grip (lane reorder), rendered absolutely at the left edge. */
  grip?: React.ReactNode
}) {
  const collapsible = onToggleCollapse !== undefined
  // Rename + delete live on the project settings page, not here — the list-view
  // header is read-mostly (see design-docs/project-member-settings.md).
  return (
    <div
      className={`relative flex items-center gap-2.5 px-[18px] py-[13px] ${
        collapsed ? '' : 'border-b border-border'
      } ${collapsible ? 'cursor-pointer transition hover:bg-surface-hover' : ''}`}
      onClick={collapsible ? onToggleCollapse : undefined}
      role={collapsible ? 'button' : undefined}
      aria-expanded={collapsible ? !collapsed : undefined}
    >
      {grip}
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
            title="Task trùng lịch: chồng thời gian, cùng giờ bắt đầu/kết thúc, hoặc chung prereq"
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
      <Avatar member={member} size={28} ring={false} />
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
    setTitle('') // clear synchronously so a fast double-Enter can't double-submit
    await addSprintTask({
      projectId,
      sprintId,
      title: t,
      assigneeId,
      startDate: sprintStartDate,
    })
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
        onKeyDown={(e) => {
          // isComposing guard: Enter that COMMITS an IME composition (Vietnamese
          // telex/VNI, etc.) must not also submit the row mid-word.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) add()
        }}
        // Commit on blur too (click away / Tab): a typed-but-unsubmitted row
        // shouldn't be lost. `add()` no-ops on empty and clears synchronously,
        // so an Enter-then-blur can't double-submit.
        onBlur={() => void add()}
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
 * are the silent default (no tag), keeping the title row calm. Colors come
 * from the shared PRIORITY_TAG map (also used by the rollover preview).
 */
function PriorityChip({ priority }: { priority: string }) {
  const meta = PRIORITY_TAG[priority]
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

/**
 * Milestone tag — an Effort-0 task is a zero-duration checkpoint, not a chunk of
 * work. Rendered as a soft accent pill (with a ◆ diamond) after the title via
 * TitleTextarea's `trailing` slot. See design-docs/milestones.md.
 */
function MilestoneTag() {
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-accent-soft text-accent select-none"
      title="Milestone — a zero-effort checkpoint (no duration)"
    >
      <span className="w-[7px] h-[7px] rotate-45 rounded-[1.5px] bg-accent" aria-hidden />
      Milestone
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
  trailing,
}: {
  value: string
  onChange: (v: string) => void
  done: boolean
  welcomeHint: boolean
  priority: string
  indent?: boolean
  bold?: boolean
  /** Optional element rendered snug after the title text (e.g. change-log 🕒). */
  trailing?: React.ReactNode
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Local draft so the textarea is NOT a controlled mirror of the IndexedDB
  // round-trip. A fully-controlled `value={task.title}` whose onChange writes
  // async to Dexie races: keystrokes typed before the live-query echoes back get
  // clobbered and the caret jumps. We render `draft` (instant) and commit the
  // DB write debounced — mirrors the EffortCell/PrereqInput draft pattern.
  const [draft, setDraft] = useState(value)
  const focusedRef = useRef(false)
  const committedRef = useRef(value)
  const latestRef = useRef(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const commit = (v: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (v !== committedRef.current) {
      committedRef.current = v
      onChange(v)
    }
  }
  // Sync external edits into the draft — but never while focused, or we'd
  // overwrite what the user is mid-typing.
  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(value)
      committedRef.current = value
      latestRef.current = value
    }
  }, [value])
  // Flush any pending debounced commit if we unmount mid-edit (fast navigate)
  // so the last keystrokes are never dropped.
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        if (latestRef.current !== committedRef.current) onChange(latestRef.current)
      }
    },
    // onChange identity changes per render (inline arrow); intentionally bind
    // the cleanup once and read the freshest value via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  // Resize on mount + every draft change. useLayoutEffect runs sync before paint
  // so users never see the "1-line then snap to N lines" flicker.
  useLayoutEffect(resize, [draft])
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
      {/* flex-1 fills the whole Task column so the title (and its click-to-edit
          hit area) stretches like the Add-task row, instead of hugging its text.
          min-w-0 lets it shrink so a `trailing` icon never overflows; trailing
          right-aligns at the column edge. Height auto-grows via resize() above. */}
      <textarea
        ref={ref}
        value={draft}
        onFocus={() => {
          focusedRef.current = true
        }}
        onChange={(e) => {
          const v = e.target.value
          setDraft(v)
          latestRef.current = v
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => commit(v), 350)
        }}
        onBlur={() => {
          focusedRef.current = false
          commit(latestRef.current) // flush immediately on blur
        }}
        rows={1}
        onKeyDown={(e) => {
          // Don't blur on the Enter that commits an IME composition (Vietnamese).
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            ;(e.target as HTMLTextAreaElement).blur()
          }
        }}
        className={`flex-1 min-w-0 editable bg-transparent resize-none overflow-hidden leading-snug whitespace-pre-wrap break-words ${
          done ? 'line-through text-ink-faint' : ''
        } ${welcomeHint ? 'welcome-hint' : ''} ${bold ? 'font-semibold' : ''}`}
      />
      {trailing && <span className="shrink-0 self-center">{trailing}</span>}
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
  planById,
  collapsed,
  onToggle,
  drag,
}: {
  task: Task
  childrenTasks: Task[]
  members: Member[]
  tasksById: Map<string, Task>
  planById: Map<string, WorkingPlan>
  collapsed: boolean
  onToggle: () => void
  drag?: RowDrag
}) {
  const { grip, indicator, rowProps, dragging } = useDragHandle(drag)
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
  // Date and time kept separate so the time tail can hide until row hover, exactly
  // like a leaf DatePickCell (see design-docs/list-view.md v4).
  let startDatePart: string | null = null
  let startTimePart: string | null = null
  let endDatePart: string | null = null
  let endTimePart: string | null = null
  let minKey: string | null = null
  let maxKey: string | null = null
  for (const c of childrenTasks) {
    const plan = planById.get(c.id) ?? computeWorkingPlan(c, tasksById, memberById)
    if (plan.startDate) {
      const k = `${plan.startDate}T${plan.startTime ?? ''}`
      if (!minKey || k < minKey) {
        minKey = k
        startDatePart = formatRelativeDate(plan.startDate)
        startTimePart = plan.startTime ?? null
      }
    }
    if (plan.dueDate) {
      const k = `${plan.dueDate}T${plan.endTime ?? ''}`
      if (!maxKey || k > maxKey) {
        maxKey = k
        endDatePart = formatRelativeDate(plan.dueDate)
        endTimePart = plan.endTime ?? null
      }
    }
  }
  return (
    <div
      {...rowProps}
      data-task-id={task.id}
      className={`task-row group/row relative flex items-center gap-3 px-4 py-1.5 text-sm hover:bg-surface-hover transition bg-accent/[0.025] ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      {grip}
      {indicator}
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
          onChange={(v) => updateTask(task.id, { title: v })}
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
          {hasEffort ? effortSum : <span className="text-ink-faint opacity-40">—</span>}
        </span>
      </div>
      <div className={COL.start}>
        <span className="inline-flex items-center justify-end w-full h-7 px-2 text-sm text-ink-muted whitespace-nowrap">
          {startDatePart ? (
            <>
              {startDatePart}
              {startTimePart && <span className="hidden group-hover/row:inline">, {startTimePart}</span>}
            </>
          ) : (
            <span className="text-ink-faint opacity-40">—</span>
          )}
        </span>
      </div>
      <div className={COL.due}>
        <span className="inline-flex items-center justify-end w-full h-7 px-2 text-sm text-ink-muted whitespace-nowrap">
          {endDatePart ? (
            <>
              {endDatePart}
              {endTimePart && <span className="hidden group-hover/row:inline">, {endTimePart}</span>}
            </>
          ) : (
            <span className="text-ink-faint opacity-40">—</span>
          )}
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
  planById,
  showAssignee = true,
  conflictTips,
  selectedIds,
  onToggleSelect,
  canReorder = false,
}: {
  tasks: Task[]
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
  planById: Map<string, WorkingPlan>
  showAssignee?: boolean
  /** taskId → conflict tooltip (member double-booking); absent map = no warnings. */
  conflictTips?: Map<string, string>
  /** Multi-select state for the group-via-selection flow. */
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  /** Drag-to-reorder is only offered in the default (seq) order. */
  canReorder?: boolean
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

  // Collapse state per parent: localStorage is the source of truth, in-session
  // toggles overlay it. DERIVED (not seeded once into state) so a sprint
  // switch — which swaps the parent set without remounting this component —
  // picks up each parent's persisted flag instead of ignoring it. Reading
  // localStorage per parent per render is a handful of cheap sync gets.
  const [collapseOverrides, setCollapseOverrides] = useState<
    Map<string, boolean>
  >(() => new Map())
  const collapsed = useMemo(() => {
    const s = new Set<string>()
    for (const pid of childrenByParent.keys()) {
      const c =
        collapseOverrides.get(pid) ??
        localStorage.getItem(GROUP_COLLAPSE_KEY(pid)) === '1'
      if (c) s.add(pid)
    }
    return s
  }, [childrenByParent, collapseOverrides])
  const toggle = (id: string) => {
    const next = !collapsed.has(id)
    if (next) localStorage.setItem(GROUP_COLLAPSE_KEY(id), '1')
    else localStorage.removeItem(GROUP_COLLAPSE_KEY(id))
    setCollapseOverrides((prev) => new Map(prev).set(id, next))
  }

  // ── Drag-to-reorder (default order only) ────────────────────────────────
  // State lives here so a drag is naturally scoped to this one card: another
  // card's TaskRows has its own (null) dragId, so dropping there is a no-op.
  const [dragId, setDragId] = useState<string | null>(null)
  // Lane = which sibling list the dragged row reorders within: '__top__' for
  // top-level rows (incl. group heads), or a parentId for a child. Drops only
  // land on rows in the same lane (no drag-reparenting).
  const dragLaneRef = useRef<string>('__top__')
  // Slot math (own-gap no-op, float collision) lives in the shared, unit-
  // tested reorder.ts; this owner keeps only lane rules + persistence.
  const { over, hover, clear, cancel } = useDragHover()

  const laneOf = (t: Task) =>
    t.parentId && childrenByParent.has(t.parentId) ? t.parentId : '__top__'
  const laneArray = (lane: string) =>
    lane === '__top__' ? topLevel : childrenByParent.get(lane) ?? []
  const effOrder = (t: Task) => t.listOrder ?? t.sequence

  const endDrag = () => {
    setDragId(null)
    cancel()
  }
  const beginDrag = (t: Task) => {
    dragLaneRef.current = laneOf(t)
    setDragId(t.id)
  }
  // Hit-testing is owner-side: the grip captures the pointer and reports
  // coordinates; we map them to the row under the cursor via `data-task-id`.
  // Only a same-lane row that isn't the dragged row shows a slot.
  const hoverRow = (targetEl: Element | null | undefined, clientY: number) => {
    if (!dragId) return
    const targetId = targetEl instanceof HTMLElement ? targetEl.dataset.taskId : undefined
    const target = targetId ? tasksById.get(targetId) : undefined
    if (!targetId || !target || targetId === dragId || laneOf(target) !== dragLaneRef.current) {
      clear()
      return
    }
    // Only light the insertion line where a drop would actually move the row —
    // run the SAME slot math the drop does and suppress the line on an own-gap
    // no-op (dragging a half-step onto an adjacent neighbour). See list-view.md.
    const r = (targetEl as HTMLElement).getBoundingClientRect()
    const pos: 'before' | 'after' = clientY - r.top > r.height / 2 ? 'after' : 'before'
    const slot = computeDropSlot(laneArray(dragLaneRef.current), (x) => x.id, dragId, targetId, pos)
    if (!slot || slot.ownGap) {
      clear()
      return
    }
    hover(targetId, targetEl as HTMLElement, clientY)
  }
  const dropOnRow = (targetEl: Element | null | undefined, clientY: number) => {
    const id = dragId
    const lane = dragLaneRef.current
    const dragged = id ? tasksById.get(id) : null
    const targetId = targetEl instanceof HTMLElement ? targetEl.dataset.taskId : undefined
    const target = targetId ? tasksById.get(targetId) : null
    if (!id || !dragged || !target || !targetId || laneOf(target) !== lane) return
    const r = (targetEl as HTMLElement).getBoundingClientRect()
    const pos: 'before' | 'after' = clientY - r.top > r.height / 2 ? 'after' : 'before'
    const arr = laneArray(lane)
    const slot = computeDropSlot(arr, (x) => x.id, id, targetId, pos)
    if (!slot || slot.ownGap) return
    const { order, collides } = resolveDropOrder(slot, effOrder)
    if (collides) {
      // Float precision exhausted — a one-row write would make two rows share
      // an order; renormalize the whole lane to clean integers instead.
      const orderedIds = arr.filter((x) => x.id !== id).map((x) => x.id)
      orderedIds.splice(slot.insertAt, 0, id)
      void renormalizeListOrder(orderedIds)
    } else if (order !== dragged.listOrder) {
      void setListOrder(id, order)
    }
  }
  const dragFor = (t: Task): RowDrag | undefined =>
    canReorder
      ? {
          id: t.id,
          enabled: true,
          dragging: dragId === t.id,
          over: over?.id === t.id ? over.pos : null,
          onStart: () => beginDrag(t),
          onMove: (x, y) =>
            hoverRow(document.elementFromPoint(x, y)?.closest('[data-task-id]'), y),
          onDrop: (x, y) =>
            dropOnRow(document.elementFromPoint(x, y)?.closest('[data-task-id]'), y),
          onEnd: endDrag,
        }
      : undefined

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
                planById={planById}
                collapsed={isCollapsed}
                onToggle={() => toggle(t.id)}
                drag={dragFor(t)}
              />
              {!isCollapsed &&
                kids.map((c) => (
                  <TaskRow
                    key={c.id}
                    task={c}
                    members={members}
                    allTasks={allTasks}
                    tasksById={tasksById}
                    planById={planById}
                    showAssignee={showAssignee}
                    isChild
                    warn={conflictTips?.get(c.id)}
                    selected={selectedIds?.has(c.id)}
                    onToggleSelect={
                      onToggleSelect ? () => onToggleSelect(c.id) : undefined
                    }
                    drag={dragFor(c)}
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
            planById={planById}
            showAssignee={showAssignee}
            warn={conflictTips?.get(t.id)}
            selected={selectedIds?.has(t.id)}
            onToggleSelect={
              onToggleSelect ? () => onToggleSelect(t.id) : undefined
            }
            drag={dragFor(t)}
          />
        )
      })}
    </>
  )
}

type TaskRowProps = {
  task: Task
  members: Member[]
  allTasks: Task[]
  tasksById: Map<string, Task>
  planById: Map<string, WorkingPlan>
  showAssignee?: boolean
  isChild?: boolean
  /** Conflict tooltip — renders an amber warning triangle in the lead gutter. */
  warn?: string
  selected?: boolean
  onToggleSelect?: () => void
  drag?: RowDrag
}

/**
 * Row equality for React.memo. Data props compare by identity (they're
 * memoized upstream and only change when data changes). The two per-render
 * closures are compared by VALUE instead:
 * - `drag`: a fresh object every render — compare enabled/dragging/over (what
 *   the row displays). Its callbacks only ever fire from the row whose grip
 *   holds the pointer capture, and that row re-renders (dragging flips) and
 *   gets fresh closures before any of them run.
 * - `onToggleSelect`: fresh closure over (stable) functional setState — safe
 *   to keep the old one.
 */
function taskRowPropsEqual(prev: TaskRowProps, next: TaskRowProps): boolean {
  return (
    prev.task === next.task &&
    prev.members === next.members &&
    prev.allTasks === next.allTasks &&
    prev.tasksById === next.tasksById &&
    prev.planById === next.planById &&
    prev.showAssignee === next.showAssignee &&
    prev.isChild === next.isChild &&
    prev.warn === next.warn &&
    prev.selected === next.selected &&
    (prev.onToggleSelect === undefined) === (next.onToggleSelect === undefined) &&
    prev.drag?.enabled === next.drag?.enabled &&
    prev.drag?.dragging === next.drag?.dragging &&
    prev.drag?.over === next.drag?.over
  )
}

const TaskRow = memo(function TaskRow({
  task,
  members,
  allTasks,
  tasksById,
  planById,
  showAssignee = true,
  isChild = false,
  warn,
  selected = false,
  onToggleSelect,
  drag,
}: TaskRowProps) {
  const { grip, indicator, rowProps, dragging } = useDragHandle(drag)
  // Canonical user-edit funnel → records a change-log entry per changed field
  // (design-docs/task-change-log.md). Covers title/status/assignee/effort/dates.
  const update = (patch: Partial<Task>) => updateTask(task.id, patch)
  const assignee = members.find((m) => m.id === task.assigneeId) ?? null
  const blocked = isTaskBlocked(task, tasksById)
  const isWelcome = task.title.startsWith(WELCOME_PREFIX)
  // Date + time from one live plan so they always agree and reflect current
  // data — never a stale stored dueDate paired with a freshly-computed time.
  // The plan comes from the view-wide planById pass (one compute per data
  // change), not a per-row computeWorkingPlan (one per render).
  const {
    startDate: liveStart,
    dueDate: liveDue,
    startTime,
    endTime,
  } = planById.get(task.id) ?? NULL_WORKING_PLAN
  // Effort 0 = milestone (a checkpoint, not a span). Distinct from estimate null
  // (= not estimated). See design-docs/milestones.md.
  const isMilestone = task.estimate === 0
  // A milestone has no due span, so its overdue check uses the milestone date
  // (its start) — otherwise a past, unfinished milestone never reads as overdue.
  const overdue = isOverdue(isMilestone ? liveStart : liveDue, task.status === 'done')

  return (
    <div
      {...rowProps}
      data-task-id={task.id}
      className={`task-row group/row relative flex items-center gap-3 px-4 py-1.5 text-sm transition ${
        selected ? 'bg-accent-soft' : 'hover:bg-surface-hover'
      } ${dragging ? 'opacity-40' : ''}`}
      title={blocked ? 'Blocked — waiting on a prerequisite task' : undefined}
    >
      {grip}
      {indicator}
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
        trailing={isMilestone ? <MilestoneTag /> : undefined}
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

      {isMilestone ? (
        // A milestone is one point in time: collapse Start+End into a single
        // editable date, spanning both date columns so Status stays aligned.
        // Width = w-28 + gap-3 + w-28 = 112 + 12 + 112. See design-docs/milestones.md.
        <div className="w-[236px] flex justify-center items-center shrink-0">
          <DatePickCell
            value={liveStart}
            time={startTime}
            timeOnHover
            locked={task.dependsOn.length > 0}
            emptyHint={task.dependsOn.length > 0 ? undefined : 'Date'}
            emptyHintHover
            accent
            highlight={overdue ? 'overdue' : null}
            onChange={async (v) => {
              await update({ startDate: v })
              await recomputeDates(task.id)
            }}
            ariaLabel="Milestone date"
            daysOff={assignee?.daysOff}
          />
        </div>
      ) : (
        <>
          <div className={COL.start}>
            <DatePickCell
              value={liveStart}
              time={startTime}
              timeOnHover
              locked={task.dependsOn.length > 0}
              emptyHint={task.dependsOn.length > 0 ? undefined : 'Start'}
              emptyHintHover
              onChange={async (v) => {
                await update({ startDate: v })
                // Manual start change recomputes end when effort drives it.
                await recomputeDates(task.id)
              }}
              ariaLabel="Start date"
              daysOff={assignee?.daysOff}
            />
          </div>

          <div className={COL.due}>
            <DatePickCell
              value={liveDue}
              time={endTime}
              timeOnHover
              locked={
                task.dependsOn.length > 0 ||
                (task.estimate !== null && task.estimate > 0)
              }
              emptyHint={
                task.dependsOn.length > 0 ||
                (task.estimate !== null && task.estimate > 0)
                  ? undefined
                  : 'Due'
              }
              emptyHintHover
              highlight={overdue ? 'overdue' : null}
              onChange={(v) => update({ dueDate: v })}
              ariaLabel="Due date"
              daysOff={assignee?.daysOff}
            />
          </div>
        </>
      )}

      <div className={COL.status}>
        <StatusPicker status={task.status} onChange={(s) => update({ status: s })} />
      </div>

      <div className={COL.prereq}>
        <PrereqInput task={task} allTasks={allTasks} tasksById={tasksById} />
      </div>
    </div>
  )
}, taskRowPropsEqual)

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
  sort: Sort
  setSort: React.Dispatch<
    React.SetStateAction<Sort>
  >
  showAssignee?: boolean
}) {
  // Three-state cycle per column: asc → desc → off. "Off" clears back to the
  // default seq order (DEFAULT_SORT), which also re-enables drag-to-reorder.
  // See design-docs/list-view.md.
  const onSort = (field: SortField) => {
    setSort((prev) => {
      if (prev.field !== field) return { field, dir: 'asc' }
      if (prev.dir === 'asc') return { field, dir: 'desc' }
      return DEFAULT_SORT
    })
  }
  return (
    // Lightened: no grey fill (was bg-canvas-sunk/40), tighter py — the labels read
    // as a quiet caption under the group name, just a hairline separating them from
    // the rows. (Sticky was attempted but the per-card overflow-x-auto + Card
    // overflow-hidden trap the sticky context, so it can't pin to the viewport
    // without a scroll-architecture refactor — deferred. See design-docs/list-view.md v4.)
    <div className="flex items-center gap-3 px-4 py-1 border-b border-border-hair">
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
  sort: Sort
  onSort: (f: SortField) => void
  align?: 'start' | 'center' | 'end'
}) {
  const isActive = sort.field === field
  // Hint the NEXT click in the asc → desc → off cycle. "Off" is the neutral
  // state (no column sorted) — reachable from every column, ID included.
  const nextHint = !isActive
    ? `Sort by ${label}`
    : sort.dir === 'asc'
      ? `Sort by ${label}, descending`
      : 'Clear sort'
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
      aria-label={nextHint}
      title={nextHint}
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
  // Pop the glyph (and draw the check when done) on any status change. The
  // `.status-pop` class is added for one animation cycle then removed so it can
  // re-fire on the next toggle; it also scopes the check-draw (index.css §6.5).
  const [popping, setPopping] = useState(false)
  const prev = useRef(status)
  useEffect(() => {
    if (prev.current !== status) {
      prev.current = status
      setPopping(true)
      const t = setTimeout(() => setPopping(false), 340)
      return () => clearTimeout(t)
    }
  }, [status])
  return (
    <button
      onClick={onCycle}
      className={`w-4 h-4 shrink-0 transition hover:scale-110 flex items-center justify-center ${
        popping ? 'status-pop' : ''
      }`}
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
        className="status-check"
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
        className="text-[11.5px] font-semibold px-0 m-0 border-0 bg-transparent appearance-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-full leading-[1.35] h-auto"
        style={{ color: fg, width: 'auto', minWidth: 'max-content' }}
        aria-label="Status"
      >
        {Object.entries(STATUS_META).map(([k, m]) => (
          <option key={k} value={k}>
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
        <Avatar
          member={assignee}
          size={24}
          ring={false}
          className="cursor-pointer ring-1 ring-transparent hover:ring-accent/40"
          onClick={() => ref.current?.focus()}
        />
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

/**
 * Compact effort input — number of days. Empty = unset (treated as 1 day
 * when prereqs trigger date computation).
 */
export function EffortCell({
  value,
  onChange,
}: {
  value: number | null
  onChange: (v: number | null) => void
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const focusedRef = useRef(false)
  useEffect(() => {
    // Don't clobber in-flight typing when an external write (recompute,
    // import) lands mid-edit — same focused guard as TitleTextarea/PrereqInput.
    if (!focusedRef.current) setDraft(value == null ? '' : String(value))
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
      onFocus={() => {
        focusedRef.current = true
      }}
      onBlur={() => {
        focusedRef.current = false
        commit()
      }}
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
      className="editable w-full text-sm text-center tabular-nums bg-transparent placeholder:text-ink-faint placeholder:opacity-40"
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- draft mirrors external writes only while NOT editing (focused guard)
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
        // Show a `#`-prefixed ref at rest (matches the `#N` language in the cycle
        // notices; disambiguates an ID from a count — see list-view.md v4). While
        // editing, drop the prefix so the raw numbers are what you type/parse.
        value={focused ? draft : draft ? `#${draft}` : ''}
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
        className={`editable w-full text-sm text-right tabular-nums bg-transparent placeholder:text-ink-faint placeholder:opacity-40 ${
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
    await addMember(projectId, n)
    setName('')
    inputRef.current?.focus()
  }

  if (!active) {
    return <AddGroupButton icon={UserPlus} label="Add member" onClick={onActivate} />
  }

  return (
    <div className="flex items-center gap-2 bg-surface border border-border rounded-lg p-2">
      <UserPlus size={14} className="text-ink-faint ml-2" />
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          if (e.key === 'Escape') {
            setName('')
            onDeactivate()
          }
        }}
        placeholder="Member name (press Enter)"
        className="flex-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-[6px] text-sm bg-transparent placeholder:text-ink-faint"
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
