import { forwardRef } from 'react'
import type { Collection, Task } from './types'
import { formatShortDate } from './lib'

/**
 * Off-screen card that becomes the exported collection PNG (design-docs/export-png.md
 * "Collection variant"). Inline HEX only — no Tailwind / CSS vars / oklch — so
 * `modern-screenshot` renders it identically regardless of theme. Always light.
 * One section (📁) per table: columns Name · Start · End · Status, custom-status
 * pills tinted from CollectionStatus.color, nested subtasks. No Effort/Assignee/
 * prereq columns (those are sprint-only). Empty sections are dropped.
 */

const C = {
  ink: '#1d1d1f',
  muted: '#6e6e73',
  faint: '#a1a1a6',
  hair: '#e5e5ea',
  surface: '#ffffff',
  panel: '#f5f5f7',
}

/** Rows in section order, children nested right under their in-section parent. */
function orderedWithDepth(items: Task[]): { task: Task; child: boolean }[] {
  const byOrder = [...items].sort(
    (a, b) => (a.listOrder ?? a.sequence) - (b.listOrder ?? b.sequence)
  )
  const idSet = new Set(byOrder.map((t) => t.id))
  const childrenByParent = new Map<string, Task[]>()
  for (const t of byOrder) {
    if (t.parentId && idSet.has(t.parentId)) {
      const arr = childrenByParent.get(t.parentId) ?? []
      arr.push(t)
      childrenByParent.set(t.parentId, arr)
    }
  }
  const isChild = (t: Task) => !!(t.parentId && idSet.has(t.parentId))
  const out: { task: Task; child: boolean }[] = []
  for (const t of byOrder.filter((x) => !isChild(x))) {
    out.push({ task: t, child: false })
    for (const k of childrenByParent.get(t.id) ?? []) out.push({ task: k, child: true })
  }
  return out
}

export const CollectionPngCard = forwardRef<
  HTMLDivElement,
  { collection: Collection; items: Task[] }
>(function CollectionPngCard({ collection, items }, ref) {
  const statusById = new Map(collection.statuses.map((s) => [s.id, s]))
  const bySection = new Map<string, Task[]>()
  for (const t of items) {
    if (!t.sectionId) continue
    const arr = bySection.get(t.sectionId) ?? []
    arr.push(t)
    bySection.set(t.sectionId, arr)
  }
  const sections = collection.sections.filter((s) => (bySection.get(s.id)?.length ?? 0) > 0)

  const th: React.CSSProperties = {
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: C.faint,
    padding: '7px 10px',
    borderBottom: `1px solid ${C.hair}`,
    whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    fontSize: 13,
    color: C.ink,
    padding: '9px 10px',
    borderBottom: `0.5px solid ${C.hair}`,
    verticalAlign: 'middle',
  }
  const dateCell: React.CSSProperties = {
    ...td,
    color: C.muted,
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  }

  return (
    <div
      ref={ref}
      style={{
        width: 660,
        background: C.surface,
        padding: '30px 34px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        color: C.ink,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
        {collection.name}
      </div>
      <div style={{ fontSize: 12.5, color: C.faint, marginTop: 3 }}>
        {items.length} item{items.length === 1 ? '' : 's'}
      </div>

      {sections.map((sec) => {
        const rows = orderedWithDepth(bySection.get(sec.id) ?? [])
        return (
          <div key={sec.id} style={{ marginTop: 22 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
              📁 {sec.name}
              <span style={{ color: C.faint, fontWeight: 600, marginLeft: 6 }}>· {rows.length}</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Name</th>
                  <th style={{ ...th, textAlign: 'right' }}>Start</th>
                  <th style={{ ...th, textAlign: 'right' }}>End</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ task, child }) => {
                  const st = task.collectionStatusId
                    ? statusById.get(task.collectionStatusId)
                    : undefined
                  return (
                    <tr key={task.id}>
                      <td style={{ ...td, paddingLeft: child ? 28 : 10 }}>
                        {child && <span style={{ color: C.faint, marginRight: 6 }}>↳</span>}
                        {task.title}
                      </td>
                      <td style={dateCell}>
                        {task.startDate ? formatShortDate(task.startDate) : '—'}
                      </td>
                      <td style={dateCell}>
                        {task.dueDate ? formatShortDate(task.dueDate) : '—'}
                      </td>
                      <td style={td}>
                        {st ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: st.color,
                              background: `${st.color}1A`,
                              borderRadius: 999,
                              padding: '3px 10px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 999,
                                background: st.color,
                              }}
                            />
                            {st.name}
                          </span>
                        ) : (
                          <span style={{ color: C.faint }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}

      <div style={{ marginTop: 18, fontSize: 11, color: C.faint, textAlign: 'right' }}>
        plan-up
      </div>
    </div>
  )
})
