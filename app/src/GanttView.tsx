import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronsUpDown, MoveRight, Search, X } from 'lucide-react'
import {
  db,
  computeWorkingPlan,
  moveTaskToSprint,
  recomputeDates,
  updateTask,
  workingFraction,
  compareMembersByOrder,
  type Task,
  type Member,
  type Sprint,
} from './db'
import { Avatar, MemberDaysOffButton } from './members'
import { STATUS_META, derivedGroupStatus } from './SprintView'
import { sprintWorkdays, formatShortDate } from './lib'
import { DateField } from './DatePicker'

/**
 * Timeline — an Apple-Calendar-style swimlane view of the sprint or a selected
 * date range (design DNA:
 * one calm surface, depth not lines, system status colors). Each member is a
 * swimlane; each scheduled task is a soft-tinted event block placed on the day
 * axis with half-day precision and lane-packed so non-overlapping tasks share a
 * row. Tasks scheduled outside the window, or with no dates, are summarised as
 * a count in the member label (click to expand). In Sprint mode, editable leaf
 * bars support day-level drag/resize. See design-docs/gantt-view.md.
 */

const MGUT = 152 // member label column
const MIN_DAY = 54 // floor for a day column; widens past this to fill the surface
const EVH = 24
const ROWH = 30
const PAD_TOP = 9

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function weekday(date: string): string {
  return WD[new Date(date + 'T00:00:00Z').getUTCDay()]
}
function gapBefore(prev: string, cur: string): boolean {
  return (new Date(cur + 'T00:00:00Z').getTime() - new Date(prev + 'T00:00:00Z').getTime()) / 86_400_000 > 1
}
const softBg = (v: string) => `color-mix(in srgb, ${v} 15%, transparent)`
const softFg = (v: string) => `color-mix(in srgb, ${v} 100%, #000 22%)`
// Faint diagonal hatch — the universal "non-working time" texture for day-offs.
const HATCH_OFF =
  'repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-ink) 13%, transparent) 0 3px, transparent 3px 7px)'
// In-bar "pause": same-status stripes over a dim scrim, clipped inside the task block.
const pauseBg = (v: string) =>
  `repeating-linear-gradient(45deg, color-mix(in srgb, ${v} 55%, transparent) 0 3px, transparent 3px 7px), color-mix(in srgb, var(--color-surface) 55%, transparent)`

type Ev = {
  task: Task
  status: keyof typeof STATUS_META
  left: number
  width: number
  contLeft: boolean
  contRight: boolean
  lane: number
  isParent: boolean
  /** Effort-0 task → a point marker (diamond) on its date, not a span. */
  isMilestone?: boolean
  startDate: string | null
  dueDate: string | null
}

type TimelineEditMode = 'move' | 'resize-start' | 'resize-end'
type TimelinePreview = {
  taskId: string
  left: number
  width: number
}

export function GanttView({
  projectId,
  sprintStartDate,
  sprintEndDate,
  tasks,
  projectTasks = tasks,
  onOpenInList,
}: {
  projectId: string
  sprintStartDate: string
  sprintEndDate: string
  tasks: Task[]
  /** All project tasks, used only by Range mode to show multiple sprint timelines. */
  projectTasks?: Task[]
  /** Jump to the List view (the bar popover's "Open in List"). */
  onOpenInList?: () => void
}) {
  const members = useLiveQuery(
    () => db.members.where('projectId').equals(projectId).toArray(),
    [projectId]
  )
  const sprints = useLiveQuery(
    () => db.sprints.where('projectId').equals(projectId).sortBy('startDate'),
    [projectId]
  )
  // Click a bar → read-only detail popover (Gantt is a scheduler projection).
  const [openBar, setOpenBar] = useState<{
    task: Task
    status: keyof typeof STATUS_META
    rect: DOMRect
  } | null>(null)
  const [preview, setPreview] = useState<TimelinePreview | null>(null)
  const suppressClickRef = useRef<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<'sprint' | 'range'>('sprint')
  const [rangeStart, setRangeStart] = useState(sprintStartDate)
  const [rangeEnd, setRangeEnd] = useState(sprintEndDate)
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  useEffect(() => {
    setRangeStart(sprintStartDate)
    setRangeEnd(sprintEndDate)
  }, [sprintStartDate, sprintEndDate])

  const rangeMode = scope === 'range'
  const windowStartDate = rangeMode ? rangeStart : sprintStartDate
  const windowEndDate = rangeMode ? rangeEnd : sprintEndDate
  const hasValidRange = windowStartDate <= windowEndDate

  const workdays = useMemo(
    () => (hasValidRange ? sprintWorkdays(windowStartDate, windowEndDate) : []),
    [hasValidRange, windowStartDate, windowEndDate]
  )
  const seamSet = useMemo(() => {
    const s = new Set<number>()
    for (let i = 1; i < workdays.length; i++) if (gapBefore(workdays[i - 1], workdays[i])) s.add(i)
    return s
  }, [workdays])

  const sourceTasks = useMemo(
    () => (rangeMode ? projectTasks.filter((t) => !!t.sprintId) : tasks),
    [projectTasks, rangeMode, tasks]
  )
  const tasksById = useMemo(() => new Map(sourceTasks.map((t) => [t.id, t])), [sourceTasks])
  // Parent → children (across all tasks). A parent group has no own dates; its
  // Timeline bar is a summary spanning its children (mirrors the List roll-up).
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of sourceTasks) {
      if (!t.parentId) continue
      const arr = m.get(t.parentId)
      if (arr) arr.push(t)
      else m.set(t.parentId, [t])
    }
    return m
  }, [sourceTasks])
  const memberById = useMemo(
    () => new Map((members ?? []).map((m) => [m.id, m] as [string, Member])),
    [members]
  )
  // Precompute each task's working plan ONCE per data change — NOT per render.
  // The `groups` memo below depends on `dayW`, which changes on every
  // ResizeObserver tick / window resize; without this the entire scheduler
  // re-ran for every task on each resize frame. Mirrors BoardView's planById.
  // Covers every task so a parent's roll-up always sees all its children.
  const planById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof computeWorkingPlan>>()
    for (const t of tasksById.values()) m.set(t.id, computeWorkingPlan(t, tasksById, memberById))
    return m
  }, [tasksById, memberById])

  const N = workdays.length
  const firstDay = workdays[0]
  const lastDay = workdays[N - 1]
  const timelineTasks = useMemo(() => {
    if (!rangeMode) return sourceTasks
    if (!firstDay || !lastDay) return []
    return sourceTasks.filter((task) => {
      const plan = planById.get(task.id)
      if (!plan?.startDate || !plan.dueDate) return false
      return plan.dueDate >= firstDay && plan.startDate <= lastDay
    })
  }, [firstDay, lastDay, planById, rangeMode, sourceTasks])
  const visibleTaskIds = useMemo(
    () => new Set(timelineTasks.map((task) => task.id)),
    [timelineTasks]
  )
  const timelineTasksById = useMemo(
    () => new Map(timelineTasks.map((task) => [task.id, task] as [string, Task])),
    [timelineTasks]
  )
  const selectedTasks = useMemo(
    () =>
      [...selectedIds]
        .map((id) => timelineTasksById.get(id))
        .filter((task): task is Task => !!task),
    [selectedIds, timelineTasksById]
  )

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleTaskIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visibleTaskIds])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [scope, rangeStart, rangeEnd, sprintStartDate, sprintEndDate])

  // Fluid columns: widen each day to fill the surface so a short sprint leaves no
  // dead white space on the right. Clamped to MIN_DAY → a long sprint scrolls instead.
  // Callback ref (not useRef + effect) so the observer attaches when the card actually
  // mounts — the card is absent during the loading branch, so a once-on-mount effect
  // would measure null and never re-run.
  const roRef = useRef<ResizeObserver | null>(null)
  const [availW, setAvailW] = useState(0)
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    if (!node) return
    const ro = new ResizeObserver(([entry]) => setAvailW(entry.contentRect.width))
    ro.observe(node)
    setAvailW(node.clientWidth)
    roRef.current = ro
  }, [])
  const dayW = availW > 0 && N > 0 ? Math.max(MIN_DAY, (availW - MGUT) / N) : MIN_DAY

  const clampIdx = useCallback(
    (idx: number, min = 0, max = N - 1) => Math.max(min, Math.min(max, idx)),
    [N]
  )

  const editableEvent = useCallback((e: Ev) => {
    // Parent rails and milestones are computed projections; dependency-driven
    // tasks would be recomputed back from their prereqs and appear to snap back.
    return (
      !e.isParent &&
      !e.isMilestone &&
      !e.contLeft &&
      !e.contRight &&
      (!e.task.dependsOn || e.task.dependsOn.length === 0) &&
      !!e.startDate &&
      !!e.dueDate
    )
  }, [])

  const toggleSelected = useCallback((taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }, [])

  const moveSelectedToSprint = useCallback(
    async (target: Sprint) => {
      const tasksToMove = selectedTasks.filter((task) => task.sprintId !== target.id)
      for (const task of tasksToMove) {
        await moveTaskToSprint(task.id, target.id)
      }
      setSelectedIds(new Set())
    },
    [selectedTasks]
  )

  const memberWorkdayEstimate = useCallback(
    (member: Member, startIdx: number, endIdx: number): number => {
      const contrib = new Map<string, 0 | 0.5>()
      for (const off of member.daysOff) contrib.set(off.date, off.half ? 0.5 : 0)
      let total = 0
      for (let i = startIdx; i <= endIdx; i++) {
        total += workingFraction(workdays[i], contrib)
      }
      return Math.max(0.5, total)
    },
    [workdays]
  )

  const previewForDelta = useCallback(
    (e: Ev, mode: TimelineEditMode, delta: number): TimelinePreview | null => {
      if (!e.startDate || !e.dueDate) return null
      const startIdx = workdays.indexOf(e.startDate)
      const dueIdx = workdays.indexOf(e.dueDate)
      if (startIdx < 0 || dueIdx < 0) return null

      let nextStart = startIdx
      let nextDue = dueIdx
      if (mode === 'move') {
        const span = dueIdx - startIdx
        nextStart = clampIdx(startIdx + delta, 0, N - 1 - span)
        nextDue = nextStart + span
      } else if (mode === 'resize-start') {
        nextStart = clampIdx(startIdx + delta, 0, dueIdx)
      } else {
        nextDue = clampIdx(dueIdx + delta, startIdx, N - 1)
      }

      const left = nextStart * dayW
      const right = (nextDue + 1) * dayW
      return { taskId: e.task.id, left, width: Math.max(right - left, 30) }
    },
    [N, clampIdx, dayW, workdays]
  )

  const commitTimelineEdit = useCallback(
    async (e: Ev, member: Member, mode: TimelineEditMode, delta: number) => {
      if (!e.startDate || !e.dueDate || delta === 0) return
      const startIdx = workdays.indexOf(e.startDate)
      const dueIdx = workdays.indexOf(e.dueDate)
      if (startIdx < 0 || dueIdx < 0) return

      let nextStart = startIdx
      let nextDue = dueIdx
      const patch: Partial<Task> = {}
      const effortDriven = (e.task.estimate ?? 0) > 0

      if (mode === 'move') {
        const span = dueIdx - startIdx
        nextStart = clampIdx(startIdx + delta, 0, N - 1 - span)
        nextDue = nextStart + span
        if (nextStart === startIdx) return
        patch.startDate = workdays[nextStart]
        if (!effortDriven) patch.dueDate = workdays[nextDue]
      } else if (mode === 'resize-start') {
        nextStart = clampIdx(startIdx + delta, 0, dueIdx)
        if (nextStart === startIdx) return
        patch.startDate = workdays[nextStart]
        if (effortDriven) patch.estimate = memberWorkdayEstimate(member, nextStart, dueIdx)
      } else {
        nextDue = clampIdx(dueIdx + delta, startIdx, N - 1)
        if (nextDue === dueIdx) return
        if (effortDriven) patch.estimate = memberWorkdayEstimate(member, startIdx, nextDue)
        else patch.dueDate = workdays[nextDue]
      }

      await updateTask(e.task.id, patch)
      await recomputeDates(e.task.id)
    },
    [N, clampIdx, memberWorkdayEstimate, workdays]
  )

  const beginTimelineEdit = useCallback(
    (
      ev: ReactPointerEvent<HTMLElement>,
      e: Ev,
      member: Member,
      mode: TimelineEditMode
    ) => {
      if (!editableEvent(e)) return
      ev.stopPropagation()
      setOpenBar(null)
      const originX = ev.clientX
      const base = previewForDelta(e, mode, 0)
      if (base) setPreview(base)
      document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize'
      document.body.style.userSelect = 'none'

      const deltaFrom = (clientX: number) => Math.round((clientX - originX) / dayW)
      const onMove = (moveEv: PointerEvent) => {
        const next = previewForDelta(e, mode, deltaFrom(moveEv.clientX))
        if (next) setPreview(next)
      }
      const onUp = (upEv: PointerEvent) => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        const delta = deltaFrom(upEv.clientX)
        setPreview(null)
        if (Math.abs(upEv.clientX - originX) > 3) {
          suppressClickRef.current = e.task.id
          window.setTimeout(() => {
            if (suppressClickRef.current === e.task.id) suppressClickRef.current = null
          }, 0)
        }
        if (delta !== 0) {
          void commitTimelineEdit(e, member, mode, delta).catch((err) => {
            console.error('Failed to edit timeline task', err)
          })
        }
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [commitTimelineEdit, dayW, editableEvent, previewForDelta]
  )

  const groups = useMemo(() => {
    // Swimlanes follow the manual per-project member order, same as the List
    // view's lanes (drag-to-reorder). See design-docs/member-lane-order.md.
    const ms = (members ?? []).slice().sort(compareMembersByOrder)
    const byMember = new Map<string, Task[]>()
    for (const m of ms) byMember.set(m.id, [])
    for (const t of timelineTasks) {
      if (t.assigneeId && byMember.has(t.assigneeId)) byMember.get(t.assigneeId)!.push(t)
    }
    // NOTE (intentional): the Timeline is an assignee-swimlane view, so tasks
    // with no assignee — including container PARENTS, which are usually
    // unassigned — do not appear here, even though List and Board show them.
    // This is by design: a parent's schedule is fully represented by its
    // children's bars (which DO show, in their own assignees' lanes). An
    // unassigned LEAF task is likewise omitted (it has no lane to live in).
    // Reviewed & accepted 2026-06-08; not a bug.
    return ms
      .filter((m) => (byMember.get(m.id) ?? []).length > 0)
      .map((m) => {
        const evs: Ev[] = []
        const offWindow: {
          task: Task
          date: string
          status: keyof typeof STATUS_META
          dir: 'earlier' | 'later'
        }[] = []
        const noDates: Task[] = []
        for (const task of byMember.get(m.id)!.sort((a, b) => a.sequence - b.sequence)) {
          const kids = childrenByParent.get(task.id)
          const isParent = !!kids && kids.length > 0
          let sd: string | null
          let dd: string | null
          let startTime: string
          let endTime: string
          let status: keyof typeof STATUS_META
          if (isParent) {
            // Parent summary: span = earliest child start … latest child end
            // (the same roll-up the List group row shows). Time-aware ordering.
            status = derivedGroupStatus(kids!) as keyof typeof STATUS_META
            sd = null
            dd = null
            startTime = '08:00'
            endTime = '17:00'
            let minKey: string | null = null
            let maxKey: string | null = null
            for (const c of kids!) {
              const p = planById.get(c.id)!
              if (p.startDate) {
                const k = `${p.startDate}T${p.startTime}`
                if (!minKey || k < minKey) {
                  minKey = k
                  sd = p.startDate
                  startTime = p.startTime
                }
              }
              if (p.dueDate) {
                const k = `${p.dueDate}T${p.endTime}`
                if (!maxKey || k > maxKey) {
                  maxKey = k
                  dd = p.dueDate
                  endTime = p.endTime
                }
              }
            }
          } else {
            const plan = planById.get(task.id)!
            sd = plan.startDate
            dd = plan.dueDate
            startTime = plan.startTime
            endTime = plan.endTime
            status = task.status as keyof typeof STATUS_META
          }
          // Milestone (effort 0) = a point in time, not a span. Place a diamond
          // marker on its date instead of dropping it into "no dates". See
          // design-docs/milestones.md.
          if (!isParent && task.estimate === 0 && sd) {
            if (sd > lastDay) {
              offWindow.push({ task, date: sd, status, dir: 'later' })
              continue
            }
            if (sd < firstDay) {
              offWindow.push({ task, date: sd, status, dir: 'earlier' })
              continue
            }
            const mIdx = workdays.indexOf(sd)
            if (mIdx < 0) {
              noDates.push(task) // milestone landed on a non-working day
              continue
            }
            evs.push({
              task,
              status,
              left: mIdx * dayW + (startTime === '13:00' ? dayW / 2 : 0),
              width: 30,
              contLeft: false,
              contRight: false,
              lane: 0,
              isParent: false,
              isMilestone: true,
              startDate: sd,
              dueDate: sd,
            })
            continue
          }
          if (!sd || !dd) {
            noDates.push(task)
            continue
          }
          // wholly after the window → "later" (shows its start); wholly before → "earlier"
          // (shows its end — when it finished)
          if (sd > lastDay) {
            offWindow.push({ task, date: sd, status, dir: 'later' })
            continue
          }
          if (dd < firstDay) {
            offWindow.push({ task, date: dd, status, dir: 'earlier' })
            continue
          }
          // left edge — clamp to the window's left with a caret when it starts earlier
          let left: number
          let contLeft = false
          const sIdx = workdays.indexOf(sd)
          if (sIdx < 0) {
            if (sd < firstDay) {
              left = 0
              contLeft = true
            } else {
              offWindow.push({ task, date: sd, status, dir: 'later' })
              continue
            }
          } else {
            left = sIdx * dayW + (startTime === '13:00' ? dayW / 2 : 0)
          }
          let right: number
          let contRight = false
          if (dd > lastDay) {
            right = N * dayW
            contRight = true
          } else {
            const eIdx = workdays.indexOf(dd)
            right = (eIdx < 0 ? N - 1 : eIdx) * dayW + (endTime === '12:00' ? dayW / 2 : dayW)
          }
          evs.push({
            task,
            status,
            left,
            width: Math.max(right - left, 30),
            contLeft,
            contRight,
            lane: 0,
            isParent,
            startDate: sd,
            dueDate: dd,
          })
        }
        // Greedy lane-packing, parents first so a group's summary rail always sits
        // ABOVE its children (Gantt convention). Parents claim the top lanes; every
        // other block packs into lanes below them.
        const pack = (items: Ev[], base: number): number => {
          items.sort((a, b) => a.left - b.left)
          const laneEnds: number[] = []
          for (const e of items) {
            let placed = false
            for (let i = 0; i < laneEnds.length; i++) {
              if (laneEnds[i] <= e.left) {
                e.lane = base + i
                laneEnds[i] = e.left + e.width
                placed = true
                break
              }
            }
            if (!placed) {
              e.lane = base + laneEnds.length
              laneEnds.push(e.left + e.width)
            }
          }
          return laneEnds.length
        }
        const parentRows = pack(evs.filter((e) => e.isParent), 0)
        const childRows = pack(evs.filter((e) => !e.isParent), parentRows)
        const rows = Math.max(1, parentRows + childRows)
        // member day-off half-columns within the window
        const offByDate = new Map<string, 'full' | 'am' | 'pm'>()
        for (const o of m.daysOff) {
          if (!o.half) offByDate.set(o.date, 'full')
          else {
            const prev = offByDate.get(o.date)
            if (prev === undefined) offByDate.set(o.date, o.half)
            else if (prev !== o.half) offByDate.set(o.date, 'full')
          }
        }
        const offBands: { left: number; width: number }[] = []
        workdays.forEach((date, i) => {
          const off = offByDate.get(date)
          if (off === 'full') offBands.push({ left: i * dayW, width: dayW })
          else if (off === 'am') offBands.push({ left: i * dayW, width: dayW / 2 })
          else if (off === 'pm') offBands.push({ left: i * dayW + dayW / 2, width: dayW / 2 })
        })
        // earlier chips first, then later — each sorted by their shown date
        offWindow.sort((a, b) =>
          a.dir !== b.dir ? (a.dir === 'earlier' ? -1 : 1) : a.date < b.date ? -1 : 1
        )
        const earlierN = offWindow.filter((o) => o.dir === 'earlier').length
        const laterN = offWindow.length - earlierN
        return { member: m, evs, rows, offWindow, earlierN, laterN, noDates, offBands }
      })
  }, [members, timelineTasks, workdays, planById, childrenByParent, N, firstDay, lastDay, dayW])
  const activeSprints = useMemo(
    () => (sprints ?? []).filter((sprint) => sprint.archivedAt == null),
    [sprints]
  )

  if (!members) return <p className="text-ink-muted py-12 text-center">Loading…</p>
  const scopeToolbar = (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-[9px] bg-fill p-0.5" aria-label="Timeline scope">
          <button
            type="button"
            onClick={() => setScope('sprint')}
            aria-pressed={!rangeMode}
            className={`h-8 rounded-[7px] px-3 text-[12.5px] font-semibold transition ${
              !rangeMode
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Sprint
          </button>
          <button
            type="button"
            onClick={() => setScope('range')}
            aria-pressed={rangeMode}
            className={`h-8 rounded-[7px] px-3 text-[12.5px] font-semibold transition ${
              rangeMode
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Range
          </button>
        </div>
        <span className="text-[12px] text-ink-faint tab-data">
          {timelineTasks.length} task{timelineTasks.length === 1 ? '' : 's'}
        </span>
      </div>
      {rangeMode && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[11px] font-semibold text-ink-faint">From</span>
            <DateField
              value={rangeStart}
              onChange={setRangeStart}
              className="h-8 min-w-[104px] rounded-[8px] border border-border bg-surface px-2.5 text-left text-[12.5px] tab-data transition hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-semibold text-ink-faint">To</span>
            <DateField
              value={rangeEnd}
              onChange={setRangeEnd}
              className="h-8 min-w-[104px] rounded-[8px] border border-border bg-surface px-2.5 text-left text-[12.5px] tab-data transition hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setRangeStart(sprintStartDate)
              setRangeEnd(sprintEndDate)
            }}
            className="h-8 rounded-[8px] px-3 text-[12.5px] font-semibold text-accent hover:bg-accent-soft transition"
          >
            This sprint
          </button>
        </div>
      )}
    </div>
  )

  if (N === 0)
    return (
      <div className="pt-4 pb-2 max-w-full">
        {scopeToolbar}
        <div className="py-16 text-center text-sm text-ink-muted">
          {hasValidRange
            ? rangeMode
              ? 'This range has no working days (weekends only).'
              : 'This sprint has no working days (weekends only).'
            : 'Choose a valid range where From is before To.'}
        </div>
      </div>
    )
  if (groups.length === 0)
    return (
      <div className="pt-4 pb-2 max-w-full">
        {scopeToolbar}
        <div className="py-16 text-center text-sm text-ink-muted">
          {rangeMode ? 'No assigned tasks in this range yet.' : 'No assigned tasks in this sprint yet.'}
        </div>
      </div>
    )

  const innerW = MGUT + N * dayW
  const today = todayISO()
  const todayIdx = workdays.indexOf(today)

  return (
    <div className="pt-4 pb-2 max-w-full">
      {scopeToolbar}
      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-[12px] text-ink-muted">
        <LegendDot varName="var(--color-status-done)" label="Done" />
        <LegendDot varName="var(--color-status-progress)" label="In progress" />
        <LegendDot varName="var(--color-status-todo)" label="To do" />
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3.5 h-3.5 rounded-[4px]"
            style={{ background: HATCH_OFF }}
          />
          Day off
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-[11px] h-[11px] rotate-45 rounded-[2px] bg-accent"
            aria-hidden
          />
          Milestone
        </span>
      </div>

      <div
        ref={measureRef}
        className="overflow-x-auto rounded-[14px] bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)]"
      >
        <div className="relative" style={{ width: innerW }}>
          {/* Today — a soft accent column wash (Apple-Calendar style), behind
              events. The sticky header's opaque bg-surface hides the wash over
              the header band, so the header's accent date pill carries "today"
              up top while the wash marks the column down through the lanes. */}
          {todayIdx >= 0 && (
            <div
              className="absolute top-0 bottom-0 bg-accent-tint z-0 pointer-events-none"
              style={{ left: MGUT + todayIdx * dayW, width: dayW }}
              aria-hidden
            />
          )}

          {/* Sticky date header */}
          <div
            className="sticky top-0 z-20 flex bg-surface border-b border-border-hair"
          >
            <div className="sticky left-0 z-10 bg-surface" style={{ width: MGUT }} />
            {workdays.map((date, i) => (
              <div
                key={date}
                className={`flex flex-col items-center justify-center py-2.5 ${
                  seamSet.has(i) ? 'border-l border-border' : ''
                }`}
                style={{ width: dayW }}
                {...(date === today ? { 'aria-current': 'date' as const } : {})}
              >
                <span
                  className={`text-[13.5px] font-semibold tab-data leading-none ${
                    date === today
                      ? 'text-white bg-accent rounded-full inline-flex items-center justify-center h-[21px] px-2'
                      : 'text-ink-muted'
                  }`}
                >
                  {formatShortDate(date)}
                </span>
                <span
                  className={`text-[11px] font-semibold leading-none mt-1 ${
                    date === today ? 'text-accent' : 'text-ink-faint'
                  }`}
                >
                  {weekday(date)}
                </span>
              </div>
            ))}
          </div>

          {/* Swimlanes */}
          {groups.map(({ member, evs, rows, offWindow, earlierN, laterN, noDates, offBands }) => {
            const laneH = rows * ROWH + PAD_TOP * 2
            const hasExtra = offWindow.length > 0 || noDates.length > 0
            const isOpen = expanded.has(member.id)
            const subParts: string[] = []
            if (earlierN) subParts.push(`↙ ${earlierN} earlier`)
            if (laterN) subParts.push(`↗ ${laterN} later`)
            if (noDates.length) subParts.push(`○ ${noDates.length} no dates`)
            return (
              <div key={member.id}>
                <div className="flex border-b border-border-hair/70" style={{ minHeight: laneH }}>
                  {/* sticky label */}
                  <div
                    className="sticky left-0 z-10 bg-surface flex items-start gap-2.5 px-3.5 py-2.5"
                    style={{ width: MGUT }}
                  >
                    <Avatar member={member} />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-ink truncate leading-tight">
                        {member.name}
                      </div>
                      {member.title && (
                        <div className="text-[11px] text-ink-faint truncate leading-tight">
                          {member.title}
                        </div>
                      )}
                      <div className="mt-1">
                        <MemberDaysOffButton
                          member={member}
                          range={{ start: windowStartDate, end: windowEndDate }}
                        />
                      </div>
                      {hasExtra && (
                        <button
                          onClick={() => toggle(member.id)}
                          className="mt-0.5 text-[10.5px] font-medium text-ink-faint hover:text-accent transition tab-data"
                        >
                          {subParts.join(' · ')} {isOpen ? '▾' : '▸'}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* track */}
                  <div className="relative" style={{ width: N * dayW }}>
                    {/* faint day separators */}
                    {workdays.map((date, i) =>
                      i === 0 ? null : (
                        <div
                          key={date}
                          className={`absolute top-0 bottom-0 ${
                            seamSet.has(i) ? 'border-l border-border' : 'border-l border-border-hair/50'
                          }`}
                          style={{ left: i * dayW }}
                          aria-hidden
                        />
                      )
                    )}
                    {/* day-off bands — faint diagonal hatch */}
                    {offBands.map((o, k) => (
                      <div
                        key={k}
                        className="absolute top-0 bottom-0"
                        style={{ left: o.left, width: o.width, background: HATCH_OFF }}
                        title="Day off"
                        aria-hidden
                      />
                    ))}
                    {/* event blocks */}
                    {evs.map((e) => {
                      const v = STATUS_META[e.status].varName
                      const livePreview = preview?.taskId === e.task.id ? preview : null
                      const isSelected = selectedIds.has(e.task.id)
                      const box = {
                        left: (livePreview?.left ?? e.left) + 2,
                        width: (livePreview?.width ?? e.width) - 4,
                        top: PAD_TOP + e.lane * ROWH,
                        height: EVH,
                      }
                      const canEdit = editableEvent(e)
                      // Parent group → a slim summary rail spanning its children.
                      if (e.isParent) {
                        return (
                          <div
                            key={e.task.id}
                            className="absolute flex items-center"
                            style={box}
                            title={`Group · ${e.task.title}`}
                          >
                            <span
                              className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[4px] rounded-full"
                              style={{ background: `color-mix(in srgb, ${v} 45%, transparent)` }}
                              aria-hidden
                            />
                            {!e.contLeft && (
                              <span
                                className="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-[13px] rounded-full"
                                style={{ background: v }}
                                aria-hidden
                              />
                            )}
                            {!e.contRight && (
                              <span
                                className="absolute right-0 top-1/2 -translate-y-1/2 w-[2.5px] h-[13px] rounded-full"
                                style={{ background: v }}
                                aria-hidden
                              />
                            )}
                            <span
                              className="relative z-10 ml-1.5 inline-block max-w-full truncate rounded bg-surface px-1.5 text-[11.5px] font-semibold"
                              style={{ color: softFg(v), maxWidth: e.width - 16 }}
                            >
                              ▾ #{e.task.sequence} {e.task.title}
                            </span>
                          </div>
                        )
                      }
                      // Milestone → a diamond at its date + a label to the right
                      // (a point, not a span). Gantt convention. See milestones.md.
                      if (e.isMilestone) {
                        return (
                          <div
                            key={e.task.id}
                            onClick={(ev) =>
                              setOpenBar({
                                task: e.task,
                                status: e.status,
                                rect: (
                                  ev.currentTarget as HTMLElement
                                ).getBoundingClientRect(),
                              })
                            }
                            className="absolute flex items-center gap-1.5 cursor-pointer hover:brightness-95 transition"
                            style={{ left: e.left + 2, top: box.top, height: EVH }}
                            title={`Milestone · ${e.task.title}`}
                          >
                            <span
                              className="w-[12px] h-[12px] rotate-45 rounded-[2px] shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
                              style={{ background: v }}
                              aria-hidden
                            />
                            <span
                              className="text-[11.5px] font-semibold whitespace-nowrap"
                              style={{ color: softFg(v) }}
                            >
                              #{e.task.sequence} {e.task.title}
                            </span>
                          </div>
                        )
                      }
                      return (
                        <div
                          key={e.task.id}
                          data-timeline-task-bar={e.task.id}
                          onPointerDown={(ev) => beginTimelineEdit(ev, e, member, 'move')}
                          onClick={(ev) => {
                            if (suppressClickRef.current === e.task.id) {
                              ev.preventDefault()
                              ev.stopPropagation()
                              return
                            }
                            setOpenBar({
                              task: e.task,
                              status: e.status,
                              rect: (
                                ev.currentTarget as HTMLElement
                              ).getBoundingClientRect(),
                            })
                          }}
                          className={`group/tbar absolute flex items-center rounded-[7px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:brightness-95 transition ${
                            canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                          } ${isSelected ? 'ring-2 ring-accent/55' : livePreview ? 'ring-2 ring-accent/35' : ''}`}
                          style={{ ...box, background: softBg(v), touchAction: canEdit ? 'none' : undefined }}
                          title={
                            canEdit
                              ? `Drag to move · resize edges · ${e.task.title}`
                              : `${STATUS_META[e.status].label} · ${e.task.title}`
                          }
                        >
                          {canEdit && (
                            <span
                              aria-label={`Resize start of ${e.task.title}`}
                              className="absolute left-0 top-0 bottom-0 z-20 w-2 cursor-ew-resize opacity-0 group-hover/tbar:opacity-100 bg-accent/20"
                              onPointerDown={(ev) => beginTimelineEdit(ev, e, member, 'resize-start')}
                            />
                          )}
                          <button
                            type="button"
                            aria-label={isSelected ? `Deselect #${e.task.sequence}` : `Select #${e.task.sequence}`}
                            aria-pressed={isSelected}
                            onPointerDown={(ev) => {
                              ev.stopPropagation()
                            }}
                            onClick={(ev) => {
                              ev.preventDefault()
                              ev.stopPropagation()
                              setOpenBar(null)
                              toggleSelected(e.task.id)
                            }}
                            className={`absolute right-1 top-1/2 z-30 grid h-[18px] w-[18px] -translate-y-1/2 place-items-center rounded-full border transition ${
                              isSelected
                                ? 'border-accent bg-accent text-white opacity-100'
                                : 'border-white/60 bg-surface/85 text-ink-faint opacity-0 shadow-[0_1px_3px_rgba(0,0,0,0.12)] group-hover/tbar:opacity-100 hover:text-accent'
                            }`}
                          >
                            {isSelected && <Check size={12} strokeWidth={3} />}
                          </button>
                          {e.contLeft && (
                            <span className="text-ink-faint text-[11px] pl-1.5" aria-hidden>
                              ‹
                            </span>
                          )}
                          <span
                            className="self-stretch my-[3px] ml-[3px] w-[3px] rounded-full shrink-0"
                            style={{ background: v }}
                          />
                          <span
                            className="text-[11.5px] font-semibold px-2 truncate"
                            style={{ color: softFg(v) }}
                          >
                            #{e.task.sequence} {e.task.title}
                          </span>
                          {/* pause: hatch+dim where the bar overlaps a day-off */}
                          {offBands.map((o, k) => {
                            const l = Math.max(box.left, o.left)
                            const r = Math.min(box.left + box.width, o.left + o.width)
                            if (r - l <= 0.5) return null
                            return (
                              <span
                                key={`p${k}`}
                                className="absolute top-0 bottom-0"
                                style={{ left: l - box.left, width: r - l, background: pauseBg(v) }}
                                aria-hidden
                              />
                            )
                          })}
                          {e.contRight && (
                            <span className="text-ink-faint text-[11px] pr-1.5" aria-hidden>
                              ›
                            </span>
                          )}
                          {canEdit && (
                            <span
                              aria-label={`Resize end of ${e.task.title}`}
                              className="absolute right-0 top-0 bottom-0 z-20 w-2 cursor-ew-resize opacity-0 group-hover/tbar:opacity-100 bg-accent/20"
                              onPointerDown={(ev) => beginTimelineEdit(ev, e, member, 'resize-end')}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                {/* expandable later / no-dates list */}
                {isOpen && hasExtra && (
                  <div
                    className="flex flex-wrap gap-1.5 px-3.5 py-2 bg-surface-hover border-b border-border-hair/70"
                    style={{ paddingLeft: MGUT }}
                  >
                    {offWindow.map(({ task, date, status, dir }) => {
                      const v = STATUS_META[status].varName
                      return (
                        <span
                          key={task.id}
                          className="inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5"
                          style={{ background: softBg(v), color: softFg(v) }}
                          title={`${STATUS_META[status].label} · ${task.title}`}
                        >
                          <span className="tab-data">#{task.sequence}</span>
                          <span className="max-w-[160px] truncate">{task.title}</span>
                          <span className="opacity-70">
                            {dir === 'earlier' ? '←' : '→'} {formatShortDate(date)}
                          </span>
                        </span>
                      )
                    })}
                    {noDates.map((task) => (
                      <span
                        key={task.id}
                        className="inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 bg-fill text-ink-muted"
                        title={task.title}
                      >
                        <span className="tab-data">#{task.sequence}</span>
                        <span className="max-w-[160px] truncate">{task.title}</span>
                        <span className="text-ink-faint">no dates</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {openBar && (
        <BarDetailPopover
          task={openBar.task}
          status={openBar.status}
          anchorRect={openBar.rect}
          onClose={() => setOpenBar(null)}
          onOpenInList={onOpenInList}
        />
      )}
      <TimelineSelectionBar
        selectedTasks={selectedTasks}
        sprints={activeSprints}
        onMove={moveSelectedToSprint}
        onClear={() => setSelectedIds(new Set())}
      />
    </div>
  )
}

function TimelineSelectionBar({
  selectedTasks,
  sprints,
  onMove,
  onClear,
}: {
  selectedTasks: Task[]
  sprints: Sprint[]
  onMove: (sprint: Sprint) => Promise<void>
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const barRef = useRef<HTMLDivElement>(null)
  const n = selectedTasks.length
  const visibleSprints = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sprints
    return sprints.filter((sprint) => {
      const hay = `${sprint.name} ${sprint.startDate} ${sprint.endDate}`.toLowerCase()
      return hay.includes(q)
    })
  }, [query, sprints])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (barRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (n === 0) {
      setOpen(false)
      setQuery('')
    }
  }, [n])

  return (
    <div
      ref={barRef}
      className={`fixed left-1/2 bottom-6 z-40 -translate-x-1/2 flex items-center gap-3 rounded-[14px] bg-ink dark:bg-[#2c2c2e] dark:ring-1 dark:ring-white/10 text-white pl-4 pr-2 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.22),0_0_0_0.5px_rgba(0,0,0,0.06)] transition-[opacity,transform] duration-200 ${
        n > 0
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-3 pointer-events-none'
      }`}
      role="toolbar"
      aria-label="Selected timeline tasks"
    >
      <span className="text-[13.5px]">
        <b className="font-semibold tabular-nums">{n}</b> selected
      </span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={sprints.length === 0}
          className="inline-flex items-center gap-1.5 rounded-[9px] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#1d1d1f] hover:bg-white/90 disabled:opacity-45 disabled:cursor-not-allowed transition"
        >
          <MoveRight size={14} />
          Move to sprint
          <ChevronsUpDown size={13} className="opacity-60" />
        </button>
        {open && (
          <div className="absolute bottom-[calc(100%+10px)] left-1/2 w-[290px] -translate-x-1/2 rounded-[12px] bg-surface p-2 text-ink shadow-[0_18px_50px_rgba(0,0,0,0.22),0_0_0_0.5px_rgba(0,0,0,0.08)]">
            <label className="flex items-center gap-2 rounded-[8px] border border-border bg-canvas-sunk/40 px-2.5 py-1.5">
              <Search size={14} className="shrink-0 text-ink-faint" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search sprint"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
              />
            </label>
            <div className="mt-2 max-h-[240px] overflow-y-auto py-1">
              {visibleSprints.length === 0 ? (
                <div className="px-2.5 py-3 text-[13px] text-ink-faint">
                  No matching sprint
                </div>
              ) : (
                visibleSprints.map((sprint) => {
                  const alreadyHere = selectedTasks.every((task) => task.sprintId === sprint.id)
                  const hereCount = selectedTasks.filter((task) => task.sprintId === sprint.id).length
                  return (
                    <button
                      key={sprint.id}
                      type="button"
                      disabled={alreadyHere}
                      onClick={() => {
                        setOpen(false)
                        setQuery('')
                        void onMove(sprint)
                      }}
                      className="w-full rounded-[8px] px-2.5 py-2 text-left hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent transition"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
                          {sprint.name}
                        </span>
                        {alreadyHere ? (
                          <span className="shrink-0 text-[11px] font-semibold text-ink-faint">
                            Current
                          </span>
                        ) : hereCount > 0 ? (
                          <span className="shrink-0 text-[11px] font-semibold text-ink-faint">
                            {hereCount} here
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-[11.5px] text-ink-faint tabular-nums">
                        {sprint.startDate} → {sprint.endDate}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
      <span className="w-px self-stretch bg-white/15" aria-hidden />
      <button
        type="button"
        onClick={onClear}
        className="grid h-8 w-8 place-items-center rounded-[9px] text-white/70 hover:bg-white/10 hover:text-white transition"
        aria-label="Clear timeline selection"
      >
        <X size={15} />
      </button>
    </div>
  )
}

/**
 * Read-only detail popover for a Gantt bar (portalled + fixed-positioned, like
 * the calendar/StatusPill pattern). Gantt dates are scheduler-computed, so this
 * shows them rather than editing — the action is "Open in List".
 */
function BarDetailPopover({
  task,
  status,
  anchorRect,
  onClose,
  onOpenInList,
}: {
  task: Task
  status: keyof typeof STATUS_META
  anchorRect: DOMRect
  onClose: () => void
  onOpenInList?: () => void
}) {
  const popRef = useRef<HTMLDivElement>(null)
  const W = 236
  const pos = useMemo(() => {
    let left = Math.min(anchorRect.left, window.innerWidth - 8 - W)
    left = Math.max(8, left)
    const H = 150
    let top = anchorRect.bottom + 6
    if (top + H > window.innerHeight - 8) top = Math.max(8, anchorRect.top - H - 6)
    return { top, left }
  }, [anchorRect])
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Anchored to a snapshot rect — close on scroll instead of floating detached.
    const onScroll = () => onClose()
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
      window.addEventListener('scroll', onScroll, true)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  const meta = STATUS_META[status]
  const v = meta.varName
  const range =
    task.startDate && task.dueDate
      ? task.startDate === task.dueDate
        ? formatShortDate(task.startDate)
        : `${formatShortDate(task.startDate)} – ${formatShortDate(task.dueDate)}`
      : task.startDate
        ? formatShortDate(task.startDate)
        : '—'

  return createPortal(
    <div
      ref={popRef}
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: W }}
      className="z-50 bg-surface border border-border-hair rounded-[14px] shadow-[0_12px_40px_rgba(0,0,0,0.18),0_0_0_0.5px_rgba(0,0,0,0.04)] p-3 space-y-2"
    >
      <div className="text-[14px] font-semibold text-ink leading-snug">
        <span className="tab-data text-ink-faint mr-1">#{task.sequence}</span>
        {task.title}
      </div>
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="text-ink-faint">Status</span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold leading-none"
          style={{ background: softBg(v), color: softFg(v) }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: v }}
            aria-hidden
          />
          {meta.label}
        </span>
      </div>
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="text-ink-faint">Dates</span>
        <span className="text-ink tabular-nums">{range}</span>
      </div>
      {onOpenInList && (
        <button
          onClick={() => {
            onOpenInList()
            onClose()
          }}
          className="w-full text-left text-[12.5px] font-medium text-accent rounded-[7px] px-1 py-1 hover:bg-accent-soft transition"
        >
          Open in List →
        </button>
      )}
    </div>,
    document.body
  )
}

function LegendDot({ varName, label }: { varName: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-3.5 h-3.5 rounded-[4px]" style={{ background: softBg(varName) }}>
        <span className="block w-[3px] h-full rounded-full" style={{ background: varName }} />
      </span>
      {label}
    </span>
  )
}
