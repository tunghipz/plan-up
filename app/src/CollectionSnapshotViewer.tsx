import { useMemo, useState } from 'react'
import { Lock, AlertTriangle, Image, ArrowUpRight, Sun, Moon, CalendarPlus } from 'lucide-react'
import type { Collection, Task } from './types'
import { decodeCollectionSnapshot } from './share-snapshot'
import {
  buildMonthGrid,
  assignLanes,
  computeBarSegments,
  todayLocalISO,
  formatShortDate,
  useDarkMode,
  type CalItem,
} from './lib'
import { CollectionImageModal } from './CollectionImageModal'

/**
 * Recipient side of a COLLECTION share link (v3 snapshot). main.tsx renders this
 * instead of <App>/<SnapshotViewer> when the URL carries `#v=3&s=…`. Purely
 * read-only: never reads/writes Dexie — the board comes from the decoded snapshot
 * in memory. Groups by SECTION (collections have no members); statuses are the
 * collection's own. Two views: List (card-per-section) + Calendar (month grid,
 * reusing the tested lib helpers). See design-docs/share-link-snapshot.md.
 */

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const NEUTRAL = 'var(--color-status-none)'
const VIEW_KEY = 'plan-up:snapshotCollView'

type Snap = NonNullable<ReturnType<typeof decodeCollectionSnapshot>>

/** `MMM d` from yyyy-mm-dd; '—' when absent/invalid. */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ymd = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? formatShortDate(ymd) : '—'
}

function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function safeWrite(key: string, val: string) {
  try {
    localStorage.setItem(key, val)
  } catch {
    /* locked-down embedding — non-fatal */
  }
}

export function CollectionSnapshotViewer({ raw }: { raw: string }) {
  const data = useMemo(() => decodeCollectionSnapshot(raw), [raw])
  const [exportOpen, setExportOpen] = useState(false)
  const [dark, setDark] = useDarkMode()
  const [view, setView] = useState<'list' | 'cal'>(() => (safeRead(VIEW_KEY) === 'cal' ? 'cal' : 'list'))
  const setViewPersist = (v: 'list' | 'cal') => {
    setView(v)
    safeWrite(VIEW_KEY, v)
  }

  const openApp = () => {
    window.location.hash = ''
    window.location.reload()
  }

  if (!data) {
    return (
      <div className="min-h-screen ambient-canvas grid place-items-center px-6">
        <div className="glass-card rounded-[18px] p-8 max-w-sm text-center space-y-4">
          <AlertTriangle size={30} strokeWidth={1.8} className="text-accent mx-auto" aria-hidden />
          <div>
            <h1 className="text-[17px] font-bold text-ink">Link không hợp lệ</h1>
            <p className="text-[13px] text-ink-muted mt-1.5">
              Snapshot hỏng, thiếu, hoặc thuộc phiên bản khác. Không có gì được mở.
            </p>
          </div>
          <button onClick={openApp} className="brand-btn text-white rounded-[10px] px-4 py-2 text-[14px] font-semibold">
            Mở plan-up
          </button>
        </div>
      </div>
    )
  }

  const stamp = shortDate(data.exportedAt)

  return (
    <div className="min-h-screen ambient-canvas pb-16">
      {/* Read-only header — same floating glass capsule as the sprint viewer. */}
      <div className="sticky top-0 z-20 px-3 sm:px-4 pt-3 pb-1">
        <div className="glass-toolbar rounded-full flex items-center gap-3 max-w-3xl mx-auto pl-3 pr-2 py-1.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/favicon.svg" alt="" aria-hidden className="w-[26px] h-[26px] shrink-0 rounded-[6px]" />
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-[14px] font-bold tracking-[-0.01em] text-ink whitespace-nowrap">plan-up</span>
              <span className="text-[10.5px] text-ink-faint truncate">
                shared snapshot{stamp !== '—' ? ` · ${stamp}` : ''}
              </span>
            </div>
            <span
              title="dữ liệu của bạn không bị đụng tới"
              className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent bg-accent-soft rounded-full px-2.5 py-1 shrink-0"
            >
              <Lock size={12} strokeWidth={2.4} aria-hidden />
              Read-only
            </span>
          </div>

          <div className="ml-auto flex items-center justify-end gap-1.5">
            <button
              onClick={() => setDark((d) => !d)}
              aria-label={dark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
              title={dark ? 'Light mode' : 'Dark mode'}
              className="inline-flex items-center justify-center rounded-[9px] p-1.5 text-ink-muted hover:bg-fill hover:text-ink transition"
            >
              {dark ? <Sun size={16} strokeWidth={2} aria-hidden /> : <Moon size={16} strokeWidth={2} aria-hidden />}
            </button>
            <button
              onClick={() => setExportOpen(true)}
              className="brand-btn inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold text-white whitespace-nowrap shrink-0 transition active:scale-[0.97] motion-reduce:active:scale-100"
            >
              <Image size={14} strokeWidth={2} aria-hidden />
              Export PNG
            </button>
            <button
              onClick={openApp}
              className="inline-flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[12.5px] font-semibold text-accent hover:bg-accent-soft transition whitespace-nowrap"
            >
              <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
              <span className="hidden sm:inline">Mở plan-up</span>
            </button>
          </div>
        </div>

        {/* Breadcrumb — collection · project + item count (no date range). */}
        <div className="max-w-3xl mx-auto mt-2 flex justify-center px-1">
          <div className="inline-flex items-center gap-2.5 bg-fill border border-border-hair rounded-full px-3.5 py-1.5 max-w-full">
            <span className="text-[13.5px] font-[680] tracking-[-0.01em] text-ink whitespace-nowrap">
              📚 {data.collection.name} · {data.project.name}
            </span>
            <span className="w-px h-[15px] bg-border-strong shrink-0" aria-hidden />
            <span className="text-[12px] text-ink-muted tab-data whitespace-nowrap">
              {data.items.length} item{data.items.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {/* View toggle — List | Calendar. */}
        <div className="max-w-3xl mx-auto mt-2 flex justify-center">
          <div className="inline-flex bg-fill rounded-[10px] p-[3px]">
            {(['list', 'cal'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setViewPersist(v)}
                className={`text-[13px] font-semibold px-4 py-1.5 rounded-[8px] transition ${
                  view === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {v === 'list' ? 'List' : 'Calendar'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-3 sm:px-4 pt-4 select-text">
        {view === 'list' ? <ListBoard data={data} /> : <CalBoard data={data} />}

        <div className="mt-4 flex items-center gap-2 text-[11px] text-ink-faint px-1">
          <span className="w-3 h-3 rounded-[3px] bg-accent inline-block" />
          Made with plan-up · read-only snapshot — không realtime, không đồng bộ về sau
        </div>
      </div>

      {exportOpen && <ExportBridge data={data} onClose={() => setExportOpen(false)} />}
    </div>
  )
}

/** Legend row of the collection's user-defined statuses (color → name). */
function Legend({ data }: { data: Snap }) {
  if (data.statuses.length === 0) return null
  return (
    <div className="flex items-center gap-3.5 flex-wrap mb-3 px-1">
      {data.statuses.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
          {s.name}
        </span>
      ))}
    </div>
  )
}

function StatusPill({ name, color }: { name: string | null; color: string | null }) {
  if (!name || !color) {
    return (
      <span className="inline-flex items-center rounded-full border border-dashed border-border-strong px-2.5 py-0.5 text-[11.5px] text-ink-faint">
        No status
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
      style={{
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        color: `color-mix(in srgb, ${color} 78%, var(--color-ink))`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {name}
    </span>
  )
}

/** List — one glass card per section, each a Name · Start · End · Status table. */
function ListBoard({ data }: { data: Snap }) {
  const statusById = useMemo(() => new Map(data.statuses.map((s) => [s.id, s])), [data.statuses])
  const bySection = useMemo(() => {
    const m = new Map<string, Snap['items']>()
    for (const it of data.items) {
      if (!it.sectionId) continue
      const arr = m.get(it.sectionId) ?? []
      arr.push(it)
      m.set(it.sectionId, arr)
    }
    return m
  }, [data.items])
  const sections = data.sections.filter((s) => (bySection.get(s.id)?.length ?? 0) > 0)

  return (
    <div className="space-y-4">
      <Legend data={data} />
      {sections.length === 0 ? (
        <p className="text-ink-muted text-[13px] py-10 text-center">Collection rỗng.</p>
      ) : (
        sections.map((sec) => {
          const items = bySection.get(sec.id) ?? []
          return (
            <div key={sec.id} className="glass-card rounded-[16px] overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sec.color || NEUTRAL }} aria-hidden />
                <span className="text-[14px] font-bold text-ink">{sec.name}</span>
                <span className="text-[12px] text-ink-faint tab-data">
                  {items.length} item{items.length === 1 ? '' : 's'}
                </span>
              </div>
              <table className="w-full text-[13px]" style={{ tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'color-mix(in srgb, var(--color-canvas-sunk) 40%, transparent)' }}>
                    <th className="text-left text-[11px] font-semibold text-ink-faint px-3 py-1.5">Name</th>
                    <th className="text-left text-[11px] font-semibold text-ink-faint px-3 py-1.5" style={{ width: 92 }}>Start</th>
                    <th className="text-left text-[11px] font-semibold text-ink-faint px-3 py-1.5" style={{ width: 92 }}>End</th>
                    <th className="text-left text-[11px] font-semibold text-ink-faint px-3 py-1.5" style={{ width: 120 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const st = it.statusId ? statusById.get(it.statusId) : undefined
                    return (
                      <tr key={i} className="border-t border-border-hair">
                        <td className="px-3 py-2 text-ink font-[560] truncate">{it.title || 'Untitled'}</td>
                        <td className="px-3 py-2 text-ink-muted tab-data whitespace-nowrap">{shortDate(it.startDate)}</td>
                        <td className="px-3 py-2 text-ink-muted tab-data whitespace-nowrap">{shortDate(it.dueDate)}</td>
                        <td className="px-3 py-2">
                          <StatusPill name={st?.name ?? null} color={st?.color ?? null} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })
      )}
    </div>
  )
}

/** Calendar — read-only month grid with seamless bars (reuses lib helpers). */
function CalBoard({ data }: { data: Snap }) {
  const statusColorById = useMemo(() => new Map(data.statuses.map((s) => [s.id, s.color])), [data.statuses])
  const titleById = useMemo(() => data.items.map((it, i) => ({ ...it, id: `t${i}` })), [data.items])
  const colorFor = (statusId: string | null): string => (statusId ? statusColorById.get(statusId) ?? NEUTRAL : NEUTRAL)

  const cal: CalItem[] = useMemo(
    () =>
      titleById
        .filter((t) => t.startDate)
        .map((t) => {
          const start = t.startDate as string
          const rawEnd = t.dueDate ?? start
          return { id: t.id, start, end: rawEnd < start ? start : rawEnd }
        }),
    [titleById]
  )
  const itemById = useMemo(() => new Map(titleById.map((t) => [t.id, t])), [titleById])
  const unscheduled = useMemo(() => titleById.filter((t) => !t.startDate), [titleById])

  const today = todayLocalISO()
  // Open on the earliest scheduled item's month (so bars are visible at once),
  // else the current month.
  const initial = useMemo(() => {
    const first = cal.map((c) => c.start).sort()[0]
    const base = first ?? today
    const [y, m] = base.split('-').map(Number)
    return { y, m: m - 1 }
  }, [cal, today])
  const [vm, setVm] = useState(initial)
  const nowY = Number(today.slice(0, 4))
  const nowM = Number(today.slice(5, 7)) - 1
  const onCurrentMonth = vm.y === nowY && vm.m === nowM
  const step = (delta: number) =>
    setVm((v) => {
      const m = v.m + delta
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }
    })

  const grid = useMemo(() => buildMonthGrid(vm.y, vm.m, today), [vm.y, vm.m, today])
  const lanes = useMemo(() => assignLanes(cal), [cal])
  const segs = useMemo(() => computeBarSegments(cal, grid, lanes), [cal, grid, lanes])
  const maxLane = segs.reduce((m, s) => Math.max(m, s.lane), 0)
  const gridTemplateRows = `30px repeat(${maxLane + 1}, 23px) 1fr`
  const minWeekHeight = 30 + (maxLane + 1) * 23 + 14

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        {data.statuses.length > 0 ? (
          <div className="flex items-center gap-3.5 flex-wrap">
            {data.statuses.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.name}
              </span>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          {!onCurrentMonth && (
            <button
              onClick={() => setVm({ y: nowY, m: nowM })}
              className="text-[12.5px] font-semibold text-accent rounded-[7px] px-2.5 py-1 hover:bg-accent-soft transition"
            >
              Today
            </button>
          )}
          <button onClick={() => step(-1)} className="w-[26px] h-[26px] rounded-[7px] bg-ink/[0.05] hover:bg-ink/[0.09] text-ink-muted transition grid place-items-center" aria-label="Previous month">‹</button>
          <span className="min-w-[104px] text-center tabular-nums">{MONTHS_LONG[vm.m]} {vm.y}</span>
          <button onClick={() => step(1)} className="w-[26px] h-[26px] rounded-[7px] bg-ink/[0.05] hover:bg-ink/[0.09] text-ink-muted transition grid place-items-center" aria-label="Next month">›</button>
        </div>
      </div>

      <div className="glass-card rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border-hair">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-[11px] font-semibold text-ink-faint text-right px-3 pt-[9px] pb-2">{w}</div>
          ))}
        </div>

        {grid.weeks.map((week, weekIndex) => (
          <div
            key={week.startIdx}
            className="grid grid-cols-7 relative border-b border-border-hair last:border-b-0"
            style={{ gridTemplateRows, minHeight: `${minWeekHeight}px` }}
          >
            {week.cells.map((cell, c) => (
              <div
                key={`bg-${cell.date}`}
                className={`row-[1/-1] z-0 ${c === 6 ? '' : 'border-r border-border-hair'} ${cell.inMonth ? '' : 'bg-ink/[0.02]'}`}
                style={{ gridColumn: c + 1 }}
                aria-hidden
              />
            ))}
            {week.cells.map((cell, c) => (
              <div
                key={`num-${cell.date}`}
                className={
                  cell.isToday
                    ? 'row-[1] z-[2] justify-self-end mt-[5px] mr-[7px] w-[22px] h-[22px] grid place-items-center rounded-full bg-accent text-white text-[12.5px] font-semibold leading-none'
                    : `row-[1] z-[2] justify-self-end px-[11px] pt-[7px] text-[12.5px] leading-none ${cell.inMonth ? 'text-ink-muted' : 'text-ink-faint'}`
                }
                style={{ gridColumn: c + 1 }}
              >
                {cell.day}
              </div>
            ))}
            {segs
              .filter((s) => s.weekIndex === weekIndex)
              .map((seg) => {
                const it = itemById.get(seg.itemId)
                const color = colorFor(it?.statusId ?? null)
                const r = '999px'
                const rl = seg.roundL ? r : '0'
                const rr = seg.roundR ? r : '0'
                return (
                  <div
                    key={`${seg.itemId}-${seg.weekIndex}`}
                    className="z-[1] h-[21px] my-px flex items-center gap-[3px] px-[9px] text-[11.5px] font-semibold whitespace-nowrap overflow-hidden relative"
                    style={{
                      gridColumn: `${seg.colStart} / span ${seg.span}`,
                      gridRow: seg.lane + 2,
                      borderRadius: `${rl} ${rr} ${rr} ${rl}`,
                      marginLeft: seg.roundL ? '4px' : '0',
                      marginRight: seg.roundR ? '4px' : '0',
                      paddingLeft: seg.roundL ? '13px' : '9px',
                      background: `color-mix(in srgb, ${color} 16%, transparent)`,
                      color: `color-mix(in srgb, ${color} 78%, var(--color-ink))`,
                    }}
                  >
                    {seg.roundL && (
                      <span className="absolute left-0 top-[3px] bottom-[3px] w-[3px] rounded-[3px] opacity-90" style={{ background: color }} aria-hidden />
                    )}
                    {seg.leftChev && <span className="font-bold opacity-85 shrink-0">‹</span>}
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">{it?.title ?? ''}</span>
                    {seg.rightChev && <span className="font-bold opacity-85 shrink-0 ml-auto">›</span>}
                  </div>
                )
              })}
          </div>
        ))}
      </div>

      {cal.length === 0 && (
        <div className="text-center text-[13px] text-ink-faint py-3">No items have dates yet.</div>
      )}

      {unscheduled.length > 0 && (
        <div className="mt-3 glass-card rounded-[18px] px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-ink-faint mr-0.5">Unscheduled · {unscheduled.length}</span>
            {unscheduled.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5 h-8 bg-canvas border border-border-hair rounded-full px-2.5 text-[12.5px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(t.statusId) }} aria-hidden />
                <span className="max-w-[150px] truncate">{t.title || 'Untitled'}</span>
                <CalendarPlus size={13} className="text-ink-faint shrink-0" aria-hidden />
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Reconstruct a synthetic Collection + Task[] from the snapshot so the existing
 * CollectionImageModal / CollectionPngCard can render the PNG unchanged. */
function ExportBridge({ data, onClose }: { data: Snap; onClose: () => void }) {
  const collection: Collection = {
    id: 'c0',
    projectId: '',
    name: data.collection.name,
    order: 0,
    sections: data.sections.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    statuses: data.statuses.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    createdAt: 0,
  }
  const items: Task[] = data.items.map((it, i) => ({
    id: `t${i}`,
    projectId: '',
    sequence: i,
    title: it.title,
    assigneeId: null,
    sprintId: null,
    status: 'todo',
    priority: 'none',
    startDate: it.startDate,
    dueDate: it.dueDate,
    estimate: null,
    createdAt: 0,
    dependsOn: [],
    collectionId: 'c0',
    sectionId: it.sectionId,
    collectionStatusId: it.statusId,
    listOrder: i,
  }))
  return <CollectionImageModal collection={collection} items={items} onClose={onClose} />
}
