import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, computeWorkingPlan, type Task, type Member } from './db'
import { Avatar } from './members'
import { sprintWorkdays, halfDayCells, type CellKind } from './lib'

/**
 * Read-only half-day (Sáng / Chiều) timeline for the current sprint, grouped by
 * member. A pure projection of the auto-scheduler — see design-docs/gantt-view.md.
 *
 * Layout: each visual row is its own CSS grid sharing one fixed column template
 * (`TV | Task | 2×workdays`), so columns align across rows without a single giant
 * grid. The TV/Task columns are sticky-left; the date header is sticky-top; a
 * continuous accent line marks today.
 */

const TV_W = 128
const TASK_W = 208
const HALF_W = 22
const DAY_W = HALF_W * 2

function todayISO(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function ddmm(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
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

const cellClass: Record<CellKind, string> = {
  active: 'bg-[#bfe7c6] dark:bg-[rgba(48,209,88,0.34)]',
  off: 'bg-[#f7cccc] dark:bg-[rgba(255,99,97,0.32)]',
  empty: '',
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
      .map((m) => ({ member: m, rows: orderTasks(byMember.get(m.id)!) }))
  }, [members, filteredTasks])

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
        <Swatch className={cellClass.active} label="Active" />
        <Swatch className={cellClass.off} label="Day off" />
        <Swatch className="ring-1 ring-inset ring-border-hair" label="No work" />
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

          {/* Sticky two-row header: date over S/C. */}
          <div
            className="sticky top-0 z-20 grid bg-surface border-b border-border-hair"
            style={{ gridTemplateColumns: gridCols, gridTemplateRows: 'auto auto' }}
          >
            <HeaderCorner label="TV" col={1} />
            <HeaderCorner label="Task" col={2} left={TV_W} />
            {workdays.map((date, i) => (
              <div
                key={`d-${date}`}
                className={`flex items-center justify-center text-[11px] font-semibold tab-data border-l border-border-hair py-1 ${
                  date === today ? 'text-accent' : 'text-ink-muted'
                }`}
                style={{ gridColumn: `${3 + i * 2} / span 2`, gridRow: '1' }}
              >
                {ddmm(date)}
              </div>
            ))}
            {workdays.map((date, i) => (
              <SCHead key={`sc-${date}`} date={date} col={3 + i * 2} today={today} />
            ))}
          </div>

          {/* Body: member groups. */}
          {groups.map(({ member, rows }) => (
            <div key={member.id}>
              {/* Member group header row */}
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
                  className="sticky z-[5] bg-fill flex items-center text-[13px] font-semibold text-ink truncate pr-3"
                  style={{ left: TV_W, width: TASK_W }}
                >
                  {member.name}
                  {member.title && (
                    <span className="ml-1.5 text-[11px] font-normal text-ink-faint truncate">
                      {member.title}
                    </span>
                  )}
                </div>
                <div style={{ gridColumn: '3 / -1' }} />
              </div>

              {/* Task rows */}
              {rows.map(({ task, depth, isParent }) => {
                const plan = computeWorkingPlan(task, tasksById, memberById)
                const cells = halfDayCells(plan, workdays, member.daysOff)
                return (
                  <div
                    key={task.id}
                    className="grid border-b border-border-hair/70 hover:bg-surface-hover/40 group"
                    style={{ gridTemplateColumns: gridCols }}
                  >
                    <div
                      className="sticky left-0 z-[5] bg-surface group-hover:bg-surface-hover flex items-center justify-end pr-2"
                      style={{ width: TV_W }}
                    >
                      <span className="text-[10px] tab-data text-ink-faint">
                        #{task.sequence}
                      </span>
                    </div>
                    <div
                      className={`sticky z-[5] bg-surface group-hover:bg-surface-hover flex items-center text-[12.5px] whitespace-normal break-words leading-tight py-1 pr-3 ${
                        isParent ? 'font-semibold text-ink' : 'text-ink'
                      }`}
                      style={{ left: TV_W, width: TASK_W, paddingLeft: 10 + depth * 14 }}
                      title={task.title}
                    >
                      {task.title}
                    </div>
                    {cells.flatMap((c, i) => [
                      <div
                        key={`am-${i}`}
                        className={`h-7 border-l border-border-hair/60 ${cellClass[c.am]}`}
                      />,
                      <div key={`pm-${i}`} className={`h-7 ${cellClass[c.pm]}`} />,
                    ])}
                  </div>
                )
              })}
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
      style={{
        gridColumn: `${col}`,
        gridRow: '1 / 3',
        left: left ?? 0,
      }}
    >
      {label}
    </div>
  )
}

function SCHead({ date, col, today }: { date: string; col: number; today: string }) {
  const cls = `flex items-center justify-center text-[9px] font-medium border-l border-border-hair py-0.5 ${
    date === today ? 'text-accent' : 'text-ink-faint'
  }`
  return (
    <>
      <div className={cls} style={{ gridColumn: `${col}`, gridRow: '2' }}>
        AM
      </div>
      <div
        className="flex items-center justify-center text-[9px] font-medium py-0.5 text-ink-faint"
        style={{ gridColumn: `${col + 1}`, gridRow: '2' }}
      >
        PM
      </div>
    </>
  )
}
