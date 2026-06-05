import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Download,
  Upload,
  Moon,
  Sun,
  Search,
  ArrowRightCircle,
  List,
  LayoutGrid,
  GanttChartSquare,
  Star,
  Plus,
  Settings,
} from 'lucide-react'
import {
  db,
  uid,
  colorForName,
  exportAll,
  importAll,
  seedIfEmpty,
  dedupeSprints,
  recomputeAllDates,
  moveUnfinishedToNextSprint,
  createProject,
  type Project,
  type Sprint,
  type Task,
  type ExportPayload,
} from './db'
import { SprintView } from './SprintView'
import { BoardView } from './BoardView'
import { GanttView } from './GanttView'
import { ProjectSettingsView } from './ProjectSettingsView'
import { DateField } from './DatePicker'
import { formatSprintRange, useDarkMode } from './lib'

const CURRENT_PROJECT_KEY = 'plan-up:currentProjectId'
const VIEW_KEY = 'plan-up:view'
type ViewMode = 'list' | 'board' | 'timeline'

function App() {
  const [seedError, setSeedError] = useState<string | null>(null)
  const [seeded, setSeeded] = useState(false)
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(
    () => localStorage.getItem(CURRENT_PROJECT_KEY)
  )
  const setCurrentProjectId = (id: string | null) => {
    setCurrentProjectIdState(id)
    if (id) localStorage.setItem(CURRENT_PROJECT_KEY, id)
    else localStorage.removeItem(CURRENT_PROJECT_KEY)
  }
  const [currentSprintId, setCurrentSprintId] = useState<string | null>(null)
  const [view, setViewState] = useState<ViewMode>(() => {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'board' ? 'board' : v === 'timeline' ? 'timeline' : 'list'
  })
  const setView = (v: ViewMode) => {
    setViewState(v)
    localStorage.setItem(VIEW_KEY, v)
  }
  const [showNewSprint, setShowNewSprint] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dark, setDark] = useDarkMode()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Resizable sprint panel. Width persisted across sessions; the icon rail
  // (58px) sits to its left, so a drag maps to clientX - 58, clamped.
  const SIDEBAR_MIN = 200
  const SIDEBAR_MAX = 460
  const RAIL_W = 58
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const s = Number(localStorage.getItem('plan-up:sidebarWidth'))
    return s >= SIDEBAR_MIN && s <= SIDEBAR_MAX ? s : 248
  })
  useEffect(() => {
    localStorage.setItem('plan-up:sidebarWidth', String(sidebarWidth))
  }, [sidebarWidth])
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX - RAIL_W))
      setSidebarWidth(w)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    seedIfEmpty()
      .then(() => dedupeSprints())
      .then((removed) => {
        if (removed > 0) {
          console.info(
            `[plan-up] cleaned up ${removed} duplicate sprint${removed === 1 ? '' : 's'} (legacy seed-race artifact)`
          )
        }
        setSeeded(true)
      })
      // Heal any stored task dates that drifted out of sync (e.g. computed
      // under an older off-day state). Runs in the background after seeding;
      // liveQuery picks up the corrected rows.
      .then(() => recomputeAllDates())
      .then((healed) => {
        if (healed > 0) {
          console.info(
            `[plan-up] healed ${healed} task date${healed === 1 ? '' : 's'} that were out of sync`
          )
        }
      })
      .catch((e: unknown) =>
        setSeedError(e instanceof Error ? e.message : String(e))
      )
  }, [])

  const projects = useLiveQuery<Project[]>(
    () =>
      seeded
        ? db.projects.orderBy('createdAt').toArray()
        : Promise.resolve([] as Project[]),
    [seeded]
  )

  // Resolve current project: stored choice if still valid, else the first.
  // When the last project is deleted, clear the selection so the UI shows a
  // proper zero-project empty state instead of a stale (deleted) project.
  useEffect(() => {
    if (!projects) return
    if (projects.length === 0) {
      if (currentProjectId) setCurrentProjectId(null)
      return
    }
    if (!currentProjectId || !projects.some((p) => p.id === currentProjectId)) {
      setCurrentProjectId(projects[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects])

  const sprints = useLiveQuery<Sprint[]>(
    () =>
      seeded && currentProjectId
        ? db.sprints
            .where('projectId')
            .equals(currentProjectId)
            .sortBy('startDate')
        : Promise.resolve([] as Sprint[]),
    [seeded, currentProjectId]
  )

  const tasks = useLiveQuery<Task[]>(
    () =>
      currentSprintId
        ? db.tasks.where('sprintId').equals(currentSprintId).toArray()
        : Promise.resolve([] as Task[]),
    [currentSprintId]
  )

  // Per-sprint task counts for the sidebar panel.
  const projectTasks = useLiveQuery<Task[]>(
    () =>
      seeded && currentProjectId
        ? db.tasks.where('projectId').equals(currentProjectId).toArray()
        : Promise.resolve([] as Task[]),
    [seeded, currentProjectId]
  )
  const sprintTaskCounts = useMemo(() => {
    const counts = new Map<string, { total: number; done: number }>()
    for (const t of projectTasks ?? []) {
      const c = counts.get(t.sprintId) ?? { total: 0, done: 0 }
      c.total++
      if (t.status === 'done') c.done++
      counts.set(t.sprintId, c)
    }
    return counts
  }, [projectTasks])

  // When project changes (or first loads), reset sprint to latest in project.
  useEffect(() => {
    if (!sprints) return
    if (sprints.length === 0) {
      setCurrentSprintId(null)
      return
    }
    if (!currentSprintId || !sprints.some((s) => s.id === currentSprintId)) {
      setCurrentSprintId(sprints[sprints.length - 1].id)
    }
  }, [sprints, currentSprintId])

  // Keyboard shortcuts: / focus search, n new sprint, esc clears search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inField =
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

      if (e.key === 'Escape') {
        // Settings takes priority over clearing search.
        if (settingsOpen) {
          setSettingsOpen(false)
          return
        }
        if (search) {
          setSearch('')
          ;(t as HTMLInputElement)?.blur?.()
        }
        return
      }
      if (inField) return
      if (e.key === '/') {
        if (settingsOpen) return // search box is hidden while in settings
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        if (settingsOpen) return // don't stack a dialog over settings
        e.preventDefault()
        setShowNewSprint(true)
      } else if (e.key === 'd' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault()
        setDark(!dark)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [search, dark, setDark, settingsOpen])

  if (seedError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-canvas text-ink">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">Storage unavailable</h1>
          <p className="text-sm text-ink-muted">
            This app stores data in IndexedDB. Your browser blocked it — usually
            this happens in private/incognito mode or with strict tracking
            protection. Try a normal window.
          </p>
          <pre className="text-xs text-red-600 bg-red-50 dark:bg-red-950/40 p-2 rounded">
            {seedError}
          </pre>
        </div>
      </div>
    )
  }

  const handleExport = async () => {
    const data = await exportAll()
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `plan-up-${data.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportClick = () => fileInputRef.current?.click()
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!confirm('Import will REPLACE all current data. Continue?')) return
    try {
      const text = await file.text()
      const data = JSON.parse(text) as ExportPayload
      await importAll(data)
      alert('Import successful.')
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const currentSprint = sprints?.find((s) => s.id === currentSprintId) ?? null
  const currentProject =
    projects?.find((p) => p.id === currentProjectId) ?? null
  const nextSprint = useMemo(() => {
    if (!sprints || !currentSprint) return null
    const idx = sprints.findIndex((s) => s.id === currentSprint.id)
    return idx >= 0 && idx < sprints.length - 1 ? sprints[idx + 1] : null
  }, [sprints, currentSprint])
  const unfinishedCount = useMemo(
    () => (tasks ?? []).filter((t) => t.status !== 'done').length,
    [tasks]
  )

  const rollover = async () => {
    if (!currentSprint || !nextSprint || unfinishedCount === 0) return
    const ok = confirm(
      `Move ${unfinishedCount} unfinished task${
        unfinishedCount === 1 ? '' : 's'
      } from "${currentSprint.name}" to "${nextSprint.name}"?`
    )
    if (!ok) return
    const result = await moveUnfinishedToNextSprint(currentSprint.id)
    if (result.targetSprintId) {
      setCurrentSprintId(result.targetSprintId)
    }
  }

  const capacity = useMemo(() => {
    const all = tasks ?? []
    // Leaf-based: a parent (task with children) is a container, excluded so its
    // work isn't double-counted with its children. See design-docs/task-groups.md.
    const parentIds = new Set(all.filter((x) => x.parentId).map((x) => x.parentId))
    const t = all.filter((x) => !parentIds.has(x.id))
    const total = t.length
    const assigned = t.filter((x) => x.assigneeId !== null).length
    const notEstimated = t.filter((x) => x.estimate === null).length
    const done = t.filter((x) => x.status === 'done').length
    return {
      total,
      assigned,
      notEstimated,
      done,
      pctAssigned: total === 0 ? 0 : Math.round((assigned / total) * 100),
      pctDone: total === 0 ? 0 : Math.round((done / total) * 100),
    }
  }, [tasks])

  return (
    <div className="h-screen flex bg-canvas text-ink overflow-hidden">
      {/* Icon rail: macOS vibrancy. Squircle app-icon tiles, accent ring on active. */}
      <aside className="vibrancy w-[58px] shrink-0 border-r border-border-hair flex flex-col items-center py-3.5 gap-2.5">
        {projects?.map((p) => {
          const isActive = p.id === currentProjectId
          const initial = p.name.trim().charAt(0).toUpperCase() || '·'
          return (
            <button
              key={p.id}
              onClick={() => setCurrentProjectId(p.id)}
              title={p.name}
              className={`w-[36px] h-[36px] rounded-[10px] flex items-center justify-center text-white text-[15px] font-semibold transition ${
                isActive
                  ? 'shadow-[0_0_0_2.5px_var(--color-accent),0_2px_5px_rgba(0,0,0,0.14)]'
                  : 'opacity-80 hover:opacity-100'
              }`}
              style={{
                background: p.color ?? colorForName(p.name),
                letterSpacing: '-0.01em',
              }}
            >
              {initial}
            </button>
          )
        })}
        <button
          onClick={() => setShowNewProject(true)}
          title="New project"
          className="w-[36px] h-[36px] rounded-[10px] text-ink-faint hover:text-accent hover:bg-surface-hover flex items-center justify-center transition"
        >
          <Plus size={18} strokeWidth={2} />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setDark(!dark)}
          title={dark ? 'Switch to light' : 'Switch to dark'}
          className="w-[36px] h-[36px] rounded-[10px] text-ink-faint hover:text-ink hover:bg-surface-hover flex items-center justify-center transition"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </aside>

      {/* Secondary panel: macOS vibrancy sidebar, accent-filled active row */}
      <aside
        className="vibrancy shrink-0 border-r border-border-hair flex flex-col overflow-hidden relative"
        style={{ width: sidebarWidth }}
      >
        {currentProject ? (
          <>
            <div className="px-[18px] pt-[18px] pb-3">
              <div className="flex items-center gap-2">
                <div className="text-[21px] font-bold text-ink truncate tracking-[-0.022em] flex-1 min-w-0">
                  {currentProject.name}
                </div>
                <button
                  onClick={() => setSettingsOpen((v) => !v)}
                  title="Project settings"
                  aria-label="Project settings"
                  aria-pressed={settingsOpen}
                  className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md transition ${
                    settingsOpen
                      ? 'text-accent bg-accent-soft'
                      : 'text-ink-faint hover:text-ink hover:bg-surface-hover'
                  }`}
                >
                  <Settings size={16} />
                </button>
              </div>
              <div className="text-[12.5px] text-ink-faint mt-1">
                <span className="tab-data">{sprints?.length ?? 0}</span> sprint
                {(sprints?.length ?? 0) === 1 ? '' : 's'} ·{' '}
                <span className="tab-data">{projectTasks?.length ?? 0}</span>{' '}
                task{(projectTasks?.length ?? 0) === 1 ? '' : 's'}
              </div>
            </div>
            <div className="flex items-center justify-between px-[18px] pt-2 pb-1.5">
              <span className="text-[12px] font-semibold text-ink-faint">
                Sprints
              </span>
              <button
                onClick={() => setShowNewSprint(true)}
                title="New sprint (n)"
                className="inline-flex items-center text-accent hover:bg-accent-soft -mr-1 p-1 rounded-md transition"
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-2.5 pb-2">
              {sprints?.map((s) => {
                const isActive = s.id === currentSprintId
                const c = sprintTaskCounts.get(s.id)
                const allDone = c && c.total > 0 && c.done === c.total
                return (
                  <button
                    key={s.id}
                    onClick={() => setCurrentSprintId(s.id)}
                    className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2 mb-0.5 text-[14px] rounded-lg transition ${
                      isActive
                        ? 'bg-accent text-white'
                        : 'text-ink hover:bg-surface-hover'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isActive ? 'bg-white/90' : allDone ? 'bg-status-done' : 'bg-ink-faint'
                      }`}
                      aria-hidden
                    />
                    <span className="flex-1 min-w-0">
                      <span className={`block truncate font-medium ${isActive ? '' : ''}`}>{s.name}</span>
                      <span className={`block text-[11.5px] leading-tight mt-0.5 tab-data ${isActive ? 'text-white/80' : 'text-ink-faint'}`}>
                        {formatSprintRange(s.startDate, s.endDate)}
                        {c && c.total > 0 && ` · ${c.total} tasks`}
                      </span>
                    </span>
                  </button>
                )
              })}
              {sprints && sprints.length === 0 && (
                <div className="px-3 py-3 text-[13px] text-ink-faint italic">
                  No sprints yet
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="p-4 text-[13px] text-ink-faint">
            Select a project →
          </div>
        )}
        {/* Drag handle — resize the panel; persists across sessions */}
        <div
          onMouseDown={startSidebarResize}
          className="group/resize absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-10"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
        >
          <div className="absolute right-0 top-0 h-full w-px bg-transparent group-hover/resize:bg-accent transition-colors" />
        </div>
      </aside>

      {/* Main column: thin header + capacity + sprint view. Always rendered;
          settings opens as a right-side drawer overlay (below), not a takeover. */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-[54px] shrink-0 border-b border-border-hair bg-surface flex items-center px-5 gap-3">
          <div className="flex items-center gap-2.5 text-sm min-w-0">
            {currentSprint ? (
              <>
                <SprintNameEditor
                  key={currentSprint.id}
                  sprint={currentSprint}
                />
                <button
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-yellow-500 hover:bg-yellow-500/10 transition shrink-0"
                  title="Star this sprint"
                  aria-label="Star sprint"
                >
                  <Star size={14} />
                </button>
                <span className="inline-flex items-center text-xs text-ink-muted shrink-0 tab-data bg-fill rounded-full px-2.5 py-1">
                  {formatSprintRange(
                    currentSprint.startDate,
                    currentSprint.endDate
                  )}
                </span>
              </>
            ) : (
              <span className="text-ink-faint">No sprint selected</span>
            )}
            {currentSprint && nextSprint && unfinishedCount > 0 && (
              <button
                onClick={rollover}
                className="text-xs flex items-center gap-1 text-accent rounded-md px-2 py-1 hover:bg-accent-soft transition ml-1"
                title={`Move ${unfinishedCount} unfinished task${
                  unfinishedCount === 1 ? '' : 's'
                } to "${nextSprint.name}"`}
              >
                <ArrowRightCircle size={13} strokeWidth={1.75} />
                <span>Roll over</span>
                <span className="text-ink-faint">{unfinishedCount}</span>
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <ViewToggle view={view} onChange={setView} />
            <div className="w-px h-5 bg-border-hair mx-1" />
            <div className="relative">
              <Search
                size={14}
                strokeWidth={1.75}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
              />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="text-sm bg-fill border border-transparent rounded-full pl-9 pr-9 py-1.5 w-52 focus:outline-none focus:bg-surface focus:ring-2 focus:ring-accent/40 text-ink transition"
              />
              <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint pointer-events-none">
                /
              </kbd>
            </div>
            <button
              onClick={handleExport}
              className="text-xs flex items-center gap-1.5 px-2 py-1.5 text-accent hover:bg-accent-soft rounded-md transition"
              title="Export JSON backup"
            >
              <Download size={13} /> Export
            </button>
            <button
              onClick={handleImportClick}
              className="text-xs flex items-center gap-1.5 px-2 py-1.5 text-accent hover:bg-accent-soft rounded-md transition"
              title="Import JSON backup"
            >
              <Upload size={13} /> Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          {currentSprint && (
            <CapacityBanner
              total={capacity.total}
              assigned={capacity.assigned}
              pctAssigned={capacity.pctAssigned}
              done={capacity.done}
              pctDone={capacity.pctDone}
              notEstimated={capacity.notEstimated}
            />
          )}

          <main className="px-6 pb-12">
            {!projects || !sprints ? (
              <p className="text-ink-muted py-12 text-center">Loading…</p>
            ) : projects.length === 0 ? (
              <div className="py-20 text-center space-y-4">
                <p className="text-ink-muted">No projects yet.</p>
                <button
                  onClick={() => setShowNewProject(true)}
                  className="text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-[8px] px-4 py-2 transition"
                >
                  Create your first project
                </button>
              </div>
            ) : sprints.length === 0 ? (
              <div className="py-20 text-center space-y-4">
                <p className="text-ink-muted">
                  This project has no sprints yet.
                </p>
                <button
                  onClick={() => setShowNewSprint(true)}
                  className="text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-[8px] px-4 py-2 transition"
                >
                  Create the first sprint
                </button>
              </div>
            ) : currentSprint && currentProjectId && tasks !== undefined ? (
              view === 'board' ? (
                <BoardView
                  projectId={currentProjectId}
                  sprintId={currentSprint.id}
                  sprintStartDate={currentSprint.startDate}
                  sprintEndDate={currentSprint.endDate}
                  tasks={tasks}
                  search={search}
                />
              ) : view === 'timeline' ? (
                <GanttView
                  projectId={currentProjectId}
                  sprintStartDate={currentSprint.startDate}
                  sprintEndDate={currentSprint.endDate}
                  tasks={tasks}
                  search={search}
                />
              ) : (
                <SprintView
                  projectId={currentProjectId}
                  sprintId={currentSprint.id}
                  sprintStartDate={currentSprint.startDate}
                  sprintEndDate={currentSprint.endDate}
                  tasks={tasks}
                  search={search}
                />
              )
            ) : (
              <p className="text-ink-muted py-12 text-center">Loading…</p>
            )}
          </main>
        </div>
      </div>

      {/* Settings drawer — right-side inspector over a dimmed backdrop. Both
          stay mounted while a project exists so the slide animates. */}
      {currentProject && (
        <>
          <div
            className={`fixed inset-0 z-40 bg-black/25 backdrop-blur-md transition-opacity duration-200 ${
              settingsOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            onClick={() => setSettingsOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Project settings"
            className={`fixed top-0 right-0 z-50 h-full w-[440px] max-w-[90vw] bg-surface border-l border-border-hair shadow-[-12px_0_50px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] ${
              settingsOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <ProjectSettingsView
              project={currentProject}
              onClose={() => setSettingsOpen(false)}
            />
          </div>
        </>
      )}

      {showNewProject && (
        <NewProjectDialog
          onClose={() => setShowNewProject(false)}
          onCreate={(p) => {
            setCurrentProjectId(p.id)
            setShowNewProject(false)
          }}
        />
      )}

      {showNewSprint && currentProjectId && (
        <NewSprintDialog
          projectId={currentProjectId}
          lastSprint={
            sprints && sprints.length > 0 ? sprints[sprints.length - 1] : null
          }
          sprintCount={sprints?.length ?? 0}
          onClose={() => setShowNewSprint(false)}
          onCreate={(s) => {
            setCurrentSprintId(s.id)
            setShowNewSprint(false)
          }}
        />
      )}
    </div>
  )
}

function CapacityBanner({
  total,
  assigned,
  pctAssigned,
  done,
  pctDone,
  notEstimated,
}: {
  total: number
  assigned: number
  pctAssigned: number
  done: number
  pctDone: number
  notEstimated: number
}) {
  return (
    <div className="px-6 pt-5 pb-2 grid grid-cols-3 gap-3 max-w-5xl">
      <Stat
        label="Backlog"
        value={total === 0 ? 'Empty' : `${total} task${total === 1 ? '' : 's'}`}
        sub={total === 0 ? 'Add your first task below' : 'in this sprint'}
        accent={total === 0}
      />
      <Stat
        label="Assigned"
        value={`${pctAssigned}%`}
        sub={`${assigned}/${total || 0} have an owner`}
      />
      <Stat
        label="Progress"
        value={`${pctDone}%`}
        sub={
          notEstimated > 0
            ? `${done} done · ${notEstimated} not estimated`
            : `${done} done`
        }
      />
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub: string
  accent?: boolean
}) {
  return (
    <div className="bg-surface rounded-[14px] px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_rgba(0,0,0,0.04)]">
      <div className="text-[12px] text-ink-faint font-medium">{label}</div>
      <div
        className={`text-[22px] font-bold tracking-[-0.018em] mt-0.5 ${accent ? 'text-accent' : 'text-ink'}`}
      >
        {value}
      </div>
      <div className="text-xs text-ink-muted mt-0.5">{sub}</div>
    </div>
  )
}

function NewSprintDialog({
  projectId,
  lastSprint,
  sprintCount,
  onClose,
  onCreate,
}: {
  projectId: string
  lastSprint: Sprint | null
  sprintCount: number
  onClose: () => void
  onCreate: (s: Sprint) => void
}) {
  // Defaults are computed once on mount — opening the dialog twice without
  // creating a sprint shouldn't change the suggestion.
  const defaults = useMemo(() => {
    // Start the day after the last sprint ended (back-to-back biweekly).
    let startISO: string
    if (lastSprint) {
      const s = new Date(lastSprint.endDate + 'T00:00:00Z')
      s.setUTCDate(s.getUTCDate() + 1)
      startISO = s.toISOString().slice(0, 10)
    } else {
      startISO = new Date().toISOString().slice(0, 10)
    }
    const e = new Date(startISO + 'T00:00:00Z')
    e.setUTCDate(e.getUTCDate() + 13)
    const endISO = e.toISOString().slice(0, 10)

    // Increment "Sprint N" from the last sprint name when possible;
    // otherwise count up by sprint total.
    let nextNum = sprintCount + 1
    if (lastSprint) {
      const m = lastSprint.name.match(/Sprint\s+(\d+)/i)
      if (m) nextNum = parseInt(m[1], 10) + 1
    }
    return { name: `Sprint ${nextNum}`, startDate: startISO, endDate: endISO }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [name, setName] = useState(defaults.name)
  const [startDate, setStartDate] = useState(defaults.startDate)
  const [endDate, setEndDate] = useState(defaults.endDate)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const sprint: Sprint = {
      id: uid(),
      projectId,
      name: trimmed,
      startDate,
      endDate,
    }
    await db.sprints.add(sprint)
    onCreate(sprint)
  }

  return (
    <div
      className="fixed inset-0 bg-black/25 backdrop-blur-md flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface text-ink rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.28)] w-full max-w-md p-6 space-y-4 border border-border-hair"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[19px] font-bold tracking-[-0.014em]">New Sprint</h2>
        <label className="block">
          <span className="text-xs text-ink-muted">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Sprint 44 (15/6 - 28/6)"
            className="mt-1 w-full px-3 py-2 border border-border bg-surface rounded-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-ink-muted">Start</span>
            <DateField value={startDate} onChange={setStartDate} />
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted">End</span>
            <DateField value={endDate} onChange={setEndDate} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-sm font-medium text-ink-muted hover:bg-surface-hover rounded-[8px] transition"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="px-4 py-1.5 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-[8px] disabled:opacity-50 transition"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

function NewProjectDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (p: Project) => void
}) {
  const [name, setName] = useState('')
  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const p = await createProject(trimmed)
    onCreate(p)
  }
  return (
    <div
      className="fixed inset-0 bg-black/25 backdrop-blur-md flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface text-ink rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.28)] w-full max-w-md p-6 space-y-4 border border-border-hair"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[19px] font-bold tracking-[-0.014em]">New Project</h2>
        <label className="block">
          <span className="text-xs text-ink-muted">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="My Side Project"
            className="mt-1 w-full px-3 py-2 border border-border bg-surface rounded-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
          />
        </label>
        <div className="text-xs text-ink-muted">
          A new project starts empty — add members, sprints, and tasks after
          creating.
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-sm font-medium text-ink-muted hover:bg-surface-hover rounded-[8px] transition"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="px-4 py-1.5 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-[8px] disabled:opacity-50 transition"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Apple-style segmented control switching between list and board view.
 */
function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode
  onChange: (v: ViewMode) => void
}) {
  const item = (mode: ViewMode, label: string, Icon: typeof List) => {
    const active = view === mode
    return (
      <button
        onClick={() => onChange(mode)}
        className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-[7px] transition ${
          active
            ? 'bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]'
            : 'text-ink-muted hover:text-ink'
        }`}
        title={`${label} view`}
        aria-pressed={active}
      >
        <Icon size={13} strokeWidth={active ? 2 : 1.75} />
        <span>{label}</span>
      </button>
    )
  }
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-[9px] bg-fill">
      {item('list', 'List', List)}
      {item('board', 'Board', LayoutGrid)}
      {item('timeline', 'Timeline', GanttChartSquare)}
    </div>
  )
}

/**
 * Inline-rename sprint name. Double-click or click pencil → editable input.
 * Enter commits, Esc cancels, blur commits. Same pattern as SprintView's
 * MemberGroupHeader rename.
 */
function SprintNameEditor({ sprint }: { sprint: Sprint }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sprint.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(sprint.name)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, sprint.name])

  const commit = async () => {
    const n = draft.trim()
    setEditing(false)
    if (n && n !== sprint.name) {
      await db.sprints.update(sprint.id, { name: n })
    }
  }
  const cancel = () => {
    setDraft(sprint.name)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        onBlur={() => void commit()}
        className="editable font-semibold text-ink display-tight bg-transparent min-w-0 max-w-[260px]"
        aria-label="Rename sprint"
      />
    )
  }
  return (
    <span
      className="font-semibold text-ink truncate display-tight cursor-text hover:underline decoration-dotted underline-offset-4"
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      title="Double-click to rename"
    >
      {sprint.name}
    </span>
  )
}

export default App
