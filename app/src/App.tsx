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
  ArrowRight,
  CalendarClock,
  CalendarCheck2,
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
  PanelLeft,
  Package,
  Database,
  FolderDown,
  Check,
  Link2,
  TriangleAlert,
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
  planSprintRollover,
  createSprint,
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
import { useConfirm } from './confirm-context'
import { ModalSheet } from './ModalSheet'
import { SprintView } from './SprintView'
import { BoardView } from './BoardView'
import { GanttView } from './GanttView'
import { ActivityLog } from './ActivityLog'
import { VersionFooter } from './VersionFooter'
import { IS_TAURI } from './backup'
import { startAutoBackup } from './backup-tauri'
import { BackupSettingsModal } from './BackupSettingsModal'
import { ShareLinkModal } from './ShareLinkModal'
import { CollectionShareModal } from './CollectionShareModal'
import { buildSnapshot, buildCollectionSnapshot } from './share-snapshot'
import { membersWithTasks } from './telegram-export'
import { usePinnedPopover } from './usePinnedPopover'
import { ProjectSettingsView } from './ProjectSettingsView'
import { HomeDashboard } from './HomeDashboard'
import { Avatar, ProjectTile } from './members'
import {
  formatSprintRange,
  formatShortDate,
  isOverdue,
  useBrandTheme,
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
  sprintExpirySignal,
  type SprintExpiry,
  MON,
  latestActiveSprint,
  nextSprintNumber,
  sprintToSelect,
  PRIORITY_TAG,
} from './lib'

const CURRENT_PROJECT_KEY = 'plan-up:currentProjectId'
const CURRENT_SPRINT_KEY = 'plan-up:currentSprintId'
const VIEW_KEY = 'plan-up:view'

// Desktop window chrome (overlay title bar + traffic-light icon rail) is normally
// gated on the real Tauri runtime. FORCE_DESKTOP_CHROME lets the browser dev server
// render the exact same chrome — with fake traffic lights — against real IndexedDB
// data, for previewing the desktop layout. Toggle with `?desktop=1` or
// localStorage['plan-up:forceDesktopChrome']='1'. True Tauri-only features
// (auto-backup, updater) stay gated on IS_TAURI and are never faked. See
// desktop-app-tauri.md.
const FORCE_DESKTOP_CHROME =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).has('desktop') ||
    window.localStorage?.getItem('plan-up:forceDesktopChrome') === '1')
const DESKTOP_CHROME = IS_TAURI || FORCE_DESKTOP_CHROME
type ViewMode = 'list' | 'board' | 'timeline'
type CollectionViewMode = 'list' | 'calendar'

// Leading row glyph encoding a sprint's temporal state (upcoming / in-progress / past),
// using only existing status tokens — no new colour. `onAccent` = rendered on the
// selected accent-filled row, so shapes switch to white. See sprints.md (State glyph).
function SprintStateDot({
  state,
  done,
  onAccent,
  attention = false,
}: {
  state: 'upcoming' | 'progress' | 'past'
  done: boolean
  onAccent: boolean
  /** Lapsed sprint still holding open work — amber "needs attention" tone (see
   *  sprint-expiry-signal.md). Ignored on the active row (dot stays white). */
  attention?: boolean
}) {
  // currentColor drives every stroke/fill; the halo is the same colour at low opacity.
  const tone = onAccent
    ? 'text-white'
    : attention
      ? 'text-priority-high'
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
/**
 * Arrow-key navigation for a `role="menu"` container (overlay contract §6.5):
 * ↓/↑ move focus through the enabled menuitems (wrapping), Home/End jump.
 * Attach as onKeyDown on the menu div; pair with focusFirstMenuItem on open.
 */
/** Persistent dismissible data-safety notice (persistence-and-backup.md §origin
 *  safety) — same card DNA as the toast, but amber and it stays until dismissed. */
function DataNotice({
  title,
  detail,
  onDismiss,
}: {
  title: string
  detail: string
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
      className="pointer-events-auto flex items-start gap-3 min-w-[340px] max-w-[500px] px-4 py-3 rounded-[14px] bg-surface border border-border-hair animate-toast-in shadow-[0_12px_32px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.55),0_0_0_0.5px_rgba(255,255,255,0.08)]"
    >
      <span className="shrink-0 w-[34px] h-[34px] rounded-full flex items-center justify-center bg-priority-high/15 text-warn-ink">
        <TriangleAlert size={18} strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-ink">{title}</div>
        <div className="text-[12px] text-ink-muted mt-0.5">{detail}</div>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-ink-faint hover:text-ink hover:bg-surface-hover transition"
      >
        <X size={16} />
      </button>
    </div>
  )
}

function menuKeyNav(e: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const items = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role^="menuitem"]:not([disabled])'
    )
  )
  if (items.length === 0) return
  e.preventDefault()
  const i = items.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    e.key === 'ArrowDown'
      ? items[(i + 1) % items.length]
      : e.key === 'ArrowUp'
        ? items[(i - 1 + items.length) % items.length]
        : e.key === 'Home'
          ? items[0]
          : items[items.length - 1]
  next.focus()
}

/** Focus a menu's first enabled item on open so arrow keys work immediately. */
function focusFirstMenuItem(container: HTMLElement | null) {
  container
    ?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not([disabled])')
    ?.focus()
}

type ToastState = {
  title: string
  detail: string
  onUndo?: () => void
  /** 'error' renders the red ⚠ variant; default is the green check. */
  kind?: 'success' | 'error'
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
  // Persisted so a reload/relaunch lands back on the same sprint (not always the
  // latest). The selection effect below validates the restored id against the
  // current project's sprints and falls back to `sprintToSelect` if it's stale.
  const [currentSprintId, setCurrentSprintId] = useState<string | null>(
    () => safeStorage.get(CURRENT_SPRINT_KEY)
  )
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
  // Top-level screen: the Home overview vs a single project. Persisted so a
  // reload lands back where you were (Home is never force-shown over a project).
  // See design-docs/home-dashboard.md.
  //
  // HOME_ENABLED gates the whole Home / All-projects overview off (temporarily
  // hidden 2026-07-06, user request). While false: the "Home / All projects"
  // switcher item is dropped, the persisted screen is ignored (always lands on
  // 'project'), and HomeDashboard is never rendered. Flip back to true to restore
  // the overview — nothing else was removed. See design-docs/home-dashboard.md.
  const HOME_ENABLED = false
  const SCREEN_KEY = 'plan-up:screen'
  const [screen, setScreenState] = useState<'home' | 'project'>(
    () => (HOME_ENABLED && safeStorage.get(SCREEN_KEY) === 'home' ? 'home' : 'project')
  )
  const setScreen = (s: 'home' | 'project') => {
    setScreenState(s)
    safeStorage.set(SCREEN_KEY, s)
  }
  const goHome = () => {
    if (!HOME_ENABLED) return
    setSettingsOpen(false)
    setShowActivity(false)
    setScreen('home')
  }
  const openProject = (id: string) => {
    setCurrentProjectId(id)
    setScreen('project')
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
  // When the New Sprint dialog is opened from the expiry banner's "carry over"
  // path, this holds the lapsed sprint to pull unfinished tasks from on create.
  // Null for every other open path (empty state, `n` key, sidebar +). See
  // design-docs/sprint-expiry-signal.md.
  const [carryOnCreate, setCarryOnCreate] = useState<{
    count: number
    fromId: string
    fromName: string
  } | null>(null)
  const [backupSettingsOpen, setBackupSettingsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [collShareOpen, setCollShareOpen] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)
  // Project switcher (header dropdown) — replaces the old icon rail. PORTALED to
  // <body>: the sidebar <aside> has `.vibrancy` (its own backdrop-filter), which
  // makes it a backdrop root — a nested .glass-popover inside it renders with no
  // blur (WebKit/WKWebView), so the menu looked transparent. Same fix as the
  // export split-menu: portal out + pin to the trigger rect.
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const switcherRef = useRef<HTMLButtonElement>(null)
  const switcherPopRef = useRef<HTMLDivElement>(null)
  const switcherPos = usePinnedPopover({
    open: switcherOpen,
    onClose: () => setSwitcherOpen(false),
    anchorRef: switcherRef,
    popRef: switcherPopRef,
    place: () => {
      const r = switcherRef.current?.getBoundingClientRect()
      if (!r) return null
      // Full-width under the trigger, matching the old left-2.5/right-2.5 inset.
      return { top: r.bottom + 6, left: r.left, width: r.width }
    },
  })
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
  // Export split-menu (header) — "this project" vs "full backup". The panel is
  // PORTALED to <body>: the glass toolbar has its own backdrop-filter, which
  // makes it a backdrop root — a nested .glass-popover inside it can't blur the
  // page behind, so the menu rendered transparent (same reason every other
  // popover in the app portals out).
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const exportMenuPanelRef = useRef<HTMLDivElement>(null)
  const exportMenuPos = usePinnedPopover({
    open: exportMenuOpen,
    onClose: () => setExportMenuOpen(false),
    anchorRef: exportMenuRef,
    popRef: exportMenuPanelRef,
    place: () => {
      const r = exportMenuRef.current?.getBoundingClientRect()
      if (!r) return null
      // Right-aligned under the trigger, like the old absolute placement.
      return { top: r.bottom + 6, right: window.innerWidth - r.right }
    },
  })
  // Non-destructive import feedback (add-as-new). Replace-all keeps its dialog.
  const [toast, setToast] = useState<ToastState>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (t: NonNullable<ToastState>) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(t)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    []
  )
  const [dark, setDark] = useDarkMode()
  // Brand theme still applies (Fire default / persisted), but the toggle is hidden
  // — call for its side-effect only. See design-docs/brand-theme.md.
  useBrandTheme()
  // Data-safety notices (persistence-and-backup.md §origin safety): an empty DB
  // on a known-good browser usually means a DIFFERENT ORIGIN (Vercel preview
  // URL, www vs apex) — surface it instead of silently seeding demo data.
  const [seedNotice, setSeedNotice] = useState(false)
  const [previewNotice, setPreviewNotice] = useState(
    () =>
      __VERCEL_ENV__ === 'preview' &&
      safeStorage.get('plan-up:previewNoticeAck') !== '1'
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Scroll container for the sprint views — search-palette jump-to scrolls it to
  // the picked task (we never use scrollIntoView; it breaks this container).
  const scrollRef = useRef<HTMLDivElement>(null)
  // Toolbar breadcrumb reveals the sprint date range once the page header's big
  // title scrolls out of view (app-shell v4.1). Cheap scrollTop threshold; React
  // bails on the setState when the boolean is unchanged, so scroll ticks don't
  // re-render.
  const [scrolled, setScrolled] = useState(false)

  // Resizable sprint panel. Width persisted across sessions. The sidebar is the
  // leftmost pane (the old icon rail is gone), so a drag maps to clientX, clamped.
  const SIDEBAR_MIN = 200
  const SIDEBAR_MAX = 460
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const s = Number(safeStorage.get('plan-up:sidebarWidth'))
    return s >= SIDEBAR_MIN && s <= SIDEBAR_MAX ? s : 248
  })
  useEffect(() => {
    safeStorage.set('plan-up:sidebarWidth', String(sidebarWidth))
  }, [sidebarWidth])
  // Collapse the whole sidebar (macOS sidebar.left idiom — app-shell v4.2). Fully
  // hidden (width 0), not a mini rail. `sidebarResizing` suppresses the width
  // transition while dragging the resize edge so the drag tracks the cursor 1:1.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => safeStorage.get('plan-up:sidebarCollapsed') === '1'
  )
  useEffect(() => {
    safeStorage.set('plan-up:sidebarCollapsed', sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault()
    setSidebarResizing(true)
    // rAF-coalesced: mousemove can fire far above the frame rate, and each
    // setSidebarWidth re-renders the whole App tree — one write per frame is
    // all the screen can show anyway.
    let raf = 0
    let nextW = 0
    const onMove = (ev: MouseEvent) => {
      nextW = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX))
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setSidebarWidth(nextW)
      })
    }
    const onUp = () => {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
        setSidebarWidth(nextW)
      }
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      setSidebarResizing(false)
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Desktop only: change-driven auto backup (design-docs/auto-backup.md).
  // No-ops on web; the disposer keeps StrictMode's double-mount clean.
  useEffect(() => startAutoBackup(), [])

  // Ask the browser to exempt this origin from storage eviction (Safari ITP
  // wipes unpersisted site data after 7 days without interaction). Best-effort:
  // denial or a missing API just keeps today's behavior.
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {})
  }, [])

  useEffect(() => {
    seedIfEmpty()
      .then((seeded) => {
        if (seeded && safeStorage.get('plan-up:seedNoticeAck') !== '1')
          setSeedNotice(true)
        return dedupeSprints()
      })
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

  // `undefined` (not `[]`) until seeded — an empty array reads as "no projects
  // exist" and would null the restored `currentProjectId` during the load
  // window, then fall back to projects[0]. `undefined` = "still loading".
  const projects = useLiveQuery<Project[] | undefined>(
    () => (seeded ? db.projects.orderBy('createdAt').toArray() : undefined),
    [seeded]
  )

  // Resolve current project: stored choice if still valid, else the first.
  // When the last project is deleted, clear the selection so the UI shows a
  // proper zero-project empty state instead of a stale (deleted) project.
  useEffect(() => {
    if (!projects) return
    if (projects.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync-with-liveQuery: validate the restored selection once data arrives
      if (currentProjectId) setCurrentProjectId(null)
      return
    }
    if (!currentProjectId || !projects.some((p) => p.id === currentProjectId)) {
      setCurrentProjectId(projects[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects])

  // While not-ready (pre-seed / no project chosen yet) the querier returns
  // `undefined`, NOT `[]` — an empty array reads as "this project has zero
  // sprints" and would wipe a restored selection (`currentSprintId`/collection)
  // during the load window. `undefined` means "still loading"; every consumer
  // already treats it that way (`sprints ?? []`, `!sprints`, `sprints?.`).
  const sprints = useLiveQuery<Sprint[] | undefined>(
    () =>
      seeded && currentProjectId
        ? db.sprints
            .where('projectId')
            .equals(currentProjectId)
            .sortBy('startDate')
        : undefined,
    [seeded, currentProjectId]
  )

  const collections = useLiveQuery<Collection[] | undefined>(
    () =>
      seeded && currentProjectId
        ? db.collections.where('projectId').equals(currentProjectId).sortBy('order')
        : undefined,
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

  // Items of the current collection — feeds the Export menu's collection
  // "Export as image…" action. See export-png.md / copy-to-telegram.md.
  const collectionItems = useLiveQuery<Task[]>(
    () =>
      currentCollectionId
        ? db.tasks.where('collectionId').equals(currentCollectionId).toArray()
        : Promise.resolve([] as Task[]),
    [currentCollectionId]
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

  // Per-sprint task counts for the sidebar panel + the project task total.
  // The querier aggregates in place and returns a compact JSON STRING: strings
  // compare by value, so useLiveQuery's setState bails out whenever a task
  // write didn't actually change any count (title keystrokes, date shifts…)
  // instead of re-rendering the whole App tree twice per edit. (A toArray()
  // result is a fresh array every emission — it can never bail.)
  const sprintCountsJson = useLiveQuery<string>(
    () =>
      seeded && currentProjectId
        ? db.tasks
            .where('projectId')
            .equals(currentProjectId)
            .toArray()
            .then((rows) => {
              const counts: Record<string, { total: number; done: number }> = {}
              // Leaf-based counting: a parent (a task with children) is a
              // CONTAINER whose status is a derived rollup, never stored as
              // 'done' — counting it would make a fully-done group read as
              // done<total (false "attention" dot + inflated count). Exclude
              // containers, matching the app's leaf-based counting everywhere
              // else (rollover, memberStats, share donut). See task-groups.md.
              const parentIds = new Set<string>()
              for (const t of rows) if (t.parentId) parentIds.add(t.parentId)
              let all = 0
              for (const t of rows) {
                if (parentIds.has(t.id)) continue // container, not a work item
                all++
                if (!t.sprintId) continue
                const c = (counts[t.sprintId] ??= { total: 0, done: 0 })
                c.total++
                if (t.status === 'done') c.done++
              }
              return JSON.stringify({ all, counts })
            })
        : Promise.resolve(''),
    [seeded, currentProjectId]
  )
  const { totalProjectTasks, sprintTaskCounts } = useMemo(() => {
    const empty = new Map<string, { total: number; done: number }>()
    if (!sprintCountsJson) return { totalProjectTasks: 0, sprintTaskCounts: empty }
    const parsed = JSON.parse(sprintCountsJson) as {
      all: number
      counts: Record<string, { total: number; done: number }>
    }
    return {
      totalProjectTasks: parsed.all,
      sprintTaskCounts: new Map(Object.entries(parsed.counts)),
    }
  }, [sprintCountsJson])

  // When project changes (or first loads), reset sprint to latest in project.
  useEffect(() => {
    if (!sprints) return
    if (sprints.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync-with-liveQuery: validate the restored selection once data arrives
      setCurrentSprintId(null)
      return
    }
    if (!currentSprintId || !sprints.some((s) => s.id === currentSprintId)) {
      // Prefer the latest non-archived sprint; never land on a blank view.
      setCurrentSprintId(sprintToSelect(sprints))
    }
  }, [sprints, currentSprintId])

  // Persist the selected sprint on every change so a reload restores it. Covers
  // all setter call sites (selection, rollover, archive, delete) in one place.
  useEffect(() => {
    if (currentSprintId) safeStorage.set(CURRENT_SPRINT_KEY, currentSprintId)
    else safeStorage.remove(CURRENT_SPRINT_KEY)
  }, [currentSprintId])

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync-with-liveQuery: dangling collection falls back to the sprint view
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
    // The list view may still be mounting (we just flipped it) — poll per
    // frame until the row exists instead of trusting one fixed delay, which
    // silently no-ops on slow machines / large sprints. Bounded so a task
    // that never renders (deleted mid-jump) can't poll forever.
    let tries = 60 // ~1s at 60fps
    const attempt = () => {
      const c = scrollRef.current
      const el = c?.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`)
      if (!c || !el) {
        if (--tries > 0) requestAnimationFrame(attempt)
        return
      }
      const top = c.scrollTop + (el.getBoundingClientRect().top - c.getBoundingClientRect().top) - 80
      c.scrollTo({ top: top < 0 ? 0 : top, behavior: 'smooth' })
      el.setAttribute('data-flash', '1')
      window.setTimeout(() => el.removeAttribute('data-flash'), 1300)
    }
    requestAnimationFrame(attempt)
  }

  // Keyboard shortcuts: / or ⌘K open the search palette, n new sprint, esc closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // A modal sheet / confirm owns the keyboard while open (overlay contract,
      // design-system §6.5): no palette/new-sprint over a dialog, and Escape is
      // the dialog's (its own listener stops propagation before we run anyway).
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return

      const t = e.target as HTMLElement | null
      const inField =
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

      const sprintActive = selKind === 'sprint' && !!currentSprintId

      // ⌘K / Ctrl+K — open palette from anywhere (works even while typing).
      // Same guards as `/`: the palette's jump-to needs the sprint list view
      // mounted, so it must not open over settings, Home, or a non-sprint
      // selection (it would mutate hidden view state and scroll nowhere).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (settingsOpen || !sprintActive || screen === 'home') return
        e.preventDefault()
        setPaletteOpen(true)
        return
      }

      // ⌘\ / Ctrl+\ — toggle the sidebar (macOS sidebar idiom, app-shell v4.2).
      // Global: works even while typing, like ⌘K.
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        setSidebarCollapsed((c) => !c)
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
        // no palette over settings / no sprint / on the Home overview
        if (settingsOpen || !sprintActive || screen === 'home') return
        e.preventDefault()
        setPaletteOpen(true)
      } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        // No dialog over settings / on Home / while viewing a collection —
        // consistent with `/`: sprint shortcuts only where sprints are on screen.
        if (settingsOpen || screen === 'home' || selKind !== 'sprint') return
        e.preventDefault()
        setShowNewSprint(true)
      } else if (e.key === 'd' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault()
        setDark(!dark)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [paletteOpen, dark, setDark, settingsOpen, showActivity, selKind, currentSprintId, screen])

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
      showToast({ kind: 'error', title: 'Import failed', detail: 'Not a valid JSON file.' })
      return
    }

    // Auto-detect file kind. A file that CLAIMS kind:'project' is committed to the
    // project path here — if it then fails full validation it's reported as a
    // corrupt project file, never re-routed to the destructive replace-all confirm
    // (a damaged share file must not raise a full-DB-wipe prompt).
    if (looksLikeProjectBundle(data)) {
      if (!isProjectBundle(data)) {
        showToast({
          kind: 'error',
          title: 'Import failed',
          detail: 'This project file is invalid or corrupt.',
        })
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
        showToast({
          kind: 'error',
          title: 'Import failed',
          detail: err instanceof Error ? err.message : String(err),
        })
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
      showToast({ title: 'Import successful', detail: 'All data replaced from the backup file.' })
    } catch (err) {
      showToast({
        kind: 'error',
        title: 'Import failed',
        detail: err instanceof Error ? err.message : String(err),
      })
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
  // Preview = the exact LEAF work items that roll over — computed by the same
  // planner the DB move uses (planSprintRollover), so the preview and the actual
  // move can never disagree. Container parents tag along silently and are not
  // listed/counted (leaf-based counting). Sorted by sequence for a stable list.
  const unfinishedTasks = useMemo(() => {
    const { moveIds, parentIds } = planSprintRollover(tasks ?? [])
    return (tasks ?? [])
      .filter((t) => moveIds.has(t.id) && !parentIds.has(t.id))
      .sort((a, b) => a.sequence - b.sequence)
  }, [tasks])
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
          className={`w-full text-left flex flex-col gap-0.5 px-2.5 py-1.5 mb-0.5 rounded-lg transition ${
            isActive ? 'brand-fill text-white' : 'text-ink hover:bg-surface-hover'
          }`}
        >
          {/* Top tier: state dot + name + task count (count fades on hover so it
             never collides with the absolute archive action that fades in). */}
          <span className="flex items-center gap-2 min-w-0">
            <SprintStateDot
              state={state}
              done={allDone}
              onAccent={isActive}
              attention={state === 'past' && !!c && c.total > 0 && c.done < c.total}
            />
            {/* Note glyph hugs the title text (not the row edge). See sprint-archive.md. */}
            <span className="flex items-center gap-1.5 min-w-0 flex-1">
              <span
                className={`min-w-0 truncate text-[14px] font-medium ${
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
            {!archived && c && c.total > 0 && (
              <span
                className={`shrink-0 text-[11.5px] tab-data transition-opacity group-hover/row:opacity-0 ${
                  isActive ? 'text-white/80' : 'text-ink-faint'
                }`}
              >
                {c.total}
              </span>
            )}
          </span>
          {/* Second tier: date range, indented under the name (dot width + gap). */}
          <span
            className={`block truncate text-[11.5px] leading-tight pl-[18px] tab-data ${
              isActive ? 'text-white/80' : 'text-ink-faint'
            }`}
          >
            {formatSprintRange(s.startDate, s.endDate)}
            {aDate && ` · archived ${MON[aDate.getMonth()]} ${aDate.getDate()}`}
          </span>
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

  // This early return MUST stay below every hook: seedError flips from null to
  // set on a later render (the seeding effect's catch), and an early return
  // above the hooks would change the hook count mid-lifecycle — React throws
  // "Rendered fewer hooks than expected" and the friendly error screen never
  // shows.
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
          <pre className="text-xs text-overdue bg-overdue/[0.07] p-2 rounded">
            {seedError}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex ambient-canvas text-ink overflow-hidden">
      {/* Browser-only preview: paint fake macOS traffic lights so `?desktop=1`
          shows the real desktop layout. Real Tauri draws OS lights instead. */}
      {FORCE_DESKTOP_CHROME && !IS_TAURI && (
        <div className="fixed top-[11px] left-[18px] z-[60] flex gap-2 pointer-events-none">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
      )}
      {HOME_ENABLED && screen === 'home' ? (
        <HomeDashboard
          projects={projects ?? []}
          onOpenProject={openProject}
          onNewProject={() => setShowNewProject(true)}
          dark={dark}
          onToggleDark={() => setDark(!dark)}
        />
      ) : (
      <>
      {/* Secondary panel: macOS vibrancy sidebar, accent-filled active row.
          Collapses to width 0 (app-shell v4.2); `inert` when collapsed so its
          controls leave the tab order. Width transition off during drag-resize. */}
      <aside
        className={`vibrancy shrink-0 border-border-hair flex flex-col overflow-hidden relative ${
          sidebarCollapsed ? '' : 'border-r'
        } ${
          sidebarResizing
            ? ''
            : 'transition-[width] duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none'
        }`}
        style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
        aria-hidden={sidebarCollapsed}
        inert={sidebarCollapsed}
      >
        {/* Desktop overlay title bar (desktop-app-tauri.md): the traffic lights
            float over this strip; it doubles as the window drag region. */}
        {DESKTOP_CHROME && <div data-tauri-drag-region className="h-[34px] shrink-0" />}
        {currentProject ? (
          <>
            <div className="px-2.5 pt-2.5 pb-2 relative">
              {/* Project switcher — cover-strip header (app-shell v5): the
                  project's own photo (or color) makes a blurred backdrop, a
                  48px sharp tile + name + counts ride on top. Click = switch
                  project popover; gear = settings. */}
              <div className="relative rounded-[12px] overflow-hidden">
                {currentProject.icon?.startsWith('data:') ? (
                  <div
                    className="absolute inset-0 bg-cover bg-center blur-[18px] saturate-[1.3] scale-[1.6] opacity-50 dark:opacity-40"
                    style={{ backgroundImage: `url(${currentProject.icon})` }}
                    aria-hidden
                  />
                ) : (
                  <div
                    className="absolute inset-0 opacity-[0.14] dark:opacity-[0.2]"
                    style={{
                      background:
                        currentProject.color ?? colorForName(currentProject.name),
                    }}
                    aria-hidden
                  />
                )}
                <div
                  className="absolute inset-0 bg-gradient-to-b from-transparent to-canvas/55"
                  aria-hidden
                />
                <div className="relative flex items-center">
                  <button
                    ref={switcherRef}
                    onClick={() => setSwitcherOpen((v) => !v)}
                    aria-haspopup="menu"
                    aria-expanded={switcherOpen}
                    title="Switch project"
                    className="flex-1 min-w-0 flex items-center gap-3 px-2.5 py-2.5 text-left hover:bg-surface-hover/60 transition"
                  >
                    <ProjectTile
                      project={currentProject}
                      size={48}
                      className="shadow-[0_2px_5px_rgba(0,0,0,0.22),0_0_0_0.5px_rgba(255,255,255,0.18)]"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-[15.5px] font-semibold tracking-[-0.014em] text-ink">
                        {currentProject.name}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-muted">
                        <span className="tab-data">{sprints?.length ?? 0}</span> sprint
                        {(sprints?.length ?? 0) === 1 ? '' : 's'} ·{' '}
                        <span className="tab-data">{totalProjectTasks}</span>{' '}
                        task{totalProjectTasks === 1 ? '' : 's'}
                      </span>
                    </span>
                    <ChevronDown
                      size={16}
                      className={`shrink-0 text-ink-faint transition-transform ${
                        switcherOpen ? 'rotate-180' : ''
                      }`}
                      aria-hidden
                    />
                  </button>
                </div>
              </div>
              {switcherOpen && switcherPos && createPortal(
                <div
                  ref={(el) => {
                    switcherPopRef.current = el
                    focusFirstMenuItem(el)
                  }}
                  role="menu"
                  onKeyDown={menuKeyNav}
                  style={{
                    position: 'fixed',
                    top: switcherPos.top,
                    left: switcherPos.left,
                    width: switcherPos.width,
                  }}
                  className="z-50 glass-popover rounded-[13px] p-1.5"
                >
                  <div className="px-2.5 pt-1 pb-1 text-[11px] font-semibold text-ink-faint tracking-[0.01em]">
                    Projects
                  </div>
                  <div className="max-h-[min(52vh,380px)] overflow-y-auto">
                    {projects?.map((p) => {
                      const isActive = p.id === currentProjectId
                      return (
                        <button
                          key={p.id}
                          role="menuitemradio"
                          aria-checked={isActive}
                          aria-current={isActive ? 'true' : undefined}
                          onClick={() => {
                            openProject(p.id)
                            setSwitcherOpen(false)
                          }}
                          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[9px] text-left text-[13.5px] transition ${
                            isActive ? 'bg-accent-soft' : 'hover:bg-surface-hover'
                          }`}
                        >
                          <ProjectTile project={p} size={22} />
                          <span className="flex-1 min-w-0 truncate font-medium text-ink">
                            {p.name}
                          </span>
                          {isActive && (
                            <Check
                              size={15}
                              strokeWidth={2.4}
                              className="shrink-0 text-accent"
                              aria-hidden
                            />
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <div className="h-px bg-border-hair mx-1.5 my-1" />
                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowNewProject(true)
                      setSwitcherOpen(false)
                    }}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[9px] text-left text-[13px] font-medium text-accent hover:bg-surface-hover transition"
                  >
                    <span className="w-[22px] flex justify-center shrink-0">
                      <Plus size={16} strokeWidth={2} />
                    </span>
                    New project
                  </button>
                  {/* Settings moved off the strip (gear-placement option A):
                      a rare action lives behind the switcher, not as an
                      always-on icon. */}
                  <button
                    role="menuitem"
                    onClick={() => {
                      setSettingsOpen(true)
                      setSwitcherOpen(false)
                    }}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[9px] text-left text-[13px] font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition"
                  >
                    <span className="w-[22px] flex justify-center shrink-0">
                      <Settings size={15} strokeWidth={1.9} />
                    </span>
                    Project settings
                  </button>
                  {/* Home / All projects — hidden while HOME_ENABLED is false
                      (overview temporarily hidden, 2026-07-06). */}
                  {HOME_ENABLED && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        goHome()
                        setSwitcherOpen(false)
                      }}
                      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[9px] text-left text-[13px] font-medium text-ink-muted hover:bg-surface-hover transition"
                    >
                      <span className="w-[22px] flex justify-center shrink-0">
                        <LayoutGrid size={16} strokeWidth={1.9} />
                      </span>
                      Home / All projects
                    </button>
                  )}
                </div>,
                document.body,
              )}
            </div>
            <div className="flex-1 overflow-auto">
            <div
              onClick={toggleSprintsCollapsed}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleSprintsCollapsed()
                }
              }}
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
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleCollectionsCollapsed()
                }
              }}
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
                        isActive ? 'brand-fill text-white' : 'text-ink hover:bg-surface-hover'
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
                        isActive ? 'text-white/70 hover:text-white hover:bg-white/20' : 'text-ink-faint hover:text-overdue hover:bg-overdue/10'
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
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="text-[14px] text-ink-muted">No project yet</div>
            <button
              onClick={() => setShowNewProject(true)}
              className="inline-flex items-center gap-2 rounded-full brand-btn text-white text-[13px] font-semibold px-4 py-2 transition-colors"
            >
              <Plus size={16} strokeWidth={2} />
              New project
            </button>
          </div>
        )}
        {/* Footer — calm `plan-up · v{version}` (morphs into an "Update" pill when
            a newer build is live; see version-and-updates.md), with the dark-mode
            toggle pinned at its right (it used to live on the removed icon rail). */}
        <div className="mt-auto shrink-0 border-t border-border-hair flex items-center">
          <VersionFooter />
          {/* Brand-theme toggle (Fire ↔ Blue) hidden 2026-07-15 — the app stays on
              its default Fire accent; theme still applied via useBrandTheme() above.
              See design-docs/brand-theme.md. */}
          <button
            onClick={() => setDark(!dark)}
            title={dark ? 'Switch to light' : 'Switch to dark'}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="shrink-0 mr-1.5 w-7 h-7 grid place-items-center rounded-md text-ink-faint hover:text-ink hover:bg-surface-hover transition"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
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

      {/* Desktop collapsed → 74px icon rail (desktop-app-tauri.md; app-shell v4.3).
          Fills the traffic-light safe zone instead of leaving an orphaned gutter, and
          puts the toolbar + content on one shared left rail. Web collapse stays a bare
          width-0 gap. Rail width = the 74px lights safe zone. */}
      {DESKTOP_CHROME && sidebarCollapsed && (
        <div className="w-[74px] shrink-0 flex flex-col items-center vibrancy border-r border-border-hair">
          {/* Drag strip — the traffic lights float over this; window drag region. */}
          <div data-tauri-drag-region className="h-[34px] w-full shrink-0" />
          <div className="flex flex-col items-center gap-1.5 pt-1">
            <button
              onClick={() => setSidebarCollapsed(false)}
              title="Show sidebar (⌘\)"
              aria-label="Show sidebar"
              className="w-9 h-9 rounded-lg inline-flex items-center justify-center text-ink-faint hover:text-ink hover:bg-surface-hover transition"
            >
              <PanelLeft size={17} strokeWidth={1.9} />
            </button>
            <div className="w-5 h-px bg-border-hair my-0.5" />
            {currentProject && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                title={`${currentProject.name} — show sidebar`}
                aria-label={`${currentProject.name} — show sidebar`}
                className="rounded-[9px] transition hover:opacity-90"
              >
                <ProjectTile project={currentProject} size={34} />
              </button>
            )}
            {selKind === 'sprint' && currentSprint && (
              <button
                onClick={() => setPaletteOpen(true)}
                title="Search tasks (/ or ⌘K)"
                aria-label="Search tasks"
                className="w-9 h-9 rounded-lg inline-flex items-center justify-center text-ink-faint hover:text-ink hover:bg-surface-hover transition"
              >
                <Search size={16} strokeWidth={1.9} />
              </button>
            )}
          </div>
          {/* Dark-mode toggle pinned at the bottom, mirroring the sidebar footer. */}
          <button
            onClick={() => setDark(!dark)}
            title="Toggle dark mode (⌘⇧L)"
            aria-label="Toggle dark mode"
            className="mt-auto mb-3 w-9 h-9 rounded-lg inline-flex items-center justify-center text-ink-faint hover:text-ink hover:bg-surface-hover transition"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      )}

      {/* Main column: thin header + capacity + sprint view. Always rendered;
          settings opens as a right-side drawer overlay (below), not a takeover. */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Liquid Glass capsule toolbar (design-docs/liquid-glass-material.md) —
            floats with a margin instead of a full-bleed bar + border-b. */}
        {/* relative z-30: glass surfaces below create stacking contexts
            (backdrop-filter), so toolbar dropdowns need the whole header
            lifted above the scroll content. Below drawers/dialogs (z-50). */}
        {/* Desktop: capsule background doubles as a window drag region. On desktop
            the collapsed state renders a 74px icon rail (above) so the capsule flows
            to its right — no marginLeft shove needed (app-shell v4.3). */}
        <header
          {...(DESKTOP_CHROME ? { 'data-tauri-drag-region': true } : {})}
          className="relative z-30 h-[46px] shrink-0 mx-3 mt-3 rounded-full glass-toolbar flex items-center px-4 gap-3"
        >
          {/* Sidebar toggle — macOS sidebar.left idiom (one button, both ways). While
              the desktop icon rail is up it owns the toggle, so hide this one to avoid
              a duplicate; web/expanded keeps it here. */}
          {!(DESKTOP_CHROME && sidebarCollapsed) && (
            <button
              onClick={() => setSidebarCollapsed((c) => !c)}
              title={`${sidebarCollapsed ? 'Show' : 'Hide'} sidebar (⌘\\)`}
              aria-label={`${sidebarCollapsed ? 'Show' : 'Hide'} sidebar`}
              aria-pressed={!sidebarCollapsed}
              className="shrink-0 inline-flex items-center justify-center w-8 h-8 -ml-1.5 rounded-md text-ink-faint hover:text-ink hover:bg-surface-hover transition"
            >
              <PanelLeft size={16} strokeWidth={1.9} />
            </button>
          )}
          <div className="flex items-center gap-2.5 text-sm min-w-0">
            {selKind === 'collection' && currentCollection ? (
              <CollectionBarIdentity collection={currentCollection} />
            ) : currentSprint ? (
              // Breadcrumb (project › sprint) — fills the toolbar's left with
              // orientation, not filler (app-shell v4.1). The date range fades in
              // once the page header's big title scrolls away. Non-interactive:
              // switching project is a sidebar-only affordance (no duplicate, §8.3),
              // so this is aria-hidden — the title h1 + Dates carry it for a11y.
              <div className="flex items-center gap-2 min-w-0" aria-hidden>
                {currentProject && (
                  <>
                    <ProjectTile project={currentProject} size={20} />
                    <span className="text-[13px] text-ink-muted truncate max-w-[168px]">
                      {currentProject.name}
                    </span>
                    <ChevronRight
                      size={14}
                      strokeWidth={1.8}
                      className="shrink-0 text-ink-faint"
                    />
                  </>
                )}
                <span className="text-[13px] font-semibold text-ink shrink-0">
                  {currentSprint.name}
                </span>
                <span
                  className={`text-[12.5px] text-ink-muted tab-data shrink-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-[280ms] ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none ${
                    scrolled ? 'max-w-[180px] opacity-100 ml-0.5' : 'max-w-0 opacity-0'
                  }`}
                >
                  · {formatSprintRange(currentSprint.startDate, currentSprint.endDate)}
                </span>
              </div>
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
            {/* Collection share link — sits on the top bar next to Export (the
                collection has no page-header to hold a Share button like sprints
                do). See design-docs/share-link-snapshot.md "Collections (v3)". */}
            {selKind === 'collection' && currentCollection && (collectionItems?.length ?? 0) > 0 && (
              <button
                onClick={() => setCollShareOpen(true)}
                title="Share read-only link"
                aria-label="Share collection as a read-only link"
                className="text-xs flex items-center gap-1.5 px-2 py-1.5 text-accent hover:bg-accent-soft rounded-md transition"
              >
                <Link2 size={13} strokeWidth={1.9} /> Share
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
              {exportMenuOpen && exportMenuPos && createPortal(
                <div
                  ref={(el) => {
                    exportMenuPanelRef.current = el
                    focusFirstMenuItem(el)
                  }}
                  role="menu"
                  onKeyDown={menuKeyNav}
                  style={{ position: 'fixed', top: exportMenuPos.top, right: exportMenuPos.right }}
                  className="z-50 min-w-[262px] p-1.5 rounded-[12px] glass-popover"
                >
                  {/* Collection "Export as image…" was removed 2026-07-15 — a
                      collection PNG is reached via its Share link (the viewer's
                      Export PNG). This menu is now data-export only. */}
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
                  {IS_TAURI && (
                    <>
                      <div className="h-px bg-border-hair mx-2 my-1" />
                      <button
                        role="menuitem"
                        onClick={() => {
                          setExportMenuOpen(false)
                          setBackupSettingsOpen(true)
                        }}
                        className="w-full flex items-start gap-3 p-2.5 rounded-[8px] text-left hover:bg-surface-hover transition"
                      >
                        <span className="shrink-0 w-[30px] h-[30px] rounded-[8px] flex items-center justify-center bg-accent-soft text-accent">
                          <FolderDown size={15} strokeWidth={1.9} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-medium text-ink">Auto backup…</span>
                          <span className="block text-[12px] text-ink-muted">Daily JSON backups to a folder</span>
                        </span>
                      </button>
                    </>
                  )}
                </div>,
                document.body
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

        <div
          ref={scrollRef}
          className="flex-1 overflow-auto"
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 48)}
        >
          {/* Merged Notion-style sprint page header: title · note (description) ·
              Dates · capacity inset. Scrolls with content; keyed by sprint so the
              note draft + capacity reset on sprint change. See app-shell v4. */}
          {selKind === 'sprint' && currentSprint && (
            <SprintPageHeader
              key={currentSprint.id}
              sprint={currentSprint}
              capacity={capacity}
              onShare={() => setShareOpen(true)}
              today={today}
              hasNext={!!nextSprint}
              nextName={nextSprint ? nextSprint.name : `Sprint ${nextSprintNumber(sprints ?? [])}`}
              openCount={unfinishedCount}
              rolloverTasks={unfinishedTasks}
              members={paletteMembers ?? []}
              onRollover={doRollover}
              onGoToNext={() => nextSprint && setCurrentSprintId(nextSprint.id)}
              onStartNext={(carry: boolean) => {
                setCarryOnCreate(
                  carry && currentSprint
                    ? {
                        count: unfinishedCount,
                        fromId: currentSprint.id,
                        fromName: currentSprint.name,
                      }
                    : null
                )
                setShowNewSprint(true)
              }}
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
                  className="text-sm font-medium brand-btn text-white rounded-[8px] px-4 py-2 transition"
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
                  className="text-sm font-medium brand-btn text-white rounded-[8px] px-4 py-2 transition"
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
      </>
      )}

      {/* Settings drawer — right-side inspector over a dimmed backdrop. Both
          stay mounted while a project exists so the slide animates. */}
      {currentProject && (
        <>
          <div
            className={`fixed inset-0 z-40 bg-black/25 backdrop-blur-md transition-opacity duration-200 ${
              settingsOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            } motion-reduce:transition-none`}
            onClick={() => setSettingsOpen(false)}
            aria-hidden
          />
          {/* Non-modal inspector (background stays interactive) — so
              role=complementary, NOT dialog/aria-modal (§ overlay contract). */}
          <div
            role="complementary"
            aria-label="Project settings"
            inert={!settingsOpen}
            className={`fixed top-0 right-0 z-50 h-full w-[440px] max-w-[90vw] bg-surface border-l border-border-hair shadow-[-12px_0_50px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none ${
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
            } motion-reduce:transition-none`}
            onClick={() => setShowActivity(false)}
            aria-hidden
          />
          <div
            role="complementary"
            aria-label="Sprint activity log"
            inert={!showActivity}
            className={`fixed top-0 right-0 z-50 h-full w-[440px] max-w-[90vw] bg-surface border-l border-border-hair shadow-[-12px_0_50px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none ${
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
            openProject(p.id)
            setShowNewProject(false)
          }}
        />
      )}

      {backupSettingsOpen && <BackupSettingsModal onClose={() => setBackupSettingsOpen(false)} />}
      {shareOpen && currentSprint && currentProject && (() => {
        const sprintTasksNow = (tasks ?? []).filter((t) => t.sprintId === currentSprint.id)
        const shareMembers = membersWithTasks(paletteMembers ?? [], sprintTasksNow)
        const counts: Record<string, number> = {}
        for (const t of sprintTasksNow) if (t.assigneeId) counts[t.assigneeId] = (counts[t.assigneeId] ?? 0) + 1
        return (
          <ShareLinkModal
            subtitle="Read-only · link ngắn, cập nhật tại chỗ"
            refId={currentSprint.id}
            projectId={currentProject.id}
            members={shareMembers}
            counts={counts}
            buildBundle={(ids) =>
              buildSnapshot(currentProject, currentSprint, paletteMembers ?? [], tasks ?? [], { memberIds: ids })
            }
            onClose={() => setShareOpen(false)}
          />
        )
      })()}
      {collShareOpen && currentCollection && currentProject && (() => {
        const collItemsNow = (collectionItems ?? []).filter((t) => t.collectionId === currentCollection.id)
        const counts: Record<string, number> = {}
        for (const t of collItemsNow) if (t.sectionId) counts[t.sectionId] = (counts[t.sectionId] ?? 0) + 1
        // Only sections that actually own an item become checklist rows.
        const shareSections = currentCollection.sections.filter((s) => (counts[s.id] ?? 0) > 0)
        return (
          <CollectionShareModal
            subtitle="Read-only · link ngắn, cập nhật tại chỗ"
            refId={currentCollection.id}
            projectId={currentProject.id}
            sections={shareSections}
            counts={counts}
            statusColors={currentCollection.statuses.map((s) => s.color)}
            buildBundle={(ids) =>
              buildCollectionSnapshot(currentProject, currentCollection, collectionItems ?? [], { sectionIds: ids })
            }
            onClose={() => setCollShareOpen(false)}
          />
        )
      })()}
      {showNewSprint && currentProjectId && (
        <NewSprintDialog
          projectId={currentProjectId}
          lastSprint={latestActiveSprint(sprints ?? [])}
          nextNumber={nextSprintNumber(sprints ?? [])}
          carry={
            carryOnCreate && carryOnCreate.count > 0
              ? { count: carryOnCreate.count, fromName: carryOnCreate.fromName }
              : null
          }
          onClose={() => {
            setShowNewSprint(false)
            setCarryOnCreate(null)
          }}
          onCreate={async (s, doCarry) => {
            setShowNewSprint(false)
            // Carry-over path (expiry banner state C): the fresh sprint is the
            // chronological "next", so rolling over from the lapsed sprint lands
            // its unfinished tasks here. Otherwise just open the new sprint.
            if (doCarry && carryOnCreate) {
              const result = await moveUnfinishedToNextSprint(carryOnCreate.fromId)
              setCurrentSprintId(result.targetSprintId ?? s.id)
            } else {
              setCurrentSprintId(s.id)
            }
            setCarryOnCreate(null)
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

      {(seedNotice || previewNotice) &&
        createPortal(
          <div className="fixed inset-x-0 bottom-6 z-[55] flex flex-col items-center gap-2 px-4 pointer-events-none">
            {previewNotice && (
              <DataNotice
                title="Preview deployment"
                detail="Data saved on this preview URL is separate from the main site. Open your usual address to see your real data."
                onDismiss={() => {
                  safeStorage.set('plan-up:previewNoticeAck', '1')
                  setPreviewNotice(false)
                }}
              />
            )}
            {seedNotice && (
              <DataNotice
                title="Fresh start with sample data"
                detail="This browser had no saved data at this URL. Had data before? Open the exact URL you used last time, or import a backup (Import in the toolbar)."
                onDismiss={() => {
                  safeStorage.set('plan-up:seedNoticeAck', '1')
                  setSeedNotice(false)
                }}
              />
            )}
          </div>,
          document.body
        )}

      {toast &&
        createPortal(
          <div
            className="fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4 pointer-events-none"
            role="status"
            aria-live="polite"
          >
            <div className="pointer-events-auto flex items-center gap-3 min-w-[340px] max-w-[460px] px-4 py-3 rounded-[14px] bg-surface border border-border-hair animate-toast-in shadow-[0_12px_32px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.55),0_0_0_0.5px_rgba(255,255,255,0.08)]">
              <span
                className={`shrink-0 w-[34px] h-[34px] rounded-full flex items-center justify-center ${
                  toast.kind === 'error'
                    ? 'bg-overdue/15 text-overdue'
                    : 'bg-status-done/15 text-status-done'
                }`}
              >
                {toast.kind === 'error' ? (
                  <X size={18} strokeWidth={2.2} />
                ) : (
                  <Check size={18} strokeWidth={2.2} />
                )}
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

  // Selection clamped to the result set DERIVED, not synced by an effect —
  // typing that shrinks the results snaps the highlight to the top row on the
  // same render, no cascading pass.
  const selIdx = sel >= results.length ? 0 : sel

  const DOT: Record<string, string> = {
    todo: 'bg-status-todo',
    in_progress: 'bg-status-progress',
    done: 'bg-status-done',
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel(Math.min(selIdx + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel(Math.max(selIdx - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const t = results[selIdx]
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
        className="dlg-sheet glass-modal text-ink rounded-[16px] w-full max-w-xl overflow-hidden"
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
                    i === selIdx ? 'bg-accent-soft' : ''
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
                    <Avatar member={assignee} size={20} ring={false} />
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
 * Sprint page header (Notion-style — see app-shell-and-navigation.md v4). Merges what
 * used to be three stacked bands (pinned title/date bar · "Add sprint note" strip ·
 * floating capacity card) into ONE header at the top of the scroll area:
 *   • large sprint title
 *   • the note as an inline description (`SprintNoteBanner`)
 *   • a Dates property
 *   • capacity folded into a soft recessed inset panel (`--color-fill`, no card)
 * Sits on a glass plate (liquid-glass-material.md) so the ambient canvas shows
 * around it; the list below separates by material, not a hairline. Capacity = one slim stacked bar partitioning leaf tasks into three
 * disjoint segments (done / in-flight / open) that sum to `total`; `notEstimated`
 * rides the legend as a warning, never the bar (design-system §4.7).
 */
/**
 * The lapsed / lapsing-sprint signal shown inside the sprint header (one of four
 * `SprintExpiry` kinds — see design-docs/sprint-expiry-signal.md). Amber when a
 * lapsed sprint still holds open work (a semantic warning, §2.2 warn-ink), calm
 * neutral for a wrapped or merely-ending-soon sprint. `ended-open` reuses the same
 * `RolloverPopover` + move as the toolbar Roll over button (confirm-by-preview).
 */
function SprintExpiryBanner({
  expiry,
  openCount,
  fromName,
  nextName,
  hasNext,
  rolloverTasks,
  members,
  onRollover,
  onGoToNext,
  onStartNext,
}: {
  expiry: SprintExpiry
  openCount: number
  fromName: string
  nextName: string
  hasNext: boolean
  rolloverTasks: Task[]
  members: Member[]
  onRollover: () => void
  onGoToNext: () => void
  onStartNext: (carry: boolean) => void
}) {
  const [rollOpen, setRollOpen] = useState(false)
  const rollRef = useRef<HTMLButtonElement>(null)

  const amber = expiry.kind === 'ended-open' || expiry.kind === 'ended-open-nonext'
  const agoText = expiry.endedDays === 1 ? 'yesterday' : `${expiry.endedDays} days ago`
  const openLabel = `${openCount} task${openCount === 1 ? '' : 's'}`

  const brandCta = (children: React.ReactNode, onClick: () => void) => (
    <button
      onClick={onClick}
      className="brand-btn inline-flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[13px] font-semibold text-white transition active:scale-[0.97]"
    >
      {children}
    </button>
  )
  const ghostCta = (label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-[9px] px-3 py-2 text-[13px] font-medium text-accent hover:bg-accent-soft transition"
    >
      {label}
    </button>
  )
  const arrow = <ArrowRight size={15} strokeWidth={2} aria-hidden />

  let title = ''
  let sub = ''
  let actions: React.ReactNode = null
  switch (expiry.kind) {
    case 'ended-open':
      title = `This sprint ended ${agoText}`
      sub = `${openLabel} still open`
      actions = (
        <>
          {ghostCta(`Go to ${nextName}`, onGoToNext)}
          <button
            ref={rollRef}
            onClick={() => setRollOpen((o) => !o)}
            aria-expanded={rollOpen}
            className="brand-btn inline-flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[13px] font-semibold text-white transition active:scale-[0.97]"
          >
            Roll over {openCount} {arrow} {nextName}
          </button>
        </>
      )
      break
    case 'ended-open-nonext':
      title = `This sprint ended ${agoText}`
      sub = `${openLabel} still open · no next sprint yet`
      actions = brandCta(
        <>
          Start {nextName} · carry {openCount} {arrow}
        </>,
        () => onStartNext(true)
      )
      break
    case 'ended-done':
      title = "Sprint wrapped — everything's done"
      sub = `ended ${agoText}`
      actions = brandCta(
        <>
          {hasNext ? `Go to ${nextName}` : `Start ${nextName}`} {arrow}
        </>,
        () => (hasNext ? onGoToNext() : onStartNext(false))
      )
      break
    case 'ending-soon':
      title = expiry.endsInDays === 0 ? 'This sprint ends today' : 'This sprint ends tomorrow'
      sub = openCount > 0 ? `${openLabel} still open` : 'on track'
      actions = ghostCta(hasNext ? `Go to ${nextName}` : `Plan ${nextName}`, () =>
        hasNext ? onGoToNext() : onStartNext(false)
      )
      break
  }

  return (
    <div
      className={`mt-3.5 rounded-[12px] px-4 py-3 flex items-center gap-3 ${
        amber ? 'bg-priority-high/15 ring-1 ring-inset ring-priority-high/25' : 'bg-fill'
      }`}
    >
      <span
        className={
          amber
            ? 'text-priority-high'
            : expiry.kind === 'ended-done'
              ? 'text-status-done'
              : 'text-ink-faint'
        }
      >
        {expiry.kind === 'ended-done' ? (
          <CalendarCheck2 size={20} strokeWidth={1.8} aria-hidden />
        ) : (
          <CalendarClock size={20} strokeWidth={1.8} aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={`text-[13.5px] font-semibold leading-tight ${
            amber ? 'text-warn-ink' : 'text-ink'
          }`}
        >
          {title}
        </div>
        <div className="text-[12px] text-ink-muted mt-0.5 tab-data">{sub}</div>
      </div>
      <div className="shrink-0 relative flex items-center gap-1.5">
        {actions}
        {rollOpen && (
          <RolloverPopover
            anchorRef={rollRef}
            tasks={rolloverTasks}
            members={members}
            fromName={fromName}
            toName={nextName}
            onMove={() => {
              setRollOpen(false)
              onRollover()
            }}
            onClose={() => setRollOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function SprintPageHeader({
  sprint,
  capacity,
  onShare,
  today,
  hasNext,
  nextName,
  openCount,
  rolloverTasks,
  members,
  onRollover,
  onGoToNext,
  onStartNext,
}: {
  sprint: Sprint
  capacity: {
    total: number
    pctAssigned: number
    done: number
    pctDone: number
    inFlight: number
    open: number
    notEstimated: number
  }
  /** Open the "Share link" popover (read-only snapshot). Hidden when empty. */
  onShare: () => void
  /** Local today (`yyyy-mm-dd`) — drives the expiry signal (see sprint-expiry-signal.md). */
  today: string
  /** Whether a next non-archived sprint already exists. */
  hasNext: boolean
  /** Name of the next sprint (existing) or the would-be next `Sprint N`. */
  nextName: string
  /** Unfinished LEAF tasks in this sprint (matches rollover counting). */
  openCount: number
  /** The exact tasks the rollover popover previews/moves. */
  rolloverTasks: Task[]
  members: Member[]
  /** Perform the rollover into the next sprint (popover onMove). */
  onRollover: () => void
  /** Switch to the existing next sprint. */
  onGoToNext: () => void
  /** Open the New Sprint dialog; `carry` pre-checks the carry-over option. */
  onStartNext: (carry: boolean) => void
}) {
  const { total, pctAssigned, done, pctDone, inFlight, open, notEstimated } = capacity
  const pct = (n: number) => `${(n / total) * 100}%`
  const expiry = sprintExpirySignal(
    sprint.startDate,
    sprint.endDate,
    today,
    openCount,
    hasNext
  )
  return (
    <div className="mx-6 mt-4 mb-3 glass-card rounded-[18px] px-5 pt-4 pb-4">
      {/* Title + Copy button on one row; note flows under the title. */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] font-bold tracking-[-0.022em] text-ink leading-tight">
            {sprint.name}
          </h1>
          {/* Note as an inline description right under the title. */}
          <SprintNoteBanner sprint={sprint} />
        </div>
        {total > 0 && (
          <div className="shrink-0 flex items-center gap-1.5">
            <button
              onClick={onShare}
              title="Share read-only link"
              aria-label="Share sprint as a read-only link"
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-fill px-3 py-1.5 text-[13px] font-medium text-ink-muted transition hover:bg-[rgba(0,0,0,0.09)] hover:text-ink active:scale-[0.97] dark:hover:bg-white/10"
            >
              <Link2 size={14} strokeWidth={1.9} aria-hidden />
              Share
            </button>
          </div>
        )}
      </div>

      {/* Expiry signal — lapsed / lapsing sprint (sprint-expiry-signal.md). */}
      {expiry && (
        <SprintExpiryBanner
          expiry={expiry}
          openCount={openCount}
          fromName={sprint.name}
          nextName={nextName}
          hasNext={hasNext}
          rolloverTasks={rolloverTasks}
          members={members}
          onRollover={onRollover}
          onGoToNext={onGoToNext}
          onStartNext={onStartNext}
        />
      )}

      {/* Dates property — Notion-style muted label + value pill. */}
      <div className="mt-3 flex items-center gap-2.5 text-[13px]">
        <span className="inline-flex items-center gap-2 text-ink-muted">
          <Calendar size={14} strokeWidth={1.8} className="text-ink-faint" aria-hidden />
          Dates
        </span>
        <span className="text-ink tab-data bg-fill rounded-full px-2.5 py-1">
          {formatSprintRange(sprint.startDate, sprint.endDate)}
        </span>
      </div>

      {/* Capacity — recessed soft-fill inset (keeps a touch of Cupertino depth
          without a floating card). */}
      <div className="mt-3.5 rounded-[12px] bg-fill px-4 py-3">
        {total === 0 ? (
          <>
            <div className="text-[12px] font-semibold tracking-[0.01em] text-ink-muted">
              Capacity
            </div>
            <div className="text-[13px] text-ink-muted mt-1">
              No tasks yet — <span className="text-accent">add your first task below</span>.
            </div>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[12px] font-semibold tracking-[0.01em] text-ink-muted">
                Capacity
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
                <span className="capacity-seg h-full bg-status-done" style={{ width: pct(done) }} />
              )}
              {inFlight > 0 && (
                <span className="capacity-seg h-full bg-accent" style={{ width: pct(inFlight) }} />
              )}
              {open > 0 && (
                <span className="capacity-seg h-full bg-border-strong" style={{ width: pct(open) }} />
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-muted tab-data">
              <LegendDot color="var(--color-status-done)" n={done} label="done" />
              <LegendDot color="var(--color-accent)" n={inFlight} label="in progress" />
              <LegendDot color="var(--color-border-strong)" n={open} label="open" />
              {notEstimated > 0 && (
                <span className="text-warn-ink">⚠ {notEstimated} not estimated</span>
              )}
            </div>
          </>
        )}
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
    const radios = ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    radios?.[i]?.focus()
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
  carry,
  onClose,
  onCreate,
}: {
  projectId: string
  /** Latest non-archived sprint — drives the back-to-back date default. */
  lastSprint: Sprint | null
  /** Next `Sprint N` number (computed excluding archived collisions). */
  nextNumber: number
  /** When opened from the expiry banner (state C): show a pre-checked "carry N
   *  unfinished from {fromName}" option. Null on every other open path. */
  carry?: { count: number; fromName: string } | null
  onClose: () => void
  onCreate: (s: Sprint, carry: boolean) => void
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
  // Carry-over is pre-checked when offered (the user came from a lapsed sprint
  // with open work); irrelevant when `carry` is null.
  const [doCarry, setDoCarry] = useState(true)

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
    await createSprint(sprint)
    onCreate(sprint, !!carry && doCarry)
  }

  return (
    <ModalSheet title="New Sprint" onClose={onClose}>
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
        {carry && carry.count > 0 && (
          <label className="flex items-center gap-2.5 px-3 py-2.5 bg-fill rounded-[8px] cursor-pointer">
            <input
              type="checkbox"
              checked={doCarry}
              onChange={(e) => setDoCarry(e.target.checked)}
              className="accent-[var(--color-accent)] w-4 h-4"
            />
            <span className="text-[13px] text-ink">
              Carry{' '}
              <span className="font-semibold tabular-nums">
                {carry.count} unfinished task{carry.count === 1 ? '' : 's'}
              </span>{' '}
              from {carry.fromName}
            </span>
          </label>
        )}
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
            className="px-4 py-1.5 text-sm font-medium brand-btn text-white rounded-[8px] disabled:opacity-50 transition"
          >
            Create
          </button>
        </div>
    </ModalSheet>
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
    <ModalSheet title="New Project" onClose={onClose}>
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
            className="px-4 py-1.5 text-sm font-medium brand-btn text-white rounded-[8px] disabled:opacity-50 transition"
          >
            Create
          </button>
        </div>
    </ModalSheet>
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
    <ModalSheet title="New Collection" onClose={onClose}>
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
            className="px-4 py-1.5 text-sm font-medium brand-btn text-white rounded-[8px] disabled:opacity-50 transition"
          >
            Create
          </button>
        </div>
    </ModalSheet>
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
          className="absolute top-0.5 bottom-0.5 rounded-[7px] bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)] transition-[left,width] duration-[280ms] ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none"
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
      className="dlg-sheet z-50 glass-modal text-ink rounded-[14px] overflow-hidden"
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
          const pri = PRIORITY_TAG[t.priority]
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
                <Avatar member={m} size={20} ring={false} />
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
                  overdue ? 'text-overdue font-semibold' : 'text-ink-muted'
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
          className="px-3.5 py-1.5 text-[13.5px] font-medium brand-btn text-white rounded-[8px] transition"
        >
          Move {tasks.length}
        </button>
      </div>
    </div>,
    document.body
  )
}

/**
 * Sprint note — an inline **description** under the sprint title inside
 * `SprintPageHeader` (app-shell v4; was a full-width goal banner). Has a note →
 * editable text (click to edit; ⌘/Ctrl+Enter or blur commits, Esc cancels). No note
 * → a quiet **"Add sprint focus…"** placeholder. The page header keys it by
 * `sprint.id`; the unmount-flush guard below still protects a mid-edit draft when the
 * sprint changes. Carries the free-text context locked sprint names can't. See sprints.md.
 */
function SprintNoteBanner({ sprint }: { sprint: Sprint }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sprint.note ?? '')
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Draft resets in beginEdit (the open trigger), not in an effect — the
  // effect only owns the post-render focus.
  const beginEdit = () => {
    setDraft(sprint.note ?? '')
    setEditing(true)
  }
  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        taRef.current?.focus()
        taRef.current?.select()
      })
    }
  }, [editing])

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

  // Unmount flush: the banner is keyed by sprint.id, so picking another sprint
  // REPLACES it mid-edit — React-driven unmounts fire no blur, and the draft
  // would silently vanish. Same guarantee TitleTextarea gives its cells.
  const flushRef = useRef({ editing, draft, note: sprint.note ?? '' })
  useEffect(() => {
    flushRef.current = { editing, draft, note: sprint.note ?? '' }
  })
  useEffect(() => {
    return () => {
      const s = flushRef.current
      if (s.editing && s.draft.trim() !== s.note) {
        void setSprintNote(sprint.id, s.draft)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (editing) {
    return (
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
        className="mt-1.5 w-full max-w-[640px] block px-2.5 py-1.5 text-[14px] leading-relaxed text-ink bg-surface border border-accent rounded-[8px] resize-y focus:outline-none focus:ring-2 focus:ring-accent/40 transition"
        aria-label="Sprint note"
      />
    )
  }

  if (!sprint.note) {
    // Empty state = a quiet Notion-style placeholder line, not a band. Faint at
    // rest, ink on hover. See app-shell v4 / list-view.md.
    return (
      <button
        onClick={beginEdit}
        className="mt-1 block text-left text-[14px] text-ink-faint rounded-[6px] -mx-1.5 px-1.5 py-0.5 transition hover:bg-surface-hover hover:text-ink"
      >
        Add sprint focus…
      </button>
    )
  }

  return (
    <div
      className="group/note mt-1 cursor-text rounded-[6px] -mx-1.5 px-1.5 py-0.5 hover:bg-surface-hover transition"
      onClick={beginEdit}
      title="Click to edit"
    >
      <span className="block text-[14px] leading-relaxed text-ink whitespace-pre-wrap break-words">
        {sprint.note}
      </span>
    </div>
  )
}

export default App
