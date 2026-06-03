import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Member, type Status, type Task } from './db'
import { formatShortDate } from './lib'
import { STATUS_META, STATUS_ORDER, StatusIcon } from './SprintView'

/**
 * Cupertino kanban board. Three columns on the grey canvas; cards are white,
 * large-radius, soft-shadowed (inset-grouped feel). Read-mostly — full editing
 * happens in the list view.
 */
export function BoardView({
  projectId,
  tasks,
  search,
}: {
  projectId: string
  tasks: Task[]
  search: string
}) {
  const members = useLiveQuery(
    () => db.members.where('projectId').equals(projectId).toArray(),
    [projectId]
  )

  const membersById = useMemo(() => {
    const m = new Map<string, Member>()
    for (const x of members ?? []) m.set(x.id, x)
    return m
  }, [members])

  const filtered = useMemo(() => {
    if (!search.trim()) return tasks
    const q = search.toLowerCase()
    return tasks.filter((t) => t.title.toLowerCase().includes(q))
  }, [tasks, search])

  const byStatus = useMemo(() => {
    const out: Record<Status, Task[]> = { todo: [], in_progress: [], done: [] }
    for (const t of filtered) out[t.status].push(t)
    for (const s of STATUS_ORDER) {
      out[s].sort((a, b) =>
        s === 'done' ? b.sequence - a.sequence : a.sequence - b.sequence
      )
    }
    return out
  }, [filtered])

  const cycleStatus = (t: Task) => {
    const idx = STATUS_ORDER.indexOf(t.status)
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]
    void db.tasks.update(t.id, { status: next })
  }

  if (!members)
    return <p className="text-ink-muted py-12 text-center">Loading…</p>

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-6xl">
      {STATUS_ORDER.map((status) => {
        const meta = STATUS_META[status]
        const list = byStatus[status]
        return (
          <section key={status} className="flex flex-col gap-2.5 min-h-[200px]">
            <header className="flex items-center gap-2 px-1.5 py-1">
              <span className="w-4 h-4" style={{ color: meta.varName }} aria-hidden>
                <StatusIcon status={status} />
              </span>
              <span className="text-[15px] font-semibold text-ink tracking-[-0.01em]">
                {meta.label}
              </span>
              <span className="text-[12.5px] ml-auto text-ink-faint tab-data">
                {list.length}
              </span>
            </header>
            <div className="flex-1 flex flex-col gap-2.5">
              {list.length === 0 ? (
                <div className="text-[13px] text-ink-faint px-2 py-6 text-center">
                  No tasks
                </div>
              ) : (
                list.map((t) => (
                  <BoardCard
                    key={t.id}
                    task={t}
                    member={
                      t.assigneeId ? membersById.get(t.assigneeId) ?? null : null
                    }
                    onCycleStatus={() => cycleStatus(t)}
                  />
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

const PRIO_TAG: Record<string, { label: string; bg: string; fg: string }> = {
  urgent: { label: 'Urgent', bg: 'rgba(255,59,48,0.12)', fg: '#d70015' },
  high: { label: 'High', bg: 'rgba(255,149,0,0.15)', fg: '#b25e00' },
}

function BoardCard({
  task,
  member,
  onCycleStatus,
}: {
  task: Task
  member: Member | null
  onCycleStatus: () => void
}) {
  const meta = STATUS_META[task.status]
  const prio = PRIO_TAG[task.priority ?? 'none']

  // Due chip — soft-tinted via tokens (works in dark too). No emoji.
  const due = (() => {
    if (!task.dueDate) return null
    const c =
      task.status === 'done'
        ? 'var(--color-status-done)'
        : (() => {
            const days =
              (new Date(task.dueDate).getTime() - Date.now()) / 86400000
            if (days < 0) return 'var(--color-priority-urgent)'
            if (days < 3) return 'var(--color-priority-high)'
            return 'var(--color-ink-faint)'
          })()
    return {
      bg: `color-mix(in srgb, ${c} 13%, transparent)`,
      fg: `color-mix(in srgb, ${c} 100%, #000 25%)`,
    }
  })()

  return (
    <article className="bg-surface rounded-[12px] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_3px_10px_rgba(0,0,0,0.05)] hover:shadow-[0_2px_4px_rgba(0,0,0,0.06),0_10px_24px_rgba(0,0,0,0.08)] transition cursor-pointer">
      <div className="flex items-start gap-2.5">
        <button
          onClick={onCycleStatus}
          className="w-[18px] h-[18px] shrink-0 mt-0.5 transition hover:scale-110 flex items-center justify-center"
          style={{ color: meta.varName }}
          title={`${meta.label} — click to cycle`}
          aria-label={`Status: ${meta.label}`}
        >
          <StatusIcon status={task.status} />
        </button>
        <div
          className={`flex-1 min-w-0 text-[14px] leading-snug break-words ${
            task.status === 'done' ? 'text-ink-faint' : 'text-ink'
          }`}
        >
          {task.title || <span className="text-ink-faint italic">Untitled</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2.5 text-[11.5px] flex-wrap">
        <span className="text-ink-faint tab-data">#{task.sequence}</span>
        {prio && (
          <span
            className="inline-flex items-center font-semibold px-2 py-0.5 rounded-full"
            style={{ background: prio.bg, color: prio.fg }}
          >
            {prio.label}
          </span>
        )}
        {due && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full font-medium tab-data"
            style={{ background: due.bg, color: due.fg }}
            title={`Due ${task.dueDate}`}
          >
            {formatShortDate(task.dueDate!)}
          </span>
        )}
        <div className="ml-auto">
          {member ? (
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-semibold"
              style={{ background: member.color }}
              title={member.name}
              aria-label={member.name}
            >
              {member.name.trim().charAt(0).toUpperCase()}
            </span>
          ) : (
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-dashed border-border-strong text-ink-faint text-[10px]"
              aria-hidden
            >
              ?
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
