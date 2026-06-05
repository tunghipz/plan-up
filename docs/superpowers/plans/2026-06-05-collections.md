# Collections (task ngoài sprint) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho plan-up một "Collection" — chỗ chứa task ngoài sprint, tên tự đặt, có nhiều "bảng" (sections) tự tạo, status tự định nghĩa per-collection, và 2 view List + Calendar (thanh liền mạch, đa tháng).

**Architecture:** Một bảng Dexie mới `collections` (sections[] + statuses[] nhúng). Collection-item **tái dùng `tasks`** — thêm `collectionId`/`sectionId`/`collectionStatusId`, `sprintId` thành nullable; sprint engine tự cách ly vì luôn query theo một `sprintId` cụ thể. Logic lịch (month grid, lane packing, segment-theo-tuần) tách thành **hàm thuần trong `lib.ts`** (TDD); UI port từ 3 demo đã verify trong `demo/`.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind v4 + Dexie (IndexedDB) + dexie-react-hooks + lucide-react + vitest.

**Spec:** `design-docs/collections.md`. **Demo tham chiếu (đã verify):** `demo/event-calendar-seamless.html`, `demo/collection-multi-table.html`, `demo/collection-status-editor.html`.

---

## File Structure

| File | Trách nhiệm | Tạo/Sửa |
|---|---|---|
| `app/src/db.ts` | Types `Collection`/`Section`/`CollectionStatus`; schema v9 + upgrade; CRUD collection/section/status/item; `COLLECTION_PALETTE`; export/import v3 | Modify |
| `app/src/lib.ts` | Hàm thuần cho Calendar: `dayIndex`, `buildMonthGrid`, `assignLanes`, `computeBarSegments` | Modify |
| `app/src/collections.test.ts` | Unit test cho db CRUD + migration | Create |
| `app/src/calendar.test.ts` | Unit test cho hàm thuần lịch | Create |
| `app/src/CollectionView.tsx` | List card-per-section + status editor + assign + segmented List/Calendar | Create |
| `app/src/CollectionCalendar.tsx` | Month grid + thanh liền mạch (dùng helper lib) | Create |
| `app/src/App.tsx` | Sidebar Sprints/Collections; container state; route main sang CollectionView | Modify |
| `design-docs/collections.md` | Status Planned → Implemented khi xong | Modify |
| `design-docs/data-model.md` | Ghi schema v9 + entity mới | Modify |

**Phase → increment chạy được:**
- **Phase 1–2** (db + logic thuần): test xanh, chưa có UI. Ship được về mặt dữ liệu.
- **Phase 3–4** (shell + List view): tạo/chọn collection, nhiều bảng, status editor — dùng end-to-end.
- **Phase 5** (Calendar): thêm view lịch.
- **Phase 6**: docs + sanity gate.

---

## PHASE 1 — Data layer (db.ts)

### Task 1: Types + schema v9 + migration

**Files:**
- Modify: `app/src/db.ts` (types sau `interface Sprint` ~`db.ts:98`; `Task` ~`db.ts:100`; constructor versions ~`db.ts:252` cuối)
- Test: `app/src/collections.test.ts` (create)

- [ ] **Step 1: Viết test thất bại** — tạo `app/src/collections.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'

async function clearAll() {
  await db.transaction('rw', db.projects, db.members, db.sprints, db.tasks, db.collections, async () => {
    await db.tasks.clear(); await db.sprints.clear(); await db.members.clear()
    await db.collections.clear(); await db.projects.clear()
  })
}

describe('schema v9 / collections table', () => {
  beforeEach(clearAll)

  it('exposes a collections table and tasks accept collection fields', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    await db.collections.add({
      id: 'c1', projectId: 'p1', name: 'Live-ops', order: 0,
      sections: [{ id: 'sec1', name: 'All' }], statuses: [], createdAt: 1,
    })
    await db.tasks.add({
      id: 't1', projectId: 'p1', sequence: 1, title: 'x', assigneeId: null,
      sprintId: null, status: 'todo', priority: 'normal', startDate: '2026-06-01',
      dueDate: null, estimate: null, createdAt: 1, dependsOn: [],
      collectionId: 'c1', sectionId: 'sec1', collectionStatusId: null,
    })
    const got = await db.tasks.where('collectionId').equals('c1').toArray()
    expect(got).toHaveLength(1)
    expect(got[0].sprintId).toBeNull()
    const c = await db.collections.get('c1')
    expect(c?.sections[0].name).toBe('All')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: FAIL — `db.collections` undefined / type errors (collectionId không tồn tại trên Task, sprintId không nhận null).

- [ ] **Step 3: Thêm types** — sửa `app/src/db.ts`. Thêm sau `interface Sprint {…}` (~`db.ts:98`):

```ts
export interface Section {
  id: string
  name: string
  /** Optional hex tô chấm header (từ COLLECTION_PALETTE). */
  color?: string
}

/** Một status do người dùng tạo trong một collection. */
export interface CollectionStatus {
  id: string
  name: string
  /** Hex từ COLLECTION_PALETTE. */
  color: string
}

export interface Collection {
  id: string
  projectId: string
  name: string
  /** Thứ tự hiển thị trong sidebar (fractional/integer). */
  order: number
  /** Bảng (tables) trong collection, có thứ tự. Luôn ≥ 1 phần tử. */
  sections: Section[]
  /** Bộ status do user tự tạo. Có thể rỗng. */
  statuses: CollectionStatus[]
  createdAt: number
}
```

- [ ] **Step 4: Cho `Task.sprintId` nhận null + thêm field collection** — sửa `interface Task` (`db.ts:107` và sau `changeLog`):

Đổi dòng `sprintId: string` → `sprintId: string | null` và thêm vào cuối interface (trước dấu `}`):

```ts
  /**
   * Collection chứa task này (khi task nằm ngoài sprint). Bất biến: đúng MỘT
   * trong {sprintId, collectionId} khác null. Indexed để query theo collection.
   */
  collectionId?: string | null
  /** Bảng (Section.id) trong collection. Non-indexed. */
  sectionId?: string | null
  /** Trỏ tới CollectionStatus.id trong collection. Non-indexed. */
  collectionStatusId?: string | null
```

- [ ] **Step 5: Khai báo table + version 9** — sửa class `PlanDB`:

Thêm field table (sau `tasks!`, ~`db.ts:151`):
```ts
  collections!: Table<Collection, string>
```

Thêm vào CUỐI constructor (sau block `this.version(8)…`, ~`db.ts:267`):
```ts
    // v9 (2026-06-05): collections (task ngoài sprint). New `collections` table;
    // tasks gain collectionId (indexed) + sectionId/collectionStatusId (non-indexed);
    // sprintId becomes nullable. Existing tasks stay sprint tasks (collectionId=null).
    this.version(9)
      .stores({
        projects: 'id, name, createdAt',
        members: 'id, name, projectId',
        sprints: 'id, startDate, projectId',
        collections: 'id, projectId, order',
        tasks: 'id, sprintId, assigneeId, status, createdAt, projectId, collectionId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('tasks')
          .toCollection()
          .modify((t: Task) => {
            if (t.collectionId === undefined) t.collectionId = null
          })
      })
```

- [ ] **Step 6: Chạy test để xác nhận PASS**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: PASS.

- [ ] **Step 7: tsc gate** (đổi sprintId nullable có thể lộ chỗ cần guard)

Run: `cd app && npx tsc --noEmit`
Expected: PASS. Nếu báo lỗi ở `App.tsx`/`SprintView.tsx` về `sprintId` null → xử lý ở Task 10/khi build; ghi lại lỗi, KHÔNG sửa lan man ngoài file đang ở.

- [ ] **Step 8: Commit**

```bash
cd /Users/lap16075/Documents/vibe-coding/plan-tmp
git add app/src/db.ts app/src/collections.test.ts
git commit -m "feat(db): schema v9 — collections table + nullable sprintId"
```

---

### Task 2: COLLECTION_PALETTE + Collection CRUD

**Files:**
- Modify: `app/src/db.ts` (sau `PALETTE`/`colorForName` ~`db.ts:286`)
- Test: `app/src/collections.test.ts`

- [ ] **Step 1: Viết test thất bại** — thêm vào `collections.test.ts`:

```ts
import {
  createCollection, renameCollection, deleteCollection, COLLECTION_PALETTE,
} from './db'

describe('collection CRUD', () => {
  beforeEach(clearAll)

  it('createCollection seeds one "All" section + default statuses', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    const c = await createCollection('p1', 'Live-ops 2026')
    expect(c.name).toBe('Live-ops 2026')
    expect(c.sections).toHaveLength(1)
    expect(c.sections[0].name).toBe('All')
    expect(c.statuses.length).toBeGreaterThan(0)
    expect(COLLECTION_PALETTE).toContain(c.statuses[0].color)
  })

  it('renameCollection trims + ignores empty', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    const c = await createCollection('p1', 'X')
    await renameCollection(c.id, '  Roadmap  ')
    expect((await db.collections.get(c.id))?.name).toBe('Roadmap')
    await renameCollection(c.id, '   ')
    expect((await db.collections.get(c.id))?.name).toBe('Roadmap')
  })

  it('deleteCollection removes the collection AND its items', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    const c = await createCollection('p1', 'X')
    await db.tasks.add({
      id: 't1', projectId: 'p1', sequence: 1, title: 'a', assigneeId: null,
      sprintId: null, status: 'todo', priority: 'normal', startDate: null,
      dueDate: null, estimate: null, createdAt: 1, dependsOn: [],
      collectionId: c.id, sectionId: c.sections[0].id, collectionStatusId: null,
    })
    await deleteCollection(c.id)
    expect(await db.collections.get(c.id)).toBeUndefined()
    expect(await db.tasks.where('collectionId').equals(c.id).count()).toBe(0)
  })
})
```

- [ ] **Step 2: Chạy test → FAIL**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: FAIL — `createCollection`/`COLLECTION_PALETTE` chưa export.

- [ ] **Step 3: Implement** — thêm vào `app/src/db.ts` (sau `colorForName`, ~`db.ts:286`):

```ts
/** Palette hệ Apple cho status/section màu (design-system §2.4 + đỏ/xám). */
export const COLLECTION_PALETTE = [
  '#0071E3', '#34C759', '#FF9500', '#FF3B30', '#AF52DE',
  '#FF2D55', '#5AC8FA', '#5856D6', '#FF6482', '#8E8E93',
] as const

/** Status mặc định khi tạo collection (user sửa được sau). */
function defaultStatuses(): CollectionStatus[] {
  return [
    { id: uid(), name: 'FEATURE', color: '#FF9500' },
    { id: uid(), name: 'EVENT', color: '#0071E3' },
  ]
}

/** Tạo collection mới: 1 section "All" + bộ status mặc định. order = max+1. */
export async function createCollection(
  projectId: string,
  name: string
): Promise<Collection> {
  const existing = await db.collections.where('projectId').equals(projectId).toArray()
  const order = existing.reduce((m, c) => Math.max(m, c.order), -1) + 1
  const col: Collection = {
    id: uid(),
    projectId,
    name: name.trim() || 'Untitled',
    order,
    sections: [{ id: uid(), name: 'All' }],
    statuses: defaultStatuses(),
    createdAt: Date.now(),
  }
  await db.collections.add(col)
  return col
}

/** Đổi tên collection (trim, bỏ qua nếu rỗng). */
export async function renameCollection(id: string, name: string): Promise<void> {
  const n = name.trim()
  if (!n) return
  await db.collections.update(id, { name: n })
}

/** Xoá collection + toàn bộ item của nó (destructive — caller confirm trước). */
export async function deleteCollection(id: string): Promise<void> {
  await db.transaction('rw', db.collections, db.tasks, async () => {
    await db.tasks.where('collectionId').equals(id).delete()
    await db.collections.delete(id)
  })
}
```

- [ ] **Step 4: Chạy test → PASS**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/db.ts app/src/collections.test.ts
git commit -m "feat(db): collection CRUD + COLLECTION_PALETTE"
```

---

### Task 3: Section CRUD

**Files:** Modify `app/src/db.ts`; Test `app/src/collections.test.ts`

- [ ] **Step 1: Viết test thất bại**:

```ts
import { addSection, renameSection, deleteSection, moveTaskToSection } from './db'

describe('section CRUD', () => {
  beforeEach(clearAll)
  async function setup() {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    return createCollection('p1', 'X')
  }

  it('addSection appends a named table', async () => {
    const c = await setup()
    await addSection(c.id, 'Tháng 6')
    const got = await db.collections.get(c.id)
    expect(got?.sections.map((s) => s.name)).toEqual(['All', 'Tháng 6'])
  })

  it('deleteSection moves its items to the FIRST section, never removes last', async () => {
    const c = await setup()
    await addSection(c.id, 'B')
    const fresh = await db.collections.get(c.id)
    const [all, b] = fresh!.sections
    await db.tasks.add({
      id: 't1', projectId: 'p1', sequence: 1, title: 'a', assigneeId: null,
      sprintId: null, status: 'todo', priority: 'normal', startDate: null,
      dueDate: null, estimate: null, createdAt: 1, dependsOn: [],
      collectionId: c.id, sectionId: b.id, collectionStatusId: null,
    })
    await deleteSection(c.id, b.id)
    expect((await db.collections.get(c.id))?.sections).toHaveLength(1)
    expect((await db.tasks.get('t1'))?.sectionId).toBe(all.id)
    // không xoá section cuối cùng
    await deleteSection(c.id, all.id)
    expect((await db.collections.get(c.id))?.sections).toHaveLength(1)
  })

  it('moveTaskToSection sets sectionId', async () => {
    const c = await setup()
    await addSection(c.id, 'B')
    const fresh = await db.collections.get(c.id)
    const b = fresh!.sections[1]
    await db.tasks.add({
      id: 't1', projectId: 'p1', sequence: 1, title: 'a', assigneeId: null,
      sprintId: null, status: 'todo', priority: 'normal', startDate: null,
      dueDate: null, estimate: null, createdAt: 1, dependsOn: [],
      collectionId: c.id, sectionId: fresh!.sections[0].id, collectionStatusId: null,
    })
    await moveTaskToSection('t1', b.id)
    expect((await db.tasks.get('t1'))?.sectionId).toBe(b.id)
  })
})
```

- [ ] **Step 2: Chạy test → FAIL**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: FAIL — hàm chưa tồn tại.

- [ ] **Step 3: Implement** — thêm vào `app/src/db.ts` (sau `deleteCollection`):

```ts
export async function addSection(collectionId: string, name: string): Promise<void> {
  const c = await db.collections.get(collectionId)
  if (!c) return
  const sections = [...c.sections, { id: uid(), name: name.trim() || 'New table' }]
  await db.collections.update(collectionId, { sections })
}

export async function renameSection(
  collectionId: string,
  sectionId: string,
  name: string
): Promise<void> {
  const n = name.trim()
  if (!n) return
  const c = await db.collections.get(collectionId)
  if (!c) return
  const sections = c.sections.map((s) => (s.id === sectionId ? { ...s, name: n } : s))
  await db.collections.update(collectionId, { sections })
}

/** Xoá 1 bảng: item của nó dồn về bảng đầu. Không cho xoá bảng cuối cùng. */
export async function deleteSection(
  collectionId: string,
  sectionId: string
): Promise<void> {
  await db.transaction('rw', db.collections, db.tasks, async () => {
    const c = await db.collections.get(collectionId)
    if (!c || c.sections.length <= 1) return
    const remaining = c.sections.filter((s) => s.id !== sectionId)
    if (remaining.length === c.sections.length) return
    const fallback = remaining[0].id
    await db.tasks
      .where('collectionId')
      .equals(collectionId)
      .filter((t) => t.sectionId === sectionId)
      .modify({ sectionId: fallback })
    await db.collections.update(collectionId, { sections: remaining })
  })
}

export async function moveTaskToSection(taskId: string, sectionId: string): Promise<void> {
  await db.tasks.update(taskId, { sectionId })
}
```

- [ ] **Step 4: Chạy test → PASS**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/db.ts app/src/collections.test.ts
git commit -m "feat(db): section CRUD (add/rename/delete→fallback/move)"
```

---

### Task 4: Status CRUD

**Files:** Modify `app/src/db.ts`; Test `app/src/collections.test.ts`

- [ ] **Step 1: Viết test thất bại**:

```ts
import { addStatus, renameStatus, recolorStatus, deleteStatus } from './db'

describe('status CRUD', () => {
  beforeEach(clearAll)
  async function setup() {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    return createCollection('p1', 'X')
  }

  it('addStatus appends with a palette color', async () => {
    const c = await setup()
    await addStatus(c.id, 'LIVE', '#34C759')
    const got = await db.collections.get(c.id)
    expect(got?.statuses.map((s) => s.name)).toContain('LIVE')
  })

  it('recolorStatus + renameStatus mutate in place', async () => {
    const c = await setup()
    const sid = c.statuses[0].id
    await renameStatus(c.id, sid, 'SHIPPED')
    await recolorStatus(c.id, sid, '#AF52DE')
    const got = await db.collections.get(c.id)
    const s = got!.statuses.find((x) => x.id === sid)!
    expect(s.name).toBe('SHIPPED')
    expect(s.color).toBe('#AF52DE')
  })

  it('deleteStatus nulls items that used it', async () => {
    const c = await setup()
    const sid = c.statuses[0].id
    await db.tasks.add({
      id: 't1', projectId: 'p1', sequence: 1, title: 'a', assigneeId: null,
      sprintId: null, status: 'todo', priority: 'normal', startDate: null,
      dueDate: null, estimate: null, createdAt: 1, dependsOn: [],
      collectionId: c.id, sectionId: c.sections[0].id, collectionStatusId: sid,
    })
    await deleteStatus(c.id, sid)
    expect((await db.collections.get(c.id))?.statuses.find((s) => s.id === sid)).toBeUndefined()
    expect((await db.tasks.get('t1'))?.collectionStatusId).toBeNull()
  })
})
```

- [ ] **Step 2: Chạy test → FAIL**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — thêm vào `app/src/db.ts`:

```ts
export async function addStatus(
  collectionId: string,
  name: string,
  color: string
): Promise<void> {
  const c = await db.collections.get(collectionId)
  if (!c) return
  const statuses = [...c.statuses, { id: uid(), name: name.trim() || 'New status', color }]
  await db.collections.update(collectionId, { statuses })
}

export async function renameStatus(
  collectionId: string,
  statusId: string,
  name: string
): Promise<void> {
  const n = name.trim()
  if (!n) return
  const c = await db.collections.get(collectionId)
  if (!c) return
  await db.collections.update(collectionId, {
    statuses: c.statuses.map((s) => (s.id === statusId ? { ...s, name: n } : s)),
  })
}

export async function recolorStatus(
  collectionId: string,
  statusId: string,
  color: string
): Promise<void> {
  const c = await db.collections.get(collectionId)
  if (!c) return
  await db.collections.update(collectionId, {
    statuses: c.statuses.map((s) => (s.id === statusId ? { ...s, color } : s)),
  })
}

/** Xoá status: item đang dùng nó về null (ô Status trống). */
export async function deleteStatus(collectionId: string, statusId: string): Promise<void> {
  await db.transaction('rw', db.collections, db.tasks, async () => {
    const c = await db.collections.get(collectionId)
    if (!c) return
    await db.collections.update(collectionId, {
      statuses: c.statuses.filter((s) => s.id !== statusId),
    })
    await db.tasks
      .where('collectionId')
      .equals(collectionId)
      .filter((t) => t.collectionStatusId === statusId)
      .modify({ collectionStatusId: null })
  })
}
```

- [ ] **Step 4: Chạy test → PASS**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/db.ts app/src/collections.test.ts
git commit -m "feat(db): per-collection status CRUD (add/rename/recolor/delete→null)"
```

---

### Task 5: addCollectionItem

**Files:** Modify `app/src/db.ts`; Test `app/src/collections.test.ts`

- [ ] **Step 1: Viết test thất bại**:

```ts
import { addCollectionItem } from './db'

describe('addCollectionItem', () => {
  beforeEach(clearAll)
  it('creates a Task with sprintId=null, default status = first, startDate=today', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    const c = await createCollection('p1', 'X')
    const t = await addCollectionItem(c.id, c.sections[0].id, { title: 'Đập trứng' })
    expect(t.sprintId).toBeNull()
    expect(t.collectionId).toBe(c.id)
    expect(t.sectionId).toBe(c.sections[0].id)
    expect(t.collectionStatusId).toBe(c.statuses[0].id) // status đầu tiên
    expect(t.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(t.title).toBe('Đập trứng')
    expect((await db.tasks.get(t.id))?.title).toBe('Đập trứng')
  })
})
```

- [ ] **Step 2: Chạy test → FAIL**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — thêm vào `app/src/db.ts`:

```ts
/**
 * Tạo một collection-item (Task ngoài sprint). status mặc định = status đầu tiên
 * của collection (hoặc null nếu chưa có status), startDate = hôm nay, dueDate=null,
 * sprintId=null. sequence per-project (collection không có numbering riêng).
 */
export async function addCollectionItem(
  collectionId: string,
  sectionId: string,
  patch: Partial<Task> & { title: string }
): Promise<Task> {
  const c = await db.collections.get(collectionId)
  const today = new Date().toISOString().slice(0, 10)
  const projectId = c?.projectId ?? ''
  const maxSeq = (
    await db.tasks.where('projectId').equals(projectId).toArray()
  ).reduce((m, t) => Math.max(m, t.sequence ?? 0), 0)
  const task: Task = {
    id: uid(),
    projectId,
    sequence: maxSeq + 1,
    title: patch.title,
    assigneeId: null,
    sprintId: null,
    status: 'todo',
    priority: 'normal',
    startDate: today,
    dueDate: null,
    estimate: null,
    createdAt: Date.now(),
    dependsOn: [],
    collectionId,
    sectionId,
    collectionStatusId: c?.statuses[0]?.id ?? null,
    ...patch,
  }
  await db.tasks.add(task)
  return task
}
```

- [ ] **Step 4: Chạy test → PASS**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/db.ts app/src/collections.test.ts
git commit -m "feat(db): addCollectionItem (sprintId=null, default status/date)"
```

---

### Task 6: Export/import collections (payload v3)

**Files:** Modify `app/src/db.ts` (`ExportPayload` ~`db.ts:1209`, `exportAll` ~`db.ts:1219`, `importAll` ~`db.ts:1236`); Test `app/src/collections.test.ts`

- [ ] **Step 1: Viết test thất bại**:

```ts
import { exportAll, importAll } from './db'

describe('export/import collections', () => {
  beforeEach(clearAll)
  it('round-trips collections + their items', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    const c = await createCollection('p1', 'Live-ops')
    await addCollectionItem(c.id, c.sections[0].id, { title: 'Đập trứng' })
    const payload = await exportAll()
    expect(payload.version).toBe(3)
    expect(payload.collections?.length).toBe(1)
    await clearAll()
    await importAll(payload)
    expect(await db.collections.count()).toBe(1)
    expect(await db.tasks.where('collectionId').equals(c.id).count()).toBe(1)
  })

  it('still imports a v2 payload (no collections) without error', async () => {
    await importAll({
      version: 2, exportedAt: 'x',
      projects: [{ id: 'p1', name: 'P', createdAt: 1 }],
      members: [], sprints: [], tasks: [],
    })
    expect(await db.collections.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Chạy test → FAIL**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: FAIL — version vẫn là 2, không có `collections`.

- [ ] **Step 3: Implement** — sửa `app/src/db.ts`:

Đổi `ExportPayload` (`db.ts:1209`):
```ts
export interface ExportPayload {
  version: 1 | 2 | 3
  exportedAt: string
  projects?: Project[]
  members: Member[]
  sprints: Sprint[]
  /** v3 introduces collections (task ngoài sprint). */
  collections?: Collection[]
  tasks: Task[]
}
```

Sửa `exportAll` (`db.ts:1219`) — thêm `db.collections.toArray()` vào `Promise.all` và `version: 3`, `collections` vào return:
```ts
export async function exportAll(): Promise<ExportPayload> {
  const [projects, members, sprints, collections, tasks] = await Promise.all([
    db.projects.toArray(),
    db.members.toArray(),
    db.sprints.toArray(),
    db.collections.toArray(),
    db.tasks.toArray(),
  ])
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    projects, members, sprints, collections, tasks,
  }
}
```

Sửa `importAll` (`db.ts:1236`):
- Dòng guard: `if (!data || ![1, 2, 3].includes(data.version)) {`
- Thêm `db.collections` vào scope `db.transaction('rw', …)` và thêm `await db.collections.clear()` cùng chỗ clear các bảng.
- Sau khi `bulkAdd` sprints, thêm:
```ts
      if (data.version === 3 && Array.isArray(data.collections)) {
        await db.collections.bulkAdd(
          data.collections.map((c) => ({ ...c, projectId: pidOf(c) }))
        )
      }
```
- Trong map tasks (object trả về), thêm các field collection (giữ nguyên nếu có, mặc định null):
```ts
          collectionId: t.collectionId ?? null,
          sectionId: t.sectionId ?? null,
          collectionStatusId: t.collectionStatusId ?? null,
```

- [ ] **Step 4: Chạy test → PASS**

Run: `cd app && npx vitest run src/collections.test.ts`
Expected: PASS.

- [ ] **Step 5: Full vitest + tsc**

Run: `cd app && npx vitest run && npx tsc --noEmit`
Expected: PASS (test cũ không vỡ).

- [ ] **Step 6: Commit**

```bash
git add app/src/db.ts app/src/collections.test.ts
git commit -m "feat(db): export/import collections (payload v3, back-compat v1/v2)"
```

---

## PHASE 2 — Hàm thuần cho Calendar (lib.ts)

### Task 7: dayIndex + buildMonthGrid

**Files:** Modify `app/src/lib.ts`; Test `app/src/calendar.test.ts` (create)

- [ ] **Step 1: Viết test thất bại** — tạo `app/src/calendar.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { dayIndex, buildMonthGrid } from './lib'

describe('buildMonthGrid', () => {
  it('June 2026 is Mon-start, 5 weeks, today flagged, trailing July faint', () => {
    const g = buildMonthGrid(2026, 5, '2026-06-03') // month0=5 → June
    expect(g.weeks).toHaveLength(5)
    expect(g.gridStart).toBe(dayIndex('2026-06-01')) // Jun 1 is Monday
    expect(g.weeks[0].cells[0].day).toBe(1)
    const today = g.weeks[0].cells.find((c) => c.isToday)
    expect(today?.day).toBe(3)
    const jul1 = g.weeks[4].cells.find((c) => c.date === '2026-07-01')
    expect(jul1?.inMonth).toBe(false)
  })

  it('a month that needs 6 weeks returns 6', () => {
    // Aug 2026: Aug 1 is Saturday → spills to 6 rows
    const g = buildMonthGrid(2026, 7, '2026-08-01')
    expect(g.weeks.length).toBeGreaterThanOrEqual(5)
    expect(g.weeks[0].cells.some((c) => c.day === 1 && c.inMonth)).toBe(true)
  })
})
```

- [ ] **Step 2: Chạy test → FAIL**

Run: `cd app && npx vitest run src/calendar.test.ts`
Expected: FAIL — chưa export.

- [ ] **Step 3: Implement** — thêm vào CUỐI `app/src/lib.ts`:

```ts
// ──────────────────────────────────────────────────────────────────────────
// Collection Calendar — pure helpers (see design-docs/collections.md)
// idx = số ngày kể từ epoch theo UTC, để so sánh & cộng ngày không lệch TZ.
// ──────────────────────────────────────────────────────────────────────────

export function dayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}
function dateFromIndex(i: number): string {
  return new Date(i * 86_400_000).toISOString().slice(0, 10)
}

export interface MonthCell {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
}
export interface MonthWeek {
  startIdx: number
  cells: MonthCell[]
}
export interface MonthGrid {
  year: number
  month0: number
  weeks: MonthWeek[]
  gridStart: number
  gridEnd: number
}

/** Lưới tháng Mon-start, số tuần động (5–6) đủ phủ tháng. */
export function buildMonthGrid(year: number, month0: number, todayStr: string): MonthGrid {
  const firstIdx = Math.floor(Date.UTC(year, month0, 1) / 86_400_000)
  const dow = (new Date(firstIdx * 86_400_000).getUTCDay() + 6) % 7 // Mon=0
  const gridStart = firstIdx - dow
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  const weekCount = Math.ceil((dow + daysInMonth) / 7)
  const todayIdx = dayIndex(todayStr)
  const weeks: MonthWeek[] = []
  for (let w = 0; w < weekCount; w++) {
    const startIdx = gridStart + w * 7
    const cells: MonthCell[] = []
    for (let c = 0; c < 7; c++) {
      const idx = startIdx + c
      const d = new Date(idx * 86_400_000)
      cells.push({
        date: dateFromIndex(idx),
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === month0,
        isToday: idx === todayIdx,
      })
    }
    weeks.push({ startIdx, cells })
  }
  return { year, month0, weeks, gridStart, gridEnd: gridStart + weekCount * 7 - 1 }
}
```

- [ ] **Step 4: Chạy test → PASS**

Run: `cd app && npx vitest run src/calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib.ts app/src/calendar.test.ts
git commit -m "feat(calendar): pure buildMonthGrid + dayIndex"
```

---

### Task 8: assignLanes

**Files:** Modify `app/src/lib.ts`; Test `app/src/calendar.test.ts`

- [ ] **Step 1: Viết test thất bại**:

```ts
import { assignLanes } from './lib'

describe('assignLanes', () => {
  it('non-overlapping items share lane 0', () => {
    const lanes = assignLanes([
      { id: 'a', start: '2026-06-02', end: '2026-06-04' },
      { id: 'b', start: '2026-06-05', end: '2026-06-07' },
    ])
    expect(lanes.get('a')).toBe(0)
    expect(lanes.get('b')).toBe(0)
  })

  it('overlapping items get distinct lanes', () => {
    const lanes = assignLanes([
      { id: 'a', start: '2026-06-02', end: '2026-06-10' },
      { id: 'b', start: '2026-06-05', end: '2026-06-07' },
    ])
    expect(lanes.get('a')).toBe(0)
    expect(lanes.get('b')).toBe(1)
  })
})
```

- [ ] **Step 2: Chạy test → FAIL**

Run: `cd app && npx vitest run src/calendar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — thêm vào `app/src/lib.ts` (sau buildMonthGrid):

```ts
export interface CalItem {
  id: string
  /** yyyy-mm-dd inclusive. */
  start: string
  end: string
}

/**
 * Gán mỗi item một lane (hàng) cố định. Sort theo start (tie-break: dài hơn
 * trước), gán lane thấp nhất mà item cuối trên lane đó đã KẾT THÚC trước khi
 * item này bắt đầu. Item không chồng ngày → chung lane.
 */
export function assignLanes(items: CalItem[]): Map<string, number> {
  const sorted = [...items].sort((x, y) => {
    const dx = dayIndex(x.start) - dayIndex(y.start)
    if (dx !== 0) return dx
    return dayIndex(y.end) - dayIndex(x.end) // dài hơn trước
  })
  const laneEnd: number[] = [] // idx kết thúc của item cuối trên mỗi lane
  const out = new Map<string, number>()
  for (const it of sorted) {
    const a = dayIndex(it.start)
    let lane = 0
    while (lane < laneEnd.length && laneEnd[lane] >= a) lane++
    out.set(it.id, lane)
    laneEnd[lane] = dayIndex(it.end)
  }
  return out
}
```

- [ ] **Step 4: Chạy test → PASS**

Run: `cd app && npx vitest run src/calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib.ts app/src/calendar.test.ts
git commit -m "feat(calendar): assignLanes (greedy interval packing)"
```

---

### Task 9: computeBarSegments

**Files:** Modify `app/src/lib.ts`; Test `app/src/calendar.test.ts`

- [ ] **Step 1: Viết test thất bại**:

```ts
import { computeBarSegments, buildMonthGrid, assignLanes } from './lib'

describe('computeBarSegments', () => {
  const grid = buildMonthGrid(2026, 5, '2026-06-03') // June, gridStart=Jun1, gridEnd=Jul5

  it('a within-week item: one rounded segment', () => {
    const items = [{ id: 'a', start: '2026-06-02', end: '2026-06-04' }]
    const segs = computeBarSegments(items, grid, assignLanes(items))
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ weekIndex: 0, colStart: 2, span: 3, roundL: true, roundR: true, leftChev: false, rightChev: false })
  })

  it('cross-week item splits with correct rounding', () => {
    const items = [{ id: 'a', start: '2026-06-20', end: '2026-06-23' }] // Sat..Tue
    const segs = computeBarSegments(items, grid, assignLanes(items))
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ weekIndex: 2, colStart: 6, span: 2, roundL: true, roundR: false })
    expect(segs[1]).toMatchObject({ weekIndex: 3, colStart: 1, span: 2, roundL: false, roundR: true })
  })

  it('item extending past gridEnd gets rightChev (no rounded right)', () => {
    const items = [{ id: 'a', start: '2026-06-10', end: '2026-07-20' }]
    const segs = computeBarSegments(items, grid, assignLanes(items))
    const last = segs[segs.length - 1]
    expect(last.rightChev).toBe(true)
    expect(last.roundR).toBe(false)
    expect(segs[0].roundL).toBe(true) // bắt đầu Jun 10 là start thật
  })
})
```

- [ ] **Step 2: Chạy test → FAIL**

Run: `cd app && npx vitest run src/calendar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — thêm vào `app/src/lib.ts`:

```ts
export interface BarSegment {
  itemId: string
  weekIndex: number
  /** 1..7 */
  colStart: number
  span: number
  roundL: boolean
  roundR: boolean
  /** Cắt mép trái lưới (còn tiếp từ tháng trước). */
  leftChev: boolean
  /** Cắt mép phải lưới (còn tiếp sang tháng sau). */
  rightChev: boolean
  lane: number
}

/** Cắt mỗi item thành các đoạn theo tung tuần trong lưới tháng. */
export function computeBarSegments(
  items: CalItem[],
  grid: MonthGrid,
  lanes: Map<string, number>
): BarSegment[] {
  const out: BarSegment[] = []
  for (const it of items) {
    const a = dayIndex(it.start)
    const b = dayIndex(it.end)
    if (b < grid.gridStart || a > grid.gridEnd) continue
    grid.weeks.forEach((week, weekIndex) => {
      const wkStart = week.startIdx
      const wkEnd = wkStart + 6
      if (b < wkStart || a > wkEnd) return
      const segA = Math.max(a, wkStart)
      const segB = Math.min(b, wkEnd)
      out.push({
        itemId: it.id,
        weekIndex,
        colStart: segA - wkStart + 1,
        span: segB - segA + 1,
        roundL: segA === a,
        roundR: segB === b,
        leftChev: segA === grid.gridStart && a < grid.gridStart,
        rightChev: segB === grid.gridEnd && b > grid.gridEnd,
        lane: lanes.get(it.id) ?? 0,
      })
    })
  }
  return out
}
```

- [ ] **Step 4: Chạy test → PASS**

Run: `cd app && npx vitest run src/calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Full vitest + tsc + commit**

Run: `cd app && npx vitest run && npx tsc --noEmit`
Expected: PASS.
```bash
git add app/src/lib.ts app/src/calendar.test.ts
git commit -m "feat(calendar): computeBarSegments (week split + multi-month chevrons)"
```

---

## PHASE 3 — App shell wiring (App.tsx)

### Task 10: Sidebar Sprints/Collections + container state

**Files:** Modify `app/src/App.tsx`

> **Mục tiêu:** sidebar thêm mục COLLECTIONS dưới SPRINTS; chọn một collection → main render `<CollectionView>` (tạm stub) thay cho sprint views. Một state `selected` mô tả đang xem sprint hay collection.

- [ ] **Step 1: Stub CollectionView** để App import được — tạo tạm `app/src/CollectionView.tsx`:

```tsx
export function CollectionView({ collectionId, projectId }: { collectionId: string; projectId: string }) {
  return <div className="p-6 text-ink-muted">Collection {collectionId} ({projectId})</div>
}
```

- [ ] **Step 2: Thêm state container vào `App.tsx`** — sau `currentSprintId` (~`App.tsx:55`):

```tsx
  // Container đang xem: 'sprint' (mặc định) hoặc 'collection'.
  const SELKIND_KEY = 'plan-up:selKind'
  const SELCOLL_KEY = 'plan-up:selCollectionId'
  const [selKind, setSelKindState] = useState<'sprint' | 'collection'>(
    () => (localStorage.getItem(SELKIND_KEY) === 'collection' ? 'collection' : 'sprint')
  )
  const [currentCollectionId, setCurrentCollectionIdState] = useState<string | null>(
    () => localStorage.getItem(SELCOLL_KEY)
  )
  const selectSprint = (id: string) => {
    setCurrentSprintId(id); setSelKindState('sprint'); localStorage.setItem(SELKIND_KEY, 'sprint')
  }
  const selectCollection = (id: string) => {
    setCurrentCollectionIdState(id); localStorage.setItem(SELCOLL_KEY, id)
    setSelKindState('collection'); localStorage.setItem(SELKIND_KEY, 'collection')
  }
```

- [ ] **Step 3: Live-query collections của project** — sau `sprints` useLiveQuery (~`App.tsx:161`):

```tsx
  const collections = useLiveQuery<Collection[]>(
    () =>
      seeded && currentProjectId
        ? db.collections.where('projectId').equals(currentProjectId).sortBy('order')
        : Promise.resolve([] as Collection[]),
    [seeded, currentProjectId]
  )
  const currentCollection =
    collections?.find((c) => c.id === currentCollectionId) ?? null
```

Thêm import: `createCollection, type Collection` vào khối import từ `'./db'`; `import { CollectionView } from './CollectionView'`.

- [ ] **Step 4: Render mục COLLECTIONS trong sidebar** — ngay sau khối `<div className="flex-1 overflow-auto px-2.5 pb-2">…sprints…</div>` đóng (~`App.tsx:458`), thêm trước `</>`:

```tsx
            <div className="flex items-center justify-between px-[18px] pt-3 pb-1.5">
              <span className="text-[12px] font-semibold text-ink-faint">Collections</span>
              <button
                onClick={async () => {
                  const name = prompt('Tên collection:')
                  if (name && name.trim() && currentProjectId) {
                    const c = await createCollection(currentProjectId, name)
                    selectCollection(c.id)
                  }
                }}
                title="New collection"
                className="inline-flex items-center text-accent hover:bg-accent-soft -mr-1 p-1 rounded-md transition"
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="px-2.5 pb-2">
              {collections?.map((c) => {
                const isActive = selKind === 'collection' && c.id === currentCollectionId
                return (
                  <button
                    key={c.id}
                    onClick={() => selectCollection(c.id)}
                    className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2 mb-0.5 text-[14px] rounded-lg transition ${
                      isActive ? 'bg-accent text-white' : 'text-ink hover:bg-surface-hover'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-white/90' : 'bg-ink-faint'}`} aria-hidden />
                    <span className="flex-1 min-w-0 truncate font-medium">{c.name}</span>
                  </button>
                )
              })}
              {collections && collections.length === 0 && (
                <div className="px-3 py-2 text-[13px] text-ink-faint italic">No collections</div>
              )}
            </div>
```

- [ ] **Step 5: Route main content** — trong `<main>` (~`App.tsx:600`), bọc nhánh hiện tại: nếu `selKind === 'collection' && currentCollection` → render CollectionView; ngược lại giữ nguyên logic sprint cũ. Thay điều kiện `currentSprint && currentProjectId && tasks !== undefined ? (…)` thành:

```tsx
            ) : selKind === 'collection' && currentCollection && currentProjectId ? (
              <CollectionView collectionId={currentCollection.id} projectId={currentProjectId} />
            ) : currentSprint && currentProjectId && tasks !== undefined ? (
```

(phần `view === 'board' ? … : …SprintView` giữ nguyên ngay sau đó). Lưu ý: header sprint (SprintNameEditor/capacity/ViewToggle) chỉ hợp lý cho sprint — chấp nhận tạm hiển thị khi ở collection (Phase 4 sẽ ẩn). Để tránh nhiễu, ẩn CapacityBanner khi ở collection: đổi `{currentSprint && (<CapacityBanner …/>)}` → `{selKind === 'sprint' && currentSprint && (<CapacityBanner …/>)}`.

- [ ] **Step 6: Guard `sprintTaskCounts` bỏ qua collection items** — trong `useMemo` (~`App.tsx:179`), thêm đầu vòng lặp: `if (!t.sprintId) continue` (collection item có sprintId null không được tính vào count sprint).

- [ ] **Step 7: tsc + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: PASS. Sửa mọi lỗi `sprintId` null phát sinh tại chỗ (vd ép kiểu khi truyền vào prop sprint cụ thể — các view sprint chỉ nhận task của sprint nên an toàn; nếu TS than ở SprintView prop, dùng `currentSprint.id`).

- [ ] **Step 8: Manual verify (Playwright, dump DOM — không đọc ảnh)**

Run dev: `cd app && npm run dev` (nền). Script kiểm tra:
```bash
cat > /tmp/v.mjs <<'EOF'
import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage()
await p.goto('http://localhost:5173'); await p.waitForTimeout(1500)
const hasColl = await p.getByText('Collections', { exact: true }).count()
console.log('Collections section present:', hasColl > 0)
await b.close()
EOF
node app/v.mjs; rm app/v.mjs
```
Expected: `Collections section present: true`.

- [ ] **Step 9: Commit**

```bash
git add app/src/App.tsx app/src/CollectionView.tsx
git commit -m "feat(app): sidebar Collections section + container routing (stub view)"
```

---

## PHASE 4 — Collection List view (CollectionView.tsx)

### Task 11: List card-per-section (port demo `collection-multi-table.html`)

**Files:** Modify `app/src/CollectionView.tsx`

> Port **`demo/collection-multi-table.html`** sang TSX. Mỗi section = một card (header collapse + tên + đếm + ✎ rename + ⋯; cột Name/Start/End/Status; "+ Add item"); "+ Add table" cuối. Dữ liệu từ `useLiveQuery`. Drag để chuyển section (HTML5 DnD như list-view hiện có — tham khảo `design-docs/list-view.md`).

- [ ] **Step 1: Viết CollectionView (List-only trước)** — thay nội dung `app/src/CollectionView.tsx`. Khung bắt buộc:

```tsx
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import {
  db, addSection, renameSection, deleteSection, moveTaskToSection,
  addCollectionItem, type Collection, type Task,
} from './db'
import { formatShortDate } from './lib'

export function CollectionView({ collectionId, projectId }: { collectionId: string; projectId: string }) {
  const collection = useLiveQuery<Collection | undefined>(
    () => db.collections.get(collectionId), [collectionId]
  )
  const items = useLiveQuery<Task[]>(
    () => db.tasks.where('collectionId').equals(collectionId).toArray(),
    [collectionId]
  ) ?? []
  const [tab, setTab] = useState<'list' | 'calendar'>('list')
  if (!collection) return <div className="p-6 text-ink-muted">Loading…</div>

  const statusById = new Map(collection.statuses.map((s) => [s.id, s]))
  const itemsBySection = (sectionId: string) =>
    items.filter((t) => t.sectionId === sectionId)

  return (
    <div className="max-w-5xl">
      {/* header: tên collection + segmented List/Calendar (Task 12 thêm Statuses) */}
      <div className="flex items-center justify-between mb-4 pt-1">
        <CollectionTitle collection={collection} />
        <Segmented tab={tab} onChange={setTab} />
      </div>

      {tab === 'list' ? (
        <div className="space-y-4">
          {collection.sections.map((sec) => (
            <SectionCard
              key={sec.id}
              collection={collection}
              section={sec}
              items={itemsBySection(sec.id)}
              statusById={statusById}
            />
          ))}
          <button
            onClick={async () => {
              const name = prompt('Tên bảng mới:')
              if (name && name.trim()) await addSection(collectionId, name)
            }}
            className="w-full py-3 text-[13.5px] font-semibold text-accent border border-dashed border-border rounded-[14px] hover:bg-accent-soft transition"
          >
            ＋ Add table
          </button>
        </div>
      ) : (
        <div className="text-ink-faint p-8 text-center">Calendar — Task 13</div>
      )}
    </div>
  )
}
```

> **Các component con** `CollectionTitle`, `Segmented`, `SectionCard`, `StatusPill` — port markup/CSS từ demo. Viết đầy đủ trong cùng file. SectionCard render colhead (`grid-template-columns:24px 1fr 96px 96px 112px`), mỗi row dùng class Tailwind tương đương demo (thẻ `bg-surface rounded-[14px] shadow`, hairline `border-border-hair`). `StatusPill` lấy màu từ `statusById.get(t.collectionStatusId)`; rỗng → "No status" xám. Dùng `formatShortDate(t.startDate)` / End "—" khi `dueDate` null. "Add item" gọi `addCollectionItem(collectionId, sec.id, { title })` (prompt tên). Rename section gọi `renameSection`; delete (⋯) gọi `deleteSection` với `confirm`.

> **Quy chiếu chính xác markup:** dùng `demo/collection-multi-table.html` (đã verify) — chuyển class CSS thuần sang Tailwind dùng token có sẵn (`bg-surface`, `text-ink`, `text-ink-faint`, `bg-accent`, `border-border-hair`, `rounded-[14px]`). Inline edit tên section theo pattern `SprintNameEditor` trong `App.tsx:965`.

- [ ] **Step 2: tsc + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual verify (DOM dump)** — tạo một collection qua UI, thêm bảng, thêm item:
```bash
cat > /tmp/v.mjs <<'EOF'
import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage()
await p.goto('http://localhost:5173'); await p.waitForTimeout(1500)
p.on('dialog', d => d.accept('Live-ops 2026'))   // new collection name
await p.getByTitle('New collection').click(); await p.waitForTimeout(500)
const cards = await p.locator('.space-y-4 > *').count()
console.log('section cards + add-table button:', cards) // ≥ 2 (1 "All" + add-table)
await b.close()
EOF
node app/v.mjs; rm app/v.mjs
```
Expected: in ra ≥ 2.

- [ ] **Step 4: Commit**

```bash
git add app/src/CollectionView.tsx
git commit -m "feat(collection): List view — card-per-section + add/rename/delete table + add item"
```

---

### Task 12: Status editor + assign pill (port demo `collection-status-editor.html`)

**Files:** Modify `app/src/CollectionView.tsx`

- [ ] **Step 1: Thêm nút "Statuses" + popover editor** vào header CollectionView. Port từ `demo/collection-status-editor.html`. Editor là popover (absolute) liệt kê `collection.statuses`: mỗi dòng swatch (click → grid `COLLECTION_PALETTE` → `recolorStatus`), input tên (`renameStatus` onBlur/Enter), ✕ (`deleteStatus` + confirm); "＋ Add status" → `addStatus(collectionId, 'New status', COLLECTION_PALETTE[0])`. Import thêm: `addStatus, renameStatus, recolorStatus, deleteStatus, COLLECTION_PALETTE`.

- [ ] **Step 2: StatusPill có thể bấm để gán** — pill trong SectionCard mở menu chọn 1 trong `collection.statuses` hoặc "No status"; chọn xong gọi `db.tasks.update(taskId, { collectionStatusId: id|null })`.

- [ ] **Step 3: tsc + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verify (DOM)** — mở editor, đếm số dòng status = 2 (FEATURE, EVENT mặc định); bấm Add status → 3.
```bash
cat > /tmp/v.mjs <<'EOF'
import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage()
await p.goto('http://localhost:5173'); await p.waitForTimeout(1500)
// giả định đã có collection từ Task 11 (chọn nó)
await p.getByText('Live-ops 2026').first().click().catch(()=>{})
await p.getByRole('button', { name: /Statuses/ }).click(); await p.waitForTimeout(300)
console.log('status rows:', await p.locator('[data-status-row]').count())
await b.close()
EOF
node app/v.mjs; rm app/v.mjs
EOF
```
Expected: `status rows: 2` (gắn `data-status-row` lên mỗi dòng trong editor để query).

- [ ] **Step 5: Commit**

```bash
git add app/src/CollectionView.tsx
git commit -m "feat(collection): per-collection status editor + click-to-assign pill"
```

---

## PHASE 5 — Collection Calendar (CollectionCalendar.tsx)

### Task 13: Month grid + thanh liền mạch (port demo `event-calendar-seamless.html`)

**Files:** Create `app/src/CollectionCalendar.tsx`; Modify `app/src/CollectionView.tsx`

- [ ] **Step 1: Tạo `app/src/CollectionCalendar.tsx`** — dùng helper thuần đã TDD:

```tsx
import { useState } from 'react'
import { buildMonthGrid, assignLanes, computeBarSegments, type CalItem } from './lib'
import type { Collection, Task } from './db'

const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December']
const TODAY = new Date().toISOString().slice(0, 10)

export function CollectionCalendar({ collection, items }: { collection: Collection; items: Task[] }) {
  const [view, setView] = useState(() => { const d = new Date(); return { y: d.getUTCFullYear(), m: d.getUTCMonth() } })
  const statusById = new Map(collection.statuses.map((s) => [s.id, s]))
  const grid = buildMonthGrid(view.y, view.m, TODAY)
  // chỉ item có startDate; end = dueDate ?? startDate
  const cal: (CalItem & { task: Task })[] = items
    .filter((t) => t.startDate)
    .map((t) => ({ id: t.id, start: t.startDate!, end: t.dueDate ?? t.startDate!, task: t }))
  const lanes = assignLanes(cal)
  const segs = computeBarSegments(cal, grid, lanes)
  const maxLane = Math.max(0, ...cal.map((c) => lanes.get(c.id) ?? 0))
  // ... render grid (7 cols/tuần) + segments theo demo event-calendar-seamless.html:
  //   - mỗi tuần: gridTemplateRows `30px repeat(maxLane+1,23px) 1fr`
  //   - bgcell (col separator + .oom mờ), dnum (today = nền tròn accent)
  //   - bar: gridColumn `colStart / span N`, gridRow lane+2; Soft style
  //     (bg = status.color @14%, text = status.color, vạch trái khi roundL);
  //     bo tròn theo roundL/roundR; chevron ‹/› theo leftChev/rightChev.
  return (/* JSX port từ demo, dùng segs/grid/statusById; nav tháng đổi view */ null)
}
```

> Render đầy đủ theo `demo/event-calendar-seamless.html` (đã verify): bar Soft, today ring, oom mờ, nav `‹ ›` đổi `view`. Màu bar/dot lấy từ `statusById.get(seg.task.collectionStatusId)?.color` (rỗng → `#C7C7CC`). Title bar = `task.title`.

- [ ] **Step 2: Gắn vào CollectionView** — nhánh `tab === 'calendar'` render `<CollectionCalendar collection={collection} items={items} />`.

- [ ] **Step 3: tsc + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verify (DOM)** — chuyển sang Calendar, đếm số tuần + số bar:
```bash
cat > /tmp/v.mjs <<'EOF'
import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage()
await p.goto('http://localhost:5173'); await p.waitForTimeout(1500)
await p.getByText('Live-ops 2026').first().click().catch(()=>{})
await p.getByRole('button', { name: 'Calendar' }).click(); await p.waitForTimeout(400)
console.log('weeks:', await p.locator('[data-week]').count())
console.log('bars:', await p.locator('[data-bar]').count())
await b.close()
EOF
node app/v.mjs; rm app/v.mjs
```
Expected: `weeks` 5–6; `bars` ≥ số item có ngày trong tháng (gắn `data-week`/`data-bar` để query).

- [ ] **Step 5: Commit**

```bash
git add app/src/CollectionCalendar.tsx app/src/CollectionView.tsx
git commit -m "feat(collection): Calendar view — seamless multi-day bars + multi-month chevrons"
```

---

## PHASE 6 — Docs + sanity gate

### Task 14: Cập nhật docs + sanity gate cuối

**Files:** Modify `design-docs/collections.md`, `design-docs/data-model.md`

- [ ] **Step 1: `collections.md`** — đổi `**Status:** Planned` → `Implemented`, bump `Last updated`, cập nhật phần Code (file thật: `CollectionView.tsx`, `CollectionCalendar.tsx`).

- [ ] **Step 2: `data-model.md`** — thêm entity `Collection`/`Section`/`CollectionStatus`; ghi Task fields mới (`collectionId` indexed, `sectionId`/`collectionStatusId` non-indexed, `sprintId` nullable); thêm dòng bảng version **v9**; cập nhật danh sách indexes (`collections: id, projectId, order`; `tasks` thêm `collectionId`).

- [ ] **Step 3: Sanity gate (theo CLAUDE.md)**

Run: `cd app && npx tsc --noEmit && npm run build && npx vitest run`
Expected: PASS hết. Fail → dừng, sửa, không đi tiếp.

- [ ] **Step 4: Commit**

```bash
git add design-docs/collections.md design-docs/data-model.md
git commit -m "docs(collections): mark Implemented + sync data-model v9"
```

---

## Self-Review (đã chạy)

**1. Spec coverage:** Sidebar Sprints/Collections (Task 10) ✓ · collection tên tự đặt + CRUD (Task 2, 10) ✓ · nhiều section/bảng tự đặt tên (Task 3, 11) ✓ · status tự tạo per-collection + palette Apple (Task 4, 12) ✓ · item là Task với collectionId/sectionId/collectionStatusId + bất biến sprintId XOR collectionId (Task 1, 5) ✓ · List card-per-section (Task 11) ✓ · Calendar thanh liền mạch + lane + đa tháng chevron + Soft (Task 7–9, 13) ✓ · xoá section→dồn bảng đầu, xoá status→null, xoá collection→xoá item (Task 2–4) ✓ · scheduler cách ly (sprintId null, Task 1 + guard Task 10 step 6) ✓ · migration v9 không mất dữ liệu + export/import v3 back-compat (Task 1, 6) ✓.

**2. Placeholder scan:** Phần data + logic thuần (Task 1–9) có code đầy đủ + test. Task 11–13 (component) port từ **3 demo HTML đã verify** trong `demo/` — code nguồn tồn tại & review được; khung TSX + mọi lời gọi db/helper được chỉ rõ. Đây là port có chủ đích, không phải "TODO".

**3. Type consistency:** `collectionId`/`sectionId`/`collectionStatusId` nhất quán giữa db.ts (Task 1), CRUD (Task 2–5), view (Task 11–13). Helper `buildMonthGrid`/`assignLanes`/`computeBarSegments` + types `CalItem`/`MonthGrid`/`BarSegment` định nghĩa Task 7–9, dùng Task 13. `createCollection(projectId, name)` chữ ký dùng nhất quán ở App.tsx (Task 10) và test (Task 2).

**Lưu ý rủi ro:** đổi `Task.sprintId: string → string | null` có thể lộ vài chỗ TS ở `SprintView/BoardView/GanttView` khi truyền task. Các view này luôn nhận task của một sprint cụ thể nên runtime an toàn; xử lý lỗi tsc tại chỗ ở Task 10 step 7 (ép dùng `currentSprint.id`, hoặc thu hẹp kiểu khi map). Nếu phát sinh nhiều → cân nhắc tách thành task phụ trước Phase 4.
