import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Users, MoreHorizontal, AlertTriangle, CalendarOff } from 'lucide-react'
import {
  db,
  colorForName,
  renamePerson,
  recolorPerson,
  mergePeople,
  type Project,
  type Task,
  type Person,
} from './db'
import { Avatar, ColorSwatchRow } from './members'
import { useConfirm } from './ConfirmDialog'
import {
  latestActiveSprint,
  formatSprintRange,
  formatShortDate,
  todayLocalISO,
  firstGrapheme,
} from './lib'
import { personLoad, personProjectCount, nextDayOff, taskOverdue } from './people'

// Read-first portfolio overview: every project's active-sprint status + a
// cross-project People roster. See design-docs/home-dashboard.md.

// Loading-state fallbacks for the live queries — module-level so their identity
// never changes (a fresh `[]` per render would defeat the memos below).
const EMPTY_SPRINTS: never[] = []
const EMPTY_TASKS: never[] = []
const EMPTY_MEMBERS: never[] = []
const EMPTY_PEOPLE: never[] = []

interface RosterEntry {
  person: Person
  load: { taskCount: number; effort: number }
  projectCount: number
  off: string | null
  projColors: string[]
}

export function HomeDashboard({
  projects,
  onOpenProject,
}: {
  projects: Project[]
  onOpenProject: (id: string) => void
}) {
  // Stable `?? EMPTY` fallbacks (not fresh `[]`) so the memos below don't see a
  // new array identity on every render while the live queries are still loading.
  const sprints = useLiveQuery(() => db.sprints.toArray(), []) ?? EMPTY_SPRINTS
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) ?? EMPTY_TASKS
  const members = useLiveQuery(() => db.members.toArray(), []) ?? EMPTY_MEMBERS
  const people = useLiveQuery(() => db.people.toArray(), []) ?? EMPTY_PEOPLE
  const today = todayLocalISO()

  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  )

  // Both scans below are O(projects × tasks) and the dashboard re-renders on
  // every live-query tick, so they're memoized on the tables they read.
  const cards = useMemo(() => {
    // A task is a leaf unless some other task names it as parent (parents are
    // excluded from progress/overdue so a group isn't double-counted).
    const parentIds = new Set<string>()
    for (const t of tasks) if (t.parentId) parentIds.add(t.parentId)
    const isLeaf = (t: Task) => !parentIds.has(t.id)

    return projects.map((p) => {
      const pSprints = sprints
        .filter((s) => s.projectId === p.id)
        .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))
      const active = latestActiveSprint(pSprints)
      let total = 0
      let done = 0
      if (active) {
        for (const t of tasks) {
          if (t.sprintId === active.id && isLeaf(t)) {
            total++
            if (t.status === 'done') done++
          }
        }
      }
      const pct = total ? Math.round((done / total) * 100) : 0
      const overdue = tasks.filter(
        (t) => t.projectId === p.id && isLeaf(t) && taskOverdue(t, today)
      ).length
      const pMembers = members
        .filter((m) => m.projectId === p.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      return { p, active, total, pct, remaining: total - done, overdue, pMembers }
    })
  }, [projects, sprints, tasks, members, today])

  const roster: RosterEntry[] = useMemo(() => {
    const projColor = (pid: string) => {
      const pr = projectsById.get(pid)
      return pr ? pr.color ?? colorForName(pr.name) : 'var(--color-status-todo)'
    }
    return people
      .map((person) => ({ person, pm: members.filter((m) => m.personId === person.id) }))
      .filter((r) => r.pm.length > 0) // zero-member people are kept in db but hidden
      .map(({ person, pm }) => {
        const memberIds = new Set(pm.map((m) => m.id))
        return {
          person,
          load: personLoad(memberIds, tasks),
          projectCount: personProjectCount(pm),
          off: nextDayOff(pm, today),
          projColors: [...new Set(pm.map((m) => m.projectId))].map(projColor),
        }
      })
      .sort(
        (a, b) =>
          b.load.taskCount - a.load.taskCount ||
          b.load.effort - a.load.effort ||
          a.person.name.localeCompare(b.person.name)
      )
  }, [people, members, tasks, projectsById, today])

  if (projects.length === 0) {
    return (
      <div className="flex-1 min-w-0 overflow-auto bg-canvas">
        <div className="h-full flex flex-col items-center justify-center text-center px-6">
          <div className="text-[17px] font-semibold text-ink">No projects yet</div>
          <div className="text-[13.5px] text-ink-muted mt-1.5 max-w-xs">
            Create your first project with the <span className="font-semibold">＋</span> tile in the
            rail to start planning.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0 overflow-auto bg-canvas">
      <div className="px-7 pt-6 pb-12 max-w-[1400px]">
        <header className="mb-5">
          <h1 className="text-[26px] font-bold text-ink tracking-[-0.022em]">Overview</h1>
          <div className="text-[13px] text-ink-muted mt-0.5 tabular-nums">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'} ·{' '}
            {roster.length} {roster.length === 1 ? 'person' : 'people'}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
          {/* Projects grid — the hero */}
          <section className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(248px,1fr))]">
            {cards.map(({ p, active, total, pct, remaining, overdue, pMembers }) => {
              const isEmoji = !!p.icon
              const label = p.icon || p.name.trim().charAt(0).toUpperCase() || '·'
              return (
                <button
                  key={p.id}
                  onClick={() => onOpenProject(p.id)}
                  className="group text-left bg-surface rounded-[14px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.06),0_14px_32px_rgba(0,0,0,0.09)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <div className="flex items-center gap-2.5 mb-3">
                    <span
                      className={`shrink-0 w-[30px] h-[30px] rounded-[8px] flex items-center justify-center text-white font-semibold ${
                        isEmoji ? 'text-[16px]' : 'text-[14px]'
                      }`}
                      style={{ background: p.color ?? colorForName(p.name) }}
                    >
                      {label}
                    </span>
                    <span className="flex-1 min-w-0 text-[15.5px] font-semibold tracking-[-0.01em] text-ink truncate">
                      {p.name}
                    </span>
                    {overdue > 0 && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-priority-urgent bg-priority-urgent/10 rounded-full px-2 py-[3px] tabular-nums">
                        <AlertTriangle size={11} strokeWidth={2.4} />
                        {overdue}
                      </span>
                    )}
                  </div>

                  {active ? (
                    <div className="text-[13px] text-ink-muted flex items-baseline gap-1.5 mb-2.5">
                      <span className="font-medium text-ink truncate">{active.name}</span>
                      <span className="text-[12px] text-ink-faint tabular-nums shrink-0">
                        {formatSprintRange(active.startDate, active.endDate)}
                      </span>
                    </div>
                  ) : (
                    <div className="text-[13px] text-ink-faint italic mb-2.5">No active sprint</div>
                  )}

                  <div className="flex items-center justify-between text-[12.5px] text-ink-muted mb-1.5 tabular-nums">
                    <span>
                      {active ? (
                        <>
                          <b className="text-ink font-semibold">{pct}%</b> done
                        </>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </span>
                    {active && total > 0 && <span>{remaining} left</span>}
                  </div>
                  <div className="h-[6px] rounded-full bg-[var(--color-canvas-sunk)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-status-done transition-[width] duration-300 ease-[cubic-bezier(.32,.72,0,1)]"
                      style={{ width: `${active && total ? pct : 0}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between mt-3.5">
                    <div className="flex">
                      {pMembers.slice(0, 5).map((m, i) => (
                        <Avatar
                          key={m.id}
                          member={m}
                          size={24}
                          className={i > 0 ? '-ml-[7px]' : ''}
                        />
                      ))}
                    </div>
                    <span className="text-[12px] text-ink-faint tabular-nums">
                      {pMembers.length} {pMembers.length === 1 ? 'member' : 'members'}
                    </span>
                  </div>
                </button>
              )
            })}
          </section>

          {/* People roster — the support panel (right rail; stacks below < lg) */}
          <aside className="bg-surface rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="flex items-center gap-2 text-[15.5px] font-semibold tracking-[-0.01em] text-ink">
                <Users size={16} className="text-ink-faint" />
                People
              </h2>
              <span className="text-[12px] text-ink-faint tabular-nums">
                {roster.length} · by load
              </span>
            </div>
            {roster.length === 0 ? (
              <div className="px-4 py-5 text-[13px] text-ink-faint italic">No people yet.</div>
            ) : (
              roster.map((r) => <PersonRow key={r.person.id} entry={r} allPeople={people} />)
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

const MENU_W = 248

function PersonRow({ entry, allPeople }: { entry: RosterEntry; allPeople: Person[] }) {
  const { person, load, projectCount, off, projColors } = entry
  const [menu, setMenu] = useState(false)
  const [name, setName] = useState(person.name)
  const others = allPeople.filter((p) => p.id !== person.id)
  const confirm = useConfirm()
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  // The People panel has `overflow-hidden` (rounded corners), so an absolutely
  // positioned popover inside it gets CLIPPED. Portal it to <body> and pin it to
  // the trigger's screen rect — same idiom as MemberDaysOffButton/CalendarPopover.
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })

  useEffect(() => {
    if (!menu) return
    const pin = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      // Right-align to the trigger, clamped into the viewport.
      let left = Math.min(r.right - MENU_W, window.innerWidth - 8 - MENU_W)
      left = Math.max(8, left)
      // Below by default; flip above if it would overflow the bottom edge.
      const h = popRef.current?.offsetHeight ?? 280
      let top = r.bottom + 6
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 6 - h)
      setPos({ top, left })
    }
    pin()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (
        popRef.current && !popRef.current.contains(t) &&
        btnRef.current && !btnRef.current.contains(t)
      ) {
        setMenu(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false)
    }
    window.addEventListener('scroll', pin, true)
    window.addEventListener('resize', pin)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', pin, true)
      window.removeEventListener('resize', pin)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <div className="group/row flex items-center gap-3 px-4 py-3 border-b border-border-hair last:border-b-0">
      <span
        className="shrink-0 w-[34px] h-[34px] rounded-full inline-flex items-center justify-center text-white text-[14px] font-semibold select-none"
        style={{ background: person.color || colorForName(person.name) }}
      >
        {firstGrapheme(person.name).toUpperCase() || '·'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-ink truncate">{person.name}</div>
        <div className="text-[12.5px] text-ink-muted mt-px tabular-nums">
          <b className="text-ink font-semibold">{load.taskCount} task{load.taskCount === 1 ? '' : 's'}</b>
          {' · '}
          {load.effort}d
        </div>
        <div className="text-[11.5px] text-ink-faint mt-0.5 flex items-center gap-1.5 min-w-0">
          <span className="flex shrink-0">
            {projColors.slice(0, 6).map((c, i) => (
              <span
                key={i}
                className={`w-[9px] h-[9px] rounded-full ring-[1.5px] ring-surface ${i > 0 ? '-ml-[3px]' : ''}`}
                style={{ background: c }}
              />
            ))}
          </span>
          <span className="shrink-0 tabular-nums">
            in {projectCount} {projectCount === 1 ? 'project' : 'projects'}
          </span>
          <span className="text-ink-faint/60">·</span>
          {off ? (
            <span className="text-priority-high truncate tabular-nums">off {formatShortDate(off)}</span>
          ) : (
            <span className="inline-flex items-center gap-1 truncate">
              <CalendarOff size={11} /> no days off
            </span>
          )}
        </div>
      </div>
      <button
        ref={btnRef}
        onClick={() => {
          setName(person.name)
          setMenu((v) => !v)
        }}
        title="Rename · recolor · merge"
        aria-label={`Manage ${person.name}`}
        className={`shrink-0 w-7 h-7 rounded-md inline-flex items-center justify-center transition ${
          menu
            ? 'text-accent bg-accent-soft'
            : 'text-ink-faint opacity-0 group-hover/row:opacity-100 hover:text-ink hover:bg-surface-hover'
        }`}
      >
        <MoreHorizontal size={16} />
      </button>

      {menu &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_W }}
            className="z-50 bg-surface rounded-[12px] border border-border-hair shadow-[0_12px_40px_rgba(0,0,0,0.18)] p-3"
          >
            <label className="block text-[11px] font-semibold text-ink-faint mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => renamePerson(person.id, name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  renamePerson(person.id, name)
                  setMenu(false)
                }
                if (e.key === 'Escape') setMenu(false)
              }}
              className="w-full text-[13.5px] text-ink bg-canvas rounded-[8px] px-2.5 py-1.5 border border-border focus:outline-none focus:border-accent"
            />
            <label className="block text-[11px] font-semibold text-ink-faint mt-3 mb-1.5">Color</label>
            <ColorSwatchRow value={person.color} onPick={(c) => recolorPerson(person.id, c)} />
            {others.length > 0 && (
              <>
                <label className="block text-[11px] font-semibold text-ink-faint mt-3 mb-1">
                  Merge into…
                </label>
                <div className="max-h-[148px] overflow-auto -mx-1 px-1">
                  {others.map((o) => (
                    <button
                      key={o.id}
                      onClick={async () => {
                        // Merge is irreversible (no split) — confirm first
                        // (design-system §6.4: confirm before destructive).
                        if (
                          !(await confirm({
                            title: 'Merge people?',
                            message: `“${person.name}” will be merged into “${o.name}” — their project memberships move over and “${person.name}” is removed. This can’t be undone.`,
                            confirmLabel: 'Merge',
                          }))
                        )
                          return
                        await mergePeople(person.id, o.id)
                        setMenu(false)
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-left hover:bg-surface-hover transition"
                    >
                      <span
                        className="shrink-0 w-5 h-5 rounded-full inline-flex items-center justify-center text-white text-[10px] font-semibold"
                        style={{ background: o.color || colorForName(o.name) }}
                      >
                        {firstGrapheme(o.name).toUpperCase() || '·'}
                      </span>
                      <span className="text-[13px] text-ink truncate">{o.name}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-ink-faint mt-1.5 leading-snug">
                  Moves {person.name}'s memberships into the chosen person.
                </p>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
