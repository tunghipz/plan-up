import { describe, expect, it } from 'vitest'
import {
  formatCollectionTree,
  formatSprintTree,
  membersWithTasks,
  sectionsWithItems,
} from './telegram-export'
import type { Collection, Member, Sprint, Task } from './types'

function member(id: string, name: string, order?: number): Member {
  return { id, projectId: 'p', name, color: '#0071e3', daysOff: [], order }
}

function task(id: string, assigneeId: string | null, seq: number, over: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'p',
    sequence: seq,
    title: `Task ${seq}`,
    assigneeId,
    sprintId: 's',
    status: 'todo',
    priority: 'normal',
    startDate: null,
    dueDate: null,
    estimate: null,
    createdAt: seq,
    dependsOn: [],
    ...over,
  }
}

const sprint: Sprint = {
  id: 's',
  projectId: 'p',
  name: 'Sprint 12',
  startDate: '2026-07-08',
  endDate: '2026-07-19',
}

describe('formatSprintTree', () => {
  it('opens with a 📋 header line carrying the name + date range', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [task('t1', 'a', 1)])
    expect(out.split('\n')[0]).toBe('📋 Sprint 12  ·  Jul 8 → Jul 19')
  })

  it('renders status as WORDS and appends due only when present', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('t1', 'a', 12, { title: 'Payment', status: 'in_progress', dueDate: '2026-07-15' }),
      task('t2', 'a', 14, { title: 'Refund', status: 'todo' }),
    ])
    expect(out).toContain('#12 Payment — In progress · Jul 15')
    expect(out).toContain('#14 Refund — To do')
    // no due → no trailing " · <date>"
    expect(out).not.toMatch(/#14 Refund — To do ·/)
  })

  it('renders a full start → end range on the task line', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('t1', 'a', 12, {
        title: 'Payment', status: 'in_progress',
        startDate: '2026-07-08', dueDate: '2026-07-15',
      }),
    ])
    expect(out).toContain('#12 Payment — In progress · Jul 8 → Jul 15')
  })

  it('shows a one-sided date (start-only / due-only) without an arrow', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('t1', 'a', 1, { title: 'StartOnly', startDate: '2026-07-08', dueDate: null }),
      task('t2', 'a', 2, { title: 'DueOnly', startDate: null, dueDate: '2026-07-15' }),
    ])
    const line = (needle: string) => out.split('\n').find((l) => l.includes(needle))!
    expect(line('StartOnly')).toContain('StartOnly — To do · Jul 8')
    expect(line('StartOnly')).not.toContain('→')
    expect(line('DueOnly')).toContain('DueOnly — To do · Jul 15')
    expect(line('DueOnly')).not.toContain('→')
  })

  it('shows the start → end range on subtasks too (still no #seq)', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('p1', 'a', 12, { title: 'Parent' }),
      task('c1', 'a', 13, {
        title: 'Child', parentId: 'p1', status: 'done',
        startDate: '2026-07-08', dueDate: '2026-07-11',
      }),
    ])
    const child = out.split('\n').find((l) => l.includes('Child'))!
    expect(child).toContain('Child — Done · Jul 8 → Jul 11')
    expect(child).not.toContain('#13')
  })

  it('orders each lane by end date (ascending), undated tasks last', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('t1', 'a', 1, { title: 'Late', dueDate: '2026-07-22' }),
      task('t2', 'a', 2, { title: 'Early', dueDate: '2026-07-10' }),
      task('t3', 'a', 3, { title: 'NoDate' }),
    ])
    const seen = out.split('\n')
      .map((l) => l.match(/Early|Late|NoDate/)?.[0])
      .filter(Boolean)
    expect(seen).toEqual(['Early', 'Late', 'NoDate'])
  })

  it('never emits priority', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('t1', 'a', 1, { priority: 'urgent' }),
    ])
    expect(out).not.toMatch(/Urgent|Gấp|urgent|priority/i)
  })

  it('uses ├─ for non-last members/tasks and └─ for the last', () => {
    const members = [member('a', 'An', 0), member('b', 'Bình', 1)]
    const out = formatSprintTree(sprint, members, [task('t1', 'a', 1), task('t2', 'b', 2)])
    const lines = out.split('\n')
    expect(lines).toContain('├─ 👤 An')
    expect(lines).toContain('└─ 👤 Bình')
  })

  it('nests a child under its parent within the lane (no #seq, status only)', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('p1', 'a', 12, { title: 'Payment' }),
      task('c1', 'a', 13, { title: 'Webhooks', parentId: 'p1', status: 'done' }),
    ])
    const lines = out.split('\n')
    const parent = lines.findIndex((l) => l.includes('#12 Payment'))
    const child = lines.findIndex((l) => l.includes('Webhooks'))
    expect(parent).toBeGreaterThan(-1)
    expect(child).toBe(parent + 1)
    expect(lines[child]).toContain('Webhooks — Done')
    expect(lines[child]).not.toContain('#13') // children drop the seq
  })

  it('labels the unassigned bucket "Unassigned" and sorts it last', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('t1', 'a', 1),
      task('t2', null, 2),
    ])
    const lines = out.split('\n')
    expect(lines).toContain('├─ 👤 An')
    expect(lines).toContain('└─ 👤 Unassigned')
    expect(lines.indexOf('└─ 👤 Unassigned')).toBeGreaterThan(lines.indexOf('├─ 👤 An'))
  })

  it('scopes to a single member when memberId is given', () => {
    const members = [member('a', 'An', 0), member('b', 'Bình', 1)]
    const tasks = [task('t1', 'a', 1), task('t2', 'b', 2)]
    const out = formatSprintTree(sprint, members, tasks, { memberId: 'a' })
    expect(out).toContain('👤 An')
    expect(out).not.toContain('Bình')
    // the sole member becomes the last branch
    expect(out).toContain('└─ 👤 An')
  })

  it('emits just the header when the sprint has no tasks', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [])
    expect(out).toBe('📋 Sprint 12  ·  Jul 8 → Jul 19')
  })
})

describe('membersWithTasks', () => {
  it('returns only real members that own tasks, in lane order, excluding unassigned', () => {
    const members = [member('b', 'Bình', 1), member('a', 'An', 0), member('c', 'Chi', 2)]
    const tasks = [task('t1', 'b', 1), task('t2', 'a', 2), task('t3', null, 3)]
    expect(membersWithTasks(members, tasks).map((m) => m.name)).toEqual(['An', 'Bình'])
  })
})

// ── Collections ────────────────────────────────────────────────────────────

const collection: Collection = {
  id: 'c',
  projectId: 'p',
  name: 'Lịch sự kiện',
  order: 0,
  createdAt: 0,
  sections: [
    { id: 'jul', name: 'July 2026' },
    { id: 'aug', name: 'August 2026' },
  ],
  statuses: [
    { id: 'ev', name: 'EVENT', color: '#0071e3' },
    { id: 'idea', name: 'Idea', color: '#8e8e93' },
  ],
}

/** A collection item: no sprint/status, carries sectionId + collectionStatusId + range. */
function citem(id: string, sectionId: string, over: Partial<Task> = {}): Task {
  return {
    ...task(id, null, 1),
    sprintId: null,
    collectionId: 'c',
    sectionId,
    collectionStatusId: 'ev',
    ...over,
  }
}

describe('formatCollectionTree', () => {
  it('groups by section with 📁, no #seq, status name + start→end range', () => {
    const tasks = [
      citem('a', 'jul', { title: 'Đập trứng', startDate: '2026-07-03', dueDate: '2026-07-05' }),
      citem('b', 'jul', { title: 'Thả bóng', startDate: '2026-07-17', dueDate: '2026-07-19' }),
    ]
    const out = formatCollectionTree(collection, tasks)
    expect(out.split('\n')[0]).toBe('📋 Lịch sự kiện')
    expect(out).toContain('└─ 📁 July 2026')
    expect(out).toContain('Đập trứng — EVENT · Jul 3 → Jul 5')
    expect(out).not.toMatch(/#\d/) // no sequence numbers for collections
  })

  it('uses the item CUSTOM status name (not todo/done), omits status when none', () => {
    const tasks = [
      citem('a', 'jul', { title: 'Idea one', collectionStatusId: 'idea', startDate: null, dueDate: null }),
      citem('b', 'jul', { title: 'No status', collectionStatusId: null, startDate: null, dueDate: null }),
    ]
    const out = formatCollectionTree(collection, tasks)
    expect(out).toContain('Idea one — Idea')
    expect(out).toContain('└─ No status') // no " — " tail at all
    expect(out).not.toMatch(/No status —/)
  })

  it('renders a one-sided date (start only / due only)', () => {
    const out = formatCollectionTree(collection, [
      citem('a', 'jul', { title: 'Start only', startDate: '2026-07-03', dueDate: null }),
      citem('b', 'jul', { title: 'Due only', startDate: null, dueDate: '2026-07-09' }),
    ])
    expect(out).toContain('Start only — EVENT · Jul 3')
    expect(out).toContain('Due only — EVENT · Jul 9')
    expect(out).not.toContain('→') // no arrow when only one side present
  })

  it('nests a child under its parent within the section (no status → title only)', () => {
    const out = formatCollectionTree(collection, [
      citem('p1', 'jul', { title: 'Parent', startDate: null, dueDate: null }),
      citem('c1', 'jul', { title: 'Child', parentId: 'p1', collectionStatusId: 'idea', startDate: null, dueDate: null }),
    ])
    const lines = out.split('\n')
    const parent = lines.findIndex((l) => l.includes('Parent'))
    const child = lines.findIndex((l) => l.includes('Child'))
    expect(child).toBe(parent + 1)
    expect(lines[child]).toContain('Child — Idea')
  })

  it('shows the start → end range on collection subtasks too', () => {
    const out = formatCollectionTree(collection, [
      citem('p1', 'jul', { title: 'Parent', startDate: null, dueDate: null }),
      citem('c1', 'jul', {
        title: 'Child', parentId: 'p1', collectionStatusId: 'idea',
        startDate: '2026-07-03', dueDate: '2026-07-05',
      }),
    ])
    const child = out.split('\n').find((l) => l.includes('Child'))!
    expect(child).toContain('Child — Idea · Jul 3 → Jul 5')
  })

  it('orders items in a section by end date (ascending), undated last', () => {
    const out = formatCollectionTree(collection, [
      citem('a', 'jul', { title: 'Late', dueDate: '2026-07-20' }),
      citem('b', 'jul', { title: 'Early', dueDate: '2026-07-05' }),
      citem('c', 'jul', { title: 'NoDate', startDate: null, dueDate: null }),
    ])
    const seen = out.split('\n')
      .map((l) => l.match(/Early|Late|NoDate/)?.[0])
      .filter(Boolean)
    expect(seen).toEqual(['Early', 'Late', 'NoDate'])
  })

  it('drops empty sections and can scope to one section', () => {
    const tasks = [citem('a', 'jul', { title: 'Only July' })]
    const out = formatCollectionTree(collection, tasks)
    expect(out).toContain('July 2026')
    expect(out).not.toContain('August 2026') // empty section dropped
    const scoped = formatCollectionTree(collection, [
      citem('a', 'jul', { title: 'A' }),
      citem('b', 'aug', { title: 'B' }),
    ], { sectionId: 'aug' })
    expect(scoped).toContain('August 2026')
    expect(scoped).not.toContain('July 2026')
  })
})

describe('sectionsWithItems', () => {
  it('returns collection sections (in order) that own items', () => {
    const tasks = [citem('a', 'aug', {}), citem('b', 'jul', {})]
    expect(sectionsWithItems(collection, tasks).map((s) => s.name)).toEqual([
      'July 2026',
      'August 2026',
    ])
  })
})
