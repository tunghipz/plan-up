/**
 * Desktop native feel (design-docs/desktop-native-feel.md): the macOS menu bar,
 * the native task context menu, the WebKit context-menu guard and the window
 * theme sync. Every `@tauri-apps/*` import is dynamic so the web bundle never
 * carries this code's Tauri half; callers gate on IS_TAURI.
 */
import { db, addSprintTask, deleteTask, updateTask, recomputeDates, type Task } from './db'
import type { Priority, Status } from './types'
import { STATUS_LABEL, PRIORITY_LABEL } from './lib'
import { STATUS_ORDER } from './sprint-logic'
import { stripRich } from './rich-text'
import type { ConfirmOpts } from './confirm-context'
import type { PredefinedMenuItemOptions } from '@tauri-apps/api/menu'

export type MenuCommand =
  | 'settings'
  | 'newSprint'
  | 'newProject'
  | 'import'
  | 'exportProject'
  | 'exportAll'
  | 'autoBackup'
  | 'find'
  | 'viewList'
  | 'viewBoard'
  | 'viewTimeline'
  | 'viewCalendar'
  | 'toggleSidebar'
  | 'activity'
  | 'toggleDark'

/** What the menu bar needs to know to enable/check its items. */
export type MenuState = {
  hasProject: boolean
  /** A sprint is on screen (not Home, not a collection). */
  inSprint: boolean
  /** A collection is on screen. */
  inCollection: boolean
  /** Settings drawer open — sprint-only commands are off underneath it. */
  settingsOpen: boolean
  view: 'list' | 'board' | 'timeline' | 'calendar'
  sidebarCollapsed: boolean
  dark: boolean
}

const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'normal', 'low', 'none']

/** `<html>` classes the CSS keys on (index.css): `desktop` = desktop chrome (also
 *  the `?desktop=1` browser preview), `native-vibrancy` = real Tauri window with
 *  the NSVisualEffectView sidebar behind a transparent page. */
export function applyShellClasses(desktopChrome: boolean, tauri: boolean) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('desktop', desktopChrome)
  document.documentElement.classList.toggle('native-vibrancy', tauri)
}

// A toggle can arrive twice for one key press: from the page's keydown handler
// and from the menu's key equivalent (WKWebView hands key equivalents to the page
// first and only falls through to the menu when the page didn't preventDefault).
// Both paths ask here; the second one inside the window is dropped.
const lastRun = new Map<string, number>()
export function shouldRun(id: string, windowMs = 300): boolean {
  const now = performance.now()
  const last = lastRun.get(id)
  lastRun.set(id, now)
  return last === undefined || now - last > windowMs
}

/** True while a modal sheet / confirm owns the keyboard (overlay contract,
 *  design-system §6.5) — menu commands stand down exactly like the shortcuts. */
export function dialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"]')
}

/**
 * Build the macOS menu bar. Returns the menu (the caller sets it as the app menu
 * once it knows it is still mounted) and `apply`, which pushes enabled/checked
 * state into the items. `run` is called with the command id on every click or
 * key equivalent.
 */
export async function buildAppMenu(run: (c: MenuCommand) => void) {
  const { Menu, Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem } = await import(
    '@tauri-apps/api/menu'
  )
  const sep = () => PredefinedMenuItem.new({ item: 'Separator' })
  const pre = (item: PredefinedMenuItemOptions['item']) => PredefinedMenuItem.new({ item })
  const item = (id: MenuCommand, text: string, accelerator?: string) =>
    MenuItem.new({ id, text, accelerator, action: () => run(id) })
  const check = (id: MenuCommand, text: string, accelerator?: string) =>
    CheckMenuItem.new({ id, text, accelerator, checked: false, action: () => run(id) })

  const settings = await item('settings', 'Settings…', 'CmdOrCtrl+,')
  const newSprint = await item('newSprint', 'New Sprint…', 'CmdOrCtrl+N')
  const newProject = await item('newProject', 'New Project…', 'CmdOrCtrl+Shift+N')
  const importItem = await item('import', 'Import…', 'CmdOrCtrl+O')
  const exportProject = await item('exportProject', 'Export This Project', 'CmdOrCtrl+E')
  const exportAll = await item('exportAll', 'Export All (Full Backup)', 'CmdOrCtrl+Shift+E')
  const autoBackup = await item('autoBackup', 'Auto Backup…')
  const find = await item('find', 'Find Task…', 'CmdOrCtrl+F')
  const viewList = await check('viewList', 'List', 'CmdOrCtrl+1')
  const viewBoard = await check('viewBoard', 'Board', 'CmdOrCtrl+2')
  const viewTimeline = await check('viewTimeline', 'Timeline', 'CmdOrCtrl+3')
  const viewCalendar = await check('viewCalendar', 'Calendar', 'CmdOrCtrl+4')
  const sidebar = await item('toggleSidebar', 'Hide Sidebar', 'CmdOrCtrl+\\')
  const activity = await item('activity', 'Sprint Activity')
  const dark = await check('toggleDark', 'Dark Mode', 'CmdOrCtrl+Shift+D')
  const github = await MenuItem.new({
    id: 'github',
    text: 'plan-up on GitHub',
    action: () => {
      void import('@tauri-apps/plugin-opener').then(({ openUrl }) =>
        openUrl('https://github.com/tunghipz/plan-up')
      )
    },
  })

  const windowMenu = await Submenu.new({
    text: 'Window',
    items: [await pre('Minimize'), await pre('Maximize'), await sep(), await pre('BringAllToFront')],
  })
  const helpMenu = await Submenu.new({ text: 'Help', items: [github] })

  const menu = await Menu.new({
    items: [
      await Submenu.new({
        text: 'plan-up',
        items: [
          await pre({ About: null }),
          await sep(),
          settings,
          await sep(),
          await pre('Services'),
          await sep(),
          await pre('Hide'),
          await pre('HideOthers'),
          await pre('ShowAll'),
          await sep(),
          await pre('Quit'),
        ],
      }),
      await Submenu.new({
        text: 'File',
        items: [
          newSprint,
          newProject,
          await sep(),
          importItem,
          exportProject,
          exportAll,
          autoBackup,
          await sep(),
          await pre('CloseWindow'),
        ],
      }),
      await Submenu.new({
        text: 'Edit',
        // Cut/Copy/Paste MUST stay: replacing Tauri's default menu without them
        // kills ⌘C/⌘V inside text fields on macOS.
        items: [
          await pre('Undo'),
          await pre('Redo'),
          await sep(),
          await pre('Cut'),
          await pre('Copy'),
          await pre('Paste'),
          await pre('SelectAll'),
          await sep(),
          find,
        ],
      }),
      await Submenu.new({
        text: 'View',
        items: [
          viewList,
          viewBoard,
          viewTimeline,
          viewCalendar,
          await sep(),
          sidebar,
          activity,
          await sep(),
          dark,
          await sep(),
          await pre('Fullscreen'),
        ],
      }),
      windowMenu,
      helpMenu,
    ],
  })

  const install = async () => {
    await menu.setAsAppMenu()
    await windowMenu.setAsWindowsMenuForNSApp()
    await helpMenu.setAsHelpMenuForNSApp()
  }

  // Sets every item, not a diff: a click on a CheckMenuItem flips its own check
  // natively before our action runs, so the caller re-applies after each command
  // to put the truth back (e.g. clicking the already-current view).
  const apply = (s: MenuState) => {
    const sprintCmds = s.inSprint && !s.settingsOpen
    const onView = s.inSprint || s.inCollection
    void Promise.all([
      settings.setEnabled(s.hasProject),
      newSprint.setEnabled(s.inSprint && !s.settingsOpen),
      exportProject.setEnabled(s.hasProject),
      find.setEnabled(sprintCmds),
      activity.setEnabled(sprintCmds),
      viewList.setEnabled(onView),
      viewBoard.setEnabled(s.inSprint),
      viewTimeline.setEnabled(s.inSprint),
      viewCalendar.setEnabled(s.inCollection),
      viewList.setChecked(onView && s.view === 'list'),
      viewBoard.setChecked(s.inSprint && s.view === 'board'),
      viewTimeline.setChecked(s.inSprint && s.view === 'timeline'),
      viewCalendar.setChecked(s.inCollection && s.view === 'calendar'),
      sidebar.setText(s.sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'),
      dark.setChecked(s.dark),
    ]).catch(() => {})
  }

  return { install, apply }
}

/** Keep the NSWindow appearance on the app's own dark-mode choice, so the native
 *  sidebar material, menus and system dialogs match the page (not macOS). */
export async function syncWindowTheme(dark: boolean) {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setTheme(dark ? 'dark' : 'light')
  } catch {
    /* cosmetic — never surface */
  }
}

// ── Native open panel for File ▸ Import… ────────────────────────────────────
// A menu action arrives over IPC with no user gesture, and WebKit only opens a
// file chooser from `<input type=file>.click()` inside one — so the menu path
// picks with the dialog plugin and reads through the app's own Rust command.
export async function pickImportText(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'plan-up backup', extensions: ['json'] }],
  })
  if (typeof path !== 'string') return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('read_import_file', { path })
}

// ── Context menus ───────────────────────────────────────────────────────────

const isEditable = (el: Element | null): el is HTMLElement =>
  !!el &&
  (el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el as HTMLElement).isContentEditable)

const TASK_HOST = '[data-task-id], article[data-id]'

const taskIdOf = (el: Element | null): string | null => {
  const host = el?.closest<HTMLElement>(TASK_HOST)
  return host?.dataset.taskId ?? host?.dataset.id ?? null
}

type ContextOpts = { confirm: (o: ConfirmOpts) => Promise<boolean> }

/**
 * One document-level listener for the whole app (desktop only):
 *  - right-click a List row / Board card → native task menu;
 *  - a field being edited, or a live text selection → WebKit's own menu
 *    (Cut/Copy/Paste/Spelling);
 *  - anywhere else → nothing (no Reload / Inspect Element).
 * Returns a disposer.
 */
export function installContextMenus(opts: ContextOpts): () => void {
  // Whether the right-clicked field was ALREADY focused, read at mousedown before
  // WebKit's default focuses it — a task title is a textarea, and right-clicking
  // a title you're not editing should give the task menu, not Cut/Copy/Paste.
  let editingAtDown = false
  const onDown = (e: MouseEvent) => {
    if (e.button !== 2) return
    const t = e.target as Element | null
    editingAtDown = isEditable(t) && document.activeElement === t
    // Don't let the right-click drop a caret into an idle title inside a task.
    if (isEditable(t) && !editingAtDown && taskIdOf(t)) e.preventDefault()
  }
  const onContext = (e: MouseEvent) => {
    const t = e.target as Element | null
    const selection = window.getSelection()
    const hasSelection = !!selection && !selection.isCollapsed && selection.toString().trim() !== ''
    if ((isEditable(t) && editingAtDown) || hasSelection) return
    if (isEditable(t) && !taskIdOf(t)) return // a plain field outside a task
    e.preventDefault()
    const id = taskIdOf(t)
    if (id) void popupTaskMenu(id, opts)
  }
  document.addEventListener('mousedown', onDown, true)
  document.addEventListener('contextmenu', onContext)
  return () => {
    document.removeEventListener('mousedown', onDown, true)
    document.removeEventListener('contextmenu', onContext)
  }
}

// The previous popup's menu resources, freed when the next one opens (closing
// right after popup() could race the item action still in flight).
let lastPopup: { close: () => Promise<void> }[] = []

async function popupTaskMenu(id: string, { confirm }: ContextOpts) {
  const task = await db.tasks.get(id)
  if (!task) return
  // parentId isn't indexed → filter (same as deleteTask).
  const childCount = await db.tasks.filter((t) => t.parentId === id).count()
  const isParent = childCount > 0

  const { Menu, Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem } = await import(
    '@tauri-apps/api/menu'
  )
  for (const r of lastPopup) void r.close().catch(() => {})
  lastPopup = []

  const statusItems = await Promise.all(
    STATUS_ORDER.map((s: Status) =>
      CheckMenuItem.new({
        text: STATUS_LABEL[s],
        checked: task.status === s,
        action: () => void updateTask(id, { status: s }),
      })
    )
  )
  const priorityItems = await Promise.all(
    PRIORITY_ORDER.map((p) =>
      CheckMenuItem.new({
        text: PRIORITY_LABEL[p],
        checked: (task.priority ?? 'none') === p,
        action: () => void updateTask(id, { priority: p }),
      })
    )
  )
  // A parent's status is derived from its children (task-groups.md).
  const status = await Submenu.new({ text: 'Status', enabled: !isParent, items: statusItems })
  const priority = await Submenu.new({ text: 'Priority', items: priorityItems })
  const duplicate = await MenuItem.new({
    text: 'Duplicate',
    enabled: !isParent && !!task.sprintId,
    action: () => void duplicateTask(task),
  })
  const del = await MenuItem.new({
    text: 'Delete…',
    action: () => void confirmDelete(task, isParent, confirm),
  })
  const menu = await Menu.new({
    items: [
      status,
      priority,
      await PredefinedMenuItem.new({ item: 'Separator' }),
      duplicate,
      await PredefinedMenuItem.new({ item: 'Separator' }),
      del,
    ],
  })
  lastPopup = [menu, status, priority, duplicate, del, ...statusItems, ...priorityItems]
  await menu.popup()
}

/** Same task, same sprint/assignee/priority/effort/dates, status back to To do,
 *  no prereqs. Through addSprintTask so `sequence` stays collision-free and the
 *  activity log records the creation. */
async function duplicateTask(task: Task) {
  if (!task.sprintId) return
  const sprint = await db.sprints.get(task.sprintId)
  if (!sprint) return
  const copy = await addSprintTask({
    projectId: task.projectId,
    sprintId: sprint.id,
    title: task.title,
    startDate: task.startDate ?? sprint.startDate,
    assigneeId: task.assigneeId,
    priority: task.priority,
    parentId: task.parentId ?? null,
  })
  // Raw write: effort/due on a brand-new row are part of its creation, not
  // user edits worth a change-log entry.
  if (task.estimate !== null || task.dueDate !== null) {
    await db.tasks.update(copy.id, { estimate: task.estimate, dueDate: task.dueDate })
  }
  await recomputeDates(copy.id)
}

async function confirmDelete(
  task: Task,
  isParent: boolean,
  confirm: ContextOpts['confirm']
) {
  // Same wording as the selection bar's delete (design-system §6.4).
  const name = stripRich(task.title).trim() || `#${task.sequence}`
  const ok = await confirm({
    title: 'Delete 1 task?',
    subject: `“${name}”`,
    message: isParent ? 'Group children will be ungrouped, not deleted.' : 'This can’t be undone.',
    confirmLabel: 'Delete',
    icon: 'trash',
  })
  if (ok) await deleteTask(task.id)
}
