import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  Calendar,
  Plus,
  Settings,
  X,
  Lock,
  StickyNote,
  ChevronDown,
  ChevronRight,
  History,
  Archive,
  ArchiveRestore,
  FolderSync,
  Layers,
  Package,
  Database,
  Check,
} from 'lucide-react'
import {
  db,
  uid,
  colorForName,
  exportAll,
  importAll,
  exportProject,
  importProject,
  deleteProject,
  seedIfEmpty,
  dedupeSprints,
  setSprintNote,
  setSprintArchived,
  recomputeAllDates,
  moveUnfinishedToNextSprint,
  logEvent,
  createProject,
  createCollection,
  deleteCollection,
  type Project,
  type Sprint,
  type Task,
  type Member,
  type Collection,
  type ExportPayload,
} from './db'
import { isProjectBundle, looksLikeProjectBundle } from './project-io'
import { CollectionView, CollectionBarIdentity, StatusEditor } from './CollectionView'
import { useConfirm } from './ConfirmDialog'
import { SprintView } from './SprintView'
import { BoardView } from './BoardView'
import { GanttView } from './GanttView'
import { ActivityLog } from './ActivityLog'
import { VersionFooter } from './VersionFooter'
import { ProjectSettingsView } from './ProjectSettingsView'
import {
  formatSprintRange,
  formatShortDate,
  isOverdue,
  useDarkMode,
  downloadJson,
  slugify,
  safeStorage,
  defaultSprintDates,
  upcomingMondays,
  snapToMonday,
  sprintEndForStart,
  todayLocalISO,
  sprintTemporalState,
  MON,
  latestActiveSprint,
  nextSprintNumber,
  sprintToSelect,
} from './lib'

const CURRENT_PROJECT_KEY = 'plan-up:currentProjectId'
const VIEW_KEY = 'plan-up:view'
type ViewMode = 'list' | 'board' | 'timeline'
type CollectionViewMode = 'list' | 'calendar'

// Leading row glyph encoding a sprint's temporal state (upcoming / in-progress / past),
// using only existing status tokens — no new colour. `onAccent` = rendered on the
// selected accent-filled row, so shapes switch to white. See sprints.md (State glyph).
function SprintStateDot({
  state,
  done,
  onAccent,
}: {
  state: 'upcoming' | 'progress' | 'past'
  done: boolean
  onAccent: boolean
}) {
  // currentColor drives every stroke/fill; the halo is the same colour at low opacity.
  const tone = onAccent
    ? 'text-white'
    : state === 'progress'
      ? 'text-accent'
      : state === 'past' && done
        ? 'text-status-done'
        : 'text-status-todo'
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`shrink-0 ${tone}`}
    >
      {state === 'upcoming' && (
        // hollow ring — not started
        <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2" />
      )}
      {state === 'progress' && (
        <>
          {/* live: soft halo + solid dot, with a calm pulse */}
          <circle className="animate-sprint-live" cx="12" cy="12" r="9" fill="currentColor" opacity="0.18" />
          <circle cx="12" cy="12" r="4.6" fill="currentColor" />
        </>
      )}
      {state === 'past' && (
        // solid muted dot (green via `tone` when fully done)
        <circle cx="12" cy="12" r="5" fill="currentColor" />
      )}
    </svg>
  )
}

/** Transient feedback after a non-destructive import (slides up from the bottom,
 *  optional Undo action). Plain timeout dismiss; no toast queue (one at a time). */
type ToastState = {
  title: string
  detail: string
  onUndo?: () => void
} | null

function App() {
  const [seedError, setSeedError] = useState<string | null>(null)
  const [seeded, setSeeded] = useState(false)
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(
    () => safeStorage.get(CURRENT_PROJECT_KEY)
  )
  const setCurrentProjectId = (id: string | null) => {
    setCurrentProjectIdState(id)
    if (id) safeStorage.set(CURRENT_PROJECT_KEY, id)
    else safeStorage.remove(CURRENT_PROJECT_KEY)
  }
  const [currentSprintId, setCurrentSprintId] = useState<string | null>(null)
  // Container đang xem: 'sprint' (mặc định) hoặc 'collection'.
  const SELKIND_KEY = 'plan-up:selKind'
  const SELCOLL_KEY = 'plan-up:selCollectionId'
  const [selKind, setSelKindState] = useState<'sprint' | 'collection'>(
    () => (safeStorage.get(SELKIND_KEY) === 'collection' ? 'collection' : 'sprint')
  )
  const [currentCollectionId, setCurrentCollectionIdState] = useState<string | null>(
    () => safeStorage.get(SELCOLL_KEY)
  )
  const selectSprint = (id: string) => {
    setShowActivity(false)
    setCurrentSprintId(id); setSelKindState('sprint'); safeStorage.set(SELKIND_KEY, 'sprint')
  }
  const selectCollection = (id: string) => {
    setShowActivity(false)
    setCurrentCollectionIdState(id); safeStorage.set(SELCOLL_KEY, id)
    setSelKindState('collection'); safeStorage.set(SELKIND_KEY, 'collection')
  }
  const [view, setViewState] = useState<ViewMode>(() => {
    const v = safeStorage.get(VIEW_KEY)
    return v === 'board' ? 'board' : v === 'timeline' ? 'timeline' : 'list'
  })
  const setView = (v: ViewMode) => {
    setViewState(v)
    safeStorage.set(VIEW_KEY, v)
  }
  // Sprint activity log is a full-page overlay of the main column (not a persisted
  // view mode — it's a transient drill-in, reset when the sprint changes). See
  // design-docs/sprint-activity-log.md.
  const [showActivity, setShowActivity] = useState(false)
  // Collection view (List/Calendar) — lifted here so the single adaptive top-bar
  // toggle can drive it; persisted separately from the sprint view.
  const COLLVIEW_KEY = 'plan-up:collectionView'
  const [collectionView, setCollectionViewState] = useState<CollectionViewMode>(
    () => (safeStorage.get(COLLVIEW_KEY) === 'calendar' ? 'calendar' : 'list')
  )
  const setCollectionView = (v: CollectionViewMode) => {
    setCollectionViewState(v)
    safeStorage.set(COLLVIEW_KEY, v)
  }
  const [showNewSprint, setShowNewSprint] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)
  const [showNewCollection, setShowNewCollection] = useState(false)
  const confirm = useConfirm()
  // Collapsible sidebar sections — persisted per section (design-system §6.2).
  const SPRINTS_COLLAPSED_KEY = 'plan-up:sidebarSprintsCollapsed'
  const COLLS_COLLAPSED_KEY = 'plan-up:sidebarCollectionsCollapsed'
  const ARCHIVED_COLLAPSED_KEY = 'plan-up:sidebarArchivedCollapsed'
  const [sprintsCollapsed, setSprintsCollapsed] = useState(
    () => safeStorage.get(SPRINTS_COLLAPSED_KEY) === '1'
  )
  // Archived sub-section starts collapsed (default '1' when unset) — see
  // design-docs/sprint-archive.md.
  const [archivedCollapsed, setArchivedCollapsed] = useState(
    () => safeStorage.get(ARCHIVED_COLLAPSED_KEY) !== '0'
  )
  const [collectionsCollapsed, setCollectionsCollapsed] = useState(
    () => safeStorage.get(COLLS_COLLAPSED_KEY) === '1'
  )
  const toggleSprintsCollapsed = () =>
    setSprintsCollapsed((p) => {
      safeStorage.set(SPRINTS_COLLAPSED_KEY, p ? '0' : '1')
      return !p
    })
  const toggleCollectionsCollapsed = () =>
    setCollectionsCollapsed((p) => {
      safeStorage.set(COLLS_COLLAPSED_KEY, p ? '0' : '1')
      return !p
    })
  const toggleArchivedCollapsed = () =>
    setArchivedCollapsed((p) => {
      safeStorage.set(ARCHIVED_COLLAPSED_KEY, p ? '0' : '1')
      return !p
    })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Export split-menu (header) — "this project" vs "full backup".
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  // Non-destructive import feedback (add-as-new). Replace-all keeps its dialog.
  const [toast, setToast] = useState<ToastState>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (t: NonNullable<ToastState>) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(t)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }
  // Close the export menu on outside-click / Escape; clear the toast timer on unmount.
  useEffect(() => {
    if (!exportMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!exportMenuRef.current?.contains(e.target as Node))
        setExportMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [exportMenuOpen])
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    []
  )
  const [dark, setDark] = useDarkMode()
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Scroll container for the sprint views — search-palette jump-to scrolls it to
  // the picked task (we never use scrollIntoView; it breaks this container).
  const scrollRef = useRef<HTMLDivElement>(null)

  // Resizable sprint panel. Width persisted across sessions; the icon rail
  // (58px) sits to its left, so a drag maps to clientX - 58, clamped.
  const SIDEBAR_MIN = 200
  const SIDEBAR_MAX = 460
  const RAIL_W = 58
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const s = Number(safeStorage.get('plan-up:sidebarWidth'))
    return s >= SIDEBAR_MIN && s <= SIDEBAR_MAX ? s : 248
  })
  useEffect(() => {
    safeStorage.set('plan-up:sidebarWidth', String(sidebarWidth))
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

  const collections = useLiveQuery<Collection[]>(
    () =>
      seeded && currentProjectId
        ? db.collections.where('projectId').equals(currentProjectId).sortBy('order')
        : Promise.resolve([] as Collection[]),
    [seeded, currentProjectId]
  )
  const currentCollection =
    collections?.find((c) => c.id === currentCollectionId) ?? null

  const tasks = useLiveQuery<Task[]>(
    () =>
      currentSprintId
        ? db.tasks.where('sprintId').equals(currentSprintId).toArray()
        : Promise.resolve([] as Task[]),
    [currentSprintId]
  )

  // Members of the current project — used by the search palette to show each
  // result's assignee. (The views load their own copy too; this is cheap/local.)
  const paletteMembers = useLiveQuery<Member[]>(
    () =>
      currentProjectId
        ? db.members.where('projectId').equals(currentProjectId).toArray()
        : Promise.resolve([] as Member[]),
    [currentProjectId]
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
      if (!t.sprintId) continue
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
      // Prefer the latest non-archived sprint; never land on a blank view.
      setCurrentSprintId(sprintToSelect(sprints))
    }
  }, [sprints, currentSprintId])

  // Guard the collection selection the same way the sprint one is guarded: if
  // selKind is 'collection' but that collection no longer exists (deleted
  // elsewhere, a project switch, or a stale persisted id from another project),
  // fall back to the sprint view so the UI never points at a dangling selection.
  useEffect(() => {
    if (!collections) return
    if (
      selKind === 'collection' &&
      currentCollectionId &&
      !collections.some((c) => c.id === currentCollectionId)
    ) {
      setSelKindState('sprint')
      safeStorage.set(SELKIND_KEY, 'sprint')
      setCurrentCollectionIdState(null)
      safeStorage.remove(SELCOLL_KEY)
    }
  }, [collections, selKind, currentCollectionId])

  // Search-palette jump-to: close the palette, ensure we're in List view (the
  // only sprint view that hosts the row highlight), then scroll the container to
  // the picked task and flash it. Never scrollIntoView (breaks the container);
  // measure the row vs the container and call scrollTo.
  const jumpToTask = (taskId: string) => {
    setPaletteOpen(false)
    setView('list')
    setTimeout(() => {
      const c = scrollRef.current
      const el = c?.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`)
      if (!c || !el) return
      const top = c.scrollTop + (el.getBoundingClientRect().top - c.getBoundingClientRect().top) - 80
      c.scrollTo({ top: top < 0 ? 0 : top, behavior: 'smooth' })
      el.setAttribute('data-flash', '1')
      window.setTimeout(() => el.removeAttribute('data-flash'), 1300)
    }, 70)
  }

  // Keyboard shortcuts: / or ⌘K open the search palette, n new sprint, esc closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inField =
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

      const sprintActive = selKind === 'sprint' && !!currentSprintId

      // ⌘K / Ctrl+K — open palette from anywhere (works even while typing).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (settingsOpen || !sprintActive) return
        e.preventDefault()
        setPaletteOpen(true)
        return
      }

      if (e.key === 'Escape') {
        if (paletteOpen) {
          setPaletteOpen(false)
          return
        }
        if (showActivity) {
          setShowActivity(false)
          return
        }
        if (settingsOpen) setSettingsOpen(false)
        return
      }
      if (inField) return
      if (e.key === '/') {
        if (settingsOpen || !sprintActive) return // no palette over settings / no sprint
        e.preventDefault()
        setPaletteOpen(true)
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
  }, [paletteOpen, dark, setDark, settingsOpen, showActivity, selKind, currentSprintId])

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

  // Full-DB backup (every project) — restore-on-a-new-machine file.
  const handleExportAll = async () => {
    setExportMenuOpen(false)
    const data = await exportAll()
    downloadJson(`plan-up-${data.exportedAt.slice(0, 10)}.json`, data)
  }

  // Single-project share file (additive on import). Used by the header menu and
  // the inline action in Project settings.
  const handleExportProject = async (projectId: string, name: string) => {
    setExportMenuOpen(false)
    const bundle = await exportProject(projectId)
    downloadJson(`plan-up-${slugify(name)}-${bundle.exportedAt.slice(0, 10)}.json`, bundle)
  }

  const handleImportClick = () => fileInputRef.current?.click()
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    let data: unknown
    try {
      data = JSON.parse(await file.text())
    } catch {
      alert('Import failed: not a valid JSON file.')
      return
    }

    // Auto-detect file kind. A file that CLAIMS kind:'project' is committed to the
    // project path here — if it then fails full validation it's reported as a
    // corrupt project file, never re-routed to the destructive replace-all confirm
    // (a damaged share file must not raise a full-DB-wipe prompt).
    if (looksLikeProjectBundle(data)) {
      if (!isProjectBundle(data)) {
        alert('Import failed: this project file is invalid or corrupt.')
        return
      }
      // A single-project bundle is ADDITIVE — it adds a new project and destroys
      // nothing, so it needs no confirm (just a toast + Undo).
      try {
        const { projectId, projectName, taskCount } = await importProject(data)
        const counts = {
          sprints: data.sprints.length,
          members: data.members.length,
        }
        // Select the freshly-imported project so the user lands on it.
        setSelKindState('sprint')
        safeStorage.set(SELKIND_KEY, 'sprint')
        setCurrentCollectionIdState(null)
        safeStorage.remove(SELCOLL_KEY)
        setCurrentSprintId(null)
        setCurrentProjectId(projectId)
        showToast({
          title: `Imported “${projectName}” as a new project`,
          detail: `${counts.sprints} sprint${counts.sprints === 1 ? '' : 's'} · ${taskCount} task${taskCount === 1 ? '' : 's'} · ${counts.members} member${counts.members === 1 ? '' : 's'}`,
          // Undo = delete exactly the project we just added (safe, reversible).
          onUndo: async () => {
            setToast(null)
            await deleteProject(projectId)
            setCurrentProjectId(null)
          },
        })
      } catch (err) {
        alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }

    // Otherwise treat it as a legacy full backup → destructive replace-all.
    if (
      !(await confirm({
        title: 'Replace all data?',
        message:
          'Importing will replace every project, sprint, collection, and task currently stored. This can’t be undone.',
        confirmLabel: 'Replace',
      }))
    )
      return
    try {
      await importAll(data as ExportPayload)
      // Imported data replaces everything — the old selection ids now point at
      // wiped rows. Reset to a clean slate; the project/sprint effects reselect
      // valid targets (projects[0] → its latest sprint) once the queries refire.
      setSelKindState('sprint')
      safeStorage.set(SELKIND_KEY, 'sprint')
      setCurrentCollectionIdState(null)
      safeStorage.remove(SELCOLL_KEY)
      setCurrentSprintId(null)
      setCurrentProjectId(null)
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
    if (idx < 0) return null
    // Rollover target = the next NON-archived sprint (must match
    // moveUnfinishedToNextSprint in db.ts). See sprint-archive.md.
    return sprints.slice(idx + 1).find((s) => s.archivedAt == null) ?? null
  }, [sprints, currentSprint])
  // Unfinished tasks = the exact set that rolls over (matches
  // moveUnfinishedToNextSprint). Sorted by sequence for a stable preview list.
  const unfinishedTasks = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => t.status !== 'done')
        .sort((a, b) => a.sequence - b.sequence),
    [tasks]
  )
  const unfinishedCount = unfinishedTasks.length

  // Roll over is a preview popover anchored to its button (not a center modal):
  // the user sees WHAT moves before committing. See sprint-rollover.md.
  const [rollOpen, setRollOpen] = useState(false)
  const rollBtnRef = useRef<HTMLButtonElement>(null)

  const doRollover = async () => {
    if (!currentSprint) return
    setRollOpen(false)
    const result = await moveUnfinishedToNextSprint(currentSprint.id)
    if (result.targetSprintId) {
      setCurrentSprintId(result.targetSprintId)
    }
  }

  // Archive splits the sprint list into the active flow + a quiet "Archived"
  // section. See design-docs/sprint-archive.md.
  const activeSprints = useMemo(
    () => (sprints ?? []).filter((s) => s.archivedAt == null),
    [sprints]
  )
  const archivedSprints = useMemo(
    () => (sprints ?? []).filter((s) => s.archivedAt != null),
    [sprints]
  )
  const onArchiveToggle = async (sprintId: string, archived: boolean) => {
    await setSprintArchived(sprintId, archived)
    // Archiving the current sprint hands off to the latest active one (never a
    // blank view) — useLiveQuery won't re-select since the row still exists.
    if (archived && sprintId === currentSprintId) {
      const after = (sprints ?? []).map((s) =>
        s.id === sprintId ? { ...s, archivedAt: Date.now() } : s
      )
      setCurrentSprintId(sprintToSelect(after))
    }
    if (archived) setArchivedCollapsed(false) // reveal where it went
  }

  // Computed once per render, shared by every row's state glyph (not per-row).
  const today = todayLocalISO()
  // One renderer for both the active list and the Archived section. Archived
  // rows are muted, carry an "archived {date}" caption, and flip the hover
  // action to Unarchive. The action is an absolute sibling (not nested in the
  // row <button>, which would be invalid HTML).
  const renderSprintRow = (s: Sprint, archived: boolean) => {
    const isActive = selKind === 'sprint' && s.id === currentSprintId
    const c = sprintTaskCounts.get(s.id)
    const allDone = !!(c && c.total > 0 && c.done === c.total)
    const state = sprintTemporalState(s.startDate, s.endDate, today)
    const aDate = archived && s.archivedAt ? new Date(s.archivedAt) : null
    return (
      <div key={s.id} className="relative group/row">
        <button
          onClick={() => selectSprint(s.id)}
          className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2 mb-0.5 text-[14px] rounded-lg transition ${
            isActive ? 'bg-accent text-white' : 'text-ink hover:bg-surface-hover'
          }`}
        >
          <SprintStateDot state={state} done={allDone} onAccent={isActive} />
          <span className="flex-1 min-w-0">
            {/* Note glyph hugs the title text (not the row edge) so it never
               collides with the hover archive action. See sprint-archive.md. */}
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className={`min-w-0 truncate font-medium ${
                  archived && !isActive ? 'text-ink-muted' : ''
                }`}
              >
                {s.name}
              </span>
              {s.note && (
                <StickyNote
                  size={13}
                  strokeWidth={2}
                  className={`shrink-0 ${isActive ? 'text-white/70' : 'text-ink-faint'}`}
                  aria-label="Has note"
                />
              )}
            </span>
            <span
              className={`block truncate text-[11.5px] leading-tight mt-0.5 tab-data ${
                isActive ? 'text-white/80' : 'text-ink-faint'
              }`}
            >
              {formatSprintRange(s.startDate, s.endDate)}
              {!archived && c && c.total > 0 &&
                ` · ${c.total} task${c.total === 1 ? '' : 's'}`}
              {aDate && ` · archived ${MON[aDate.getMonth()]} ${aDate.getDate()}`}
            </span>
          </span>
          <span className="w-5 shrink-0" aria-hidden />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void onArchiveToggle(s.id, !archived)
          }}
          title={archived ? 'Unarchive sprint' : 'Archive sprint'}
          aria-label={archived ? `Unarchive ${s.name}` : `Archive ${s.name}`}
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-md opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition ${
            isActive
              ? 'text-white/80 hover:bg-white/20'
              : 'text-ink-faint hover:bg-accent-soft hover:text-accent'
          }`}
        >
          {archived ? (
            <ArchiveRestore size={14} strokeWidth={1.9} />
          ) : (
            <Archive size={14} strokeWidth={1.9} />
          )}
        </button>
      </div>
    )
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
    // Disjoint partition for the stacked capacity bar (sums to total):
    // done · in-flight (owned, not done) · open (unowned, not done).
    const inFlight = t.filter(
      (x) => x.status !== 'done' && x.assigneeId !== null
    ).length
    const open = total - done - inFlight
    return {
      total,
      assigned,
      inFlight,
      open,
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
              aria-label={p.name}
              aria-current={isActive ? 'true' : undefined}
              className={`tile-press w-[36px] h-[36px] rounded-[10px] flex items-center justify-center text-white text-[15px] font-semibold transition ${
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
          className="tile-press w-[36px] h-[36px] rounded-[10px] text-ink-faint hover:text-accent hover:bg-surface-hover flex items-center justify-center transition"
        >
          <Plus size={18} strokeWidth={2} />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setDark(!dark)}
          title={dark ? 'Switch to light' : 'Switch to dark'}
          className="tile-press w-[36px] h-[36px] rounded-[10px] text-ink-faint hover:text-ink hover:bg-surface-hover flex items-center justify-center transition"
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
            <div className="flex-1 overflow-auto">
            <div
              onClick={toggleSprintsCollapsed}
              role="button"
              aria-expanded={!sprintsCollapsed}
              className="flex items-center justify-between px-[18px] pt-3 pb-1.5 cursor-pointer select-none"
            >
              <span className="flex items-center gap-2 text-[15.5px] font-semibold tracking-[-0.01em] text-ink-muted">
                <ChevronDown
                  size={13}
                  className={`shrink-0 text-ink-faint transition-transform ${sprintsCollapsed ? '-rotate-90' : ''}`}
                  aria-hidden
                />
                <FolderSync size={16} className="shrink-0 text-ink-faint" aria-hidden />
                Sprints
                {activeSprints.length > 0 && (
                  <span className="text-[13px] tabular-nums font-medium text-ink-faint/70">
                    {activeSprints.length}
                  </span>
                )}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowNewSprint(true)
                }}
                title="New sprint (n)"
                className="inline-flex items-center text-accent hover:bg-accent-soft -mr-1 p-1 rounded-md transition"
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            </div>
            {!sprintsCollapsed && (
            <div className="pl-[26px] pr-2.5 pb-2">
              {activeSprints.map((s) => renderSprintRow(s, false))}
              {sprints && sprints.length === 0 && (
                <div className="px-3 py-3 text-[13px] text-ink-faint italic">
                  No sprints yet
                </div>
              )}
              {sprints && sprints.length > 0 && activeSprints.length === 0 && (
                <div className="px-3 py-3 text-[13px] text-ink-faint italic">
                  All sprints archived
                </div>
              )}
              {/* Archived sprints — an inline "Show N archived" disclosure that
                 lives INSIDE the Sprints group (not a peer header), so the panel
                 reads as one Sprints group + Collections as its peer. The rows
                 reveal indented directly below. See sprint-archive.md (Hierarchy). */}
              {archivedSprints.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={toggleArchivedCollapsed}
                    aria-expanded={!archivedCollapsed}
                    className="w-full flex items-center gap-1.5 mt-0.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-ink-faint hover:bg-surface-hover hover:text-ink-muted transition cursor-pointer select-none"
                  >
                    {archivedCollapsed ? (
                      <ChevronRight size={11} className="shrink-0" aria-hidden />
                    ) : (
                      <ChevronDown size={11} className="shrink-0" aria-hidden />
                    )}
                    {archivedCollapsed
                      ? `Show ${archivedSprints.length} archived`
                      : 'Hide archived'}
                  </button>
                  {!archivedCollapsed && (
                    <div className="pl-3">
                      {archivedSprints.map((s) => renderSprintRow(s, true))}
                    </div>
                  )}
                </>
              )}
            </div>
            )}
            <div
              onClick={toggleCollectionsCollapsed}
              role="button"
              aria-expanded={!collectionsCollapsed}
              className="flex items-center justify-between px-[18px] pt-3 pb-1.5 cursor-pointer select-none"
            >
              <span className="flex items-center gap-2 text-[15.5px] font-semibold tracking-[-0.01em] text-ink-muted">
                <ChevronDown
                  size={13}
                  className={`shrink-0 text-ink-faint transition-transform ${collectionsCollapsed ? '-rotate-90' : ''}`}
                  aria-hidden
                />
                <Layers size={16} className="shrink-0 text-ink-faint" aria-hidden />
                Collections
                {(collections?.length ?? 0) > 0 && (
                  <span className="text-[13px] tabular-nums font-medium text-ink-faint/70">
                    {collections?.length}
                  </span>
                )}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowNewCollection(true)
                }}
                title="New collection"
                className="inline-flex items-center text-accent hover:bg-accent-soft -mr-1 p-1 rounded-md transition"
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            </div>
            {!collectionsCollapsed && (
            <div className="pl-[26px] pr-2.5 pb-2">
              {collections?.map((c) => {
                const isActive = selKind === 'collection' && c.id === currentCollectionId
                return (
                  <div key={c.id} className="group relative mb-0.5">
                    <button
                      onClick={() => selectCollection(c.id)}
                      className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2 text-[14px] rounded-lg transition ${
                        isActive ? 'bg-accent text-white' : 'text-ink hover:bg-surface-hover'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-white/90' : 'bg-ink-faint'}`} aria-hidden />
                      <span className="flex-1 min-w-0 truncate font-medium">{c.name}</span>
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (
                          !(await confirm({
                            title: 'Delete collection?',
                            message: `“${c.name}” and all its items will be permanently deleted. This can’t be undone.`,
                            confirmLabel: 'Delete',
                          }))
                        )
                          return
                        await deleteCollection(c.id)
                        if (
                          selKind === 'collection' &&
                          currentCollectionId === c.id
                        ) {
                          setSelKindState('sprint')
                          safeStorage.set(SELKIND_KEY, 'sprint')
                        }
                      }}
                      title="Delete collection"
                      aria-label={`Delete collection ${c.name}`}
                      className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded transition opacity-0 group-hover:opacity-100 ${
                        isActive ? 'text-white/70 hover:text-white hover:bg-white/20' : 'text-ink-faint hover:text-red-500 hover:bg-red-500/10'
                      }`}
                    >
                      <X size={13} strokeWidth={2} />
                    </button>
                  </div>
                )
              })}
              {collections && collections.length === 0 && (
                <div className="px-3 py-2 text-[13px] text-ink-faint italic">No collections</div>
              )}
            </div>
            )}
            </div>
          </>
        ) : (
          <div className="p-4 text-[13px] text-ink-faint">
            Select a project →
          </div>
        )}
        {/* Version footer — calm `plan-up · v{version}` at rest; morphs into a
            glowing "Update" pill when a newer build is live. See
            design-docs/version-and-updates.md. */}
        <VersionFooter />
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
            {selKind === 'collection' && currentCollection ? (
              <CollectionBarIdentity collection={currentCollection} />
            ) : currentSprint ? (
              <>
                {/* Sprint name is automatic + locked (no rename). Context lives
                    in the optional goal note below the header. See sprints.md. */}
                <span className="font-semibold text-ink display-tight truncate">
                  {currentSprint.name}
                </span>
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
            {selKind === 'sprint' && currentSprint && nextSprint && unfinishedCount > 0 && (
              <div className="relative ml-1">
                <button
                  ref={rollBtnRef}
                  onClick={() => setRollOpen((o) => !o)}
                  aria-expanded={rollOpen}
                  className={`text-xs flex items-center gap-1 text-accent rounded-md px-2 py-1 hover:bg-accent-soft transition ${
                    rollOpen ? 'bg-accent-soft' : ''
                  }`}
                  title={`Move ${unfinishedCount} unfinished task${
                    unfinishedCount === 1 ? '' : 's'
                  } to "${nextSprint.name}"`}
                >
                  <ArrowRightCircle size={13} strokeWidth={1.75} />
                  <span>Roll over</span>
                  <span className="text-ink-faint">{unfinishedCount}</span>
                </button>
                {rollOpen && (
                  <RolloverPopover
                    anchorRef={rollBtnRef}
                    tasks={unfinishedTasks}
                    members={paletteMembers ?? []}
                    fromName={currentSprint.name}
                    toName={nextSprint.name}
                    onMove={doRollover}
                    onClose={() => setRollOpen(false)}
                  />
                )}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {selKind === 'collection' && currentCollection ? (
              <>
                <StatusEditor collection={currentCollection} />
                <ViewToggle
                  value={collectionView}
                  options={COLLECTION_VIEWS}
                  onChange={setCollectionView}
                />
              </>
            ) : (
              <ViewToggle value={view} options={SPRINT_VIEWS} onChange={setView} />
            )}
            <div className="w-px h-5 bg-border-hair mx-1" />
            {/* Search = command palette (Spotlight). Sprint-only (search never
                applied to collections). Trigger: this icon, "/", or ⌘K. */}
            {selKind === 'sprint' && currentSprint && (
              <button
                onClick={() => setPaletteOpen(true)}
                title="Search tasks (/ or ⌘K)"
                aria-label="Search tasks"
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-faint hover:text-ink hover:bg-surface-hover transition"
              >
                <Search size={15} strokeWidth={1.9} />
              </button>
            )}
            {/* Sprint activity log — toggle the right-side drawer. Calm grey at
                rest (accent is a signal, not chrome); accent only while open. */}
            {selKind === 'sprint' && currentSprint && (
              <button
                onClick={() => setShowActivity((s) => !s)}
                aria-pressed={showActivity}
                title="Sprint activity log"
                aria-label="Sprint activity log"
                className={`inline-flex items-center justify-center w-8 h-8 rounded-md transition ${
                  showActivity
                    ? 'text-accent bg-accent-soft'
                    : 'text-ink-faint hover:text-ink hover:bg-surface-hover'
                }`}
              >
                <History size={15} strokeWidth={1.9} />
              </button>
            )}
            {/* Export split-menu: "this project" (additive share file) vs the
                full DB backup. See design-docs/project-export-import.md. */}
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setExportMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
                className="text-xs flex items-center gap-1.5 px-2 py-1.5 text-accent hover:bg-accent-soft rounded-md transition"
                title="Export"
              >
                <Download size={13} /> Export
                <ChevronDown size={12} className={`transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {exportMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[262px] p-1.5 rounded-[12px] bg-surface shadow-[0_12px_32px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.55),0_0_0_0.5px_rgba(255,255,255,0.08)]"
                >
                  <button
                    role="menuitem"
                    disabled={!currentProject}
                    onClick={() =>
                      currentProject &&
                      handleExportProject(currentProject.id, currentProject.name)
                    }
                    className="w-full flex items-start gap-3 p-2.5 rounded-[8px] text-left hover:bg-surface-hover transition disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <span className="shrink-0 w-[30px] h-[30px] rounded-[8px] flex items-center justify-center bg-accent-soft text-accent">
                      <Package size={15} strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-ink">Export this project</span>
                      <span className="block text-[12px] text-ink-muted truncate">
                        {currentProject?.name ?? 'No project selected'}
                      </span>
                    </span>
                  </button>
                  <div className="h-px bg-border-hair mx-2 my-1" />
                  <button
                    role="menuitem"
                    onClick={handleExportAll}
                    className="w-full flex items-start gap-3 p-2.5 rounded-[8px] text-left hover:bg-surface-hover transition"
                  >
                    <span className="shrink-0 w-[30px] h-[30px] rounded-[8px] flex items-center justify-center bg-accent-soft text-accent">
                      <Database size={15} strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-ink">Export all (full backup)</span>
                      <span className="block text-[12px] text-ink-muted">Every project — restore on a new machine</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleImportClick}
              className="text-xs flex items-center gap-1.5 px-2 py-1.5 text-accent hover:bg-accent-soft rounded-md transition"
              title="Import a project file or full backup"
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

        {/* Goal note banner — chrome strip under the header, sprint-only.
            Editable inline; collapses to a calm dashed "+ Add sprint note"
            slot when empty (§5.11 idiom). See sprints.md. */}
        {selKind === 'sprint' && currentSprint && (
          <SprintNoteBanner key={currentSprint.id} sprint={currentSprint} />
        )}

        <div ref={scrollRef} className="flex-1 overflow-auto">
          {selKind === 'sprint' && currentSprint && (
            <CapacityBanner
              total={capacity.total}
              pctAssigned={capacity.pctAssigned}
              done={capacity.done}
              pctDone={capacity.pctDone}
              inFlight={capacity.inFlight}
              open={capacity.open}
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
            ) : selKind === 'collection' && currentCollection && currentProjectId ? (
              <CollectionView
                collectionId={currentCollection.id}
                view={collectionView}
                onViewInList={() => setCollectionView('list')}
              />
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
                />
              ) : view === 'timeline' ? (
                <GanttView
                  projectId={currentProjectId}
                  sprintStartDate={currentSprint.startDate}
                  sprintEndDate={currentSprint.endDate}
                  tasks={tasks}
                  onOpenInList={() => setView('list')}
                />
              ) : (
                <SprintView
                  projectId={currentProjectId}
                  sprintId={currentSprint.id}
                  sprintStartDate={currentSprint.startDate}
                  sprintEndDate={currentSprint.endDate}
                  tasks={tasks}
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
            inert={!settingsOpen}
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

      {/* Sprint activity log — right-side drawer over a dimmed backdrop, mirroring
          the settings drawer idiom. Both stay mounted while a sprint is selected so
          the slide animates; `inert` keeps focus/keyboard out when closed. */}
      {selKind === 'sprint' && currentSprint && (
        <>
          <div
            className={`fixed inset-0 z-40 bg-black/25 backdrop-blur-md transition-opacity duration-200 ${
              showActivity ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            onClick={() => setShowActivity(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Sprint activity log"
            inert={!showActivity}
            className={`fixed top-0 right-0 z-50 h-full w-[440px] max-w-[90vw] bg-surface border-l border-border-hair shadow-[-12px_0_50px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] ${
              showActivity ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <ActivityLog
              open={showActivity}
              sprintId={currentSprint.id}
              sprintRange={formatSprintRange(currentSprint.startDate, currentSprint.endDate)}
              tasks={tasks ?? []}
              members={paletteMembers ?? []}
              onClose={() => setShowActivity(false)}
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
          lastSprint={latestActiveSprint(sprints ?? [])}
          nextNumber={nextSprintNumber(sprints ?? [])}
          onClose={() => setShowNewSprint(false)}
          onCreate={(s) => {
            setCurrentSprintId(s.id)
            setShowNewSprint(false)
          }}
        />
      )}

      {showNewCollection && currentProjectId && (
        <NewCollectionDialog
          projectId={currentProjectId}
          onClose={() => setShowNewCollection(false)}
          onCreate={(c) => {
            selectCollection(c.id)
            setShowNewCollection(false)
          }}
        />
      )}

      {paletteOpen && currentSprint && (
        <SearchPalette
          tasks={tasks ?? []}
          members={paletteMembers ?? []}
          onSelect={jumpToTask}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {toast &&
        createPortal(
          <div className="fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-3 min-w-[340px] max-w-[460px] px-4 py-3 rounded-[14px] bg-surface border border-border-hair animate-toast-in shadow-[0_12px_32px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.55),0_0_0_0.5px_rgba(255,255,255,0.08)]">
              <span className="shrink-0 w-[34px] h-[34px] rounded-full flex items-center justify-center bg-status-done/15 text-status-done">
                <Check size={18} strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-ink truncate">{toast.title}</div>
                <div className="text-[12px] text-ink-muted mt-0.5">{toast.detail}</div>
              </div>
              {toast.onUndo && (
                <button
                  onClick={toast.onUndo}
                  className="shrink-0 self-center text-[13px] font-medium text-accent hover:bg-accent-soft rounded-md px-2.5 py-1.5 transition"
                >
                  Undo
                </button>
              )}
            </div>
          </div>,
          document.body
        )}

    </div>
  )
}

/**
 * Command palette (Spotlight) — search the current sprint's tasks by title and
 * jump to one. Replaces the old toolbar search input (design-docs/search-and-
 * keyboard.md). Uses the shared dlg-scrim/dlg-sheet motion (§6.5). Picking a
 * result hands the task id back to App, which scrolls+flashes its row.
 */
function SearchPalette({
  tasks,
  members,
  onSelect,
  onClose,
}: {
  tasks: Task[]
  members: Member[]
  onSelect: (taskId: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members]
  )
  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    const list = query
      ? tasks.filter((t) => t.title.toLowerCase().includes(query))
      : tasks
    // Stable, predictable order: by sequence.
    return [...list].sort((a, b) => a.sequence - b.sequence).slice(0, 50)
  }, [q, tasks])

  // Keep the selection in range as the result set changes.
  useEffect(() => {
    setSel((s) => (s >= results.length ? 0 : s))
  }, [results.length])

  const DOT: Record<string, string> = {
    todo: 'bg-status-todo',
    in_progress: 'bg-status-progress',
    done: 'bg-status-done',
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const t = results[sel]
      if (t) onSelect(t.id)
    }
    // Escape is handled by the global key handler (closes the palette).
  }

  const renderTitle = (title: string) => {
    const query = q.trim()
    if (!query) return title
    const i = title.toLowerCase().indexOf(query.toLowerCase())
    if (i < 0) return title
    return (
      <>
        {title.slice(0, i)}
        <mark className="bg-accent-tint text-ink rounded-[3px]">
          {title.slice(i, i + query.length)}
        </mark>
        {title.slice(i + query.length)}
      </>
    )
  }

  return (
    <div
      className="dlg-scrim fixed inset-0 bg-black/25 backdrop-blur-md flex items-start justify-center pt-[12vh] p-4 z-50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Search tasks"
        className="dlg-sheet bg-surface text-ink rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.28)] w-full max-w-xl border border-border-hair overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
          <Search size={18} strokeWidth={1.75} className="text-ink-faint shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Tìm task trong sprint…"
            className="flex-1 bg-transparent outline-none text-[16px] text-ink placeholder:text-ink-faint"
          />
          <kbd className="text-[11px] text-ink-faint border border-border rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>
        <div className="max-h-[320px] overflow-auto px-2 py-1.5">
          {results.length === 0 ? (
            <div className="px-4 py-7 text-center text-sm text-ink-faint">
              {q.trim() ? 'Không có task nào khớp.' : 'Sprint này chưa có task.'}
            </div>
          ) : (
            results.map((t, i) => {
              const assignee = t.assigneeId ? memberById.get(t.assigneeId) : null
              return (
                <button
                  key={t.id}
                  onClick={() => onSelect(t.id)}
                  onMouseEnter={() => setSel(i)}
                  className={`w-full text-left flex items-center gap-3 px-2.5 py-2 rounded-lg transition ${
                    i === sel ? 'bg-accent-soft' : ''
                  }`}
                >
                  <span
                    className={`w-3 h-3 rounded-full shrink-0 ${DOT[t.status] ?? 'bg-status-todo'}`}
                    aria-hidden
                  />
                  <span
                    className={`flex-1 min-w-0 truncate text-sm ${
                      t.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'
                    }`}
                  >
                    {renderTitle(t.title)}
                  </span>
                  <span className="text-xs text-ink-faint tab-data shrink-0">
                    #{t.sequence}
                  </span>
                  {assignee ? (
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                      style={{ background: assignee.color ?? colorForName(assignee.name) }}
                      title={assignee.name}
                    >
                      {assignee.name.slice(0, 1).toUpperCase()}
                    </span>
                  ) : (
                    <span className="w-5 shrink-0 text-center text-ink-faint text-xs">—</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Capacity = single slim stacked bar + inline numbers (design-system §4.7).
 * The bar partitions the sprint's leaf tasks into three disjoint segments —
 * done / in-flight (owned, not done) / open (unowned) — that sum to `total`.
 * `notEstimated` rides the legend as a warning, never the bar.
 */
function CapacityBanner({
  total,
  pctAssigned,
  done,
  pctDone,
  inFlight,
  open,
  notEstimated,
}: {
  total: number
  pctAssigned: number
  done: number
  pctDone: number
  inFlight: number
  open: number
  notEstimated: number
}) {
  if (total === 0) {
    return (
      <div className="px-6 pt-5 pb-2">
        <div className="bg-surface rounded-[14px] px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_rgba(0,0,0,0.04)]">
          <div className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            Sprint capacity
          </div>
          <div className="text-[13px] text-ink-muted mt-0.5">
            No tasks yet — <span className="text-accent">add your first task below</span>.
          </div>
        </div>
      </div>
    )
  }
  const pct = (n: number) => `${(n / total) * 100}%`
  return (
    <div className="px-6 pt-5 pb-2">
      <div className="bg-surface rounded-[14px] px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_rgba(0,0,0,0.04)]">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            Sprint capacity
          </div>
          <div className="text-[12.5px] text-ink-muted tab-data">
            <span className="font-semibold text-ink">{total}</span> task
            {total === 1 ? '' : 's'} ·{' '}
            <span className="font-semibold text-ink">{pctDone}%</span> done ·{' '}
            <span className="font-semibold text-ink">{pctAssigned}%</span> assigned
          </div>
        </div>
        <div className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-canvas-sunk)]">
          {done > 0 && (
            <span
              className="capacity-seg h-full bg-status-done"
              style={{ width: pct(done) }}
            />
          )}
          {inFlight > 0 && (
            <span
              className="capacity-seg h-full bg-accent"
              style={{ width: pct(inFlight) }}
            />
          )}
          {open > 0 && (
            <span
              className="capacity-seg h-full bg-border-strong"
              style={{ width: pct(open) }}
            />
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-muted tab-data">
          <LegendDot color="var(--color-status-done)" n={done} label="done" />
          <LegendDot color="var(--color-accent)" n={inFlight} label="in progress" />
          <LegendDot color="var(--color-border-strong)" n={open} label="open" />
          {notEstimated > 0 && (
            <span className="text-warn-ink">
              ⚠ {notEstimated} not estimated
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function LegendDot({
  color,
  n,
  label,
}: {
  color: string
  n: number
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span className="font-semibold text-ink">{n}</span> {label}
    </span>
  )
}

/**
 * Horizontal strip of selectable Mondays for sprint creation. Because the spec
 * locks a sprint start to a Monday, a month calendar would be ~25/30 dead cells;
 * the strip shows only valid options. See design-docs/sprint-cadence.md.
 */
function MondayStrip({
  mondays,
  value,
  thisWeekMonday,
  onSelect,
}: {
  mondays: string[]
  value: string
  thisWeekMonday: string
  onSelect: (iso: string) => void
}) {
  // Real radiogroup keyboard contract: one tab stop (the checked chip), arrow
  // keys + Home/End move the selection and focus. See design-system interaction.
  const ref = useRef<HTMLDivElement>(null)
  const idx = mondays.indexOf(value)
  const move = (next: number) => {
    const i = Math.max(0, Math.min(mondays.length - 1, next))
    onSelect(mondays[i])
    ref.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [i]?.focus()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault(); move(idx - 1); break
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault(); move(idx + 1); break
      case 'Home':
        e.preventDefault(); move(0); break
      case 'End':
        e.preventDefault(); move(mondays.length - 1); break
    }
  }
  return (
    <div
      ref={ref}
      onKeyDown={onKeyDown}
      className="mt-1 flex gap-2 overflow-x-auto pb-1.5 px-0.5"
      role="radiogroup"
      aria-label="Sprint start (Monday)"
    >
      {mondays.map((iso) => {
        const [, mm, dd] = iso.split('-').map(Number)
        const selected = iso === value
        const isThisWeek = iso === thisWeekMonday
        return (
          <button
            key={iso}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(iso)}
            className={`flex-none min-w-[60px] text-center rounded-[11px] border px-2.5 py-2 transition tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
              selected
                ? 'bg-accent border-accent text-white'
                : 'bg-surface border-border hover:border-border-strong'
            }`}
          >
            <div className={`text-[10px] font-semibold ${selected ? 'text-white/80' : 'text-ink-faint'}`}>
              Mon
            </div>
            <div className="text-[17px] font-bold tracking-[-0.02em] leading-tight">{dd}</div>
            <div className={`text-[10px] ${selected ? 'text-white/80' : 'text-ink-faint'}`}>
              {MON[mm - 1]}
            </div>
            {isThisWeek && (
              <span className={`block text-[9px] font-bold mt-0.5 ${selected ? 'text-white/90' : 'text-accent'}`}>
                this week
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function NewSprintDialog({
  projectId,
  lastSprint,
  nextNumber,
  onClose,
  onCreate,
}: {
  projectId: string
  /** Latest non-archived sprint — drives the back-to-back date default. */
  lastSprint: Sprint | null
  /** Next `Sprint N` number (computed excluding archived collisions). */
  nextNumber: number
  onClose: () => void
  onCreate: (s: Sprint) => void
}) {
  // Computed once on mount — the dialog is mounted fresh per open, so the
  // suggestion shouldn't shift while it's open.
  const todayStr = useMemo(() => todayLocalISO(), [])

  // Defaults are computed once on mount — opening the dialog twice without
  // creating a sprint shouldn't change the suggestion. Start locks to a Monday
  // and length is a fixed 2 weeks (see design-docs/sprint-cadence.md).
  const defaults = useMemo(() => {
    const { startDate, endDate } = defaultSprintDates(
      lastSprint?.endDate ?? null,
      todayStr
    )
    return { name: `Sprint ${nextNumber}`, startDate, endDate }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Name is automatic + locked (Sprint N) — not editable. The optional note
  // carries the "what is this sprint about". See sprints.md.
  const name = defaults.name
  // Start is the only real choice and must be a Monday — picked from a strip of
  // upcoming Mondays anchored at the default. End is fully derived (start + 13).
  const [startDate, setStartDate] = useState(defaults.startDate)
  const mondays = useMemo(
    () => upcomingMondays(defaults.startDate, 9),
    [defaults.startDate]
  )
  const thisWeekMonday = useMemo(() => snapToMonday(todayStr), [todayStr])
  const endDate = useMemo(() => sprintEndForStart(startDate), [startDate])
  const [note, setNote] = useState('')

  const submit = async () => {
    const noteTrimmed = note.trim()
    const sprint: Sprint = {
      id: uid(),
      projectId,
      name,
      startDate,
      endDate,
      ...(noteTrimmed ? { note: noteTrimmed } : {}),
    }
    await db.sprints.add(sprint)
    await logEvent({
      projectId,
      sprintId: sprint.id,
      taskId: null,
      taskSeq: null,
      taskTitle: null,
      kind: 'sprint_started',
      from: null,
      to: null,
      ts: Date.now(),
    })
    onCreate(sprint)
  }

  return (
    <div
      className="dlg-scrim fixed inset-0 bg-black/25 backdrop-blur-md flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="dlg-sheet bg-surface text-ink rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.28)] w-full max-w-md p-6 space-y-4 border border-border-hair"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[19px] font-bold tracking-[-0.014em]">New Sprint</h2>
        <div className="block">
          <span className="text-xs text-ink-muted">Name</span>
          {/* Locked: names are automatic (Sprint N), not editable. */}
          <div className="mt-1 w-full flex items-center gap-2 px-3 py-2 bg-fill rounded-[8px] text-sm">
            <span className="font-semibold text-ink">{name}</span>
            <Lock size={13} className="ml-auto text-ink-faint" aria-label="Locked" />
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-faint leading-snug">
            Sprint names are automatic — add a note below to describe it.
          </p>
        </div>
        <div className="block">
          <span className="text-xs text-ink-muted">Start · pick a Monday</span>
          <MondayStrip
            mondays={mondays}
            value={startDate}
            thisWeekMonday={thisWeekMonday}
            onSelect={setStartDate}
          />
          {/* End is derived (start + 13 = a Sunday) — read-only range, not a picker. */}
          <div className="mt-2 flex items-center gap-2.5 px-3 py-2 bg-accent-soft rounded-[8px] text-sm">
            <span className="text-ink-faint" aria-hidden="true">
              →
            </span>
            <span className="font-semibold tabular-nums">
              {formatShortDate(endDate)}
            </span>
            <span className="ml-auto text-[11px] font-semibold text-accent bg-surface rounded-full px-2 py-0.5">
              2 weeks
            </span>
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-faint leading-snug tabular-nums">
            {formatSprintRange(startDate, endDate)} · ends on a Sunday, next sprint
            starts the following Monday.
          </p>
        </div>
        <label className="block">
          <span className="text-xs text-ink-muted">Note — optional</span>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              // Multi-line: ⌘/Ctrl+Enter submits; plain Enter is a newline.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            rows={2}
            placeholder="What's the focus of this sprint?"
            className="mt-1 w-full px-3 py-2 border border-border bg-surface rounded-[8px] text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
          />
        </label>
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
      className="dlg-scrim fixed inset-0 bg-black/25 backdrop-blur-md flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="dlg-sheet bg-surface text-ink rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.28)] w-full max-w-md p-6 space-y-4 border border-border-hair"
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

/** New-collection modal — same Cupertino sheet as New Sprint, name only. */
function NewCollectionDialog({
  projectId,
  onClose,
  onCreate,
}: {
  projectId: string
  onClose: () => void
  onCreate: (c: Collection) => void
}) {
  const [name, setName] = useState('')
  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const c = await createCollection(projectId, trimmed)
    onCreate(c)
  }
  return (
    <div
      className="dlg-scrim fixed inset-0 bg-black/25 backdrop-blur-md flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="dlg-sheet bg-surface text-ink rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.28)] w-full max-w-md p-6 space-y-4 border border-border-hair"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[19px] font-bold tracking-[-0.014em]">
          New Collection
        </h2>
        <label className="block">
          <span className="text-xs text-ink-muted">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Live-ops 2026"
            className="mt-1 w-full px-3 py-2 border border-border bg-surface rounded-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
          />
        </label>
        <div className="text-xs text-ink-muted">
          A collection holds tasks outside any sprint — events, changelog,
          ad-hoc items. It starts with one table you can rename.
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
 * Single adaptive view toggle for the top context bar. The segments are passed in
 * via `options`, so the same component renders the sprint set (List/Board/Timeline)
 * or the collection set (List/Calendar) — one toggle, container-aware (collections.md).
 */
function ViewToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string; Icon: typeof List }[]
  onChange: (v: T) => void
}) {
  // Sliding white indicator (macOS segmented control): measure the active
  // segment after layout and glide the pill to it, instead of swapping a
  // per-button background. Re-measures on value/options change.
  const ref = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-seg="${value}"]`)
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth })
  }, [value, options])
  return (
    <div
      ref={ref}
      className="relative inline-flex items-center gap-0.5 p-0.5 rounded-[9px] bg-fill"
    >
      {ind && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 rounded-[7px] bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)] transition-[left,width] duration-[280ms] ease-[cubic-bezier(.32,.72,0,1)]"
          style={{ left: ind.left, width: ind.width }}
        />
      )}
      {options.map(({ value: v, label, Icon }) => {
        const active = value === v
        return (
          <button
            key={v}
            data-seg={v}
            onClick={() => onChange(v)}
            className={`relative z-10 flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-[7px] transition-colors ${
              active ? 'text-ink' : 'text-ink-muted hover:text-ink'
            }`}
            title={`${label} view`}
            aria-pressed={active}
          >
            <Icon size={13} strokeWidth={active ? 2 : 1.75} />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

const SPRINT_VIEWS: { value: ViewMode; label: string; Icon: typeof List }[] = [
  { value: 'list', label: 'List', Icon: List },
  { value: 'board', label: 'Board', Icon: LayoutGrid },
  { value: 'timeline', label: 'Timeline', Icon: GanttChartSquare },
]
const COLLECTION_VIEWS: { value: CollectionViewMode; label: string; Icon: typeof List }[] = [
  { value: 'list', label: 'List', Icon: List },
  { value: 'calendar', label: 'Calendar', Icon: Calendar },
]

/**
 * Roll over preview popover (design-system §5.5 portal pattern). Anchored to the
 * Roll over button; previews the exact unfinished tasks that will move into the
 * next sprint, then commits on Move. Portal + fixed position (the main column is
 * overflow-hidden and would clip an in-flow popover); re-pins on scroll/resize,
 * flips up near the viewport edge; outside-click / Esc to dismiss. See
 * sprint-rollover.md. Move-all — no per-task selection (matches the DB move).
 */
const ROLL_PRIORITY: Record<string, { label: string; bg: string; fg: string }> = {
  urgent: { label: 'Urgent', bg: 'rgba(255,59,48,0.12)', fg: 'color-mix(in srgb, var(--color-priority-urgent) 100%, #000 22%)' },
  high: { label: 'High', bg: 'rgba(255,149,0,0.15)', fg: 'color-mix(in srgb, var(--color-priority-high) 100%, #000 22%)' },
}
function RolloverPopover({
  anchorRef,
  tasks,
  members,
  fromName,
  toName,
  onMove,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  tasks: Task[]
  members: Member[]
  fromName: string
  toName: string
  onMove: () => void
  onClose: () => void
}) {
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })
  const WIDTH = 360
  const memberOf = (id: string | null) =>
    id ? members.find((m) => m.id === id) ?? null : null

  useLayoutEffect(() => {
    const pin = () => {
      const r = anchorRef.current?.getBoundingClientRect()
      if (!r) return
      const h = popRef.current?.offsetHeight || 320
      let left = Math.min(r.left, window.innerWidth - 8 - WIDTH)
      left = Math.max(8, left)
      let top = r.bottom + 8
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8)
      setPos({ top, left })
    }
    pin()
    window.addEventListener('scroll', pin, true)
    window.addEventListener('resize', pin)
    return () => {
      window.removeEventListener('scroll', pin, true)
      window.removeEventListener('resize', pin)
    }
  }, [anchorRef, tasks.length])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (
        popRef.current && !popRef.current.contains(t) &&
        anchorRef.current && !anchorRef.current.contains(t)
      ) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        anchorRef.current?.focus?.()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onClose])

  return createPortal(
    <div
      ref={popRef}
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: WIDTH }}
      className="dlg-sheet z-50 bg-surface text-ink rounded-[14px] shadow-[0_12px_40px_rgba(0,0,0,0.18),0_0_0_0.5px_rgba(0,0,0,0.06)] overflow-hidden"
      role="dialog"
      aria-label="Roll over unfinished tasks"
    >
      <div className="px-4 pt-3.5 pb-2.5">
        <div className="flex items-center gap-1.5 text-[14px] font-bold tracking-[-0.01em]">
          <span>Roll over</span>
          <ArrowRightCircle size={13} className="text-ink-faint" aria-hidden />
          <span className="truncate">{toName}</span>
        </div>
        <div className="text-xs text-ink-muted mt-0.5">
          {tasks.length} unfinished task{tasks.length === 1 ? '' : 's'} from “{fromName}”
        </div>
      </div>
      <div className="max-h-[240px] overflow-auto px-2 pb-1">
        {tasks.map((t) => {
          const m = memberOf(t.assigneeId)
          const overdue = isOverdue(t.dueDate, false)
          const pri = ROLL_PRIORITY[t.priority]
          return (
            <div
              key={t.id}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-[9px]"
            >
              {/* status: todo = empty ring, in_progress = half pie */}
              {t.status === 'in_progress' ? (
                <span
                  className="w-4 h-4 rounded-full shrink-0 border-2 border-accent"
                  style={{ background: 'conic-gradient(var(--color-accent) 50%, transparent 0)' }}
                  aria-hidden
                />
              ) : (
                <span className="w-4 h-4 rounded-full shrink-0 border-2 border-border-strong" aria-hidden />
              )}
              <span className="text-[11.5px] text-ink-faint tab-data w-[22px] shrink-0">#{t.sequence}</span>
              {pri && (
                <span
                  className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: pri.bg, color: pri.fg }}
                >
                  {pri.label}
                </span>
              )}
              <span className="flex-1 min-w-0 text-[13.5px] truncate">{t.title}</span>
              {m ? (
                <span
                  className="w-5 h-5 rounded-full shrink-0 grid place-items-center text-[10px] font-semibold text-white"
                  style={{ background: m.color ?? colorForName(m.name) }}
                  title={m.name}
                >
                  {m.name.charAt(0).toUpperCase()}
                </span>
              ) : (
                <span
                  className="w-5 h-5 rounded-full shrink-0 grid place-items-center text-[10px] text-ink-faint border border-dashed border-border-strong"
                  title="Unassigned"
                  aria-label="Unassigned"
                >
                  ·
                </span>
              )}
              <span
                className={`text-[11.5px] tab-data shrink-0 min-w-[42px] text-right ${
                  overdue ? 'text-red-500 font-medium' : 'text-ink-muted'
                }`}
              >
                {t.dueDate ? formatShortDate(t.dueDate) : '—'}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-border-hair">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-[13.5px] font-medium text-ink-muted hover:bg-surface-hover rounded-[8px] transition"
        >
          Cancel
        </button>
        <button
          onClick={onMove}
          className="px-3.5 py-1.5 text-[13.5px] font-medium bg-accent hover:bg-accent-hover text-white rounded-[8px] transition"
        >
          Move {tasks.length}
        </button>
      </div>
    </div>,
    document.body
  )
}

/**
 * Sprint goal-note banner (design-system §5.11 idiom). A thin chrome strip
 * under the header. Has a note → editable text (click to edit; ⌘/Ctrl+Enter or
 * blur commits, Esc cancels). No note → calm dashed "+ Add sprint note" slot
 * that turns accent on hover. Replaces the old inline rename — sprint names are
 * locked now; this carries the free-text context. See sprints.md.
 */
function SprintNoteBanner({ sprint }: { sprint: Sprint }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sprint.note ?? '')
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(sprint.note ?? '')
      requestAnimationFrame(() => {
        taRef.current?.focus()
        taRef.current?.select()
      })
    }
  }, [editing, sprint.note])

  const commit = async () => {
    setEditing(false)
    if (draft.trim() !== (sprint.note ?? '')) {
      await setSprintNote(sprint.id, draft)
    }
  }
  const cancel = () => {
    setDraft(sprint.note ?? '')
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="shrink-0 bg-surface border-b border-border-hair px-5 py-2.5">
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          onBlur={() => void commit()}
          rows={2}
          placeholder="What's the focus of this sprint?"
          className="w-full px-2.5 py-1.5 text-[13.5px] leading-relaxed text-ink bg-surface border border-accent rounded-[8px] resize-y focus:outline-none focus:ring-2 focus:ring-accent/40 transition"
          aria-label="Sprint note"
        />
      </div>
    )
  }

  if (!sprint.note) {
    return (
      <div className="shrink-0 bg-surface border-b border-border-hair px-5 py-2">
        <button
          onClick={() => setEditing(true)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[12.5px] font-semibold text-ink-muted border border-dashed border-border rounded-[10px] transition hover:text-accent hover:border-accent/40 hover:bg-accent-soft"
        >
          <StickyNote size={14} strokeWidth={2} />
          Add sprint note
        </button>
      </div>
    )
  }

  return (
    <div className="shrink-0 bg-surface border-b border-border-hair px-5 py-2.5">
      <div
        className="group/note flex items-start gap-2.5 cursor-text rounded-[8px] -mx-1.5 px-1.5 py-1 hover:bg-surface-hover transition"
        onClick={() => setEditing(true)}
        title="Click to edit note"
      >
        <StickyNote
          size={15}
          strokeWidth={1.9}
          className="text-accent shrink-0 mt-0.5"
          aria-hidden
        />
        <span className="flex-1 min-w-0 text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap break-words">
          {sprint.note}
        </span>
      </div>
    </div>
  )
}

export default App
