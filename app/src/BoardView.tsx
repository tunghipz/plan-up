import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowUpDown, ChevronDown } from 'lucide-react'
import {
  db,
  uid,
  nextSequence,
  computeWorkingPlan,
  recomputeDates,
  updateTask,
  logStatusChange,
  type Member,
  type Status,
  type Task,
} from './db'
import { ChangeLogTooltip } from './ChangeLogTooltip'
import { formatShortDate } from './lib'
import { SprintRangeContext } from './DatePicker'
import {
  STATUS_META,
  STATUS_ORDER,
  StatusIcon,
  derivedGroupStatus,
  DatePickCell,
  EffortCell,
} from './SprintView'

// Per-column sort (see design-docs/board-view.md). Each column carries its own
// {mode, dir}; `manual` is the default drag order. Sort is a NON-DESTRUCTIVE view
// overlay — picking name/time never writes boardOrder; back to manual restores the
// dragged order. A drop flips the destination column to manual (a drag is manual
// intent), reindexing it so the card lands exactly where dropped.
type BoardSortMode = 'manual' | 'name' | 'time' | 'member'
type ColSort = { mode: BoardSortMode; dir: 'asc' | 'desc' }
type BoardSort = Record<Status, ColSort>
const SORT_MODES: BoardSortMode[] = ['manual', 'name', 'time', 'member']
const SORT_LABELS: Record<BoardSortMode, string> = {
  manual: 'Manual',
  name: 'Name',
  time: 'Time',
  member: 'Member',
}
const BOARD_SORT_KEY = 'plan-up:board-sort'
const freshBoardSort = (): BoardSort => ({
  todo: { mode: 'manual', dir: 'asc' },
  in_progress: { mode: 'manual', dir: 'asc' },
  done: { mode: 'manual', dir: 'asc' },
})
// Load + validate the per-column sort (unknown mode/dir → manual/asc), mirroring the
// List's loadSort. Survives view/sprint/project switch and reload.
function loadBoardSort(): BoardSort {
  try {
    const raw = localStorage.getItem(BOARD_SORT_KEY)
    if (!raw) return freshBoardSort()
    const parsed = JSON.parse(raw) as Partial<Record<Status, Partial<ColSort>>>
    const pick = (s: Status): ColSort => {
      const c = parsed?.[s]
      const mode = c && SORT_MODES.includes(c.mode as BoardSortMode) ? (c.mode as BoardSortMode) : 'manual'
      const dir = c?.dir === 'desc' ? 'desc' : 'asc'
      return { mode, dir }
    }
    return { todo: pick('todo'), in_progress: pick('in_progress'), done: pick('done') }
  } catch {
    return freshBoardSort()
  }
}
function saveBoardSort(s: BoardSort) {
  try {
    localStorage.setItem(BOARD_SORT_KEY, JSON.stringify(s))
  } catch {
    // localStorage unavailable, swallow
  }
}

/**
 * Cupertino kanban board. Three columns on the grey canvas; cards are white,
 * large-radius, soft-shadowed (inset-grouped feel). Read-mostly — full editing
 * happens in the list view.
 */
export function BoardView({
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

  // Parent → children (across all tasks). A parent is a container: its card shows a
  // derived status (rolled up from children), consistent with List/Timeline.
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.parentId) continue
      const arr = m.get(t.parentId)
      arr ? arr.push(t) : m.set(t.parentId, [t])
    }
    return m
  }, [tasks])

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  // Precompute each task's working plan ONCE per data change — not per render.
  // Drag re-renders the board on every index change; recomputing the scheduler
  // for every card's due chip in that hot path was the source of drag jank.
  const planById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof computeWorkingPlan>>()
    for (const t of tasks) m.set(t.id, computeWorkingPlan(t, tasksById, membersById))
    return m
  }, [tasks, tasksById, membersById])

  const effectiveStatus = (t: Task): Status => {
    const kids = childrenByParent.get(t.id)
    return kids && kids.length ? derivedGroupStatus(kids) : t.status
  }
  // Date span rolled up from children (earliest start … latest end, time-aware) —
  // parents have no own dates. Mirrors the List group row / Timeline summary rail.
  const groupRange = (kids: Task[]): string | null => {
    let sKey: string | null = null
    let eKey: string | null = null
    let sd: string | null = null
    let dd: string | null = null
    for (const c of kids) {
      const p = planById.get(c.id)
      if (!p) continue
      if (p.startDate) {
        const k = `${p.startDate}T${p.startTime}`
        if (!sKey || k < sKey) (sKey = k), (sd = p.startDate)
      }
      if (p.dueDate) {
        const k = `${p.dueDate}T${p.endTime}`
        if (!eKey || k > eKey) (eKey = k), (dd = p.dueDate)
      }
    }
    if (!sd && !dd) return null
    if (sd && dd) return sd === dd ? formatShortDate(sd) : `${formatShortDate(sd)} – ${formatShortDate(dd)}`
    return formatShortDate((dd ?? sd)!)
  }

  // Order within a column: manual board order if set, else sequence. Ascending
  // everywhere (top = first) for predictable drag — replaces the old Done-desc.
  const orderOf = (t: Task) => t.boardOrder ?? t.sequence

  // Per-column sort state, persisted to localStorage. See design-docs/board-view.md.
  const [boardSort, setBoardSort] = useState<BoardSort>(loadBoardSort)
  useEffect(() => {
    saveBoardSort(boardSort)
  }, [boardSort])
  const setColSort = useCallback((status: Status, next: ColSort) => {
    setBoardSort((prev) => (prev[status] === next ? prev : { ...prev, [status]: next }))
  }, [])

  // "Sort by time" key = the COMPUTED date the card's Due chip shows (so chip and
  // order agree), reusing the precomputed planById (no extra scheduler runs). A
  // parent rolls up to its latest child due — the end of its date-range chip.
  // null (no due) → sorts last. ISO `YYYY-MM-DDThh:mm` strings compare chronologically.
  const timeKeyById = useMemo(() => {
    const m = new Map<string, string | null>()
    const leafKey = (id: string): string | null => {
      const p = planById.get(id)
      return p?.dueDate ? `${p.dueDate}T${p.endTime ?? ''}` : null
    }
    for (const t of tasks) {
      const kids = childrenByParent.get(t.id)
      if (kids && kids.length) {
        let k: string | null = null
        for (const c of kids) {
          const ck = leafKey(c.id)
          if (ck && (!k || ck > k)) k = ck
        }
        m.set(t.id, k)
      } else {
        m.set(t.id, leafKey(t.id))
      }
    }
    return m
  }, [tasks, childrenByParent, planById])

  const byStatus = useMemo(() => {
    const cmp = (a: Task, b: Task, cs: ColSort): number => {
      if (cs.mode === 'manual') return orderOf(a) - orderOf(b)
      const mul = cs.dir === 'asc' ? 1 : -1
      if (cs.mode === 'name') {
        const ta = (a.title || '').toLowerCase()
        const tb = (b.title || '').toLowerCase()
        if (ta < tb) return -1 * mul
        if (ta > tb) return 1 * mul
        return a.sequence - b.sequence
      }
      if (cs.mode === 'member') {
        // by assignee name (the avatar the card shows); unassigned sinks last
        const ma = a.assigneeId ? membersById.get(a.assigneeId)?.name.toLowerCase() ?? null : null
        const mb = b.assigneeId ? membersById.get(b.assigneeId)?.name.toLowerCase() ?? null : null
        if (ma === null && mb === null) return a.sequence - b.sequence
        if (ma === null) return 1
        if (mb === null) return -1
        if (ma < mb) return -1 * mul
        if (ma > mb) return 1 * mul
        return a.sequence - b.sequence
      }
      // time: by computed due key; no-due always sinks last regardless of dir
      const ka = timeKeyById.get(a.id) ?? null
      const kb = timeKeyById.get(b.id) ?? null
      if (ka === null && kb === null) return a.sequence - b.sequence
      if (ka === null) return 1
      if (kb === null) return -1
      if (ka < kb) return -1 * mul
      if (ka > kb) return 1 * mul
      return a.sequence - b.sequence
    }
    const out: Record<Status, Task[]> = { todo: [], in_progress: [], done: [] }
    for (const t of filtered) out[effectiveStatus(t)].push(t)
    for (const s of STATUS_ORDER) out[s].sort((a, b) => cmp(a, b, boardSort[s]))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, childrenByParent, boardSort, timeKeyById, membersById])

  // Per-card display data (status / group roll-up / parent title), precomputed once
  // per data change. Crucial for drag perf: the `group` object keeps a STABLE ref
  // across the many re-renders a drag triggers, so memo(BoardCard) can skip cards
  // whose data didn't change (a fresh inline `{done,total,range}` would bust memo).
  const metaById = useMemo(() => {
    const m = new Map<
      string,
      { displayStatus: Status; group: { done: number; total: number; range: string | null } | null; parentTitle: string | null }
    >()
    for (const t of tasks) {
      const kids = childrenByParent.get(t.id)
      const group =
        kids && kids.length
          ? { done: kids.filter((c) => c.status === 'done').length, total: kids.length, range: groupRange(kids) }
          : null
      const displayStatus: Status = group ? derivedGroupStatus(kids!) : t.status
      const parentTitle = t.parentId ? tasksById.get(t.parentId)?.title ?? null : null
      m.set(t.id, { displayStatus, group, parentTitle })
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, childrenByParent, planById, tasksById])

  // Cycle status by id — stable callback (no closure over the rendered index/task),
  // so it doesn't change identity on a drag re-render and memo(BoardCard) holds.
  const onCycleStatusId = useCallback(
    (id: string) => {
      const t = tasksById.get(id)
      if (!t || childrenByParent.get(id)?.length) return // parent status is derived
      const idx = STATUS_ORDER.indexOf(t.status)
      const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]
      void logStatusChange(id, t.status, next)
    },
    [tasksById, childrenByParent]
  )

  // Drag (native HTML5 DnD). Leaf cards only. Dropping sets status AND a manual
  // `boardOrder` so the card lands — and stays — exactly where the placeholder was.
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ status: Status; index: number } | null>(null)
  const dragged = dragId ? tasksById.get(dragId) ?? null : null
  // Ref mirror of dragId so the (stable) card handlers can early-return without
  // closing over the dragId state — keeps their identity stable for memo.
  const dragIdRef = useRef<string | null>(null)
  // Coalesce the constant dragover stream into one hit-test + setOver per frame.
  // overRaf holds the scheduled frame; pendingHit the latest card to test against.
  const overRaf = useRef(0)
  const pendingHit = useRef<{ el: HTMLElement; status: Status; base: number; clientY: number } | null>(null)
  const clearDrag = useCallback(() => {
    if (overRaf.current) { cancelAnimationFrame(overRaf.current); overRaf.current = 0 }
    pendingHit.current = null
    dragIdRef.current = null
    setDragId(null)
    setOver(null)
  }, [])
  // Fractional index between the slot's display neighbours (skipping the dragged
  // card). null → column has no other tasks, leave order untouched.
  const orderForDrop = (status: Status, index: number, id: string): number | null => {
    const L = byStatus[status]
    let before: Task | undefined
    let after: Task | undefined
    for (let i = index - 1; i >= 0; i--) if (L[i].id !== id) { before = L[i]; break }
    for (let i = index; i < L.length; i++) if (L[i].id !== id) { after = L[i]; break }
    if (!before && !after) return null
    if (!before) return orderOf(after!) - 1
    if (!after) return orderOf(before!) + 1
    return (orderOf(before!) + orderOf(after!)) / 2
  }
  const handleDrop = (status: Status, id: string, index: number) => {
    const t = tasksById.get(id)
    if (!t || childrenByParent.get(id)?.length) return // ignore parents
    if (boardSort[status].mode === 'manual') {
      // Manual column: one fractional boardOrder between the slot's neighbours,
      // plus a logged status change if it crossed columns. boardOrder is written
      // raw (not loggable); status goes through logStatusChange so the move shows
      // in the card's change log (parity with the List status control).
      const order = orderForDrop(status, index, id)
      const crossed = t.status !== status
      void (async () => {
        if (order != null && order !== t.boardOrder)
          await db.tasks.update(id, { boardOrder: order })
        if (crossed) await logStatusChange(id, t.status, status)
      })()
      return
    }
    // Sorted column: a drop is manual intent. Reindex the whole column to its
    // current displayed (sorted) order with the card spliced in at the slot, then
    // flip the column to manual so that arrangement sticks and the card lands
    // exactly where dropped. (Fractional insert would be wrong here — the visible
    // neighbours' boardOrder isn't monotonic under a name/time sort.)
    const cur = byStatus[status]
    const rest = cur.filter((x) => x.id !== id)
    let pos = 0
    for (let i = 0; i < index && i < cur.length; i++) if (cur[i].id !== id) pos++
    rest.splice(Math.min(pos, rest.length), 0, t)
    void db
      .transaction('rw', db.tasks, async () => {
        for (let i = 0; i < rest.length; i++) {
          const x = rest[i]
          const changes: Partial<Task> = {}
          if (x.boardOrder !== i) changes.boardOrder = i
          if (x.id === id && t.status !== status) changes.status = status
          if (Object.keys(changes).length) await db.tasks.update(x.id, changes)
        }
      })
      // Flip to manual only AFTER the reindex commits, so the column doesn't briefly
      // re-sort stale boardOrder values (visible jump). Until then it stays in its
      // sorted mode showing the right order. The reindex already persisted the new
      // status (raw); logStatusChange then records the transition outside that
      // tasks-only transaction (calling it inside would nest a wider db.members
      // scope and throw — see design-docs/task-change-log.md).
      .then(() => {
        setColSort(status, { mode: 'manual', dir: 'asc' })
        if (t.status !== status) void logStatusChange(id, t.status, status)
      })
  }

  // Stable card drag handlers — they read the card's id/status/index from `data-*`
  // attributes on the DOM node instead of closing over the rendered values, so their
  // identity never changes. Combined with memo(BoardCard), a dragover only re-renders
  // the lightweight placeholder (DropSlot) — the cards themselves are NOT re-rendered
  // while moving. The DB is written only once, on drop (dropTo).
  const onCardDragStart = useCallback((e: React.DragEvent) => {
    // never start a card drag from an interactive control
    if ((e.target as HTMLElement).closest('button, select, input, a, label, [data-no-drag]')) {
      e.preventDefault()
      return
    }
    const el = e.currentTarget as HTMLElement
    const id = el.dataset.id
    if (!id) return
    const status = el.dataset.status as Status
    const index = Number(el.dataset.index)
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    if (BLANK_DRAG_IMG) e.dataTransfer.setDragImage(BLANK_DRAG_IMG, 0, 0)
    dragIdRef.current = id
    setDragId(id)
    setOver({ status, index }) // seed the slot at the origin (instant 1:1 swap)
  }, [])
  const onCardDragOver = useCallback((e: React.DragEvent) => {
    if (!dragIdRef.current) return
    e.preventDefault()
    e.stopPropagation() // beat the column-level append
    e.dataTransfer.dropEffect = 'move'
    // Stash the latest target; do the getBoundingClientRect + setOver once per frame.
    // dragover fires faster than the frame rate, and reading a rect right after the
    // previous frame mutated the DOM (slot moved) forces a synchronous reflow — so we
    // defer the read into rAF where layout has already settled, coalescing the burst.
    const el = e.currentTarget as HTMLElement
    pendingHit.current = {
      el,
      status: el.dataset.status as Status,
      base: Number(el.dataset.index),
      clientY: e.clientY,
    }
    if (overRaf.current) return
    overRaf.current = requestAnimationFrame(() => {
      overRaf.current = 0
      const h = pendingHit.current
      if (!h || !dragIdRef.current) return
      const r = h.el.getBoundingClientRect()
      const index = h.base + (h.clientY - r.top > r.height / 2 ? 1 : 0)
      setOver((prev) =>
        prev && prev.status === h.status && prev.index === index ? prev : { status: h.status, index }
      )
    })
  }, [])

  // Edge auto-scroll: dragging near the top/bottom edge scrolls the board's
  // scroll container (or the window) so long boards stay reachable even when the
  // cursor sits still. Also a dragend backstop so a hidden source can't get stuck.
  const gridRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!dragId) return
    const scroller = scrollableAncestor(gridRef.current)
    let y = 0
    let raf = 0
    const onOver = (e: DragEvent) => {
      y = e.clientY
      // float the lifted card under the cursor (offset so it isn't hidden by it)
      if (ghostRef.current && e.clientX)
        ghostRef.current.style.transform = `translate(${e.clientX - 24}px, ${e.clientY - 16}px)`
    }
    const tick = () => {
      const edge = 90
      const h = window.innerHeight
      const dy = y && y < edge ? -(edge - y) : y && y > h - edge ? y - (h - edge) : 0
      if (dy) {
        const step = Math.ceil(dy / 5)
        if (scroller) scroller.scrollTop += step
        else window.scrollBy(0, step)
      }
      raf = requestAnimationFrame(tick)
    }
    document.addEventListener('dragover', onOver)
    document.addEventListener('dragend', clearDrag)
    raf = requestAnimationFrame(tick)
    return () => {
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('dragend', clearDrag)
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId])

  if (!members)
    return <p className="text-ink-muted py-12 text-center">Loading…</p>

  return (
    <SprintRangeContext.Provider value={{ start: sprintStartDate, end: sprintEndDate }}>
    <div ref={gridRef} className="grid grid-cols-1 md:grid-cols-3 items-start gap-5 max-w-6xl">
      {STATUS_ORDER.map((status) => {
        const meta = STATUS_META[status]
        const list = byStatus[status]
        const isOver = over?.status === status && dragId !== null
        return (
          <section
            key={status}
            className={`flex flex-col gap-2.5 min-h-[200px] rounded-[14px] [contain:layout] ${
              isOver ? 'bg-accent/[0.05]' : ''
            }`}
            onDragOver={(e) => {
              if (!dragId) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              // Only seed on column-ENTER (default to end). Per-card onDragOver refines
              // the index; never re-set here, or hovering the slot/gap would bounce the
              // index back to the end → flicker loop.
              if (over?.status !== status) setOver({ status, index: list.length })
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/plain') || dragId
              const index = over?.status === status ? over.index : list.length
              if (id) handleDrop(status, id, index)
              clearDrag()
            }}
          >
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
              <SortMenu status={status} sort={boardSort[status]} onChange={setColSort} />
            </header>
            <div className="flex-1 flex flex-col gap-2.5">
              {list.length === 0 && !isOver && (
                <div className="text-[13px] text-ink-faint px-2 py-6 text-center">
                  No tasks
                </div>
              )}
              {list.map((t, i) => {
                const m = metaById.get(t.id)
                return (
                  <Fragment key={t.id}>
                    {isOver && over!.index === i && <DropSlot />}
                    <BoardCard
                      task={t}
                      member={
                        t.assigneeId ? membersById.get(t.assigneeId) ?? null : null
                      }
                      members={members}
                      tasksById={tasksById}
                      membersById={membersById}
                      plan={planById.get(t.id) ?? null}
                      displayStatus={m?.displayStatus ?? t.status}
                      group={m?.group ?? null}
                      parentTitle={m?.parentTitle ?? null}
                      index={i}
                      draggable={!m?.group}
                      dragging={dragId === t.id}
                      onDragStart={onCardDragStart}
                      onDragEnd={clearDrag}
                      onDragOver={onCardDragOver}
                      onCycleStatus={onCycleStatusId}
                    />
                  </Fragment>
                )
              })}
              {isOver && over!.index >= list.length && <DropSlot />}
              <AddTaskComposer
                projectId={projectId}
                sprintId={sprintId}
                sprintStartDate={sprintStartDate}
                status={status}
              />
            </div>
          </section>
        )
      })}
      {dragged && <DragGhost task={dragged} innerRef={ghostRef} />}
    </div>
    </SprintRangeContext.Provider>
  )
}

/**
 * Bottom-of-column "Add task" affordance (Variant A). Toggles between a blue ghost
 * button and an inline composer. Creates a leaf task via the SAME path as the List's
 * AddTaskRow (`uid()` + `nextSequence` + §5.3.1 defaults), but with `status` set to
 * this column's status. Enter creates + stays open (rapid entry); Esc / empty-blur close.
 */
function AddTaskComposer({
  projectId,
  sprintId,
  sprintStartDate,
  status,
}: {
  projectId: string
  sprintId: string
  sprintStartDate: string
  status: Status
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  const grow = () => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }
  const add = async () => {
    const t = title.trim()
    if (!t) return
    const seq = await nextSequence(sprintId)
    await db.tasks.add({
      id: uid(),
      projectId,
      sequence: seq,
      title: t,
      assigneeId: null,
      sprintId,
      status, // inherit the column's status
      priority: 'normal',
      startDate: sprintStartDate,
      dueDate: null,
      estimate: null,
      createdAt: Date.now(),
      dependsOn: [],
    })
    setTitle('') // keep the composer open + refocus for rapid entry
    requestAnimationFrame(() => {
      grow()
      taRef.current?.focus()
    })
  }
  const close = () => {
    setOpen(false)
    setTitle('')
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-0.5 flex w-full items-center gap-1.5 rounded-[10px] px-2.5 py-2 text-left text-[13.5px] font-medium text-accent transition hover:bg-accent/[0.08]"
      >
        <span className="text-[16px] leading-none">+</span> Add task
      </button>
    )
  }
  return (
    <div className="mt-0.5 rounded-[12px] bg-surface p-3 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_3px_10px_rgba(0,0,0,0.05)] ring-1 ring-accent">
      <textarea
        ref={taRef}
        autoFocus
        rows={1}
        value={title}
        placeholder="Task name…"
        onChange={(e) => {
          setTitle(e.target.value)
          grow()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void add()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
        // Blur closes only when empty (matches List: click-outside doesn't cancel a draft).
        // Cancel/Add use onMouseDown+preventDefault, so they never blur the textarea.
        onBlur={() => {
          if (!title.trim()) close()
        }}
        className="w-full resize-none break-words bg-transparent text-[14px] leading-snug text-ink outline-none placeholder:text-ink-faint"
      />
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-faint">
        <kbd className="rounded-[5px] bg-fill px-1.5 py-px font-semibold text-ink-muted">↵</kbd>
        <span>add</span>
        <kbd className="rounded-[5px] bg-fill px-1.5 py-px font-semibold text-ink-muted">esc</kbd>
        <span>cancel</span>
        <span className="flex-1" />
        <button
          onMouseDown={(e) => {
            e.preventDefault()
            close()
          }}
          className="rounded-[7px] px-2.5 py-1 text-[12px] font-semibold text-ink-muted transition hover:bg-fill"
        >
          Cancel
        </button>
        <button
          onMouseDown={(e) => {
            e.preventDefault()
            void add()
          }}
          disabled={!title.trim()}
          className="rounded-[7px] bg-accent px-3 py-1 text-[12px] font-semibold text-white transition disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  )
}

/** Small "layers" glyph marking a group card. */
function LayersGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      className="inline-block align-[-1px] mr-1 text-ink-faint"
      aria-hidden
    >
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  )
}

/** Nearest scrollable ancestor (vertical) of `el`, or null → use the window. */
function scrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let n = el?.parentElement ?? null
  while (n) {
    const oy = getComputedStyle(n).overflowY
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n
    n = n.parentElement
  }
  return null
}

/** Per-column sort control — the app's native-picker pattern (design-system §5.5,
 * same as the assignee/priority selects): a calm pill with a hidden <select> overlay
 * for the mode (Manual / Name / Time / Member), plus a small ▲/▼ ghost button shown
 * only when sorted to flip direction. Idle columns show just a faint ⇅ glyph so the
 * header stays quiet. No custom popover / outside-click handling — the OS owns the
 * dropdown (free keyboard nav, dark-safe via tokens). memo'd with stable props, so the
 * frequent re-renders during a card drag skip it — preserving the drag-perf work.
 * See design-docs/board-view.md. */
const SortMenu = memo(function SortMenu({
  status,
  sort,
  onChange,
}: {
  status: Status
  sort: ColSort
  onChange: (status: Status, next: ColSort) => void
}) {
  const active = sort.mode !== 'manual'
  return (
    <div className="flex items-center gap-1" data-no-drag>
      <span
        className={`relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] transition ${
          active
            ? 'text-accent border border-accent/35'
            : 'text-ink-faint hover:text-ink hover:bg-surface-hover'
        }`}
      >
        {active ? (
          <span className="font-medium">{SORT_LABELS[sort.mode]}</span>
        ) : (
          <ArrowUpDown size={13} strokeWidth={2} aria-hidden />
        )}
        <ChevronDown size={11} strokeWidth={2} className="text-ink-faint" aria-hidden />
        <select
          aria-label={`Sort ${status} column`}
          className="absolute inset-0 cursor-pointer opacity-0"
          value={sort.mode}
          onChange={(e) => {
            const mode = e.target.value as BoardSortMode
            onChange(status, { mode, dir: mode === 'manual' ? 'asc' : sort.dir })
          }}
        >
          {SORT_MODES.map((m) => (
            <option key={m} value={m}>
              {SORT_LABELS[m]}
            </option>
          ))}
        </select>
      </span>
      {active && (
        <button
          type="button"
          data-no-drag
          aria-label={`Sort direction: ${sort.dir === 'asc' ? 'ascending' : 'descending'}`}
          title="Toggle direction"
          onClick={() => onChange(status, { ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
          className="rounded-full p-1 text-accent leading-none transition hover:bg-surface-hover"
        >
          <span className="text-[10px] leading-none" aria-hidden>
            {sort.dir === 'asc' ? '▲' : '▼'}
          </span>
        </button>
      )}
    </div>
  )
})

/** Insertion gap shown while dragging — marks where the card will land. The card
 * content rides the cursor as a floating tilted ghost (<DragGhost>), not here. */
function DropSlot() {
  return (
    <div
      className="rounded-[12px] border-2 border-dashed border-accent/45 bg-accent/[0.06] h-[58px] pointer-events-none"
      aria-hidden
    />
  )
}

// Transparent 1×1 image → suppress the browser's default drag ghost so only our
// custom <DragGhost> shows. Created once at module load (browser-only SPA).
const BLANK_DRAG_IMG =
  typeof Image !== 'undefined'
    ? Object.assign(new Image(), {
        src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      })
    : null

/** The lifted card that follows the cursor while dragging — tilted, shadowed.
 * Positioned imperatively (transform) by the dragover listener for smoothness. */
const DragGhost = memo(function DragGhost({ task, innerRef }: { task: Task; innerRef: React.Ref<HTMLDivElement> }) {
  const meta = STATUS_META[task.status]
  return (
    <div
      ref={innerRef}
      className="fixed top-0 left-0 z-50 w-[272px] pointer-events-none will-change-transform"
      style={{ transform: 'translate(-1000px,-1000px)' }}
      aria-hidden
    >
      <div className="bg-surface rounded-[12px] p-3 rotate-[3deg] shadow-[0_14px_34px_rgba(0,0,0,0.24)] ring-1 ring-black/[0.04]">
        <div className="flex items-start gap-2.5">
          <span className="w-[18px] h-[18px] shrink-0 mt-0.5" style={{ color: meta.varName }}>
            <StatusIcon status={task.status} />
          </span>
          <div className="flex-1 min-w-0 text-[14px] leading-snug break-words text-ink">
            {task.title || <span className="text-ink-faint italic">Untitled</span>}
          </div>
        </div>
        <div className="mt-2.5 text-[11.5px] text-ink-faint tab-data">#{task.sequence}</div>
      </div>
    </div>
  )
})

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  )
}
function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  )
}

/** Toolbar assign button: a person icon with an overlaid native member <select>
 * (same mechanism as the List AssigneePicker — clicking opens the native menu). */
function MemberMenu({
  task,
  members,
  onChange,
}: {
  task: Task
  members: Member[]
  onChange: (id: string | null) => void
}) {
  return (
    <label
      className="relative w-[26px] h-[26px] rounded-[6px] flex items-center justify-center text-ink-muted hover:bg-fill hover:text-accent transition cursor-pointer"
      title="Assign member"
    >
      <UserIcon />
      <select
        value={task.assigneeId ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
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

/** Quick date editor popover: Start + End, reusing the List's DatePickCell and
 * its exact lock rules so the Board can't override the auto-scheduler. */
function DatePopover({
  task,
  tasksById,
  membersById,
}: {
  task: Task
  tasksById: Map<string, Task>
  membersById: Map<string, Member>
}) {
  const plan = computeWorkingPlan(task, tasksById, membersById)
  const startLocked = task.dependsOn.length > 0
  const endLocked = task.dependsOn.length > 0 || (task.estimate !== null && task.estimate > 0)
  const assigneeDaysOff = task.assigneeId ? membersById.get(task.assigneeId)?.daysOff : undefined
  return (
    <div className="absolute top-[42px] right-2 z-30 w-[232px] rounded-[13px] border border-border-hair bg-surface p-2 shadow-[0_8px_30px_rgba(0,0,0,0.18)]">
      <div className="text-[11px] font-bold uppercase tracking-[0.04em] text-ink-faint px-1.5 pt-0.5 pb-1.5">
        Schedule
      </div>
      <div className="flex items-center gap-2 px-1 mb-1">
        <span className="text-[12px] text-ink-muted w-9">Effort</span>
        <div className="flex-1 flex items-center gap-1 rounded-md border border-border px-2 h-8">
          <EffortCell
            value={task.estimate}
            onChange={async (v) => {
              await updateTask(task.id, { estimate: v })
              await recomputeDates(task.id)
            }}
          />
          <span className="text-[11px] text-ink-faint shrink-0">days</span>
        </div>
      </div>
      <div className="flex items-center gap-2 px-1">
        <span className="text-[12px] text-ink-muted w-9">Start</span>
        <div className="flex-1 text-left">
          <DatePickCell
            value={plan.startDate}
            time={plan.startTime}
            locked={startLocked}
            ariaLabel="Start date"
            daysOff={assigneeDaysOff}
            onChange={async (v) => {
              await updateTask(task.id, { startDate: v })
              await recomputeDates(task.id)
            }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 px-1 mt-1">
        <span className="text-[12px] text-ink-muted w-9">End</span>
        <div className="flex-1 text-left">
          <DatePickCell
            value={plan.dueDate}
            time={plan.endTime}
            locked={endLocked}
            ariaLabel="Due date"
            daysOff={assigneeDaysOff}
            onChange={(v) => updateTask(task.id, { dueDate: v })}
          />
        </div>
      </div>
      {(startLocked || endLocked) && (
        <p className="text-[11px] leading-snug text-ink-faint px-1.5 pt-2">
          Locked fields are computed from prerequisites/effort — edit those in the list.
        </p>
      )}
    </div>
  )
}

const PRIO_TAG: Record<string, { label: string; bg: string; fg: string }> = {
  urgent: { label: 'Urgent', bg: 'rgba(255,59,48,0.12)', fg: '#d70015' },
  high: { label: 'High', bg: 'rgba(255,149,0,0.15)', fg: '#b25e00' },
}

// Wrapped in memo so the per-dragover re-renders of BoardView don't re-render every
// card. All props are passed with stable identity (callbacks via useCallback; `group`
// via the memoized metaById), so a card whose data is unchanged skips rendering during
// a drag — only the dragged card (its `dragging` flips) and the placeholder move.
const BoardCard = memo(function BoardCard({
  task,
  member,
  members,
  tasksById,
  membersById,
  plan,
  displayStatus,
  group,
  parentTitle,
  index,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onCycleStatus,
}: {
  task: Task
  member: Member | null
  members: Member[]
  tasksById: Map<string, Task>
  membersById: Map<string, Member>
  plan: ReturnType<typeof computeWorkingPlan> | null
  displayStatus: Status
  group: { done: number; total: number; range: string | null } | null
  parentTitle: string | null
  index: number
  draggable: boolean
  dragging: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onCycleStatus: (id: string) => void
}) {
  const meta = STATUS_META[displayStatus]
  const prio = PRIO_TAG[task.priority ?? 'none']
  const isParent = group !== null
  const [dateOpen, setDateOpen] = useState(false)

  // Due chip — uses the live computed plan (date + time, e.g. "Jun 11, 17:00"),
  // consistent with the List/Timeline. Soft-tinted by urgency via tokens (dark-safe).
  const due = (() => {
    if (isParent || !plan?.dueDate) return null
    const dd = plan.dueDate
    const c =
      displayStatus === 'done'
        ? 'var(--color-status-done)'
        : (() => {
            const days = (new Date(dd).getTime() - Date.now()) / 86400000
            if (days < 0) return 'var(--color-priority-urgent)'
            if (days < 3) return 'var(--color-priority-high)'
            return 'var(--color-ink-faint)'
          })()
    return {
      bg: `color-mix(in srgb, ${c} 13%, transparent)`,
      fg: `color-mix(in srgb, ${c} 100%, #000 25%)`,
      label: plan.endTime ? `${formatShortDate(dd)}, ${plan.endTime}` : formatShortDate(dd),
      title: `Due ${dd}${plan.endTime ? ' ' + plan.endTime : ''}`,
    }
  })()

  return (
    <article
      data-id={task.id}
      data-status={displayStatus}
      data-index={index}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      className={`group relative bg-surface rounded-[12px] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_3px_10px_rgba(0,0,0,0.05)] hover:shadow-[0_2px_4px_rgba(0,0,0,0.06),0_10px_24px_rgba(0,0,0,0.08)] transition ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${dragging ? 'hidden' : ''}`}
    >
      {/* hover quick-edit toolbar — leaf tasks only (groups are derived containers) */}
      {!isParent && (
        <div
          className={`absolute top-2 right-2 z-20 ${
            dateOpen ? 'flex' : 'hidden group-hover:flex'
          } items-center gap-0.5 rounded-[9px] border border-border-hair bg-surface p-0.5 shadow-[0_4px_14px_rgba(0,0,0,0.12)]`}
        >
          <MemberMenu
            task={task}
            members={members}
            onChange={async (id) => {
              await updateTask(task.id, { assigneeId: id })
              await recomputeDates(task.id)
            }}
          />
          <button
            onClick={() => setDateOpen((v) => !v)}
            className={`w-[26px] h-[26px] rounded-[6px] flex items-center justify-center transition ${
              dateOpen ? 'bg-fill text-accent' : 'text-ink-muted hover:bg-fill hover:text-accent'
            }`}
            title="Effort & dates"
            aria-label="Effort and dates"
          >
            <CalendarIcon />
          </button>
        </div>
      )}
      {dateOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={() => setDateOpen(false)}
          />
          <DatePopover task={task} tasksById={tasksById} membersById={membersById} />
        </>
      )}
      <div className="flex items-start gap-2.5">
        {isParent ? (
          <span
            className="w-[18px] h-[18px] shrink-0 mt-0.5 flex items-center justify-center"
            style={{ color: meta.varName }}
            title={`${meta.label} — group status (derived from children)`}
            aria-label={`Group status: ${meta.label}`}
          >
            <StatusIcon status={displayStatus} />
          </span>
        ) : (
          <button
            onClick={() => onCycleStatus(task.id)}
            className="w-[18px] h-[18px] shrink-0 mt-0.5 transition hover:scale-110 flex items-center justify-center"
            style={{ color: meta.varName }}
            title={`${meta.label} — click to cycle`}
            aria-label={`Status: ${meta.label}`}
          >
            <StatusIcon status={displayStatus} />
          </button>
        )}
        <div
          className={`flex-1 min-w-0 text-[14px] leading-snug break-words ${
            isParent ? 'font-semibold text-ink' : displayStatus === 'done' ? 'text-ink-faint' : 'text-ink'
          }`}
        >
          {isParent && <LayersGlyph />}
          {task.title || <span className="text-ink-faint italic">Untitled</span>}
          {!isParent && (
            <span className="inline-flex align-middle ml-1">
              <ChangeLogTooltip entries={task.changeLog} />
            </span>
          )}
        </div>
      </div>
      {group && (
        <div
          className="mt-2.5 h-[5px] rounded-full overflow-hidden bg-fill"
          title={`${group.done}/${group.total} done`}
        >
          <span
            className="block h-full rounded-full"
            style={{
              width: `${group.total ? (group.done / group.total) * 100 : 0}%`,
              background: meta.varName,
            }}
          />
        </div>
      )}
      <div className="flex items-center gap-2 mt-2.5 text-[11.5px] flex-wrap">
        <span className="text-ink-faint tab-data">#{task.sequence}</span>
        {group && (
          <>
            <span className="text-ink-faint font-medium tab-data" title="Group progress">
              {group.done}/{group.total}
            </span>
            {group.range && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full font-medium tab-data bg-fill text-ink-muted"
                title="Group span (rolled up from children)"
              >
                {group.range}
              </span>
            )}
          </>
        )}
        {parentTitle && (
          <span
            className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-ink-faint bg-fill max-w-[150px]"
            title={`In group: ${parentTitle}`}
          >
            <span aria-hidden>↳</span>
            <span className="truncate">{parentTitle}</span>
          </span>
        )}
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
            title={due.title}
          >
            {due.label}
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
})
