import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, List, Calendar, X } from 'lucide-react'
import {
  db,
  addSection,
  renameSection,
  deleteSection,
  addCollectionItem,
  renameCollection,
  type Collection,
  type CollectionStatus,
  type Task,
} from './db'
import { formatShortDate } from './lib'

const COLLAPSE_KEY = (collectionId: string) =>
  `plan-up:collCollapsed:${collectionId}`

/** Grid columns shared by the column-header row and each item row. */
const ROW_GRID = 'grid-cols-[24px_1fr_96px_96px_112px]'

export function CollectionView({
  collectionId,
}: {
  collectionId: string
  projectId: string
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

  const [tab, setTab] = useState<'list' | 'calendar'>('list')

  if (!collection) {
    return <div className="p-6 text-ink-muted">Loading…</div>
  }

  const statusById = new Map(collection.statuses.map((s) => [s.id, s]))
  const itemsBySection = (sectionId: string) =>
    items.filter((t) => t.sectionId === sectionId)

  return (
    <div className="max-w-5xl mx-auto px-1">
      <div className="flex items-center justify-between gap-3 mb-4 pt-1 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <CollectionTitle collection={collection} />
          <span className="text-[10px] font-bold tracking-wide text-white bg-accent rounded-[5px] px-1.5 py-0.5">
            COLLECTION
          </span>
        </div>
        <Segmented tab={tab} onChange={setTab} />
      </div>

      {tab === 'list' ? (
        <div className="space-y-4">
          {collection.sections.map((sec) => (
            <SectionCard
              key={sec.id}
              collectionId={collectionId}
              canDelete={collection.sections.length > 1}
              section={sec}
              items={itemsBySection(sec.id)}
              statusById={statusById}
            />
          ))}
          <button
            data-add-table
            onClick={async () => {
              const name = window.prompt('New table name:')
              if (name && name.trim()) await addSection(collectionId, name)
            }}
            className="w-full py-3 text-[13.5px] font-semibold text-accent border border-dashed border-border rounded-[14px] hover:bg-accent-soft transition"
          >
            ＋ Add table
          </button>
        </div>
      ) : (
        <div className="text-ink-faint p-12 text-center text-[14px] border border-dashed border-border rounded-[14px]">
          Calendar view — coming soon
        </div>
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
        className="editable text-[18px] font-bold text-ink tracking-[-0.018em] bg-transparent min-w-0 max-w-[320px]"
        aria-label="Rename collection"
      />
    )
  }
  return (
    <h2
      className="text-[18px] font-bold text-ink tracking-[-0.018em] truncate cursor-text hover:underline decoration-dotted underline-offset-4"
      onDoubleClick={() => setEditing(true)}
      title="Double-click to rename"
    >
      {collection.name}
    </h2>
  )
}

/** Apple-style segmented List/Calendar control. */
function Segmented({
  tab,
  onChange,
}: {
  tab: 'list' | 'calendar'
  onChange: (t: 'list' | 'calendar') => void
}) {
  const item = (mode: 'list' | 'calendar', label: string, Icon: typeof List) => {
    const active = tab === mode
    return (
      <button
        onClick={() => onChange(mode)}
        className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-[7px] transition ${
          active
            ? 'bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]'
            : 'text-ink-muted hover:text-ink'
        }`}
        aria-pressed={active}
      >
        <Icon size={13} strokeWidth={active ? 2 : 1.75} />
        {label}
      </button>
    )
  }
  return (
    <div className="flex gap-1 bg-black/[0.06] dark:bg-white/[0.08] rounded-[9px] p-[3px]">
      {item('list', 'List', List)}
      {item('calendar', 'Calendar', Calendar)}
    </div>
  )
}

function SectionCard({
  collectionId,
  section,
  items,
  statusById,
  canDelete,
}: {
  collectionId: string
  section: { id: string; name: string; color?: string }
  items: Task[]
  statusById: Map<string, CollectionStatus>
  canDelete: boolean
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

  return (
    <div
      data-section-card
      className="bg-surface rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)] overflow-hidden"
    >
      <div className="group flex items-center gap-2.5 px-[18px] py-3 select-none">
        <button
          onClick={toggle}
          className="text-ink-faint shrink-0"
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-label={collapsed ? 'Expand table' : 'Collapse table'}
        >
          <ChevronDown
            size={14}
            className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
        </button>
        <SectionName collectionId={collectionId} section={section} />
        <span className="text-[13px] font-medium text-ink-faint tabular-nums">
          {items.length}
        </span>
        <span className="flex-1" />
        {canDelete && (
          <button
            onClick={async () => {
              if (
                window.confirm(
                  `Delete table “${section.name}”? Its items move to the first table.`
                )
              ) {
                await deleteSection(collectionId, section.id)
              }
            }}
            title="Delete table"
            aria-label="Delete table"
            className="text-ink-faint opacity-0 group-hover:opacity-70 hover:opacity-100 hover:text-ink p-1 rounded-md transition"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {!collapsed && (
        <div>
          <div
            className={`grid ${ROW_GRID} gap-[13px] items-center px-[18px] py-[7px] bg-black/[0.018] dark:bg-white/[0.02] text-[11px] font-semibold text-ink-faint border-t border-border-hair`}
          >
            <span />
            <span>Name</span>
            <span>Start</span>
            <span>End</span>
            <span>Status</span>
          </div>

          {items.map((t) => (
            <ItemRow key={t.id} task={t} statusById={statusById} />
          ))}

          <button
            onClick={async () => {
              const title = window.prompt('Item title:')
              if (title && title.trim())
                await addCollectionItem(collectionId, section.id, {
                  title: title.trim(),
                })
            }}
            className="w-full text-left px-[18px] py-[11px] text-[13.5px] text-accent border-t border-border-hair hover:bg-surface-hover transition"
          >
            ＋ Add item
          </button>
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
      className="text-[15.5px] font-semibold text-ink tracking-[-0.01em] truncate cursor-text hover:underline decoration-dotted underline-offset-4"
      onDoubleClick={() => setEditing(true)}
      title="Double-click to rename"
    >
      {section.name}
    </span>
  )
}

function ItemRow({
  task,
  statusById,
}: {
  task: Task
  statusById: Map<string, CollectionStatus>
}) {
  const status = task.collectionStatusId
    ? statusById.get(task.collectionStatusId)
    : undefined
  const dotColor = status?.color ?? '#C7C7CC'

  return (
    <div
      className={`grid ${ROW_GRID} gap-[13px] items-center px-[18px] py-[11px] text-[14.5px] border-t border-border-hair hover:bg-surface-hover transition`}
    >
      <span
        className="w-[17px] h-[17px] rounded-full justify-self-start"
        style={{ background: dotColor }}
        aria-hidden
      />
      <ItemTitle task={task} />
      <span className="text-[13px] text-ink-muted tabular-nums">
        {task.startDate ? formatShortDate(task.startDate) : '—'}
      </span>
      <span className="text-[13px] text-ink-muted tabular-nums">
        {task.dueDate ? formatShortDate(task.dueDate) : '—'}
      </span>
      <StatusPill status={status} />
    </div>
  )
}

/** Inline-edit the item title (Enter / blur commits). */
function ItemTitle({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(task.title)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, task.title])

  const commit = async () => {
    const n = draft.trim()
    setEditing(false)
    if (n && n !== task.title) await db.tasks.update(task.id, { title: n })
    else if (!n) setDraft(task.title)
  }
  const cancel = () => {
    setDraft(task.title)
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
        className="editable text-[14.5px] text-ink bg-transparent min-w-0 w-full"
        aria-label="Rename item"
      />
    )
  }
  return (
    <span
      className="truncate text-ink cursor-text hover:underline decoration-dotted underline-offset-4"
      onDoubleClick={() => setEditing(true)}
      title="Double-click to rename"
    >
      {task.title}
    </span>
  )
}

/** Display-only status pill (click-to-assign editor lands in Task 12). */
function StatusPill({ status }: { status?: CollectionStatus }) {
  if (!status) {
    return (
      <span className="text-[11.5px] font-medium text-ink-faint">
        No status
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold w-fit"
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
  )
}
