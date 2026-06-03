import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Member, type Status, type Task } from './db'
import { formatShortDate } from './lib'
import { STATUS_META, STATUS_ORDER, StatusIcon } from './SprintView'

/**
 * Trello-style kanban board. Full gradient canvas with translucent list
 * containers; cards are pure white with a colored label strip on top.
 * Read-mostly — full editing happens in the list view.
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
    const out: Record<Status, Task[]> = {
      todo: [],
      in_progress: [],
      done: [],
    }
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
    <div
      className="rounded-2xl p-5 max-w-6xl shadow-[0_4px_14px_rgba(9,30,66,0.15),inset_0_1px_0_rgba(255,255,255,0.1)]"
      style={{
        background:
          'linear-gradient(135deg, #026AA7 0%, #0098E5 100%)',
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STATUS_ORDER.map((status) => {
          const meta = STATUS_META[status]
          const list = byStatus[status]
          return (
            <section
              key={status}
              className="rounded-xl flex flex-col min-h-[200px] p-2 backdrop-blur-sm"
              style={{
                background: 'rgba(244, 245, 247, 0.92)',
              }}
            >
              <header className="flex items-center gap-2 px-2 py-2">
                <span
                  className="w-3.5 h-3.5"
                  style={{ color: meta.varName }}
                  aria-hidden
                >
                  <StatusIcon status={status} />
                </span>
                <span className="text-[14px] font-semibold text-ink">
                  {meta.label}
                </span>
                <span className="text-[11.5px] ml-auto font-semibold text-ink-faint">
                  {list.length}
                </span>
              </header>
              <div className="flex-1 flex flex-col gap-2">
                {list.length === 0 ? (
                  <div className="text-[13px] text-ink-faint italic px-2 py-3 text-center">
                    Empty
                  </div>
                ) : (
                  list.map((t) => (
                    <BoardCard
                      key={t.id}
                      task={t}
                      member={
                        t.assigneeId
                          ? membersById.get(t.assigneeId) ?? null
                          : null
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
    </div>
  )
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
  // Label strip color derived from priority (Trello signature visual).
  const priorityColor: Record<string, string> = {
    urgent: 'var(--color-priority-urgent)',
    high: 'var(--color-priority-high)',
    normal: 'var(--color-priority-normal)',
    low: 'var(--color-priority-low)',
    none: 'transparent',
  }
  const stripColor = priorityColor[task.priority ?? 'none'] ?? 'transparent'

  // Due date chip tinting — overdue red, due-soon orange, normal grey.
  const dueChipClass = (() => {
    if (!task.dueDate) return ''
    const now = new Date()
    const due = new Date(task.dueDate)
    const days = (due.getTime() - now.getTime()) / 86400000
    if (task.status === 'done') return 'bg-[#E3FCEF] text-[#006644]'
    if (days < 0) return 'bg-[#FFEBE5] text-[#BF2600]'
    if (days < 3) return 'bg-[#FFF7E5] text-[#B25500]'
    return 'bg-[#EBECF0] text-ink-muted'
  })()

  return (
    <article className="bg-surface rounded-md shadow-[0_1px_0_rgba(9,30,66,0.13)] hover:shadow-[0_4px_12px_rgba(9,30,66,0.18)] transition cursor-pointer overflow-hidden">
      {stripColor !== 'transparent' && (
        <div
          className="h-2 w-10 rounded-full mx-2.5 mt-2.5"
          style={{ background: stripColor }}
        />
      )}
      <div className="px-2.5 py-2">
        <div className="flex items-start gap-2">
          <button
            onClick={onCycleStatus}
            className="w-4 h-4 shrink-0 mt-0.5 transition hover:scale-110 flex items-center justify-center"
            style={{ color: meta.varName }}
            title={`${meta.label} — click to cycle`}
            aria-label={`Status: ${meta.label}`}
          >
            <StatusIcon status={task.status} />
          </button>
          <div className="flex-1 min-w-0 text-[14px] text-ink leading-snug break-words">
            {task.title || (
              <span className="text-ink-faint italic">Untitled</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[11.5px] flex-wrap">
          <span className="text-ink-faint font-mono">#{task.sequence}</span>
          {task.dueDate && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium font-mono ${dueChipClass}`}
              title={`Due ${task.dueDate}`}
            >
              📅 {formatShortDate(task.dueDate)}
            </span>
          )}
          <div className="ml-auto">
            {member ? (
              <span
                className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-semibold ring-2 ring-white shadow-[0_0_0_1px_rgba(9,30,66,0.13)]"
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
      </div>
    </article>
  )
}
