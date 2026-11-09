// Structural sharing for live-query results.
//
// Dexie hands back a FRESH object for every row on every emission, so after a
// one-task edit every row's identity changes and `memo` on row components
// (TaskRow, BoardCard) can never bail out — a 300-task sprint re-rendered 300
// rows per keystroke-commit. `stabilizeRows` keeps the previous object for any
// row whose fields are unchanged, and the previous ARRAY when nothing changed at
// all, so only the edited row (and whatever really depends on it) re-renders.

/** Field-by-field equality; nested values (arrays/objects) compare by JSON. */
function rowEqual(a: object, b: object): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  const ar = a as Record<string, unknown>
  const br = b as Record<string, unknown>
  for (const k of ak) {
    const x = ar[k]
    const y = br[k]
    if (x === y) continue
    if (
      x === null ||
      y === null ||
      typeof x !== 'object' ||
      typeof y !== 'object' ||
      JSON.stringify(x) !== JSON.stringify(y)
    ) {
      return false
    }
  }
  return true
}

/**
 * `next` with every row that equals its counterpart in `prev` (matched by id)
 * replaced by the `prev` object. Returns `prev` itself when the two hold the
 * same rows in the same order — so a no-op emission keeps every downstream memo.
 */
export function stabilizeRows<T extends { id: string }>(
  prev: readonly T[] | undefined,
  next: T[]
): T[] {
  if (!prev || prev.length === 0) return next
  const prevById = new Map(prev.map((r) => [r.id, r]))
  let same = prev.length === next.length
  const out = next.map((row, i) => {
    const old = prevById.get(row.id)
    const keep = old !== undefined && rowEqual(old, row) ? old : row
    if (same && keep !== prev[i]) same = false
    return keep
  })
  return same ? (prev as T[]) : out
}

/**
 * A stateful stabilizer for one live query: call `stabilize` inside the
 * querier. Create it once per component (`useState(() => createRowStabilizer())`)
 * — it is plain mutable state, not React state, so it never triggers a render.
 */
export function createRowStabilizer<T extends { id: string }>() {
  let last: T[] | undefined
  return {
    stabilize(rows: T[]): T[] {
      last = stabilizeRows(last, rows)
      return last
    },
  }
}
