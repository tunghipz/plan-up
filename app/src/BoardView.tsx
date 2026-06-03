import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Member, type Status, type Task } from './db'
import { formatShortDate } from './lib'
import { STATUS_META, STATUS_ORDER, StatusIcon } from './SprintView'

/**
 * Kanban-style board view. Three columns (Todo / In Progress / Done).
 * Each card shows status icon (clickable to cycle), title, assignee avatar,
 * due date. Read-mostly — full editing happens in the list view.
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
    // Done first by most recent (later sequence), others by sequence ascending.
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
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-6xl">
      {STATUS_ORDER.map((status) => {
        const meta = STATUS_META[status]
        const list = byStatus[status]
        return (
          <section
            key={status}
            className="bg-canvas-sunk/60 rounded-xl border border-border-hair flex flex-col min-h-[200px]"
          >
            <header className="flex items-center gap-2 px-3 py-2.5 border-b border-border-hair">
              <span
                className="w-3.5 h-3.5"
                style={{ color: meta.varName }}
                aria-hidden
              >
                <StatusIcon status={status} />
              </span>
              <span className="text-[13px] font-semibold text-ink display-tight">
                {meta.label}
              </span>
              <span className="text-[11px] text-ink-faint ml-1">
                {list.length}
              </span>
            </header>
            <div className="flex-1 p-2 space-y-2">
              {list.length === 0 ? (
                <div className="text-[12px] text-ink-faint italic px-2 py-3 text-center">
                  Empty
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
  return (
    <article className="bg-surface border border-border-hair rounded-lg p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition">
      <div className="flex items-start gap-2.5">
        <button
          onClick={onCycleStatus}
          className="w-4 h-4 shrink-0 mt-0.5 transition hover:scale-110 flex items-center justify-center"
          style={{ color: meta.varName }}
          title={`${meta.label} — click to cycle`}
          aria-label={`Status: ${meta.label}`}
        >
          <StatusIcon status={task.status} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-ink leading-snug break-words">
            {task.title || (
              <span className="text-ink-faint italic">Untitled</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2 text-[11.5px] text-ink-muted flex-wrap">
            <span className="text-ink-faint font-mono">#{task.sequence}</span>
            {task.dueDate && (
              <>
                <span className="text-ink-faint" aria-hidden>
                  ·
                </span>
                <span className="text-ink-faint font-medium">End time</span>
                <span
                  className="text-ink font-medium font-mono"
                  title={`End time: ${task.dueDate}`}
                >
                  {formatShortDate(task.dueDate)}
                </span>
              </>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {member ? (
                <>
                  <span
                    className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-white text-[9px] font-semibold"
                    style={{
                      background: member.color,
                      letterSpacing: '-0.01em',
                    }}
                    aria-hidden
                  >
                    {member.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="text-ink font-medium truncate max-w-[120px]">
                    {member.name}
                  </span>
                </>
              ) : (
                <>
                  <span
                    className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border border-dashed border-border-strong text-ink-faint text-[10px]"
                    aria-hidden
                  >
                    ?
                  </span>
                  <span className="text-ink-faint italic">Unassigned</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
