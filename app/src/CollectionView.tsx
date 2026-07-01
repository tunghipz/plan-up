import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, X, Plus, Trash2, Layers, Pencil } from 'lucide-react'
import {
  db,
  addSection,
  renameSection,
  deleteSection,
  addCollectionItem,
  renameCollection,
  moveCollectionItem,
  deleteTask,
  orderBetween,
  renormalizeListOrder,
  addStatus,
  renameStatus,
  recolorStatus,
  deleteStatus,
  COLLECTION_PALETTE,
  type Collection,
  type CollectionStatus,
  type Task,
} from './db'
import { CollectionCalendar } from './CollectionCalendar'
import { DateRangePickCell } from './DatePicker'
import { AddGroupButton } from './AddGroupButton'
import { useDragHandle, type RowDrag } from './DragHandle'

/** Effective manual order for a collection item — mirrors the sprint list. */
const effOrder = (t: Task) => t.listOrder ?? t.sequence

const COLLAPSE_KEY = (collectionId: string) =>
  `plan-up:collCollapsed:${collectionId}`

// Stable empty array so a section with no items doesn't hand SectionCard a fresh
// `[]` identity each render (keeps future memoization honest).
const EMPTY_ITEMS: Task[] = []

/**
 * Column widths shared by the column-header row and each item row — mirrors the
 * sprint list view's `COL` (SprintView.tsx) so Collections feel identical, minus
 * the scheduling columns (no seq/assignee/effort/prereq). Flex, not grid: the
 * title absorbs the slack via flex-1; the rest are fixed and shrink-0.
 */
const COL = {
  lead: 'w-5 shrink-0 flex justify-center items-center',
  dot: 'w-4 shrink-0 flex justify-center',
  title: 'flex-1 min-w-[150px]',
  start: 'w-28 flex justify-end shrink-0',
  due: 'w-28 flex justify-end shrink-0',
  status: 'w-28 flex justify-start shrink-0 pl-2',
}

// Click-to-sort columns — mirrors the sprint list (SprintView.tsx), minus the
// scheduling fields. `null` sort = natural (insertion/DB) order. See
// design-docs/collections.md + list-view.md.
type CollSortField = 'title' | 'startDate' | 'dueDate' | 'status'
type CollSort = { field: CollSortField; dir: 'asc' | 'desc' } | null
// One global sort preference shared across every section card (like the sprint
// list's global SORT_KEY), so it survives switching collection/view + reload.
const COLL_SORT_KEY = 'plan-up:collSort'
const COLL_SORT_FIELDS: CollSortField[] = ['title', 'startDate', 'dueDate', 'status']

function loadCollSort(): CollSort {
  try {
    const raw = localStorage.getItem(COLL_SORT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<NonNullable<CollSort>>
    if (
      parsed &&
      COLL_SORT_FIELDS.includes(parsed.field as CollSortField) &&
      (parsed.dir === 'asc' || parsed.dir === 'desc')
    ) {
      return { field: parsed.field as CollSortField, dir: parsed.dir }
    }
    return null
  } catch {
    return null
  }
}

function saveCollSort(sort: CollSort) {
  try {
    if (sort) localStorage.setItem(COLL_SORT_KEY, JSON.stringify(sort))
    else localStorage.removeItem(COLL_SORT_KEY)
  } catch {
    // localStorage unavailable, swallow
  }
}

/**
 * Compare two items for the active sort. Empty dates sort last; status sorts by
 * the user-defined status order (no status sorts last). JS sort is stable, so
 * equal items keep their natural order. `statusRank` maps statusId → index.
 */
function compareItems(
  a: Task,
  b: Task,
  sort: NonNullable<CollSort>,
  statusRank: Map<string, number>
): number {
  const mul = sort.dir === 'asc' ? 1 : -1
  const val = (t: Task): string | number =>
    sort.field === 'title'
      ? (t.title || '').toLowerCase()
      : sort.field === 'status'
        ? t.collectionStatusId
          ? (statusRank.get(t.collectionStatusId) ?? Number.POSITIVE_INFINITY)
          : Number.POSITIVE_INFINITY
        : (t[sort.field] ?? '￿') // startDate / dueDate — empty sorts last
  const va = val(a)
  const vb = val(b)
  if (va < vb) return -1 * mul
  if (va > vb) return 1 * mul
  return 0
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
  onViewInList,
}: {
  collectionId: string
  /** Controlled view — driven by the single adaptive toggle in App's top bar. */
  view: 'list' | 'calendar'
  /** Calendar's "View in list →" callback (App flips the top-bar toggle). */
  onViewInList: () => void
}) {
  const collection = useLiveQuery<Collection | undefined>(
    () => db.collections.get(collectionId),
    [collectionId]
  )
  const items =
    useLiveQuery<Task[]>(
      () => db.tasks.where('collectionId').equals(collectionId).toArray(),
      [collectionId]
    ) ?? []

  const [addingTable, setAddingTable] = useState(false)

  // Global sort preference, shared across all section cards (mirrors sprint list).
  const [sort, setSort] = useState<CollSort>(loadCollSort)
  useEffect(() => {
    saveCollSort(sort)
  }, [sort])

  const statusById = useMemo(
    () => new Map((collection?.statuses ?? []).map((s) => [s.id, s])),
    [collection]
  )
  // Rank statuses by their user-defined order so `status` sort follows it.
  const statusRank = useMemo(
    () => new Map((collection?.statuses ?? []).map((s, i) => [s.id, i])),
    [collection]
  )
  // Group items by section ONCE per data change instead of re-filtering the full
  // item list for every section on every render — that was O(sections × items)
  // per keystroke, since item titles persist on every keystroke. Each section's
  // array is natural-sorted by effOrder (listOrder ?? sequence) — the order the
  // pointer-drag reorders within, and the display order when no column sort is on.
  const itemsBySectionMap = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of items) {
      const k = t.sectionId ?? ''
      const arr = m.get(k)
      arr ? arr.push(t) : m.set(k, [t])
    }
    for (const arr of m.values()) arr.sort((a, b) => effOrder(a) - effOrder(b))
    return m
  }, [items])
  const itemsById = useMemo(() => new Map(items.map((t) => [t.id, t])), [items])

  // ── Pointer-based drag-to-reorder (shared useDragHandle with the sprint list) ─
  // The owner lives HERE (not per-card) so hit-testing spans every SectionCard:
  // reordering within a table and moving an item to another table are the same
  // gesture. Only offered in the natural order (sort === null), like the sprint
  // list's `canReorder`. See design-docs/collections.md.
  const canReorder = sort === null
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; pos: 'before' | 'after' } | null>(
    null
  )
  // Section under the cursor — highlights an empty table (which has no row to show
  // a drop-slot line on) as a valid drop target.
  const [overSectionId, setOverSectionId] = useState<string | null>(null)
  const overRaf = useRef(0)
  const pendingHit = useRef<{ id: string; el: HTMLElement; clientY: number } | null>(
    null
  )

  const endDrag = () => {
    setDragId(null)
    setOver(null)
    setOverSectionId(null)
    if (overRaf.current) {
      cancelAnimationFrame(overRaf.current)
      overRaf.current = 0
    }
  }

  // Hover: resolve the item + section under the cursor (elementFromPoint), show a
  // before/after slot line on the hovered row (rAF-throttled like the sprint list).
  const hoverItem = (x: number, y: number) => {
    if (!dragId) return
    const el = document.elementFromPoint(x, y)
    const secEl = el?.closest('[data-section-id]') as HTMLElement | null
    setOverSectionId(secEl?.dataset.sectionId ?? null)
    const itemEl = el?.closest('[data-item-id]') as HTMLElement | null
    const targetId = itemEl?.dataset.itemId
    if (!targetId || targetId === dragId) {
      if (over) setOver(null)
      return
    }
    pendingHit.current = { id: targetId, el: itemEl!, clientY: y }
    if (overRaf.current) return
    overRaf.current = requestAnimationFrame(() => {
      overRaf.current = 0
      const h = pendingHit.current
      if (!h || !dragId) return
      const r = h.el.getBoundingClientRect()
      const pos: 'before' | 'after' =
        h.clientY - r.top > r.height / 2 ? 'after' : 'before'
      setOver((prev) =>
        prev && prev.id === h.id && prev.pos === pos ? prev : { id: h.id, pos }
      )
    })
  }

  // Drop: place the dragged item into the target section at the resolved slot,
  // writing sectionId + listOrder together (moveCollectionItem). Dropping on a
  // section's empty area appends to its end. Renormalizes on float-precision
  // collision, mirroring the sprint list's drop.
  const dropOnItem = (x: number, y: number) => {
    const id = dragId
    const dragged = id ? itemsById.get(id) : null
    if (!id || !dragged) return
    const el = document.elementFromPoint(x, y)
    const itemEl = el?.closest('[data-item-id]') as HTMLElement | null
    const secEl = el?.closest('[data-section-id]') as HTMLElement | null
    const targetId = itemEl?.dataset.itemId
    const targetSectionId =
      (targetId ? itemsById.get(targetId)?.sectionId : undefined) ??
      secEl?.dataset.sectionId
    if (!targetSectionId) return
    const arr = itemsBySectionMap.get(targetSectionId) ?? []
    const rest = arr.filter((x) => x.id !== id)
    let insertAt: number
    if (targetId && targetId !== id) {
      const r = itemEl!.getBoundingClientRect()
      const pos: 'before' | 'after' = y - r.top > r.height / 2 ? 'after' : 'before'
      insertAt = rest.findIndex((x) => x.id === targetId)
      if (insertAt < 0) return
      if (pos === 'after') insertAt += 1
    } else {
      // Dropped on the section's empty/below-rows area → append to the end.
      insertAt = rest.length
    }
    const before = rest[insertAt - 1] ?? null
    const after = rest[insertAt] ?? null
    // No-op if it lands back in its own gap within the same table.
    if (dragged.sectionId === targetSectionId) {
      const fromIndex = arr.findIndex((x) => x.id === id)
      const left = arr[fromIndex - 1] ?? null
      const right = arr[fromIndex + 1] ?? null
      if (
        (before?.id ?? null) === (left?.id ?? null) &&
        (after?.id ?? null) === (right?.id ?? null)
      )
        return
    }
    const beforeOrder = before ? effOrder(before) : null
    const afterOrder = after ? effOrder(after) : null
    const newOrder = orderBetween(beforeOrder, afterOrder)
    const collides =
      (beforeOrder != null && newOrder <= beforeOrder) ||
      (afterOrder != null && newOrder >= afterOrder)
    if (collides) {
      const orderedIds = rest.map((x) => x.id)
      orderedIds.splice(insertAt, 0, id)
      if (dragged.sectionId !== targetSectionId)
        void db.tasks.update(id, { sectionId: targetSectionId })
      void renormalizeListOrder(orderedIds)
    } else {
      void moveCollectionItem(id, targetSectionId, newOrder)
    }
  }

  const dragFor = (t: Task): RowDrag | undefined =>
    canReorder
      ? {
          id: t.id,
          enabled: true,
          dragging: dragId === t.id,
          over: over?.id === t.id ? over.pos : null,
          onStart: () => setDragId(t.id),
          onMove: hoverItem,
          onDrop: dropOnItem,
          onEnd: endDrag,
        }
      : undefined

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
              statusById={statusById}
              statuses={collection.statuses}
              sort={sort}
              setSort={setSort}
              statusRank={statusRank}
              dragFor={dragFor}
              dropHint={dragId !== null && overSectionId === sec.id}
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(collection.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(collection.name)
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
      onClick={() => setEditing(true)}
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
  statusById,
  statuses,
  canDelete,
  sort,
  setSort,
  statusRank,
  dragFor,
  dropHint,
}: {
  collectionId: string
  section: { id: string; name: string; color?: string }
  items: Task[]
  statusById: Map<string, CollectionStatus>
  statuses: CollectionStatus[]
  canDelete: boolean
  sort: CollSort
  setSort: React.Dispatch<React.SetStateAction<CollSort>>
  statusRank: Map<string, number>
  /** Pointer-drag wiring from CollectionView (undefined row → not draggable). */
  dragFor: (t: Task) => RowDrag | undefined
  /** True while a drag hovers this card — highlights it as a drop target. */
  dropHint: boolean
}) {
  // Apply the active sort; `null` keeps natural (insertion) order. JS sort is
  // stable, so a copy preserves order for equal rows. See list-view.md.
  const sortedItems = useMemo(
    () =>
      sort ? [...items].sort((a, b) => compareItems(a, b, sort, statusRank)) : items,
    [items, sort, statusRank]
  )
  // Three-state cycle per column: asc → desc → off (natural order).
  const onSort = (field: CollSortField) => {
    setSort((prev) => {
      if (!prev || prev.field !== field) return { field, dir: 'asc' }
      if (prev.dir === 'asc') return { field, dir: 'desc' }
      return null
    })
  }
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

  // Inline (in-DNA) delete confirm — replaces window.confirm (§8).
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div
      data-section-card
      // Hit-test anchor for the pointer-drag owner (CollectionView): identifies
      // this table so an item can be dropped into it — including onto its empty
      // area, which has no row to land on.
      data-section-id={section.id}
      className={`bg-surface rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)] overflow-hidden transition-shadow ${
        dropHint ? 'ring-2 ring-accent/40' : ''
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
              <div className={COL.dot} />
              <SortHeader
                className={COL.title}
                field="title"
                label="Name"
                sort={sort}
                onSort={onSort}
              />
              <SortHeader
                className={COL.start}
                field="startDate"
                label="Start"
                sort={sort}
                onSort={onSort}
                align="end"
              />
              <SortHeader
                className={COL.due}
                field="dueDate"
                label="End"
                sort={sort}
                onSort={onSort}
                align="end"
              />
              <SortHeader
                className={COL.status}
                field="status"
                label="Status"
                sort={sort}
                onSort={onSort}
              />
            </div>
          )}

          {items.length === 0 && (
            <div className="px-4 pt-6 pb-1 text-center text-[13.5px] text-ink-faint">
              No items yet — add your first below.
            </div>
          )}

          <div className="divide-y divide-border">
            {sortedItems.map((t) => (
              <ItemRow
                key={t.id}
                task={t}
                statusById={statusById}
                statuses={statuses}
                drag={dragFor(t)}
              />
            ))}
            <AddItemRow collectionId={collectionId} sectionId={section.id} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Clickable column header — same look/cycle as the sprint list's SortHeader, but
 * over the collection's smaller field set and a nullable sort (off = natural).
 */
function SortHeader({
  className,
  field,
  label,
  sort,
  onSort,
  align,
}: {
  className: string
  field: CollSortField
  label: string
  sort: CollSort
  onSort: (f: CollSortField) => void
  align?: 'start' | 'center' | 'end'
}) {
  const isActive = sort?.field === field
  // Hint the NEXT click in the asc → desc → off cycle.
  const nextHint = !isActive
    ? `Sort by ${label}`
    : sort!.dir === 'asc'
      ? `Sort by ${label}, descending`
      : 'Clear sort'
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`${className} group flex items-center gap-1 text-[11px] tracking-normal font-medium select-none py-0.5 hover:bg-black/[0.04] rounded transition ${
        align === 'end'
          ? 'justify-end'
          : align === 'center'
            ? 'justify-center'
            : ''
      } ${isActive ? 'text-accent' : 'text-ink-faint hover:text-ink'}`}
      aria-label={nextHint}
      title={nextHint}
    >
      <span>{label}</span>
      <span
        className={`text-[9px] leading-none ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}
        aria-hidden
      >
        {isActive ? (sort!.dir === 'asc' ? '▲' : '▼') : '▲'}
      </span>
    </button>
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
      setDraft(section.name)
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
  statusById,
  statuses,
  drag,
}: {
  task: Task
  statusById: Map<string, CollectionStatus>
  statuses: CollectionStatus[]
  /** Pointer-drag wiring (undefined → not draggable, e.g. a column sort is on). */
  drag?: RowDrag
}) {
  const status = task.collectionStatusId
    ? statusById.get(task.collectionStatusId)
    : undefined
  const dotColor = status?.color ?? '#C7C7CC'

  // Pointer-based drag (shared with the sprint list). The grip is rendered
  // absolutely at the row's left edge and only *it* starts a drag, so the title
  // textarea + date/status controls keep receiving normal clicks. `data-item-id`
  // is how the owner's elementFromPoint hit-test finds this row.
  const { grip, indicator, dragging } = useDragHandle(drag)

  return (
    <div
      data-item-id={task.id}
      className={`task-row group/row relative flex items-center gap-3 px-4 py-2 text-sm transition hover:bg-surface-hover ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      {grip}
      {indicator}
      <div className={COL.lead} />
      {/* Status dot at rest ↔ delete at hover, in the same slot — keeps the
          control "up front" without a trailing cell that would offset the column
          grid, and clear of the drag grip (which lives in the lead gutter). One
          click, no confirm: a collection item is lightweight (§ speed > breadth). */}
      <div className={`${COL.dot} relative`}>
        <span
          className="w-3 h-3 rounded-full group-hover/row:opacity-0 transition-opacity"
          style={{ background: dotColor }}
          aria-hidden
        />
        <button
          type="button"
          aria-label="Delete item"
          title="Delete item"
          onClick={(e) => {
            e.stopPropagation()
            void deleteTask(task.id)
          }}
          className="absolute inset-0 grid place-items-center rounded text-ink-faint/70 opacity-0 group-hover/row:opacity-100 hover:text-red-500 transition"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <ItemTitle task={task} />
      <div className={COL.start}>
        <DateRangePickCell
          which="start"
          start={task.startDate}
          end={task.dueDate}
          onChange={({ start, end }) =>
            db.tasks.update(task.id, { startDate: start, dueDate: end })
          }
          ariaLabel="Start date"
          emptyHint="Start"
        />
      </div>
      <div className={COL.due}>
        <DateRangePickCell
          which="end"
          start={task.startDate}
          end={task.dueDate}
          onChange={({ start, end }) =>
            db.tasks.update(task.id, { startDate: start, dueDate: end })
          }
          ariaLabel="End date"
          emptyHint="End"
        />
      </div>
      <div className={COL.status}>
        <StatusPill task={task} status={status} statuses={statuses} />
      </div>
    </div>
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
      <div className={COL.lead} />
      <div className={COL.dot}>
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
      <div className={COL.start} />
      <div className={COL.due} />
      <div className={COL.status} />
    </div>
  )
}

/** Click-to-assign status pill. */
function StatusPill({
  task,
  status,
  statuses,
}: {
  task: Task
  status?: CollectionStatus
  statuses: CollectionStatus[]
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: -9999,
    left: -9999,
  })
  const MENU_W = 160

  // Pin a fixed-position menu to the pill — portalled to <body> so the card's
  // `overflow-hidden` (rounded corners) can't clip it. Mirrors DatePicker.
  useLayoutEffect(() => {
    if (!open) return
    const pin = () => {
      const r = anchorRef.current?.getBoundingClientRect()
      if (!r) return
      let left = Math.min(r.left, window.innerWidth - 8 - MENU_W)
      left = Math.max(8, left)
      const menuH = (statuses.length + 1) * 34 + 16
      let top = r.bottom + 4
      if (top + menuH > window.innerHeight - 8)
        top = Math.max(8, r.top - menuH - 4)
      setPos({ top, left })
    }
    pin()
    window.addEventListener('scroll', pin, true)
    window.addEventListener('resize', pin)
    return () => {
      window.removeEventListener('scroll', pin, true)
      window.removeEventListener('resize', pin)
    }
  }, [open, statuses.length])

  // Close on outside click (anchor OR menu excluded) and Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (
        popRef.current?.contains(t) ||
        anchorRef.current?.contains(t)
      )
        return
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

  const assign = async (id: string | null) => {
    setOpen(false)
    await db.tasks.update(task.id, { collectionStatusId: id })
  }

  return (
    <>
      <button
        ref={anchorRef}
        onClick={() => setOpen((p) => !p)}
        className="cursor-pointer hover:opacity-80 transition"
        aria-label="Assign status"
      >
        {status ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold leading-none w-fit"
            style={{
              background: `color-mix(in srgb, ${status.color} 16%, transparent)`,
              color: status.color,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: status.color }}
              aria-hidden
            />
            {status.name}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[11.5px] font-medium leading-none text-ink-faint hover:border-accent hover:text-accent transition">
            ＋ Status
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: MENU_W,
            }}
            className={`z-50 bg-surface rounded-[10px] py-1 ${FLOAT_SHADOW}`}
          >
            {statuses.map((s) => (
              <button
                key={s.id}
                onClick={() => void assign(s.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-ink hover:bg-surface-hover transition"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: s.color }}
                  aria-hidden
                />
                {s.name}
              </button>
            ))}
            <div className="border-t border-border-hair my-1" />
            <button
              onClick={() => void assign(null)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-ink-muted hover:bg-surface-hover transition"
            >
              <span
                className="w-2.5 h-2.5 rounded-full border border-border shrink-0"
                aria-hidden
              />
              No status
            </button>
          </div>,
          document.body
        )}
    </>
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
