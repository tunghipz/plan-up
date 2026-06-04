import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, computeWorkingPlan, type Task, type Member } from './db'
import { Avatar } from './members'
import { sprintWorkdays, halfDayCells, type CellKind } from './lib'

/**
 * Read-only half-day (AM/PM) timeline for the current sprint, grouped by member.
 * A pure projection of the auto-scheduler — see design-docs/gantt-view.md.
 *
 * Layout: each visual row is its own CSS grid sharing one fixed column template
 * (`TV | Task | 2×workdays`), so columns align across rows without a single giant
 * grid. The TV/Task columns are sticky-left; the date header is sticky-top; a
 * continuous accent line marks today. Each member band carries a slim "load"
 * roll-up (union of that member's task spans); unscheduled tasks show a "no
 * dates" affordance instead of a blank row.
 */

const TV_W = 128
const TASK_W = 208
const HALF_W = 23
const DAY_W = HALF_W * 2

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function todayISO(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function ddmm(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

function weekday(date: string): string {
  return WD[new Date(date + 'T00:00:00Z').getUTCDay()]
}

/** True if a calendar gap (weekend) was skipped between two adjacent workdays. */
function gapBefore(prev: string, cur: string): boolean {
  const a = new Date(prev + 'T00:00:00Z').getTime()
  const b = new Date(cur + 'T00:00:00Z').getTime()
  return (b - a) / 86_400_000 > 1
}

/** Contiguous true-runs of a boolean array → inclusive [a,b] segments. */
function segmentsOf(arr: boolean[]): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = []
  let run: { a: number; b: number } | null = null
  arr.forEach((on, i) => {
    if (on) run ? (run.b = i) : (run = { a: i, b: i })
    else if (run) {
      out.push(run)
      run = null
    }
  })
  if (run) out.push(run)
  return out
}

/** Member's tasks flattened so children follow their parent (depth 1). */
function orderTasks(tasks: Task[]): { task: Task; depth: number; isParent: boolean }[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const parentIds = new Set<string>()
  for (const t of tasks) if (t.parentId) parentIds.add(t.parentId)
  const children = new Map<string, Task[]>()
  const tops: Task[] = []
  for (const t of tasks) {
    if (t.parentId && byId.has(t.parentId)) {
      const arr = children.get(t.parentId) ?? []
      arr.push(t)
      children.set(t.parentId, arr)
    } else tops.push(t)
  }
  const bySeq = (a: Task, b: Task) => a.sequence - b.sequence
  tops.sort(bySeq)
  const out: { task: Task; depth: number; isParent: boolean }[] = []
  for (const t of tops) {
    out.push({ task: t, depth: 0, isParent: parentIds.has(t.id) })
    const ch = children.get(t.id)
    if (ch) {
      ch.sort(bySeq)
      for (const c of ch) out.push({ task: c, depth: 1, isParent: parentIds.has(c.id) })
    }
  }
  return out
}

const ACTIVE_FILL =
  'bg-[#7fcf91] dark:bg-[rgba(48,209,88,0.5)] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
const OFF_FILL =
  'bg-[repeating-linear-gradient(45deg,#f7cccc_0_4px,#eeb4b4_4px_8px)] dark:bg-[repeating-linear-gradient(45deg,rgba(255,99,97,0.34)_0_4px,rgba(255,99,97,0.16)_4px_8px)]'
const ZEBRA = 'bg-black/[0.018] dark:bg-white/[0.022]'

/** One half-day grid cell. */
function Cell({
  state,
  am,
  seam,
  zebra,
  segStart,
  segEnd,
}: {
  state: CellKind
  am: boolean
  seam: boolean
  zebra: boolean
  segStart: boolean
  segEnd: boolean
}) {
  const border = am
    ? seam
      ? 'border-l-2 border-border-strong'
      : 'border-l border-border-hair'
    : 'border-l border-border-hair/30'
  let fill = ''
  if (state === 'active') {
    fill = ` ${ACTIVE_FILL}`
    if (segStart) fill += ' rounded-l-[6px] ml-[2px]'
    if (segEnd) fill += ' rounded-r-[6px] mr-[2px]'
  } else if (state === 'off') {
    fill = ` ${OFF_FILL}`
  } else if (zebra) {
    fill = ` ${ZEBRA}`
  }
  return <div className={`h-7 ${border}${fill}`} />
}

export function GanttView({
  projectId,
  sprintStartDate,
  sprintEndDate,
  tasks,
  search,
}: {
  projectId: string
  sprintStartDate: string
  sprintEndDate: string
  tasks: Task[]
  search: string
}) {
  const members = useLiveQuery(
    () => db.members.where('projectId').equals(projectId).toArray(),
    [projectId]
  )

  const workdays = useMemo(
    () => sprintWorkdays(sprintStartDate, sprintEndDate),
    [sprintStartDate, sprintEndDate]
  )
  // Indices that begin right after a skipped weekend → draw a seam separator.
  const seamSet = useMemo(() => {
    const s = new Set<number>()
    for (let i = 1; i < workdays.length; i++) {
      if (gapBefore(workdays[i - 1], workdays[i])) s.add(i)
    }
    return s
  }, [workdays])

  const filteredTasks = useMemo(() => {
    if (!search.trim()) return tasks
    const q = search.toLowerCase()
    return tasks.filter((t) => t.title.toLowerCase().includes(q))
  }, [tasks, search])

  // Unfiltered lookup so a task's prereqs still resolve when the view is filtered.
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const memberById = useMemo(
    () => new Map((members ?? []).map((m) => [m.id, m] as [string, Member])),
    [members]
  )

  const groups = useMemo(() => {
    const ms = members ?? []
    const byMember = new Map<string, Task[]>()
    for (const m of ms) byMember.set(m.id, [])
    for (const t of filteredTasks) {
      if (t.assigneeId && byMember.has(t.assigneeId)) byMember.get(t.assigneeId)!.push(t)
    }
    return ms
      .filter((m) => (byMember.get(m.id) ?? []).length > 0)
      .map((m) => {
        const rows = orderTasks(byMember.get(m.id)!).map((r) => {
          const plan = computeWorkingPlan(r.task, tasksById, memberById)
          const cells = halfDayCells(plan, workdays, m.daysOff)
          const flat: CellKind[] = cells.flatMap((c) => [c.am, c.pm])
          const scheduled = !!plan.startDate && !!plan.dueDate
          return { ...r, flat, scheduled }
        })
        // Member load roll-up = union of every task's occupied half-days.
        const union = Array(workdays.length * 2).fill(false)
        for (const r of rows) {
          r.flat.forEach((s, i) => {
            if (s !== 'empty') union[i] = true
          })
        }
        return { member: m, rows, loadSegs: segmentsOf(union) }
      })
  }, [members, filteredTasks, workdays, tasksById, memberById])

  if (!members) return <p className="text-ink-muted py-12 text-center">Loading…</p>

  if (workdays.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-ink-muted">
        This sprint has no working days (weekends only).
      </div>
    )
  }
  if (groups.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-ink-muted">
        {search.trim()
          ? `No tasks match "${search}".`
          : 'No assigned tasks in this sprint yet.'}
      </div>
    )
  }

  const gridCols = `${TV_W}px ${TASK_W}px repeat(${workdays.length * 2}, ${HALF_W}px)`
  const totalW = TV_W + TASK_W + workdays.length * DAY_W
  const today = todayISO()
  const todayIdx = workdays.indexOf(today)

  return (
    <div className="pt-4 pb-2 max-w-full">
      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-[12px] text-ink-muted">
        <Swatch className={ACTIVE_FILL} label="Active" />
        <Swatch className={OFF_FILL} label="Day off" />
        <Swatch className="ring-1 ring-inset ring-border-strong" label="No work" />
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-5 h-[6px] rounded-full bg-accent/45" />
          Member load
        </span>
      </div>

      <div className="overflow-auto w-fit max-w-full rounded-[12px] border border-border-hair bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_rgba(0,0,0,0.04)]">
        <div className="relative" style={{ width: totalW }}>
          {/* Today marker — continuous accent line spanning all rows. */}
          {todayIdx >= 0 && (
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-accent/70 z-10 pointer-events-none"
              style={{ left: TV_W + TASK_W + todayIdx * DAY_W }}
              aria-hidden
            />
          )}

          {/* Sticky two-row header: date (+ weekday) over AM/PM. */}
          <div
            className="sticky top-0 z-20 grid bg-surface border-b border-border-hair"
            style={{ gridTemplateColumns: gridCols, gridTemplateRows: 'auto auto' }}
          >
            <HeaderCorner label="TV" col={1} />
            <HeaderCorner label="Task" col={2} left={TV_W} />
            {workdays.map((date, i) => (
              <div
                key={`d-${date}`}
                className={`flex flex-col items-center justify-center py-1 ${
                  seamSet.has(i) ? 'border-l-2 border-border-strong' : 'border-l border-border-hair'
                } ${date === today ? 'text-accent' : 'text-ink-muted'}`}
                style={{ gridColumn: `${3 + i * 2} / span 2`, gridRow: '1' }}
              >
                <span className="text-[11px] font-semibold tab-data leading-none">{ddmm(date)}</span>
                <span
                  className={`text-[9px] font-semibold leading-none mt-0.5 ${
                    date === today ? 'text-accent' : 'text-ink-faint'
                  }`}
                >
                  {weekday(date)}
                </span>
              </div>
            ))}
            {workdays.map((date, i) => (
              <SCHead key={`sc-${date}`} date={date} col={3 + i * 2} today={today} seam={seamSet.has(i)} />
            ))}
          </div>

          {/* Body: member groups. */}
          {groups.map(({ member, rows, loadSegs }) => (
            <div key={member.id}>
              {/* Member group header row + load roll-up */}
              <div
                className="grid bg-fill/60 border-b border-border-hair"
                style={{ gridTemplateColumns: gridCols }}
              >
                <div
                  className="sticky left-0 z-[5] bg-fill flex items-center justify-center py-1.5"
                  style={{ width: TV_W }}
                >
                  <Avatar member={member} />
                </div>
                <div
                  className="sticky z-[5] bg-fill flex items-center text-[13px] font-semibold text-ink truncate overflow-hidden pr-3"
                  style={{ left: TV_W, width: TASK_W }}
                >
                  {member.name}
                  {member.title && (
                    <span className="ml-1.5 text-[11px] font-normal text-ink-faint truncate">
                      {member.title}
                    </span>
                  )}
                </div>
                <div className="relative" style={{ gridColumn: '3 / -1' }}>
                  {loadSegs.map((s, k) => (
                    <div
                      key={k}
                      className="absolute top-1/2 -translate-y-1/2 h-[6px] rounded-full bg-accent/45"
                      style={{
                        left: s.a * HALF_W + 2,
                        width: Math.max((s.b - s.a + 1) * HALF_W - 4, 6),
                      }}
                      aria-hidden
                    />
                  ))}
                </div>
              </div>

              {/* Task rows */}
              {rows.map(({ task, depth, isParent, flat, scheduled }) => (
                <div
                  key={task.id}
                  className="grid border-b border-border-hair/55 hover:bg-surface-hover/40 group"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div
                    className="sticky left-0 z-[5] bg-surface group-hover:bg-surface-hover flex items-center justify-end pr-2"
                    style={{ width: TV_W }}
                  >
                    <span className="text-[10px] tab-data text-ink-faint">#{task.sequence}</span>
                  </div>
                  <div
                    className={`sticky z-[5] bg-surface group-hover:bg-surface-hover flex items-center text-[12.5px] whitespace-normal break-words overflow-hidden leading-tight py-1 pr-3 ${
                      isParent ? 'font-semibold' : ''
                    } ${scheduled ? 'text-ink' : 'text-ink-faint'}`}
                    style={{ left: TV_W, width: TASK_W, paddingLeft: 10 + depth * 14 }}
                    title={task.title}
                  >
                    {task.title}
                  </div>
                  {scheduled ? (
                    workdays.flatMap((_, i) => [
                      <Cell
                        key={`am-${i}`}
                        state={flat[i * 2]}
                        am
                        seam={seamSet.has(i)}
                        zebra={i % 2 === 1}
                        segStart={flat[i * 2] === 'active' && flat[i * 2 - 1] !== 'active'}
                        segEnd={flat[i * 2] === 'active' && flat[i * 2 + 1] !== 'active'}
                      />,
                      <Cell
                        key={`pm-${i}`}
                        state={flat[i * 2 + 1]}
                        am={false}
                        seam={false}
                        zebra={i % 2 === 1}
                        segStart={flat[i * 2 + 1] === 'active' && flat[i * 2] !== 'active'}
                        segEnd={flat[i * 2 + 1] === 'active' && flat[i * 2 + 2] !== 'active'}
                      />,
                    ])
                  ) : (
                    <div className="relative h-7 flex items-center" style={{ gridColumn: '3 / -1' }}>
                      <div className="absolute left-2 right-2 top-1/2 border-t border-dashed border-border-strong/60" />
                      <span className="relative ml-2 text-[9.5px] font-semibold text-ink-faint bg-surface group-hover:bg-surface-hover border border-dashed border-border-strong rounded-[5px] px-1.5 py-px">
                        no dates
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-3.5 h-3.5 rounded-[3px] ${className}`} />
      {label}
    </span>
  )
}

function HeaderCorner({ label, col, left }: { label: string; col: number; left?: number }) {
  return (
    <div
      className="sticky top-0 z-30 bg-surface flex items-center text-[11px] font-semibold text-ink-muted px-2.5"
      style={{ gridColumn: `${col}`, gridRow: '1 / 3', left: left ?? 0 }}
    >
      {label}
    </div>
  )
}

function SCHead({
  date,
  col,
  today,
  seam,
}: {
  date: string
  col: number
  today: string
  seam: boolean
}) {
  const amBorder = seam ? 'border-l-2 border-border-strong' : 'border-l border-border-hair'
  const tone = date === today ? 'text-accent' : 'text-ink-faint'
  return (
    <>
      <div
        className={`flex items-center justify-center text-[9px] font-medium py-0.5 ${amBorder} ${tone}`}
        style={{ gridColumn: `${col}`, gridRow: '2' }}
      >
        AM
      </div>
      <div
        className="flex items-center justify-center text-[9px] font-medium py-0.5 border-l border-border-hair/30 text-ink-faint"
        style={{ gridColumn: `${col + 1}`, gridRow: '2' }}
      >
        PM
      </div>
    </>
  )
}
