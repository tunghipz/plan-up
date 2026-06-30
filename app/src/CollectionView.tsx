import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarPlus,
  ChevronDown,
  X,
  Plus,
  GripVertical,
  Layers,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react'
import {
  db,
  addSection,
  renameSection,
  deleteSection,
  addCollectionItem,
  renameCollection,
  moveTaskToSprint,
  moveTaskToSection,
  addStatus,
  renameStatus,
  recolorStatus,
  deleteStatus,
  deleteTask,
  COLLECTION_PALETTE,
  updateTask,
  type Collection,
  type CollectionStatus,
  type Member,
  type Sprint,
  type Task,
} from './db'
import { CollectionCalendar } from './CollectionCalendar'
import { AddGroupButton } from './AddGroupButton'
import { EffortCell } from './SprintView'

const COLLAPSE_KEY = (collectionId: string) =>
  `plan-up:collCollapsed:${collectionId}`

// Stable empty array so a section with no items doesn't hand SectionCard a fresh
// `[]` identity each render (keeps future memoization honest).
const EMPTY_ITEMS: Task[] = []

/**
 * Column widths shared by the column-header row and each item row — mirrors the
 * sprint list view's `COL` (SprintView.tsx) so Collections feel identical, with
 * only member + editable duration surfaced. Flex, not grid: the title absorbs
 * the slack via flex-1; the rest are fixed and shrink-0.
 */
const COL = {
  lead: 'w-5 shrink-0 flex justify-center items-center',
  title: 'flex-1 min-w-[150px]',
  member: 'w-32 flex justify-start shrink-0',
  duration: 'w-24 flex justify-center shrink-0',
  sprint: 'w-36 flex justify-end shrink-0',
  actions: 'w-8 flex justify-end shrink-0',
}

/** Floating-shadow surface for popovers/menus (design-system §4.2). */
const FLOAT_SHADOW =
  'shadow-[0_8px_30px_rgba(0,0,0,0.18),0_0_0_0.5px_rgba(0,0,0,0.06)]'

/** Close `ref` element when a click lands outside it. */
function useOutsideClose(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void
) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ref, open, close])
}

export function CollectionView({
  collectionId,
  view,
  currentSprintId,
  onViewInList,
}: {
  collectionId: string
  /** Controlled view — driven by the single adaptive toggle in App's top bar. */
  view: 'list' | 'calendar'
  currentSprintId?: string | null
  /** Calendar's "View in list →" callback (App flips the top-bar toggle). */
  onViewInList: () => void
}) {
  const collection = useLiveQuery<Collection | undefined>(
    () => db.collections.get(collectionId),
    [collectionId]
  )
  const liveItems = useLiveQuery<Task[]>(
    () => db.tasks.where('collectionId').equals(collectionId).toArray(),
    [collectionId]
  )
  const items = useMemo(() => liveItems ?? [], [liveItems])
  const projectMembers =
    useLiveQuery<Member[]>(
      () =>
        collection
          ? db.members.where('projectId').equals(collection.projectId).toArray()
          : Promise.resolve([]),
      [collection?.projectId]
    ) ?? []
  const memberById = useMemo(
    () => new Map(projectMembers.map((m) => [m.id, m])),
    [projectMembers]
  )
  const projectSprints =
    useLiveQuery<Sprint[]>(
      () =>
        collection
          ? db.sprints.where('projectId').equals(collection.projectId).sortBy('startDate')
          : Promise.resolve([]),
      [collection?.projectId]
    ) ?? []
  const activeSprints = useMemo(
    () =>
      projectSprints
        .filter((s) => s.archivedAt == null)
        .slice()
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [projectSprints]
  )
  const [addingTable, setAddingTable] = useState(false)

  // Group items by section ONCE per data change instead of re-filtering the full
  // item list for every section on every render — that was O(sections × items)
  // per keystroke, since item titles persist on every keystroke.
  const itemsBySectionMap = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of items) {
      const k = t.sectionId ?? ''
      const arr = m.get(k)
      if (arr) arr.push(t)
      else m.set(k, [t])
    }
    return m
  }, [items])

  if (!collection) {
    return <div className="p-6 text-ink-muted">Loading…</div>
  }

  // Identity (name + summary), Statuses, and the List/Calendar toggle all live in
  // App's top context bar now — see CollectionBarIdentity / StatusEditor below and
  // the adaptive ViewToggle in App.tsx. This body renders content only (no header),
  // so there's a single context bar instead of two stacked toggles.
  return (
    <div className="max-w-5xl mx-auto px-1 pt-4">
      {view === 'list' ? (
        <div className="space-y-4">
          {collection.sections.map((sec) => (
            <SectionCard
              key={sec.id}
              collectionId={collectionId}
              canDelete={collection.sections.length > 1}
              section={sec}
              items={itemsBySectionMap.get(sec.id) ?? EMPTY_ITEMS}
              members={projectMembers}
              memberById={memberById}
              sprints={activeSprints}
              currentSprintId={currentSprintId ?? null}
            />
          ))}
          <AddGroupButton
            icon={Plus}
            label="Add table"
            onClick={() => setAddingTable(true)}
          />
        </div>
      ) : (
        <CollectionCalendar
          collection={collection}
          items={items}
          onViewInList={onViewInList}
        />
      )}

      {addingTable && (
        <NameModal
          title="New Table"
          placeholder="Untitled"
          hint="A table groups items inside this collection — e.g. “Q3 events”, “Shipped”."
          submitLabel="Add"
          onClose={() => setAddingTable(false)}
          onSubmit={async (name) => {
            await addSection(collectionId, name)
            setAddingTable(false)
          }}
        />
      )}
    </div>
  )
}

/**
 * Calm at-a-glance summary under the title (replaces the old "COLLECTION" accent
 * badge — accent is a signal, not chrome, §2.1): item count + a row of dots
 * showing the status distribution. Renders nothing when the collection is empty.
 */
function CollectionSummary({
  items,
  statuses,
}: {
  items: Task[]
  statuses: CollectionStatus[]
}) {
  if (items.length === 0) return null
  const NONE = '∅'
  const byStatus = new Map<string, number>()
  for (const t of items) {
    const k = t.collectionStatusId ?? NONE
    byStatus.set(k, (byStatus.get(k) ?? 0) + 1)
  }
  const dots = statuses
    .filter((s) => byStatus.get(s.id))
    .map((s) => ({ color: s.color, n: byStatus.get(s.id)! }))
  const none = byStatus.get(NONE) ?? 0
  return (
    <div className="flex items-center gap-2 text-[12px] text-ink-faint font-medium shrink-0">
      <span className="tabular-nums">
        {items.length} {items.length === 1 ? 'item' : 'items'}
      </span>
      {(dots.length > 0 || none > 0) && (
        <span className="flex items-center gap-1">
          {dots.map((d, i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full"
              style={{ background: d.color }}
              title={`${d.n}`}
              aria-hidden
            />
          ))}
          {none > 0 && (
            <span
              className="w-2 h-2 rounded-full border border-border"
              title={`${none} no status`}
              aria-hidden
            />
          )}
        </span>
      )}
    </div>
  )
}

/** Inline-rename collection name (mirrors SprintNameEditor in App.tsx). */
function CollectionTitle({ collection }: { collection: Collection }) {
  return <EditableCollectionTitle collection={collection} />
}

function EditableCollectionTitle({ collection }: { collection: Collection }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(collection.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, collection.name])

  const commit = async () => {
    const n = draft.trim()
    setEditing(false)
    if (n && n !== collection.name) await renameCollection(collection.id, n)
  }
  const cancel = () => {
    setDraft(collection.name)
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
        aria-label="Rename collection"
      />
    )
  }
  return (
    <h2
      className="group/title inline-flex items-center gap-1.5 min-w-0 font-semibold text-ink display-tight cursor-text"
      onClick={() => {
        setDraft(collection.name)
        setEditing(true)
      }}
      title="Click to rename"
    >
      <span className="truncate">{collection.name}</span>
      <Pencil
        size={13}
        className="text-ink-faint opacity-0 group-hover/title:opacity-60 transition shrink-0"
        aria-hidden
      />
    </h2>
  )
}

/**
 * Name-only Cupertino modal — same sheet as App's New Sprint / New Collection
 * dialogs. Used for "Add table". Enter submits; scrim/Cancel closes.
 */
function NameModal({
  title,
  placeholder,
  hint,
  submitLabel = 'Create',
  onClose,
  onSubmit,
}: {
  title: string
  placeholder?: string
  hint?: string
  submitLabel?: string
  onClose: () => void
  onSubmit: (name: string) => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const submit = () => {
    const t = name.trim()
    if (!t) return
    void onSubmit(t)
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
        <h2 className="text-[19px] font-bold tracking-[-0.014em]">{title}</h2>
        <label className="block">
          <span className="text-xs text-ink-muted">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape') onClose()
            }}
            placeholder={placeholder}
            className="mt-1 w-full px-3 py-2 border border-border bg-surface rounded-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
          />
        </label>
        {hint && <div className="text-xs text-ink-muted">{hint}</div>}
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
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Compact collection identity for App's top context bar — the parallel of the
 * sprint name/date shown when a sprint is selected. Inline-rename title + a quiet
 * item-count/status-dots summary. Queries its own items so App stays lean.
 */
export function CollectionBarIdentity({
  collection,
}: {
  collection: Collection
}) {
  const items =
    useLiveQuery<Task[]>(
      () => db.tasks.where('collectionId').equals(collection.id).toArray(),
      [collection.id]
    ) ?? []
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Layers size={15} className="text-ink-faint shrink-0" aria-hidden />
      <CollectionTitle collection={collection} />
      <CollectionSummary items={items} statuses={collection.statuses} />
    </div>
  )
}

function SectionCard({
  collectionId,
  section,
  items,
  canDelete,
  members,
  memberById,
  sprints,
  currentSprintId,
}: {
  collectionId: string
  section: { id: string; name: string; color?: string }
  items: Task[]
  canDelete: boolean
  members: Member[]
  memberById: Map<string, Member>
  sprints: Sprint[]
  currentSprintId: string | null
}) {
  const [collapsed, setCollapsed] = useState(
    () =>
      localStorage.getItem(`${COLLAPSE_KEY(collectionId)}:${section.id}`) === '1'
  )
  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(
        `${COLLAPSE_KEY(collectionId)}:${section.id}`,
        next ? '1' : '0'
      )
      return next
    })
  }

  // Drop target for items dragged in from another section.
  const [dropActive, setDropActive] = useState(false)
  // Inline (in-DNA) delete confirm — replaces window.confirm (§8).
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div
      data-section-card
      data-section-drop
      onDragOver={(e) => {
        // Allow drops carrying a collection item id.
        if (e.dataTransfer.types.includes('text/plain')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (!dropActive) setDropActive(true)
        }
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer actually leaves the card (not a child).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDropActive(false)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDropActive(false)
        const id = e.dataTransfer.getData('text/plain')
        // No-op if dropped onto the section it already belongs to.
        if (id && !items.some((t) => t.id === id)) {
          void moveTaskToSection(id, section.id)
        }
      }}
      className={`bg-surface rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)] overflow-hidden transition-shadow ${
        dropActive ? 'ring-2 ring-accent/40' : ''
      }`}
    >
      {/* Whole header toggles collapse (mirrors the sprint group card). The
          rename field and delete button stopPropagation so they don't toggle. */}
      <div
        onClick={toggle}
        role="button"
        aria-expanded={!collapsed}
        className={`group flex items-center gap-2.5 px-[18px] py-[13px] select-none cursor-pointer transition hover:bg-surface-hover ${
          collapsed ? '' : 'border-b border-border'
        }`}
      >
        <ChevronDown
          size={14}
          className={`text-ink-faint shrink-0 transition-transform ${
            collapsed ? '-rotate-90' : ''
          }`}
        />
        <SectionName collectionId={collectionId} section={section} />
        <span className="text-[13px] font-medium text-ink-faint tabular-nums">
          {items.length}
        </span>
        <span className="flex-1" />
        {canDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setConfirmingDelete(true)
            }}
            title="Delete table"
            aria-label="Delete table"
            className="text-ink-faint opacity-0 group-hover:opacity-70 hover:opacity-100 hover:text-ink p-1 rounded-md transition"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {confirmingDelete && (
        <div className="flex items-center gap-3 px-[18px] py-2.5 bg-red-500/[0.06] border-b border-border text-[13px]">
          <span className="flex-1 text-ink font-medium">
            Delete this table? Its items move to the first table.
          </span>
          <button
            onClick={async () => {
              await deleteSection(collectionId, section.id)
            }}
            className="text-red-500 font-semibold hover:underline"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmingDelete(false)}
            className="text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}

      {!collapsed && (
        <div>
          {/* Quiet column header — same look as the sprint list (canvas-sunk
              tint + hairline), labels aligned to the row columns via COL. Hidden
              while the table is empty (mirrors the sprint list, §5.8). */}
          {items.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border-hair bg-canvas-sunk/40">
              <div className={COL.lead} />
              <div className={`${COL.title} text-[11px] tracking-normal text-ink-faint font-medium`}>
                Name
              </div>
              <div className={`${COL.member} text-[11px] tracking-normal text-ink-faint font-medium`}>
                Member
              </div>
              <div className={`${COL.duration} text-[11px] tracking-normal text-ink-faint font-medium text-center`}>
                Duration
              </div>
              <div className={`${COL.sprint} text-[11px] tracking-normal text-ink-faint font-medium text-right`}>
                Sprint
              </div>
              <div className={COL.actions} />
            </div>
          )}

          {items.length === 0 && (
            <div className="px-4 pt-6 pb-1 text-center text-[13.5px] text-ink-faint">
              No items yet — add your first below.
            </div>
          )}

          <div className="divide-y divide-border">
            {items.map((t) => (
              <ItemRow
                key={t.id}
                task={t}
                members={members}
                assignee={t.assigneeId ? memberById.get(t.assigneeId) ?? null : null}
                sprints={sprints}
                currentSprintId={currentSprintId}
              />
            ))}
            <AddItemRow
              collectionId={collectionId}
              sectionId={section.id}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** Inline-rename a section name. */
function SectionName({
  collectionId,
  section,
}: {
  collectionId: string
  section: { id: string; name: string }
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(section.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, section.name])

  const commit = async () => {
    const n = draft.trim()
    setEditing(false)
    if (n && n !== section.name) await renameSection(collectionId, section.id, n)
  }
  const cancel = () => {
    setDraft(section.name)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onClick={(e) => e.stopPropagation()}
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
        className="editable text-[15.5px] font-semibold text-ink tracking-[-0.01em] bg-transparent min-w-0 max-w-[280px]"
        aria-label="Rename table"
      />
    )
  }
  return (
    <span
      className="group/sname inline-flex items-center gap-1.5 min-w-0 text-[15.5px] font-semibold text-ink tracking-[-0.01em] cursor-text"
      onClick={(e) => {
        e.stopPropagation()
        setDraft(section.name)
        setEditing(true)
      }}
      title="Click to rename"
    >
      <span className="truncate">{section.name}</span>
      <Pencil
        size={12}
        className="text-ink-faint opacity-0 group-hover/sname:opacity-60 transition shrink-0"
        aria-hidden
      />
    </span>
  )
}

function ItemRow({
  task,
  members,
  assignee,
  sprints,
  currentSprintId,
}: {
  task: Task
  members: Member[]
  assignee: Member | null
  sprints: Sprint[]
  currentSprintId: string | null
}) {
  // Grip-armed native drag: a drag only starts if it was begun from the grip,
  // so inline title editing and duration controls are never hijacked.
  const armedRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div
      data-item-row
      draggable
      onDragStart={(e) => {
        if (!armedRef.current) {
          e.preventDefault()
          return
        }
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', task.id)
        setDragging(true)
      }}
      onDragEnd={() => {
        armedRef.current = false
        setDragging(false)
      }}
      className={`task-row group/row relative flex items-center gap-3 px-4 py-2 text-sm transition hover:bg-surface-hover ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      {confirmingDelete && (
        <div className="absolute inset-y-0 right-0 z-20 flex items-center gap-2 bg-red-50/95 border-l border-red-200 px-3 text-[12.5px] shadow-[-8px_0_18px_rgba(255,255,255,0.92)]">
          <span className="font-medium text-red-600 whitespace-nowrap">Delete item?</span>
          <button
            type="button"
            onClick={() => void deleteTask(task.id)}
            className="px-2 py-1 rounded-md bg-red-500 text-white font-semibold hover:bg-red-600 transition"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="px-2 py-1 rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink transition"
          >
            Cancel
          </button>
        </div>
      )}
      {/* Lead gutter — hover-revealed grip; arming a drag here keeps the title
          textarea and date/status controls free to receive normal clicks. */}
      <div className={`${COL.lead} relative self-stretch`}>
        <button
          type="button"
          aria-label="Drag to another table"
          onPointerDown={(e) => {
            e.stopPropagation()
            armedRef.current = true
            const off = () => {
              armedRef.current = false
              window.removeEventListener('pointerup', off)
            }
            window.addEventListener('pointerup', off)
          }}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 grid place-items-center text-ink-faint/70 hover:text-ink-muted opacity-0 group-hover/row:opacity-100 transition-opacity cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical size={14} />
        </button>
      </div>
      <ItemTitle task={task} />
      <div className={COL.member}>
        <CollectionMemberPicker task={task} members={members} assignee={assignee} />
      </div>
      <div className={COL.duration}>
        <EffortCell
          value={task.estimate}
          onChange={(estimate) => void updateTask(task.id, { estimate })}
        />
      </div>
      <div className={COL.sprint}>
        <AddToSprintMenu
          task={task}
          sprints={sprints}
          currentSprintId={currentSprintId}
        />
      </div>
      <div className={COL.actions}>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          title="Delete item"
          aria-label={`Delete ${task.title}`}
          className="grid place-items-center w-7 h-7 rounded-md text-ink-faint opacity-0 group-hover/row:opacity-100 hover:text-red-500 hover:bg-red-500/10 transition"
        >
          <Trash2 size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

function CollectionMemberPicker({
  task,
  members,
  assignee,
}: {
  task: Task
  members: Member[]
  assignee: Member | null
}) {
  const label = assignee?.name ?? 'Unassigned'
  return (
    <label
      className={`relative inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 -ml-1 text-[12.5px] font-medium transition hover:bg-surface-hover ${
        assignee ? 'text-ink-muted' : 'text-ink-faint'
      }`}
      title={label}
    >
      {assignee && (
        <span
          className="w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold text-white shrink-0"
          style={{ background: assignee.color }}
          aria-hidden
        >
          {assignee.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="truncate">{label}</span>
      <select
        value={task.assigneeId ?? ''}
        onChange={(e) => void updateTask(task.id, { assigneeId: e.target.value || null })}
        className="absolute inset-0 opacity-0 cursor-pointer"
        aria-label={`Assign ${task.title}`}
      >
        <option value="">Unassigned</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function AddToSprintMenu({
  task,
  sprints,
  currentSprintId,
}: {
  task: Task
  sprints: Sprint[]
  currentSprintId: string | null
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: -9999, left: -9999 })
  const MENU_W = 260

  const suggestions = useMemo(() => {
    if (sprints.length === 0) return []
    const currentIdx = currentSprintId
      ? sprints.findIndex((s) => s.id === currentSprintId)
      : -1
    const startIdx = currentIdx >= 0 ? currentIdx : 0
    return sprints.slice(startIdx, startIdx + 3)
  }, [currentSprintId, sprints])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return suggestions
    return sprints.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.startDate.includes(q) ||
        s.endDate.includes(q)
    )
  }, [query, sprints, suggestions])

  useLayoutEffect(() => {
    if (!open) return
    const pin = () => {
      const r = anchorRef.current?.getBoundingClientRect()
      if (!r) return
      let left = r.right - MENU_W
      left = Math.min(left, window.innerWidth - MENU_W - 8)
      left = Math.max(8, left)
      const top = Math.min(r.bottom + 6, window.innerHeight - 320)
      setPos({ top: Math.max(8, top), left })
    }
    pin()
    window.addEventListener('scroll', pin, true)
    window.addEventListener('resize', pin)
    return () => {
      window.removeEventListener('scroll', pin, true)
      window.removeEventListener('resize', pin)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const move = async (sprint: Sprint) => {
    setOpen(false)
    setQuery('')
    await moveTaskToSprint(task.id, sprint.id)
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={sprints.length === 0}
        className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink-muted hover:text-accent hover:border-accent/40 disabled:opacity-40 disabled:hover:text-ink-muted disabled:hover:border-border transition"
      >
        <CalendarPlus size={13} />
        Add
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_W }}
            className={`z-50 bg-surface rounded-[12px] p-2 ${FLOAT_SHADOW}`}
          >
            <label className="flex items-center gap-2 rounded-[8px] border border-border bg-canvas-sunk/40 px-2.5 py-1.5">
              <Search size={14} className="text-ink-faint shrink-0" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sprint"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
              />
            </label>
            <div className="mt-2 max-h-[230px] overflow-y-auto py-1">
              {visible.length === 0 ? (
                <div className="px-2.5 py-3 text-[13px] text-ink-faint">
                  No matching sprint
                </div>
              ) : (
                visible.map((sprint) => (
                  <button
                    key={sprint.id}
                    type="button"
                    onClick={() => void move(sprint)}
                    className="w-full rounded-[8px] px-2.5 py-2 text-left hover:bg-surface-hover transition"
                  >
                    <span className="block text-[13px] font-semibold text-ink truncate">
                      {sprint.name}
                    </span>
                    <span className="block text-[11.5px] text-ink-faint tabular-nums">
                      {sprint.startDate} → {sprint.endDate}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

/**
 * Always-editable item title — tap anywhere to edit, just like the sprint list's
 * TitleTextarea. Writes on each keystroke; Enter commits (blurs), Shift+Enter
 * adds a line. `field-sizing:content` hugs the text; the manual resize is a
 * fallback for browsers without it.
 */
function ItemTitle({ task }: { task: Task }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  useLayoutEffect(resize, [task.title])

  return (
    <div className={`${COL.title} flex items-start`}>
      <textarea
        ref={ref}
        value={task.title}
        rows={1}
        onChange={(e) => void db.tasks.update(task.id, { title: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            ;(e.target as HTMLTextAreaElement).blur()
          }
        }}
        className="flex-1 min-w-0 editable text-ink bg-transparent resize-none overflow-hidden leading-snug whitespace-pre-wrap break-words"
        aria-label="Item title"
      />
    </div>
  )
}

/** Inline add-item row (type + Enter) — mirrors the sprint list's AddTaskRow. */
function AddItemRow({
  collectionId,
  sectionId,
}: {
  collectionId: string
  sectionId: string
}) {
  const [title, setTitle] = useState('')
  const add = async () => {
    const t = title.trim()
    if (!t) return
    await addCollectionItem(collectionId, sectionId, { title: t })
    setTitle('')
  }
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      <div className={COL.lead}>
        <Plus size={14} className="text-ink-faint" />
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void add()}
        placeholder="Add item"
        className={`${COL.title} editable placeholder:text-ink-faint bg-transparent`}
        aria-label="Add item"
      />
      <div className={COL.member} />
      <div className={COL.duration} />
      <div className={COL.sprint} />
      <div className={COL.actions} />
    </div>
  )
}

/** Per-collection status editor popover (Statuses button in header). */
export function StatusEditor({ collection }: { collection: Collection }) {
  const [open, setOpen] = useState(false)
  const [paletteFor, setPaletteFor] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useOutsideClose(ref, open, () => {
    setOpen(false)
    setPaletteFor(null)
    setConfirmId(null)
  })

  return (
    <div ref={ref} className="relative">
      <button
        data-statuses-btn
        onClick={() => {
          setOpen((p) => !p)
          setPaletteFor(null)
        }}
        className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-[7px] border transition ${
          open
            ? 'bg-surface text-ink border-border shadow-[0_1px_3px_rgba(0,0,0,0.12)]'
            : 'text-ink-muted border-transparent hover:border-border hover:text-ink'
        }`}
        aria-expanded={open}
        aria-label="Edit statuses"
      >
        Statuses
      </button>

      {open && (
        <div
          className={`absolute right-0 top-full mt-1.5 z-40 bg-surface rounded-[12px] w-[260px] py-2 ${FLOAT_SHADOW}`}
        >
          <div className="px-4 pb-1.5 pt-0.5 text-[11px] font-semibold text-ink-faint tracking-wider">
            STATUSES
          </div>

          {collection.statuses.map((s) =>
            confirmId === s.id ? (
              <div
                key={s.id}
                data-status-row
                className="flex items-center gap-2 px-3 py-1.5 bg-red-500/[0.06] text-[13px]"
              >
                <span className="flex-1 min-w-0 truncate text-ink">
                  Delete “{s.name}”?
                </span>
                <button
                  onClick={async () => {
                    await deleteStatus(collection.id, s.id)
                    setConfirmId(null)
                  }}
                  className="text-red-500 font-semibold shrink-0"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  className="text-ink-muted hover:text-ink shrink-0"
                >
                  Cancel
                </button>
              </div>
            ) : (
            <div
              key={s.id}
              data-status-row
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover transition group"
            >
              {/* Color swatch → palette picker */}
              <div className="relative shrink-0">
                <button
                  className="w-4 h-4 rounded-full border border-white/20 shadow-sm hover:scale-110 transition"
                  style={{ background: s.color }}
                  onClick={() => setPaletteFor(paletteFor === s.id ? null : s.id)}
                  aria-label="Change color"
                />
                {paletteFor === s.id && (
                  <div
                    className={`absolute left-0 top-full mt-1 z-50 bg-surface rounded-[10px] p-2 grid grid-cols-5 gap-1.5 w-[110px] ${FLOAT_SHADOW}`}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {COLLECTION_PALETTE.map((c) => (
                      <button
                        key={c}
                        className="w-4 h-4 rounded-full hover:scale-125 transition"
                        style={{ background: c }}
                        onClick={() => {
                          void recolorStatus(collection.id, s.id, c)
                          setPaletteFor(null)
                        }}
                        aria-label={c}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Name input */}
              <input
                defaultValue={s.name}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim()
                  if (v && v !== s.name) void renameStatus(collection.id, s.id, v)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  else if (e.key === 'Escape') {
                    e.currentTarget.value = s.name
                    e.currentTarget.blur()
                  }
                }}
                className="flex-1 min-w-0 text-[13px] text-ink bg-transparent border-b border-transparent focus:border-accent focus:outline-none"
                aria-label="Status name"
              />

              {/* Delete */}
              <button
                onClick={() => {
                  setPaletteFor(null)
                  setConfirmId(s.id)
                }}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-ink-faint hover:text-red-500 transition p-0.5 rounded"
                aria-label={`Delete ${s.name}`}
              >
                <X size={13} />
              </button>
            </div>
            )
          )}

          <div className="border-t border-border-hair mx-3 my-1.5" />
          <button
            onClick={() =>
              void addStatus(collection.id, 'New status', COLLECTION_PALETTE[0])
            }
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-accent hover:bg-accent-soft transition"
          >
            <Plus size={13} strokeWidth={2.5} />
            Add status
          </button>
        </div>
      )}
    </div>
  )
}
